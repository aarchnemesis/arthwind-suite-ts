const ExcelJS = require('exceljs');
const https = require('https');
const sharp = require('sharp');

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

  const candidates = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const loc = Number(row.getCell(col('Location(m)')).value);
    const bladeSn = row.getCell(13).value;
    const photoLink = row.getCell(20).value;
    if (!isFinite(loc) || !photoLink) continue;
    candidates.push({ r, loc, bladeSn, photoLink });
  }

  // sample a spread: some <13, some >13, across different blades if possible
  const under13 = candidates.filter(c => c.loc <= 13);
  const over13 = candidates.filter(c => c.loc > 13);
  console.log(`Total rows with location+photo: ${candidates.length} (<=13m: ${under13.length}, >13m: ${over13.length})`);

  const sampleOver = over13.filter((_, i) => i % Math.max(1, Math.floor(over13.length / 8)) === 0).slice(0, 8);
  const sampleUnder = under13.slice(0, 4);

  for (const c of [...sampleUnder, ...sampleOver]) {
    try {
      const buf = await fetchBuffer(c.photoLink);
      const meta = await sharp(buf).metadata();
      const aspect = (meta.width / meta.height).toFixed(3);
      console.log(`row ${c.r} blade=${c.bladeSn} loc=${c.loc}m -> ${meta.width}x${meta.height} (aspect ${aspect}) ${Math.abs(aspect-2)<0.15?'*** 360/EQUIRECT ***':''}`);
    } catch (e) {
      console.log(`row ${c.r} blade=${c.bladeSn} loc=${c.loc}m -> ERROR ${e.message}`);
    }
  }
})();
