const fs = require('fs');
const iconv = require('iconv-lite');

const FILE = process.env.DBF_FILE || '../ОборотыTEST.dbf';
const buffer = fs.readFileSync(FILE);
const recordCount = buffer.readUInt32LE(4);
const headerLen = buffer.readUInt16LE(8);
const recordLen = buffer.readUInt16LE(10);
const fields = [];
let offset = 32;
while (buffer[offset] !== 0x0d && offset < headerLen) {
  const nameBuf = buffer.subarray(offset, offset + 11);
  const zero = nameBuf.indexOf(0);
  const name = nameBuf
    .subarray(0, zero >= 0 ? zero : 11)
    .toString('ascii')
    .trim();
  const type = String.fromCharCode(buffer[offset + 11]);
  const length = buffer[offset + 16];
  const decimal = buffer[offset + 17];
  fields.push({ name, type, length, decimal });
  offset += 32;
}

const fieldIndex = Object.fromEntries(fields.map((f, i) => [f.name, i]));
const dateField = fields[fieldIndex.DATE];
if (!dateField) {
  console.error('DATE field not found');
  process.exit(1);
}

let dataOffset = headerLen;
let minDate = null;
let maxDate = null;
const sampleDates = new Map();
const maxSample = 20;

for (let i = 0; i < recordCount; i++) {
  const rec = buffer.subarray(dataOffset + i * recordLen, dataOffset + (i + 1) * recordLen);
  if (rec[0] === 0x2a) continue;
  let ptr = 1;
  let dateTxt = null;
  for (const field of fields) {
    const slice = rec.subarray(ptr, ptr + field.length);
    ptr += field.length;
    if (field.name === 'DATE') {
      dateTxt = slice.toString('ascii').trim();
      break;
    }
  }
  if (!dateTxt) continue;
  if (!minDate || dateTxt < minDate) minDate = dateTxt;
  if (!maxDate || dateTxt > maxDate) maxDate = dateTxt;
  if (!sampleDates.has(dateTxt)) {
    sampleDates.set(dateTxt, sampleDates.size);
    if (sampleDates.size >= maxSample) break;
  }
}

console.log('Record count:', recordCount);
console.log('Date range:', minDate, maxDate);
console.log('Sample unique dates:', Array.from(sampleDates.keys()));
