import { test } from 'vitest';
import { assertEquals } from '../test/asserts.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tempFile } from '../test/tmp.js';
import { jpegMergeWriter, parseJpegSegments } from './jpeg-merge.js';
import { mergePhotoshopIrb, resolveIptcWriteRequest } from './iptc.js';
import { parseAPP13 } from '../exif/app13.js';
import { jpegParser } from '../format/jpeg.js';
import tagData from '../tags/generated/tags.json' with { type: 'json' };
import type { TableDef } from '../tags.js';

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

test('fresh APP13 with UTF-8 keywords and CodedCharacterSet', async () => {
  const base = new Uint8Array(await readFile(new URL('../../assets/01.jpg', import.meta.url)));
  const out = jpegMergeWriter(
    base,
    { 'IPTC:CodedCharacterSet': 'UTF8', 'IPTC:Keywords': ['kelp', 'forêt 🌲'] },
  );
  const payloads = app13Payloads(out.bytes);
  const sets = payloads
    .filter((payload) => new TextDecoder().decode(payload.subarray(0, 14)) === 'Photoshop 3.0\0')
    .flatMap(decodeIim);
  assertEquals(sets.find((entry) => entry.record === 1 && entry.dataset === 90), {
    record: 1, dataset: 90, value: '\x1b%G',
  });
  assertEquals(sets.filter((entry) => entry.record === 2 && entry.dataset === 25), [
    { record: 2, dataset: 25, value: 'kelp' },
    { record: 2, dataset: 25, value: 'forêt 🌲' },
  ]);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, out.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-IPTC:CodedCharacterSet', '-IPTC:Keywords', file]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.CodedCharacterSet, 'UTF8');
    assertEquals(tags.Keywords, ['kelp', 'forêt 🌲']);
  } finally {
    await rm(file, { force: true });
  }
});

test('legacy non-ASCII IPTC survives adding a UTF-8 keyword like ExifTool', async () => {
  const header = new TextEncoder().encode('Photoshop 3.0\0');
  const iim = new Uint8Array([0x1c, 0x02, 0x05, 0x00, 0x04, 0x63, 0x61, 0x66, 0xe9]);
  const resource = new Uint8Array(12 + iim.length + iim.length % 2);
  resource.set([0x38, 0x42, 0x49, 0x4d, 0x04, 0x04, 0x00, 0x00]);
  new DataView(resource.buffer).setUint32(8, iim.length, false);
  resource.set(iim, 12);
  const payload = new Uint8Array(header.length + resource.length);
  payload.set(header);
  payload.set(resource, header.length);
  const app13Length = payload.length + 2;
  const jpeg = new Uint8Array(await readFile(new URL('../../assets/01.jpg', import.meta.url)));
  const base = new Uint8Array(jpeg.length + payload.length + 4);
  base.set(jpeg.subarray(0, 2));
  base.set([0xff, 0xed, app13Length >> 8, app13Length & 0xff], 2);
  base.set(payload, 6);
  base.set(jpeg.subarray(2), payload.length + 6);

  const upstreamFile = await tempFile('.jpg');
  const portFile = await tempFile('.jpg');
  try {
    await writeFile(upstreamFile, base);
    await writeFile(portFile, jpegMergeWriter(base, { 'IPTC:Keywords': ['forêt'] }).bytes);
    await execFileP(upstreamExifTool, ['-overwrite_original', '-IPTC:Keywords=forêt', upstreamFile]);
    const args = ['-j', '-IPTC:ObjectName', '-IPTC:Keywords'];
    const { stdout: upstreamJson } = await execFileP(upstreamExifTool, [...args, upstreamFile]);
    const { stdout: portJson } = await execFileP(upstreamExifTool, [...args, portFile]);
    const upstreamTags = JSON.parse(upstreamJson)[0];
    const portTags = JSON.parse(portJson)[0];
    assertEquals(portTags.ObjectName, 'café');
    assertEquals(portTags.Keywords, 'forêt');
    assertEquals(portTags.ObjectName, upstreamTags.ObjectName);
    assertEquals(portTags.Keywords, upstreamTags.Keywords);
  } finally {
    await rm(upstreamFile, { force: true });
    await rm(portFile, { force: true });
  }
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

test('encodes every generated writable IPTC-IIM dataset type', () => {
  const tables = tagData as TableDef[];
  const writableTables = tables.filter((table) =>
    ['IPTC::ApplicationRecord', 'IPTC::EnvelopeRecord', 'IPTC::NewsPhoto'].includes(table.perlName)
  );
  const tags: Record<string, string | number | Uint8Array> = {};
  for (const table of writableTables) {
    for (const tag of table.tags) {
      if (!tag.writable) continue;
      const key = `IPTC:${tag.name}`;
      let value: string | number | Uint8Array;
      if (tag.type === 'string') {
        value = tag.name === 'CodedCharacterSet' ? 'UTF8' : 'sample';
      } else if (tag.type === 'digits') {
        const enumKey = Object.keys(tag.values ?? {}).find((entry) => /^\d+$/.test(entry));
        const candidate = (enumKey ? [enumKey] : Array.from({ length: 8 }, (_, index) => '1'.repeat(index + 1)))
          .find((digits) => resolveIptcWriteRequest(key, digits) !== undefined);
        if (!candidate) throw new Error(`No valid sample for ${key}`);
        value = candidate;
      } else if (tag.type === 'undef') {
        value = tag.name === 'RasterizedCaption' ? new Uint8Array(7360) : new Uint8Array([1, 2, 3]);
      } else if (['int8u', 'int16u', 'int32u'].includes(tag.type)) {
        value = 1;
      } else {
        throw new Error(`Unclassified generated IPTC type ${tag.type} for ${key}`);
      }
      if (!resolveIptcWriteRequest(key, value)) {
        throw new Error(`No valid write request for ${key}`);
      }
      tags[key] = value;
    }
  }

  const expectedKeys = Object.keys(tags).sort();
  const output = jpegMergeWriter(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), tags);
  assertEquals(output.written.slice().sort(), expectedKeys);
  assertEquals(output.skipped, []);
});

test('writes and replaces repeatable IPTC Byline values without losing siblings', async () => {
  const original = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const seeded = jpegMergeWriter(original, {
    'IPTC:By-line': ['First Writer', 'Second Writer'],
    'IPTC:City': 'Seattle',
  });
  const file = await tempFile('.jpg');
  const replaced = jpegMergeWriter(seeded.bytes, { 'IPTC:By-line': ['Replacement Writer'] });
  assertEquals(replaced.written, ['IPTC:By-line']);
  try {
    await writeFile(file, seeded.bytes);
    const { stdout: seededJson } = await execFileP(upstreamExifTool, ['-j', '-IPTC:By-line', file]);
    assertEquals(JSON.parse(seededJson)[0]['By-line'], ['First Writer', 'Second Writer']);
    await writeFile(file, replaced.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-IPTC:By-line', '-IPTC:City', file]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags['By-line'], 'Replacement Writer');
    assertEquals(tags.City, 'Seattle');

    const deleted = jpegMergeWriter(replaced.bytes, { 'IPTC:By-line': null });
    await writeFile(file, deleted.bytes);
    const { stdout: deletedJson } = await execFileP(upstreamExifTool, ['-j', '-IPTC:By-line', '-IPTC:City', file]);
    const deletedTags = JSON.parse(deletedJson)[0];
    assertEquals(deletedTags['By-line'], undefined);
    assertEquals(deletedTags.City, 'Seattle');
  } finally {
    await rm(file, { force: true });
  }
});

test('requires UTF-8 when setting CodedCharacterSet and adding IPTC text', () => {
  const base = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const unsupported = jpegMergeWriter(base, {
    'IPTC:CodedCharacterSet': 'ISO-8859-1',
    'IPTC:Keywords': ['forêt'],
  });
  assertEquals(unsupported.skipped, ['IPTC:CodedCharacterSet']);

  const deleted = jpegMergeWriter(base, {
    'IPTC:CodedCharacterSet': null,
    'IPTC:Keywords': ['forêt'],
  });
  const datasets = app13Payloads(deleted.bytes).flatMap(decodeIim);
  assertEquals(datasets[0], { record: 1, dataset: 90, value: '\x1b%G' });
  assertEquals(datasets[1], { record: 2, dataset: 25, value: 'forêt' });

  const escaped = jpegMergeWriter(base, { 'IPTC:CodedCharacterSet': 'ESC % G' });
  assertEquals(app13Payloads(escaped.bytes).flatMap(decodeIim)[0], {
    record: 1, dataset: 90, value: '\x1b%G',
  });
});

test('validates fixed-width IPTC digit datasets', async () => {
  const out = jpegMergeWriter(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    'IPTC:Urgency': 2,
    'IPTC:EditorialUpdate': '01',
  });
  assertEquals(out.written, ['IPTC:Urgency', 'IPTC:EditorialUpdate']);
  assertEquals(out.skipped, []);
  const invalid = jpegMergeWriter(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    'IPTC:Urgency': '20',
    'IPTC:EditorialUpdate': '1',
  });
  assertEquals(invalid.skipped, ['IPTC:Urgency', 'IPTC:EditorialUpdate']);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, out.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-IPTC:Urgency', '-IPTC:EditorialUpdate', file]);
    assertEquals(JSON.parse(stdout)[0], { SourceFile: file, Urgency: 2, EditorialUpdate: '01' });
  } finally {
    await rm(file, { force: true });
  }
});

test('writes IPTC ActionAdvised enum labels as two-digit dataset values', async () => {
  const output = jpegMergeWriter(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    'IPTC:ActionAdvised': 'Object Kill',
  });
  assertEquals(output.written, ['IPTC:ActionAdvised']);
  assertEquals(decodeIim(app13Payloads(output.bytes)[0]!).find((entry) => entry.dataset === 42)?.value, '01');
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, output.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-IPTC:ActionAdvised', file]);
    assertEquals(JSON.parse(stdout)[0].ActionAdvised, 'Object Kill');
  } finally {
    await rm(file, { force: true });
  }
});

test('writes generated IPTC enum labels across all record families', async () => {
  const values = {
    'IPTC:ActionAdvised': 'Object Kill',
    'IPTC:ImageOrientation': 'Landscape',
    'IPTC:ObjectCycle': 'Morning',
    'IPTC:FileFormat': 'JPEG File Interchange (JFIF)',
    'IPTC:SupplementalType': 'Reduced Resolution Image',
  };
  const output = jpegMergeWriter(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), values);
  assertEquals(output.written, Object.keys(values));
  assertEquals(output.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, output.bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-IPTC:ActionAdvised', '-IPTC:ImageOrientation', '-IPTC:ObjectCycle',
      '-IPTC:FileFormat', '-IPTC:SupplementalType', file,
    ]);
    assertEquals(JSON.parse(stdout)[0], {
      SourceFile: file,
      ActionAdvised: 'Object Kill',
      ImageOrientation: 'Landscape',
      ObjectCycle: 'Morning',
      FileFormat: 'JPEG File Interchange (JFIF)',
      SupplementalType: 'Reduced Resolution Image',
    });
  } finally {
    await rm(file, { force: true });
  }
});

test('writes IPTC date fields from ExifTool formatted date values', async () => {
  const values = {
    'IPTC:DateCreated': '2026:08:25',
    'IPTC:ReleaseDate': '2026-08-26',
    'IPTC:DigitalCreationDate': '2026:08:27',
    'IPTC:DateSent': '2026:08:28',
  };
  const out = jpegMergeWriter(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), values);
  assertEquals(out.written, Object.keys(values));
  assertEquals(out.skipped, []);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, out.bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-IPTC:DateCreated', '-IPTC:ReleaseDate', '-IPTC:DigitalCreationDate', '-IPTC:DateSent', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.DateCreated, '2026:08:25');
    assertEquals(tags.ReleaseDate, '2026:08:26');
    assertEquals(tags.DigitalCreationDate, '2026:08:27');
    assertEquals(tags.DateSent, '2026:08:28');
  } finally {
    await rm(file, { force: true });
  }
});

test('writes fixed-size IPTC RasterizedCaption binary data', async () => {
  const binary = Uint8Array.from({ length: 7360 }, (_, index) => index & 0xff);
  const out = jpegMergeWriter(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    'IPTC:RasterizedCaption': binary,
  });
  assertEquals(out.written, ['IPTC:RasterizedCaption']);
  assertEquals(out.skipped, []);
  assertEquals(jpegMergeWriter(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    'IPTC:RasterizedCaption': new Uint8Array(7359),
  }).skipped, ['IPTC:RasterizedCaption']);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, out.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-b', '-IPTC:RasterizedCaption', file], { encoding: 'buffer' });
    assertEquals(new Uint8Array(stdout), binary);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes IPTC ObjectPreviewData with an extended dataset length', async () => {
  const binary = Uint8Array.from({ length: 40000 }, (_, index) => (index * 17) & 0xff);
  const out = jpegMergeWriter(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    'IPTC:ObjectPreviewData': binary,
  });
  assertEquals(out.written, ['IPTC:ObjectPreviewData']);
  assertEquals(out.skipped, []);
  assertEquals(jpegMergeWriter(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    'IPTC:ObjectPreviewData': new Uint8Array(256001),
  }).skipped, ['IPTC:ObjectPreviewData']);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, out.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-b', '-IPTC:ObjectPreviewData', file], { encoding: 'buffer' });
    assertEquals(new Uint8Array(stdout), binary);
    const updated = jpegMergeWriter(out.bytes, { 'IPTC:City': 'Seattle' });
    const updatedSegments = app13Payloads(updated.bytes).filter((payload) =>
      new TextDecoder().decode(payload.subarray(0, 14)) === 'Photoshop 3.0\0',
    );
    assertEquals(updatedSegments.length, 1);
    await writeFile(file, updated.bytes);
    const preview = await execFileP(upstreamExifTool, ['-b', '-IPTC:ObjectPreviewData', file], { encoding: 'buffer' });
    assertEquals(new Uint8Array(preview.stdout), binary);
    const { stdout: cityJson } = await execFileP(upstreamExifTool, ['-j', '-IPTC:City', file]);
    assertEquals(JSON.parse(cityJson)[0].City, 'Seattle');
  } finally {
    await rm(file, { force: true });
  }
});

test('splits large IPTC preview datasets across Photoshop APP13 segments', async () => {
  const binary = Uint8Array.from({ length: 120000 }, (_, index) => (index * 31) & 0xff);
  const original = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const out = jpegMergeWriter(original, {
    'IPTC:ObjectPreviewData': binary,
    'IPTC:City': 'SplitSegmentTail',
  });
  assertEquals(out.written, ['IPTC:ObjectPreviewData', 'IPTC:City']);
  const photoshopSegments = app13Payloads(out.bytes).filter((payload) =>
    new TextDecoder().decode(payload.subarray(0, 14)) === 'Photoshop 3.0\0',
  );
  assertEquals(photoshopSegments.length, 2);
  assertEquals(photoshopSegments.every((payload) => payload.length + 2 <= 0xffff), true);
  const local = await jpegParser.parse(out.bytes, 'large-preview.jpg');
  assertEquals(local.tags.City, 'SplitSegmentTail');
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, out.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-b', '-IPTC:ObjectPreviewData', file], { encoding: 'buffer' });
    assertEquals(new Uint8Array(stdout), binary);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes IPTC NewsPhoto record datasets', async () => {
  const file = await tempFile('.jpg');
  const out = jpegMergeWriter(
    new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    { 'IPTC:NewsPhotoVersion': 2 },
  );
  assertEquals(out.written, ['IPTC:NewsPhotoVersion']);
  assertEquals(out.skipped, []);
  try {
    await writeFile(file, out.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-IPTC:NewsPhotoVersion', file]);
    assertEquals(JSON.parse(stdout)[0].NewsPhotoVersion, 2);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes IPTC NewsPhoto image and pixel dimensions', async () => {
  const file = await tempFile('.jpg');
  const values = {
    'IPTC:IPTCImageWidth': 640,
    'IPTC:IPTCImageHeight': 480,
    'IPTC:IPTCPixelWidth': 1280,
    'IPTC:IPTCPixelHeight': 960,
  };
  const out = jpegMergeWriter(
    new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    values,
  );
  assertEquals(out.written, Object.keys(values));
  assertEquals(out.skipped, []);
  try {
    await writeFile(file, out.bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-IPTCImageWidth', '-IPTCImageHeight', '-IPTCPixelWidth', '-IPTCPixelHeight', file,
    ]);
    assertEquals(JSON.parse(stdout)[0], { SourceFile: file, ...Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key.slice('IPTC:'.length), value]),
    ) });
  } finally {
    await rm(file, { force: true });
  }
});

test('writes IPTC NewsPhoto byte and long integer datasets', async () => {
  const file = await tempFile('.jpg');
  const values = {
    'IPTC:IPTCBitsPerSample': 8,
    'IPTC:DataCompressionMethod': 1,
  };
  const out = jpegMergeWriter(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), values);
  assertEquals(out.written, Object.keys(values));
  assertEquals(out.skipped, []);
  try {
    await writeFile(file, out.bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-IPTCBitsPerSample', '-DataCompressionMethod', file,
    ]);
    assertEquals(JSON.parse(stdout)[0], {
      SourceFile: file,
      IPTCBitsPerSample: 8,
      DataCompressionMethod: 1,
    });
  } finally {
    await rm(file, { force: true });
  }
});

test('writes the remaining scalar IPTC NewsPhoto datasets', async () => {
  const file = await tempFile('.jpg');
  const values = {
    'IPTC:IPTCPictureNumber': 'PN-1',
    'IPTC:SupplementalType': 1,
    'IPTC:ColorRepresentation': 2,
    'IPTC:InterchangeColorSpace': 3,
    'IPTC:ColorSequence': 4,
    'IPTC:NumIndexEntries': 5,
    'IPTC:SampleStructure': 6,
    'IPTC:ScanningDirection': 7,
    'IPTC:IPTCImageRotation': 8,
    'IPTC:QuantizationMethod': 9,
    'IPTC:ExcursionTolerance': 10,
    'IPTC:BitsPerComponent': 11,
    'IPTC:MaximumDensityRange': 12,
    'IPTC:GammaCompensatedValue': 13,
  };
  const out = jpegMergeWriter(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), values);
  assertEquals(out.written, Object.keys(values));
  assertEquals(out.skipped, []);
  try {
    await writeFile(file, out.bytes);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-IPTCPictureNumber', '-SupplementalType', '-ColorRepresentation',
      '-InterchangeColorSpace', '-ColorSequence', '-NumIndexEntries', '-SampleStructure',
      '-ScanningDirection', '-IPTCImageRotation', '-QuantizationMethod', '-ExcursionTolerance',
      '-BitsPerComponent', '-MaximumDensityRange', '-GammaCompensatedValue', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    for (const [key, value] of Object.entries(values)) {
      const name = key.slice('IPTC:'.length);
      assertEquals(tags[name], value);
    }
  } finally {
    await rm(file, { force: true });
  }
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

test('preserves unknown IRB resource names and padding byte-for-byte', () => {
  const header = new TextEncoder().encode('Photoshop 3.0\0');
  const unknownBlock = new Uint8Array([
    0x38, 0x42, 0x49, 0x4d, 0x04, 0x0f,
    0x02, 0x4e, 0x4d, 0xa5,
    0x00, 0x00, 0x00, 0x03,
    0x11, 0x22, 0x33, 0x5a,
  ]);
  const largeResource = new Uint8Array([
    0x38, 0x42, 0x36, 0x34, 0x12, 0x34,
    0x00, 0x00,
    0x00, 0x00, 0x00, 0x02,
    0x44, 0x55,
  ]);
  const payload = new Uint8Array(header.length + unknownBlock.length + largeResource.length);
  payload.set(header);
  payload.set(unknownBlock, header.length);
  payload.set(largeResource, header.length + unknownBlock.length);
  const merged = mergePhotoshopIrb(payload, ['keyword']);
  const findBlockOffset = (block: Uint8Array) => merged!.findIndex((_, offset) =>
    offset + block.length <= merged!.length &&
    block.every((byte, index) => merged![offset + index] === byte),
  );
  const blockOffset = findBlockOffset(unknownBlock);
  const largeResourceOffset = findBlockOffset(largeResource);
  assertEquals(blockOffset >= 0, true);
  assertEquals(largeResourceOffset >= 0, true);
  assertEquals(Array.from(merged!.subarray(blockOffset, blockOffset + unknownBlock.length)), Array.from(unknownBlock));
  assertEquals(Array.from(merged!.subarray(largeResourceOffset, largeResourceOffset + largeResource.length)), Array.from(largeResource));
});

test('reconciles IPTCDigest only when it matches the old IPTC block', async () => {
  const resources = (payload: Uint8Array) => payload.subarray('Photoshop 3.0\0'.length);
  const original = mergePhotoshopIrb(null, [{
    key: 'IPTC:Keywords', record: 2, dataset: 25, type: 'string', value: 'old',
  }])!;
  const currentDigest = parseAPP13(resources(original)).CurrentIPTCDigest as string;
  const digestBytes = Uint8Array.from(currentDigest.match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
  const digestResource = new Uint8Array(28);
  digestResource.set([0x38, 0x42, 0x49, 0x4d, 0x04, 0x25, 0, 0, 0, 0, 0, 16]);
  digestResource.set(digestBytes, 12);
  const payloadWithDigest = new Uint8Array(original.length + digestResource.length);
  payloadWithDigest.set(original);
  payloadWithDigest.set(digestResource, original.length);

  const updated = mergePhotoshopIrb(payloadWithDigest, [{
    key: 'IPTC:City', record: 2, dataset: 90, type: 'string', value: 'Seattle',
  }])!;
  const updatedTags = parseAPP13(resources(updated));
  assertEquals(updatedTags.IPTCDigest, updatedTags.CurrentIPTCDigest);

  const jpeg = new Uint8Array(2 + 4 + payloadWithDigest.length + 2);
  jpeg.set([0xff, 0xd8, 0xff, 0xed, (payloadWithDigest.length + 2) >> 8, (payloadWithDigest.length + 2) & 0xff]);
  jpeg.set(payloadWithDigest, 6);
  jpeg.set([0xff, 0xd9], 6 + payloadWithDigest.length);
  const file = await tempFile('.jpg');
  try {
    const written = jpegMergeWriter(jpeg, { 'IPTC:City': 'Seattle' });
    await writeFile(file, written.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-IPTCDigest', '-CurrentIPTCDigest', file]);
    const upstreamTags = JSON.parse(stdout)[0];
    assertEquals(upstreamTags.IPTCDigest.toLowerCase(), updatedTags.IPTCDigest);
    assertEquals(upstreamTags.CurrentIPTCDigest.toLowerCase(), updatedTags.CurrentIPTCDigest);
  } finally {
    await rm(file, { force: true });
  }

  digestResource.fill(0xff, 12);
  const stalePayload = new Uint8Array(original.length + digestResource.length);
  stalePayload.set(original);
  stalePayload.set(digestResource, original.length);
  const stale = mergePhotoshopIrb(stalePayload, [{
    key: 'IPTC:City', record: 2, dataset: 90, type: 'string', value: 'Seattle',
  }])!;
  const staleTags = parseAPP13(resources(stale));
  assertEquals(staleTags.IPTCDigest, 'ff'.repeat(16));
  assertEquals(staleTags.CurrentIPTCDigest === staleTags.IPTCDigest, false);
});

test('IPTC write is idempotent and splices into an existing APP13 segment', () => {
  const base = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const first = jpegMergeWriter(base, { 'IPTC:Keywords': ['a', 'b'] });
  const second = jpegMergeWriter(first.bytes, { 'IPTC:Keywords': ['a', 'b'] });
  assertEquals(Array.from(second.bytes), Array.from(first.bytes));
});

test('writes large IPTC keywords using extended lengths and split APP13 segments', async () => {
  const keyword = 'x'.repeat(0x10000);
  const out = jpegMergeWriter(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    'IPTC:Keywords': [keyword],
  });
  assertEquals(out.written, ['IPTC:Keywords']);
  const segments = app13Payloads(out.bytes).filter((payload) =>
    new TextDecoder().decode(payload.subarray(0, 14)) === 'Photoshop 3.0\0',
  );
  assertEquals(segments.length, 2);
  const file = await tempFile('.jpg');
  try {
    await writeFile(file, out.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-IPTC:Keywords', file]);
    assertEquals(JSON.parse(stdout)[0].Keywords, keyword);
  } finally {
    await rm(file, { force: true });
  }
});
