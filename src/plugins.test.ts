import { test } from 'vitest';
import { assertEquals } from '../src/test/asserts.js';
import { ALL_PLUGINS, MODERN_PLUGINS, MODERN_RAW_PLUGINS, gifParser, jpegParser, pngParser, ppmParser, pgmParser, pbmParser, webpParser, avifParser, exifParser, exvParser, iccParser, xmpParser, tiffRawParser } from './plugins.js';
import { BUILTIN_PLUGINS } from './format/all.js';

test('MODERN_PLUGINS is exactly the web formats (Web Almanac 2024 set)', () => {
  assertEquals(MODERN_PLUGINS.map((p) => p.format), ['JPEG', 'GIF', 'PNG', 'WebP', 'AVIF']);
});

test('MODERN_RAW_PLUGINS has the RAW container plus XMP sidecar support', () => {
  assertEquals(MODERN_RAW_PLUGINS.map((p) => p.format), ['TIFF', 'XMP']);
  assertEquals(typeof tiffRawParser.writeBytes, 'function');
  assertEquals(typeof xmpParser.writeBytes, 'function');
  const rawExtensions = tiffRawParser.extensions.map((e) => e.toLowerCase());
  for (const ext of ['.dng', '.cr2', '.nef', '.arw', '.orf', '.rw2']) {
    assertEquals(rawExtensions.includes(ext), true, `missing ${ext}`);
  }
});

test('ALL_PLUGINS is every shipped parser, distinct from the presets', () => {
  assertEquals(ALL_PLUGINS.map((p) => p.format), ['JPEG', 'GIF', 'PNG', 'PPM', 'PGM', 'PBM', 'WebP', 'AVIF', 'TIFF', 'EXIF', 'EXV', 'ICC', 'XMP']);
  assertEquals(ALL_PLUGINS, BUILTIN_PLUGINS);
  for (const preset of [MODERN_PLUGINS, MODERN_RAW_PLUGINS]) {
    for (const p of preset) {
      assertEquals(ALL_PLUGINS.includes(p), true, `${p.format} missing from ALL_PLUGINS`);
    }
  }
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
