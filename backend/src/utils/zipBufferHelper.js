const path = require('path');

function safeText(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function toDosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;

  return { dosDate, dosTime };
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buffer) {
  let crc = 0 ^ -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function writeUInt16LE(buffer, value, offset) {
  buffer.writeUInt16LE(value & 0xffff, offset);
}

function writeUInt32LE(buffer, value, offset) {
  buffer.writeUInt32LE(value >>> 0, offset);
}

function normalizeEntryName(name, index) {
  const clean = safeText(name).replace(/\\/g, '/').replace(/^\/+/, '');
  const base = clean || `arquivo_${index + 1}`;
  return path.posix.basename(base);
}

function createZipFromEntries(entries = []) {
  const normalizedEntries = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && Buffer.isBuffer(entry.data))
    .map((entry, index) => ({
      name: normalizeEntryName(entry.name, index),
      data: entry.data,
      date: entry.date instanceof Date ? entry.date : new Date(),
    }));

  if (!normalizedEntries.length) {
    throw new Error('Nenhum arquivo válido foi informado para compactação ZIP.');
  }

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  normalizedEntries.forEach((entry) => {
    const fileNameBuffer = Buffer.from(entry.name, 'utf8');
    const { dosDate, dosTime } = toDosDateTime(entry.date);
    const data = entry.data;
    const checksum = crc32(data);

    const localHeader = Buffer.alloc(30);
    writeUInt32LE(localHeader, 0x04034b50, 0);
    writeUInt16LE(localHeader, 20, 4);
    writeUInt16LE(localHeader, 0x0800, 6);
    writeUInt16LE(localHeader, 0, 8);
    writeUInt16LE(localHeader, dosTime, 10);
    writeUInt16LE(localHeader, dosDate, 12);
    writeUInt32LE(localHeader, checksum, 14);
    writeUInt32LE(localHeader, data.length, 18);
    writeUInt32LE(localHeader, data.length, 22);
    writeUInt16LE(localHeader, fileNameBuffer.length, 26);
    writeUInt16LE(localHeader, 0, 28);

    localParts.push(localHeader, fileNameBuffer, data);

    const centralHeader = Buffer.alloc(46);
    writeUInt32LE(centralHeader, 0x02014b50, 0);
    writeUInt16LE(centralHeader, 20, 4);
    writeUInt16LE(centralHeader, 20, 6);
    writeUInt16LE(centralHeader, 0x0800, 8);
    writeUInt16LE(centralHeader, 0, 10);
    writeUInt16LE(centralHeader, dosTime, 12);
    writeUInt16LE(centralHeader, dosDate, 14);
    writeUInt32LE(centralHeader, checksum, 16);
    writeUInt32LE(centralHeader, data.length, 20);
    writeUInt32LE(centralHeader, data.length, 24);
    writeUInt16LE(centralHeader, fileNameBuffer.length, 28);
    writeUInt16LE(centralHeader, 0, 30);
    writeUInt16LE(centralHeader, 0, 32);
    writeUInt16LE(centralHeader, 0, 34);
    writeUInt16LE(centralHeader, 0, 36);
    writeUInt32LE(centralHeader, 0, 38);
    writeUInt32LE(centralHeader, offset, 42);

    centralParts.push(centralHeader, fileNameBuffer);

    offset += localHeader.length + fileNameBuffer.length + data.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  const localData = Buffer.concat(localParts);

  const endRecord = Buffer.alloc(22);
  writeUInt32LE(endRecord, 0x06054b50, 0);
  writeUInt16LE(endRecord, 0, 4);
  writeUInt16LE(endRecord, 0, 6);
  writeUInt16LE(endRecord, normalizedEntries.length, 8);
  writeUInt16LE(endRecord, normalizedEntries.length, 10);
  writeUInt32LE(endRecord, centralDirectory.length, 12);
  writeUInt32LE(endRecord, localData.length, 16);
  writeUInt16LE(endRecord, 0, 20);

  return Buffer.concat([localData, centralDirectory, endRecord]);
}

module.exports = {
  createZipFromEntries,
};
