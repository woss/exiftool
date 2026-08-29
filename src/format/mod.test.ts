import { test } from 'vitest';
import { assertEquals } from '../../src/test/asserts.js';
import { detectParser, getAllParsers, getParser, registerParser } from './mod.js';

// The parser registry is process-global; use throwaway format names so the
// built-in JPEG/PNG/WebP/AVIF registrations are never disturbed.
const DUMMY = 'ZZ-RegistryTestFmt';

function dummyParser(tag: string) {
  return {
    format: DUMMY,
    extensions: ['.zztest'],
    canParse: (bytes: Uint8Array) => bytes[0] === 0x7f && tag === 'v2',
    parse: () => Promise.resolve({ path: '', format: DUMMY, tags: {} }),
  };
}

test('registerParser overwrites same-format entries and getParser returns latest', () => {
  registerParser(dummyParser('v1'));
  const first = getParser(DUMMY);
  assertEquals(first?.format, DUMMY);

  registerParser(dummyParser('v2'));
  const second = getParser(DUMMY)!;
  assertEquals(second.canParse(new Uint8Array([0x7f])), true);

  // v1 was replaced: its predicate no longer matches.
  const stale = getAllParsers().filter((p) => p.format === DUMMY);
  assertEquals(stale.length, 1);
});

test('getParser returns undefined for unknown formats', () => {
  assertEquals(getParser('No-Such-Format'), undefined);
});

test('detectParser falls back to undefined on unrecognized magic', () => {
  assertEquals(detectParser(new Uint8Array([0x01, 0x02, 0x03, 0x04])), undefined);
});
