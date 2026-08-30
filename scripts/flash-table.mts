import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Locate the Flash (0x9209, SHORT, count 1) value inside assets/01.jpg's
// APP1 TIFF and rewrite it per test value, then ask exiftool for its
// PrintConv rendering — building the authoritative table empirically.
const buf = readFileSync('assets/01.jpg');

// Find APP1 EXIF: FF E1 len 'Exif\0\0'
let tiffStart = -1;
for (let i = 2; i < buf.length - 4; i++) {
  if (buf[i] === 0xff && buf[i + 1] === 0xe1) {
    const len = buf.readUInt16BE(i + 2);
    const id = buf.slice(i + 4, i + 10).toString('latin1');
    if (id.startsWith('Exif')) { tiffStart = i + 10; break; }
    i += len;
  }
}
if (tiffStart < 0) throw new Error('no EXIF APP1');

const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const tiffDv = dv;
const le = tiffDv.getUint16(tiffStart, true) === 0x4949;
const ifd0 = tiffStart + tiffDv.getUint32(tiffStart + 4, le);
const num = tiffDv.getUint16(ifd0, le);
// Walk IFD0 for ExifIFD pointer (0x8769), then Flash 0x9209.
let exifIfd = -1;
for (let e = 0; e < num; e++) {
  const entry = ifd0 + 2 + e * 12;
  const tag = tiffDv.getUint16(entry, le);
  if (tag === 0x8769) exifIfd = tiffStart + tiffDv.getUint32(entry + 8, le);
}
if (exifIfd < 0) throw new Error('no Exif IFD');
const num2 = tiffDv.getUint16(exifIfd, le);
let flashEntry = -1;
for (let e = 0; e < num2; e++) {
  const entry = exifIfd + 2 + e * 12;
  const tag = tiffDv.getUint16(entry, le);
  if (tag === 0x9209) { flashEntry = entry; break; }
}
if (flashEntry < 0) throw new Error('no Flash tag');

const values = [0x0, 0x1, 0x5, 0x7, 0x8, 0x9, 0xc, 0x10, 0x14, 0x18, 0x19, 0x1d, 0x20, 0x30, 0x41, 0x45, 0x47, 0x49, 0x4d, 0x4f, 0x50, 0x58, 0x59, 0x5d, 0x11];
const work = Buffer.from(buf);
for (const v of values) {
  work.set(buf); // reset
  // SHORT count 1: value inline at entry+8 (LE for our little-endian file).
  if (le) work.writeUInt16LE(v, flashEntry + 8);
  else work.writeUInt16BE(v, flashEntry + 8);
  const f = `/tmp/flashv-${v.toString(16)}.jpg`;
  writeFileSync(f, work);
  let out = '';
  try {
    out = execFileSync('exiftool', ['-j', '-Flash', f]).toString();
  } catch (e) { out = 'ERR'; }
  const m = out.match(/"Flash": "([^"]*)"/);
  console.log(`0x${v.toString(16).padStart(2, '0')} → ${m ? m[1] : '(none)'}`);
}
