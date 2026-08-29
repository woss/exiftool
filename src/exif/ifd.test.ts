import { test } from 'vitest';
import { assertEquals } from '../../src/test/asserts.js';
import { parseIFD } from './ifd.js';

/** Little-endian u16/u32 writers for building raw IFD bytes. */
function u16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}
function u32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

/** Build a 12-byte IFD entry; pads the 4-byte value field with zeros. */
function entry(tag: number, type: number, count: number, valueField: number[]): number[] {
  if (valueField.length > 4) throw new Error('value field must fit 4 bytes');
  const pad = [...valueField, ...new Array(4 - valueField.length).fill(0)];
  return [...u16(tag), ...u16(type), ...u32(count), ...pad];
}

function viewOf(bytes: number[]): DataView {
  return new DataView(Uint8Array.from(bytes).buffer);
}

test('valid minimal IFD parses entry and nextIfdOffset', () => {
  // offset 0: count=1; one ASCII "AB" entry inline; nextIfdOffset=7
  const bytes = [
    ...u16(1),
    ...entry(0x010f, 2, 2, [0x41, 0x42]), // Make, ASCII, count 2, inline
    ...u32(7),
  ];
  const ifd = parseIFD(viewOf(bytes), 0, true);

  assertEquals(ifd.entries.length, 1);
  const e = ifd.entries[0]!;
  assertEquals(e.tag, 0x010f);
  assertEquals(e.type, 2);
  assertEquals(e.count, 2);
  assertEquals(Array.from(e.value as Uint8Array), [0x41, 0x42]);
  assertEquals(ifd.nextIfdOffset, 7);
});

test('numEntries claims 5 but buffer holds only 2 entries: returns 2, no throw', () => {
  const bytes = [
    ...u16(5), // lies about 5 entries
    ...entry(0x0001, 3, 1, u16(10)), // SHORT inline
    ...entry(0x0002, 3, 1, u16(20)), // SHORT inline
    // buffer ends here — no room for a third entry nor the next-IFD pointer
  ];
  const ifd = parseIFD(viewOf(bytes), 0, true);

  assertEquals(ifd.entries.length, 2);
  assertEquals(ifd.entries[0]!.tag, 0x0001);
  assertEquals(ifd.entries[1]!.tag, 0x0002);
  assertEquals(ifd.nextIfdOffset, 0); // truncated next-IFD read -> 0
});

test('out-of-line value offset+dataSize exceeds buffer: partial result, no throw', () => {
  // UNDEFINED (type 7, size 1) count 100 -> dataSize 100 > 4, out-of-line.
  // Only 1 of the claimed 100 value bytes is present, so the buffer ends
  // before both the value and the 4-byte next-IFD pointer.
  const valueOffset = 15;
  const bytes = [...u16(1), ...entry(0x9286, 7, 100, u32(valueOffset)), 0xff];
  const ifd = parseIFD(viewOf(bytes), 0, true);

  assertEquals(ifd.entries.length, 0);
  assertEquals(ifd.nextIfdOffset, 0);
});

test('truncated second entry stops parsing with prior entries intact', () => {
  // numEntries=2 but only the first entry is complete; the second has just
  // its first 8 of 12 bytes before EOF.
  const good = entry(0x0001, 3, 1, u16(7));
  const partialBad = [...u16(0x0002), ...u16(2), ...u32(8)]; // missing value field
  const bytes = [...u16(2), ...good, ...partialBad];

  const ifd = parseIFD(viewOf(bytes), 0, true);

  assertEquals(ifd.entries.length, 1);
  assertEquals(ifd.entries[0]!.tag, 0x0001);
  assertEquals(ifd.nextIfdOffset, 0);
});

test('offset beyond buffer: empty entries, no throw', () => {
  const view = viewOf([0x49, 0x49]); // 2-byte buffer

  let ifd;
  try {
    ifd = parseIFD(view, 100, true); // offset way past end
  } catch (error) {
    throw new Error(`parseIFD threw on out-of-range offset: ${error}`);
  }

  assertEquals(ifd.entries.length, 0);
  assertEquals(ifd.nextIfdOffset, 0);
});

test('maxRecursion 0 returns empty immediately', () => {
  const view = viewOf([
    0x00, 0x01, // entry count 1 (would parse if recursion allowed)
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x41, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);

  let ifd;
  try {
    ifd = parseIFD(view, 0, true, 0);
  } catch (error) {
    throw new Error(`parseIFD threw at maxRecursion 0: ${error}`);
  }

  assertEquals(ifd.entries.length, 0);
  assertEquals(ifd.nextIfdOffset, 0);
});
