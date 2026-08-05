const ExcelJS = require('exceljs');
const https = require('https');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '_bruteforce_review');

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 30000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function buildPolygonOverlaySvg(points, width, height, strokeWidth, color) {
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z';
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" ` +
    `stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  return Buffer.from(svg);
}

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('C:\\Users\\Pedro\\Downloads\\ATW-2024-0063-2-NAWP-LAGOA DOS VENTOS-VSR05-06.xlsx');
  const ws = wb.worksheets[0];
  const headerMap = new Map();
  ws.getRow(1).eachCell((c, col) => {
    const v = String(c.value ?? '').trim().toLowerCase();
    if (v) headerMap.set(v, col);
  });
  const col = (name) => headerMap.get(name.toLowerCase());

  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const photoLink = row.getCell(20).value;
    const polyRaw = row.getCell(col('polygon data/coordinates')).value;
    if (!photoLink || !polyRaw) continue;
    let points;
    try { points = JSON.parse(polyRaw); } catch { continue; }
    if (!Array.isArray(points) || points.length < 3) continue;

    rows.push({
      r,
      defectId: row.getCell(col('defect id')).value,
      bladeSn: row.getCell(13).value,
      section: row.getCell(col('section')).value,
      side: row.getCell(col('side')).value,
      component: row.getCell(col('component')).value,
      type: row.getCell(col('type')).value,
      layer: row.getCell(col('layer')).value,
      severity: row.getCell(col('severity')).value,
      location: row.getCell(col('location(m)')).value,
      lengthMm: row.getCell(col('length(mm)')).value,
      widthMm: row.getCell(col('width(mm)')).value,
      inspectionDate: row.getCell(col('inspection date')).value,
      defectStatus: row.getCell(col('defect status')).value,
      photoLink,
      points,
    });
  }

  console.log(`Found ${rows.length} rows with photo+polygon. Processing...`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const manifest = [];
  let i = 0;
  for (const row of rows) {
    i++;
    try {
      const buf = await fetchBuffer(row.photoLink);
      const meta = await sharp(buf).metadata();
      const width = meta.width, height = meta.height;

      // RAW coordinates, as-is, only correcting Y sign — no scale, no shift.
      const rawPoints = row.points.map(p => ({ x: Math.round(p.x), y: Math.round(Math.abs(p.y)) }));
      const closed = [...rawPoints, rawPoints[0]];

      const xs = rawPoints.map(p => p.x), ys = rawPoints.map(p => p.y);
      const pW = Math.max(...xs) - Math.min(...xs);
      const pH = Math.max(...ys) - Math.min(...ys);
      const pCy = ys.reduce((a,b)=>a+b,0)/ys.length;
      const ambiguous = pW < 1000 && pH < 600 && pCy < 1600;

      const thickness = Math.max(6, Math.round(width / 400));
      const overlay = buildPolygonOverlaySvg(closed, width, height, thickness, '#FF0000');

      const safeId = String(row.defectId).replace(/[^a-zA-Z0-9_-]/g, '_');
      const fname = `${String(i).padStart(3,'0')}_blade${row.bladeSn}_${safeId}${ambiguous ? '_AMBIG' : ''}.jpg`;
      await sharp(buf).composite([{ input: overlay }]).jpeg({ quality: 80 }).toFile(path.join(OUT_DIR, fname));

      manifest.push({ ...row, points: undefined, width, height, pW, pH, pCy, ambiguous, file: fname });
      console.log(`[${i}/${rows.length}] ${fname} (dims ${width}x${height}, ambiguous=${ambiguous})`);
    } catch (e) {
      console.log(`[${i}/${rows.length}] ERROR row ${row.r} (${row.defectId}): ${e.message}`);
      manifest.push({ ...row, points: undefined, error: e.message });
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, '_manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nDone. ${manifest.filter(m=>m.ambiguous).length} ambiguous (small bbox) out of ${manifest.length}.`);
  console.log(`Output folder: ${OUT_DIR}`);
})();
