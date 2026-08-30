import { test } from 'vitest';
import { assertEquals } from '../test/asserts.js';
import { md5Hex } from './md5.js';

// RFC 1321 test vectors.
test('md5Hex RFC 1321 vectors', () => {
  assertEquals(md5Hex(''), 'd41d8cd98f00b204e9800998ecf8427e');
  assertEquals(md5Hex('a'), '0cc175b9c0f1b6a831c399e269772661');
  assertEquals(md5Hex('abc'), '900150983cd24fb0d6963f7d28e17f72');
  assertEquals(md5Hex('message digest'), 'f96b697d7cb7938d525a2f31aaf161d0');
  assertEquals(
    md5Hex('abcdefghijklmnopqrstuvwxyz'),
    'c3fcd3d76192e4007dfb496cca67e13b',
  );
  assertEquals(
    md5Hex('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'),
    'd174ab98d277d9f5a5611c2c9f419d9f',
  );
  assertEquals(
    md5Hex('12345678901234567890123456789012345678901234567890123456789012345678901234567890'),
    '57edf4a22be3c955ac49da2e2107b67a',
  );
});

test('md5Hex handles binary input and long messages', () => {
  assertEquals(md5Hex(new TextEncoder().encode('abc')), '900150983cd24fb0d6963f7d28e17f72');
  // 'a' x 1_000_000 — the classic long-message vector.
  const million = new Uint8Array(1_000_000).fill(97);
  assertEquals(md5Hex(million), '7707d6ae4e027c70eea2a935c2296f21');
});
