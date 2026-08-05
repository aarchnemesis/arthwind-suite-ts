const ExcelJS = require('exceljs');
const https = require('https');

function fetchDims(url) {
  return new Promise((resolve) => {
    https.get(url, { timeout: 15000 }, (res) => {
      const chunks = [];
      let total = 0;
      res.on('data', (c) => { chunks.push(c); total += c.length; if (total > 200000) { res.destroy(); resolve(Buffer.concat(chunks)); } });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', () => resolve(null));
    }).on('error', () => resolve(null));
  });
}

// crude JPEG SOF0/SOF2 dimension parser
function jpegDims(buf) {
  if (!buf || buf.length < 4) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
    if (marker === 0xD9) break;
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      return { width, height };
    }
    i += 2 + len;
  }
  return null;
}

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('C:\\Users\\Pedro\\Downloads\\ATW-2024-0063-2-NAWP-LAGOA DOS VENTOS-VSR05-06.xlsx');
  const ws = wb.worksheets[0];
  const headerRow = ws.getRow(1);
  const headerMap = new Map();
  headerRow.eachCell((cell, col) => {
    const v = String(cell.value ?? '').trim().toLowerCase();
    if (v) headerMap.set(v, col);
  });

  const surfaces = new Set();
  let externalCount = 0, printed = 0;
  for (let r = 2; r <= ws.rowCount && printed < 8; r++) {
    const row = ws.getRow(r);
    const surfaceCol = headerMap.get('surface');
    const surface = surfaceCol ? String(row.getCell(surfaceCol).value ?? '') : '';
    surfaces.add(surface);
    if (surface.toLowerCase() !== 'external') continue;
    externalCount++;
    const polyCol = headerMap.get('polygon data/coordinates');
    const poly = polyCol ? row.getCell(polyCol).value : null;
    const photoLink = row.getCell(20).value;
    const bladeSn = row.getCell(13).value;
    console.log('ROW', r, 'bladeSn=', bladeSn, 'surface=', surface);
    console.log('  photoLink=', photoLink);
    console.log('  poly=', poly);
    printed++;
  }
  console.log('Distinct surfaces seen:', [...surfaces]);
  console.log('External rows found (checked up to row', ws.rowCount, '):', externalCount);
})();
