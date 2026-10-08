import { test } from 'vitest';
import { assertEquals } from '../test/asserts.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tempFile } from '../test/tmp.js';
import { jpegMergeWriter, parseJpegSegments } from './jpeg-merge.js';
import { mergePhotoshopIrb } from './iptc.js';

const execFileP = promisify(execFile);
const upstreamExifTool = new URL('../../vendor/exiftool/exiftool', import.meta.url).pathname;

function app13Payloads(bytes: Uint8Array): Uint8Array[] {
  return parseJpegSegments(bytes)
    .filter((s) => s.marker === 0xed)
    .map((s) => bytes.subarray(s.payloadStart, s.payloadEnd));
}

function decodeIim(payload: Uint8Array): Array<{ record: number; dataset: number; value: string }> {
  const out: Array<{ record: number; dataset: number; value: string }> = [];
  // Skip "Photoshop 3.0\0", walk 8BIM blocks.
  let pos = 14;
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  while (pos + 12 <= payload.length) {
    const sig = String.fromCharCode(...payload.subarray(pos, pos + 4));
    const id = dv.getUint16(pos + 4);
    let p = pos + 6;
    const nameLen = payload[p];
    p += 1 + nameLen + (1 + nameLen) % 2;
    const size = dv.getUint32(p);
    p += 4;
    if (sig === '8BIM' && id === 0x0404) {
      let q = p;
      while (q + 5 <= p + size && payload[q] === 0x1c) {
        const record = payload[q + 1];
        const dataset = payload[q + 2];
        const len = (payload[q + 3] << 8) | payload[q + 4];
        out.push({ record, dataset, value: new TextDecoder().decode(payload.subarray(q + 5, q + 5 + len)) });
        q += 5 + len;
      }
    }
    pos = p + size + size % 2;
  }
  return out;
}

test('fresh APP13 with UTF-8 keywords and CodedCharacterSet', () => {
  const out = jpegMergeWriter(
    new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    { 'IPTC:Keywords': ['kelp', 'forêt 🌲'] },
  );
  const payloads = app13Payloads(out.bytes);
  assertEquals(payloads.length, 1);
  const sets = decodeIim(payloads[0]);
  assertEquals(sets[0], { record: 1, dataset: 90, value: '\x1b%G' });
  assertEquals(sets.slice(1), [
    { record: 2, dataset: 25, value: 'kelp' },
    { record: 2, dataset: 25, value: 'forêt 🌲' },
  ]);
});

test('writes generated IPTC ApplicationRecord datasets and removes the empty APP13', () => {
  const base = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const first = jpegMergeWriter(base, {
    'IPTC:ObjectName': 'A caption',
    'IPTC:City': 'Seattle',
    'IPTC:Urgency': 2,
  });
  assertEquals(first.written, ['IPTC:ObjectName', 'IPTC:City', 'IPTC:Urgency']);
  const sets = decodeIim(app13Payloads(first.bytes)[0]!);
  assertEquals(sets.slice(1), [
    { record: 2, dataset: 5, value: 'A caption' },
    { record: 2, dataset: 90, value: 'Seattle' },
    { record: 2, dataset: 10, value: '2' },
  ]);

  const deleted = jpegMergeWriter(first.bytes, {
    'IPTC:ObjectName': null,
    'IPTC:City': null,
    'IPTC:Urgency': null,
    'IPTC:CodedCharacterSet': null,
  });
  assertEquals(deleted.written.length, 4);
  assertEquals(app13Payloads(deleted.bytes), []);
});

test('vendored ExifTool reads generic IPTC fields written by the JPEG merger', async () => {
  const file = await tempFile('.jpg');
  try {
    const original = new Uint8Array(await readFile('assets/01.jpg'));
    const result = jpegMergeWriter(original, {
      'IPTC:ObjectName': 'A caption',
      'IPTC:City': 'Seattle',
      'IPTC:Urgency': 2,
    });
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-G1', '-IPTC:ObjectName', '-IPTC:City', '-IPTC:Urgency', file,
    ]);
    const info = JSON.parse(stdout)[0];
    assertEquals(info['IPTC:ObjectName'], 'A caption');
    assertEquals(info['IPTC:City'], 'Seattle');
    assertEquals(info['IPTC:Urgency'], 2);
  } finally {
    await rm(file, { force: true });
  }
});

test('merges into an existing APP13 without touching other 8BIM blocks', () => {
  // Existing payload: 8BIM 0x040f (resolution) + 8BIM 0x0404 with old keyword.
  const header = new TextEncoder().encode('Photoshop 3.0\0');
  const oldIptc = new Uint8Array([0x1c, 0x02, 0x19, 0x00, 0x03, 0x6f, 0x6c, 0x64]); // 'old'
  const parts = (id: number, data: Uint8Array): number[] => {
    const name = [0, 0]; // empty pascal name padded
    const size = [data.length >> 24 & 255, data.length >> 16 & 255, data.length >> 8 & 255, data.length & 255];
    return [...[0x38, 0x42, 0x49, 0x4d], id >> 8, id & 255, ...name, ...size, ...data, ...(data.length % 2 ? [0] : [])];
  };
  const payload = new Uint8Array([
    ...header,
    ...parts(0x040f, new Uint8Array([1, 2, 3, 4])),
    ...parts(0x0404, oldIptc),
  ]);
  const merged = mergePhotoshopIrb(payload, ['new']);
  const sets = decodeIim(merged);
  assertEquals(sets, [{ record: 1, dataset: 90, value: '\x1b%G' }, { record: 2, dataset: 25, value: 'new' }]);
  // The 0x040f block survives verbatim (its data bytes appear in the payload).
  const mergedHex = Array.from(merged).join(',');
  assertEquals(mergedHex.includes('1,2,3,4'), true);
  assertEquals(new TextDecoder().decode(merged).includes('old'), false);
});

test('IPTC write is idempotent and splices into an existing APP13 segment', () => {
  const base = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const first = jpegMergeWriter(base, { 'IPTC:Keywords': ['a', 'b'] });
  const second = jpegMergeWriter(first.bytes, { 'IPTC:Keywords': ['a', 'b'] });
  assertEquals(Array.from(second.bytes), Array.from(first.bytes));
});

test('iimDataset throws on oversized keyword datasets', () => {
  let threw = false;
  try {
    jpegMergeWriter(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
      'IPTC:Keywords': ['x'.repeat(0x10000)],
    });
  } catch (e) {
    threw = e instanceof Error && e.message.includes('64 KiB');
  }
  assertEquals(threw, true);
});
