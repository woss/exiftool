import { test } from 'vitest';
import { assertEquals } from '../../src/test/asserts.js';
import { builtinPlugins, detectParser, type FormatParser } from './mod.js';

function dummyParser(accepts: (bytes: Uint8Array) => boolean): FormatParser {
  return {
    format: 'ZZ-TestFmt',
    extensions: ['.zztest'],
    canParse: accepts,
    parse: () => Promise.resolve({ path: '', format: 'ZZ-TestFmt', tags: {} }),
  };
}

test('detectParser returns the first accepting plugin in order', () => {
  const never = dummyParser(() => false);
  const always = dummyParser(() => true);
  assertEquals(detectParser(new Uint8Array([1]), [never, always]), always);
  assertEquals(detectParser(new Uint8Array([1]), [never]), undefined);
});

test('detectParser returns undefined on unrecognized magic', () => {
  assertEquals(detectParser(new Uint8Array([0x01, 0x02, 0x03, 0x04]), []), undefined);
});

test('builtinPlugins lazily provides all four built-in formats', async () => {
  const plugins = await builtinPlugins();
  assertEquals(plugins.map((p) => p.format), ['JPEG', 'PNG', 'WebP', 'AVIF']);
  // Cached: the same array instances come back.
  assertEquals(await builtinPlugins(), plugins);
});
