import { test } from 'vitest';
import { assertEquals } from '../../src/test/asserts.js';
import { computeCompositeTags } from './composite.js';

test('FocalLength35efl renders fractional focal length without trailing zero', () => {
  const tags: Record<string, unknown> = {
    FocalLength: 4.5,
    FocalLengthIn35mmFormat: 28,
  };
  computeCompositeTags(tags as never);
  const value = tags['FocalLength35efl'] as string;
  assertEquals(
    value.startsWith('4.5 mm (35 mm equivalent: 28.0 mm)'),
    true,
    `got: ${value}`,
  );
});

test('FocalLength35efl keeps integer focal length as N.0 mm', () => {
  const tags: Record<string, unknown> = {
    FocalLength: 50,
    FocalLengthIn35mmFormat: 75,
  };
  computeCompositeTags(tags as never);
  const value = tags['FocalLength35efl'] as string;
  assertEquals(
    value.startsWith('50.0 mm (35 mm equivalent: 75.0 mm)'),
    true,
    `got: ${value}`,
  );
});

test('FocalLength35efl defaults to the focal length at 1.0 crop', () => {
  const tags: Record<string, unknown> = { FocalLength: 4.5 };
  computeCompositeTags(tags as never);
  assertEquals(
    tags['FocalLength35efl'],
    '4.5 mm (35 mm equivalent: 4.5 mm)',
  );
});

test('DOF computed from focal, aperture and subject distance', () => {
  const tags: Record<string, unknown> = {
    FocalLength: 171,
    FNumber: 2.8,
    SubjectDistance: 2.53,
  };
  computeCompositeTags(tags as never);
  assertEquals(tags['DOF'], '2.51 m - 2.55 m');
});
test('Megapixels and Aperture computed from dimensions and f-number', () => {
  const tags: Record<string, unknown> = {
    ImageWidth: 6000,
    ImageHeight: 4000,
    FNumber: 2.8,
  };
  computeCompositeTags(tags as never);
  assertEquals(tags['Megapixels'], 24);
  assertEquals(tags['Aperture'], 2.8);
});

test('existing Aperture is not overwritten', () => {
  const tags: Record<string, unknown> = { FNumber: 2.8, Aperture: 4 };
  computeCompositeTags(tags as never);
  assertEquals(tags['Aperture'], 4);
});

test('GPSPosition combines cleaned coordinates with refs', () => {
  const tags: Record<string, unknown> = {
    GPSLatitude: '40 deg 26\' 46.30" N',
    GPSLongitude: '79 deg 58\' 56.00" W',
    GPSLatitudeRef: ' N ',
    GPSLongitudeRef: 5, // non-string ref degrades to empty
  };
  computeCompositeTags(tags as never);
  assertEquals(tags['GPSPosition'], `40 deg 26' 46.30" N, 79 deg 58' 56.00" `);
});

test('GPSDateTime built from date stamp plus time stamp', () => {
  const tags: Record<string, unknown> = {
    GPSDateStamp: '2024:01:15',
    GPSTimeStamp: '14:58:24.75',
  };
  computeCompositeTags(tags as never);
  assertEquals(tags['GPSDateTime'], '2024:01:15 14:58:24.75Z');
});

test('SubSec datetime tags attach offsets when present', () => {
  const tags: Record<string, unknown> = {
    CreateDate: '2024:01:15 10:30:00',
    OffsetTimeDigitized: '-05:00',
    DateTimeOriginal: '2024:01:15 10:30:01',
    OffsetTimeOriginal: '+02:00',
    ModifyDate: '2024:01:15 10:30:02',
    OffsetTime: '+00:00',
  };
  computeCompositeTags(tags as never);
  assertEquals(tags['SubSecCreateDate'], '2024:01:15 10:30:00-05:00');
  assertEquals(tags['SubSecDateTimeOriginal'], '2024:01:15 10:30:01+02:00');
  assertEquals(tags['SubSecModifyDate'], '2024:01:15 10:30:02+00:00');
});

test('SubSec datetime tags pass through without offsets or space', () => {
  const tags: Record<string, unknown> = {
    CreateDate: '2024:01:15 10:30:00',
    DateTimeOriginal: 'date-only-no-space',
    ModifyDate: '2024:01:15 10:30:02',
  };
  computeCompositeTags(tags as never);
  assertEquals(tags['SubSecCreateDate'], '2024:01:15 10:30:00');
  assertEquals(tags['SubSecDateTimeOriginal'], 'date-only-no-space');
  assertEquals(tags['SubSecModifyDate'], '2024:01:15 10:30:02');
});

test('missing dates produce no SubSec tags', () => {
  const tags: Record<string, unknown> = {};
  computeCompositeTags(tags as never);
  assertEquals('SubSecCreateDate' in tags, false);
  assertEquals('SubSecDateTimeOriginal' in tags, false);
  assertEquals('SubSecModifyDate' in tags, false);
});

test('LensModel populates Lens and LensID', () => {
  const tags: Record<string, unknown> = { LensModel: 'FE 24-70mm F2.8 GM' };
  computeCompositeTags(tags as never);
  assertEquals(tags['Lens'], 'FE 24-70mm F2.8 GM');
  assertEquals(tags['LensID'], 'FE 24-70mm F2.8 GM');
});

test('LightValue computed from aperture, shutter, and ISO', () => {
  // f/2.8, 1/250s at ISO 100 -> EV100 = log2(2.8^2 / (1/250)) ~= 10.9
  const tags: Record<string, unknown> = {
    FNumber: 2.8,
    ExposureTime: '1/250',
    ISO: 100,
    FocalLength: 50,
  };
  computeCompositeTags(tags as never);
  const lv = tags['LightValue'] as number;
  assertEquals(Math.abs(lv - 10.9) < 0.05, true, `got ${lv}`);
});

test('ImageHeight falls back from a non-numeric ImageLength', () => {
  const tags: Record<string, unknown> = { ImageWidth: 100, ImageLength: 'abc' };
  computeCompositeTags(tags as never);
  assertEquals(tags['ImageHeight'], 'abc');
});

test('ImageHeight materialized from a numeric ImageLength', () => {
  const tags: Record<string, unknown> = { ImageWidth: 6000, ImageLength: 4000 };
  computeCompositeTags(tags as never);
  assertEquals(tags['ImageHeight'], 4000);
  assertEquals(tags['ImageSize'], '6000x4000');
});

test('ShutterSpeed renders seconds above one and reciprocal below', () => {
  const fast: Record<string, unknown> = { ExposureTime: 0.004 };
  computeCompositeTags(fast as never);
  assertEquals(fast['ShutterSpeed'], '1/250');

  const slow: Record<string, unknown> = { ExposureTime: 2 };
  computeCompositeTags(slow as never);
  assertEquals(slow['ShutterSpeed'], '2');
});

test('HyperfocalDistance computed when focal length and f-number present', () => {
  // 50mm at f/2.8: 50*50/(2.8*0.030)/1000 = 29.76 m
  const tags: Record<string, unknown> = {
    FocalLength: 50,
    FocalLengthIn35mmFormat: 75,
    FNumber: 2.8,
  };
  computeCompositeTags(tags as never);
  assertEquals(tags['CircleOfConfusion'], '0.030 mm');
  assertEquals(tags['HyperfocalDistance'], '29.76 m');
});

test('ScaleFactor35efl omitted when the crop factor is below one', () => {
  const tags: Record<string, unknown> = {
    FocalLength: 100,
    FocalLengthIn35mmFormat: 50,
  };
  computeCompositeTags(tags as never);
  assertEquals('ScaleFactor35efl' in tags, false);
});

test('EncodingProcess implies legacy JPEG Compression', () => {
  const tags: Record<string, unknown> = { EncodingProcess: 'Baseline DCT, Huffman coding' };
  computeCompositeTags(tags as never);
  assertEquals(tags['Compression'], 'JPEG (old-style)');

  const existing: Record<string, unknown> = { EncodingProcess: 'x', Compression: 6 };
  computeCompositeTags(existing as never);
  assertEquals(existing['Compression'], 6);
});

test('DerivedFromInstanceID: IPTC OriginalInstanceID wins over HistoryInstanceID', () => {
  const tags: Record<string, unknown> = {
    OriginalDocumentID: 'IPTCHEX1',
    OriginalInstanceID: 'IPTCHEX2',
    HistoryInstanceID: 'xmp.iid:FALLBACK',
  };
  computeCompositeTags(tags as never);
  assertEquals(tags['DerivedFromOriginalDocumentID'], 'IPTCHEX1');
  assertEquals(tags['DerivedFromInstanceID'], 'IPTCHEX2');
  assertEquals(tags['DerivedFromDocumentID'], undefined);
});

test('DerivedFromInstanceID falls back to HistoryInstanceID with doc-id conversion', () => {
  const tags: Record<string, unknown> = { HistoryInstanceID: 'xmp.iid:AAA' };
  computeCompositeTags(tags as never);
  assertEquals(tags['DerivedFromInstanceID'], 'xmp.iid:AAA');
  assertEquals(tags['DerivedFromDocumentID'], 'xmp.did:AAA');
});
