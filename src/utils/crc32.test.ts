import { test } from 'vitest';
import { assertEquals } from '../../src/test/asserts.js';
import { crc32 } from './crc32.js';

test('crc32 matches the standard check vector', () => {
  // IEEE 802.3 check value for "123456789".
  const data = new TextEncoder().encode('123456789');
  assertEquals(crc32(data), 0xCBF43926);
});

test('crc32 of empty input is the identity residue', () => {
  assertEquals(crc32(new Uint8Array(0)), 0x00000000);
});

test('crc32 is sensitive to input bytes', () => {
  const a = crc32(new Uint8Array([1, 2, 3]));
  const b = crc32(new Uint8Array([1, 2, 4]));
  assertEquals(a !== b, true);
});
