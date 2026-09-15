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

test('buildTiff writes ExifIFD and GPS IFDs readable by the TIFF parser', () => {
  const { bytes, written } = buildTiff({
    Make: 'Acme',
    DateTimeOriginal: '2024:01:02 03:04:05',
    ExposureTime: [1, 250],
    FNumber: 2.8,
    ISOSpeedRatings: 200,
    ExifVersion: '0231',
    UserComment: 'Hello world',
    ExifImageWidth: 4000,
    GPSLatitude: "43 deg 28' 2.00\" N",
    GPSLongitude: "11 deg 21' 0.00\" E",
    GPSAltitude: '12 m',
    GPSTimeStamp: '10:20:30',
  });
  assertEquals(written.includes('DateTimeOriginal'), true);
  assertEquals(written.includes('ExposureTime'), true);
  assertEquals(written.includes('GPSLatitudeRef'), true); // synthesized from the coordinate
  const tags = extractExifFromTiff(bytes);
  assertEquals(tags.Make, 'Acme');
  assertEquals(tags.DateTimeOriginal, '2024:01:02 03:04:05');
  assertEquals(tags.ExposureTime, '1/250');
  assertEquals(tags.FNumber, 2.8);
  assertEquals(tags.ISOSpeedRatings, 200);
  assertEquals(tags.PixelXDimension, 4000);
  assertEquals(tags.GPSLatitude, "43 deg 28' 2.00\" N");
  assertEquals(tags.GPSLatitudeRef, 'North');
  assertEquals(tags.GPSAltitude, '12 m');
});

test('UserComment and ExifVersion encode as UNDEFINED with exact bytes', () => {
  const { bytes } = buildTiff({ UserComment: 'Hi', ExifVersion: '0231' });
  const header = [0x41, 0x53, 0x43, 0x49, 0x49, 0, 0, 0]; // 'ASCII\0\0\0'
  const headerPos = bytes.length >= 8
    ? [...bytes.keys()].find((i) => header.every((b, j) => bytes[i + j] === b))
    : undefined;
  assertEquals(headerPos !== undefined, true);
  // '0231' raw bytes appear somewhere in the value area.
  const ver = [0x30, 0x32, 0x33, 0x31];
  assertEquals(ver.every((b) => bytes.includes(b)), true);
  const tags = extractExifFromTiff(bytes);
  assertEquals(tags.UserComment, '[65, 83, 67, 73, 73, 0, 0, 0, 72, 105]');
  assertEquals(tags.ExifVersion, '0231');
});

test('ExifIFD pointer is synthesized only when the ExifIFD has tags', () => {
  const dv = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pointerIds = (bytes: Uint8Array) => {
    const view = dv(bytes);
    const count = view.getUint16(8, true);
    const ids: number[] = [];
    for (let i = 0; i < count; i++) ids.push(view.getUint16(10 + i * 12, true));
    return ids;
  };
  assertEquals(pointerIds(buildTiff({ Make: 'A' }).bytes).includes(0x8769), false);
  assertEquals(
    pointerIds(buildTiff({ DateTimeOriginal: '2024:01:02 03:04:05' }).bytes).includes(0x8769),
    true,
  );
  assertEquals(pointerIds(buildTiff({ GPSAltitude: 12 }).bytes).includes(0x8825), true);
});

test('skipped reporting covers unknown names and unencodable GPS values', () => {
  const { skipped } = buildTiff({ Make: 'A', NotARealTag: 1, GPSLatitude: 'not a coordinate' });
  assertEquals(skipped.sort(), ['GPSLatitude', 'NotARealTag']);
});

test('GPSLatitudeRef supplied explicitly suppresses the synthesized ref', () => {
  const { written } = buildTiff({ GPSLatitude: "10 deg 0' 0.00\" E", GPSLatitudeRef: 'South' });
  assertEquals(written.filter((n) => n === 'GPSLatitudeRef').length, 1);
  const tags = extractExifFromTiff(
    buildTiff({ GPSLatitude: "10 deg 0' 0.00\" S", GPSLatitudeRef: 'South' }).bytes,
  );
  assertEquals(tags.GPSLatitudeRef, 'South');
});
test('SRATIONAL tags encode negative exposure compensation', () => {
  const { bytes } = buildTiff({ ExposureCompensation: [-1, 3] });
  assertEquals(extractExifFromTiff(bytes).ExposureBiasValue, -1 / 3);
});

test('ShutterSpeedValue encodes as SRATIONAL APEX', () => {
  const { bytes } = buildTiff({ ShutterSpeedValue: [5, 1] });
  assertEquals(extractExifFromTiff(bytes).ShutterSpeedValue, '1/32');
});

test('GPSVersionID, GPSDateStamp, GPSTimeStamp, GPSAltitudeRef coerce', () => {
  const { bytes, skipped } = buildTiff({
    GPSVersionID: '2 3 0 0',
    GPSDateStamp: '2024-01-02',
    GPSTimeStamp: [10, 20, 30],
    GPSAltitudeRef: 'Above Sea Level',
    ExifImageHeight: 3000,
    LensInfo: [24, 70, 2.8, 4],
  });
  assertEquals(skipped, []);
  const tags = extractExifFromTiff(bytes);
  assertEquals(tags.GPSVersionID, '2.3.0.0');
  assertEquals(tags.GPSDateStamp, '2024:01:02');
  assertEquals(tags.GPSTimeStamp, '10:20:30');
  assertEquals(tags.GPSAltitudeRef, 'Above Sea Level');
  assertEquals(tags.LensSpecification, [24, 70, 2.8, 4]);
});
