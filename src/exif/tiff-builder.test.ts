import { test } from 'vitest';
import { assertEquals } from '../../src/test/asserts.js';
import { buildTiff } from './tiff-builder.js';
import { extractExifFromTiff } from './tiff.js';

test('buildTiff writes ASCII tags readable by the TIFF parser', () => {
  const { bytes } = buildTiff({ Make: 'Acme', Model: 'Model 1' });
  const tags = extractExifFromTiff(bytes);
  assertEquals(tags.Make, 'Acme');
  assertEquals(tags.Model, 'Model 1');
});

test('buildTiff encodes SHORT and RATIONAL values', () => {
  const { bytes } = buildTiff({
    Orientation: 1,
    XResolution: [300, 1],
    YResolution: 72.5,
    ResolutionUnit: '2',
  });
  const tags = extractExifFromTiff(bytes);
  assertEquals(tags.Orientation, 'Horizontal (normal)');
  assertEquals(tags.ResolutionUnit, 'inches');
});
test('buildTiff accepts fraction strings for rational tags', () => {
  const { bytes } = buildTiff({ XResolution: '300/1' });
  assertEquals(extractExifFromTiff(bytes).XResolution, 300);
});

test('buildTiff skips unknown tag names and reports them', () => {
  const { written, skipped } = buildTiff({ Make: 'A', ISOSpeed: 100 });
  assertEquals(written.includes('Make'), true);
  assertEquals(skipped, ['ISOSpeed']);
});

test('buildTiff matches names case-insensitively', () => {
  const { bytes, written } = buildTiff({ MAKE: 'Zeta' });
  assertEquals(written.includes('Make'), true);
  assertEquals(extractExifFromTiff(bytes).Make, 'Zeta');
});

test('buildTiff rejects out-of-range SHORT values as skipped', () => {
  const { skipped } = buildTiff({ Orientation: 70000 });
  assertEquals(skipped, ['Orientation']);
});

test('buildTiff pads oversized odd-length values to even offsets', () => {
  // ImageDescription of 6 characters -> 7 bytes with NUL -> needs padding.
  const { bytes } = buildTiff({ ImageDescription: 'abcdef', Make: 'X' });
  assertEquals(bytes.length % 2, 0);
  assertEquals(extractExifFromTiff(bytes).ImageDescription, 'abcdef');
});

test('buildTiff maps ModifyDate onto the DateTime field', () => {
  const { written, bytes } = buildTiff({ ModifyDate: '2024:01:02 03:04:05' });
  assertEquals(written, ['DateTime']);
  assertEquals(extractExifFromTiff(bytes).DateTime, '2024:01:02 03:04:05');
});

test('buildTiff coerces booleans and plain numeric strings for ascii tags', () => {
  const { bytes } = buildTiff({ Make: true, Software: '7' });
  const tags = extractExifFromTiff(bytes);
  assertEquals(tags.Make, 'true');
  assertEquals(tags.Software, '7');
});

test('buildTiff accepts plain numeric strings for rational tags', () => {
  const { bytes } = buildTiff({ XResolution: '350' });
  assertEquals(extractExifFromTiff(bytes).XResolution, 350);
});

test('buildTiff skips values that cannot encode to the target type', () => {
  const { skipped } = buildTiff({
    Make: new Uint8Array([1]),
    Orientation: 'abc',
    XResolution: null,
    YResolution: [1, 'x'],
    Software: [],
  });
  assertEquals(skipped.sort(), [
    'Make',
    'Orientation',
    'Software',
    'XResolution',
    'YResolution',
  ]);
});
