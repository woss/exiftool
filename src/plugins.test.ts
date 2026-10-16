import { test } from 'vitest';
import { assertEquals } from '../src/test/asserts.js';
import { ALL_PLUGINS, MODERN_PLUGINS, gifParser, jpegParser, pngParser, ppmParser, pgmParser, pbmParser, webpParser, avifParser, exifParser, exvParser, iccParser, xmpParser } from './plugins.js';

test('MODERN_PLUGINS covers all built-in formats incl. TIFF-family RAW', () => {
  assertEquals(MODERN_PLUGINS.map((p) => p.format), ['JPEG', 'GIF', 'PNG', 'PPM', 'PGM', 'PBM', 'WebP', 'AVIF', 'TIFF', 'EXIF', 'EXV', 'ICC', 'XMP']);
  assertEquals(ALL_PLUGINS, MODERN_PLUGINS);
});

test('preset parsers carry write support, TIFF restricted to TIFF/DNG', () => {
  for (const p of MODERN_PLUGINS) {
    assertEquals(typeof p.writeBytes, 'function');
  }
  assertEquals([jpegParser.format, gifParser.format, pngParser.format, webpParser.format, avifParser.format], [
    'JPEG',
    'GIF',
    'PNG',
    'WebP',
    'AVIF',
  ]);
  assertEquals(xmpParser.format, 'XMP');
  assertEquals(iccParser.format, 'ICC');
  assertEquals(ppmParser.format, 'PPM');
  assertEquals(pgmParser.format, 'PGM');
  assertEquals(pbmParser.format, 'PBM');
  assertEquals(exifParser.format, 'EXIF');
  assertEquals(exvParser.format, 'EXV');
});
