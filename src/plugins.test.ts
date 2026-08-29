import { test } from 'vitest';
import { assertEquals } from '../src/test/asserts.js';
import { ALL_PLUGINS, MODERN_PLUGINS, jpegParser, pngParser, webpParser, avifParser } from './plugins.js';

test('MODERN_PLUGINS covers all four built-in web formats', () => {
  assertEquals(MODERN_PLUGINS.map((p) => p.format), ['JPEG', 'PNG', 'WebP', 'AVIF']);
  assertEquals(ALL_PLUGINS, MODERN_PLUGINS);
});

test('preset parsers carry write support', () => {
  for (const p of MODERN_PLUGINS) {
    assertEquals(typeof p.writeBytes, 'function');
  }
  assertEquals([jpegParser.format, pngParser.format, webpParser.format, avifParser.format], [
    'JPEG',
    'PNG',
    'WebP',
    'AVIF',
  ]);
});
