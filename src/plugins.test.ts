import { test } from 'vitest';
import { assertEquals } from '../src/test/asserts.js';
import { ALL_PLUGINS, MODERN_PLUGINS, jpegParser, pngParser, webpParser, avifParser } from './plugins.js';

test('MODERN_PLUGINS covers all built-in formats incl. TIFF-family RAW', () => {
  assertEquals(MODERN_PLUGINS.map((p) => p.format), ['JPEG', 'PNG', 'WebP', 'AVIF', 'TIFF']);
  assertEquals(ALL_PLUGINS, MODERN_PLUGINS);
});

test('preset parsers carry write support, TIFF restricted to TIFF/DNG', () => {
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
