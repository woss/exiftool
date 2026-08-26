import { assertEquals } from '../deps.ts';
// Importing the barrel pulls in src/exiftool.ts, whose side-effect imports
// register every format parser — detectParser below depends on that.
import { ExifTool, TagDb, UnsupportedFormatError, writeTags } from '../mod.ts';
import type { WriteResult } from '../mod.ts';
import { DEFAULT_OPTIONS } from '../src/types.ts';
import { detectParser, getParser } from '../src/format/mod.ts';

Deno.test('barrel exports the public API surface', () => {
  assertEquals(typeof ExifTool, 'function');
  assertEquals(typeof TagDb, 'function');
  assertEquals(typeof writeTags, 'function');
  assertEquals(typeof UnsupportedFormatError, 'function');
  const sample: WriteResult = { file: 'x', written: [], skipped: [] };
  assertEquals(sample.file, 'x');
});

Deno.test('ExifTool constructor wires a populated tag db and default options', () => {
  const tool = new ExifTool();
  assertEquals(tool.tagDb instanceof TagDb, true);
  assertEquals(tool.tagDb.size() > 0, true);
  assertEquals(tool.options, DEFAULT_OPTIONS);
  const custom = new ExifTool({ verbosity: 3 });
  assertEquals(custom.options.verbosity, 3);
  assertEquals(custom.options.composite, DEFAULT_OPTIONS.composite);
});

Deno.test('format parsers are registered via side-effect import; JPEG is detected', () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const parser = detectParser(jpeg);
  assertEquals(parser?.format, 'JPEG');
});

Deno.test('DEFAULT_OPTIONS exposes exiftool-parity defaults', () => {
  assertEquals(DEFAULT_OPTIONS.duplicates, false);
  assertEquals(DEFAULT_OPTIONS.binary, false);
  assertEquals(DEFAULT_OPTIONS.composite, true);
  assertEquals(DEFAULT_OPTIONS.fastScan, 0);
  assertEquals(DEFAULT_OPTIONS.verbosity, 0);
  assertEquals(DEFAULT_OPTIONS.charset, 'UTF8');
  assertEquals(DEFAULT_OPTIONS.lang, 'en');
  assertEquals(DEFAULT_OPTIONS.extractEmbedded, 0);
  assertEquals(DEFAULT_OPTIONS.groupNames, false);
  assertEquals(DEFAULT_OPTIONS.struct, false);
});
