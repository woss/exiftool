import { test } from 'vitest';
import { assertEquals } from '../src/test/asserts.js';
import {
  assertPinnedExifToolVersion,
  assertWritableTypesClassified,
  collectWritableExifTags,
  collectWritableXmpShapes,
  parseExifToolXml,
  parseExifToolXmpNamespaces,
} from './generate-tags.js';

test('tag generation requires the pinned ExifTool version', () => {
  assertPinnedExifToolVersion('13.64');
  let message: string | undefined;
  try {
    assertPinnedExifToolVersion('13.63');
  } catch (error) {
    message = (error as Error).message;
  }
  assertEquals(message, 'Expected vendored ExifTool 13.64, found 13.63');
});

test('tag generation rejects unclassified writable type names', () => {
  const parseTag = (type: string) => parseExifToolXml([
    "<table name='Test::Main'>",
    ` <tag id='1' name='Value' type='${type}' writable='true'>`,
    ' </tag>',
    '</table>',
  ].join('\n'));
  assertWritableTypesClassified(parseTag('int16u'));
  let message: string | undefined;
  try {
    assertWritableTypesClassified(parseTag('futureType'));
  } catch (error) {
    message = (error as Error).message;
  }
  assertEquals(message, 'Unclassified writable ExifTool types: futureType');
});

test('tag generation retains upstream enum values', () => {
  const tables = parseExifToolXml([
    "<table name='Exif::Main' g0='EXIF' g1='IFD0'>",
    " <tag id='274' name='Orientation' type='int16u' writable='true'>",
    '  <values>',
    "   <key id='1'>",
    '    <val lang=\'en\'>Horizontal (normal)</val>',
    "   </key>",
    '  </values>',
    ' </tag>',
    '</table>',
  ].join('\n'));
  assertEquals(tables[0]?.tags[0]?.values, { 1: 'Horizontal (normal)' });
});

test('tag generation decodes XML entities in enum labels', () => {
  const tables = parseExifToolXml([
    "<table name='Test::Main' g0='Test' g1='Main'>",
    " <tag id='1' name='Compression' type='int16u' writable='true'>",
    '  <desc lang=\'en\'>A &amp; B &#x26; C</desc>',
    '  <values>',
    "   <key id='9'>",
    '    <val lang=\'en\'>JBIG B&amp;W &#66;</val>',
    '   </key>',
    '  </values>',
    ' </tag>',
    '</table>',
  ].join('\n'));
  assertEquals(tables[0]?.tags[0]?.description, 'A & B & C');
  assertEquals(tables[0]?.tags[0]?.values, { 9: 'JBIG B&W B' });
});

test('tag generation extracts quoted and unquoted XMP namespace prefixes', () => {
  const namespaces = parseExifToolXmpNamespaces([
    '%nsURI = (',
    "    dc => 'http://purl.org/dc/elements/1.1/',",
    "   'apple-fi' => 'http://ns.apple.com/faceinfo/1.0/', # comment",
    ');',
  ].join('\n'));
  assertEquals(namespaces, {
    dc: 'http://purl.org/dc/elements/1.1/',
    'apple-fi': 'http://ns.apple.com/faceinfo/1.0/',
  });
});

test('tag generation maps writable XMP list shapes through canonical namespace prefixes', () => {
  const table = {
    perlName: 'XMP::dc',
    groups: { g1: 'XMP-dc' },
    description: '',
    tags: [
      { id: 'subject', name: 'subject', type: 'string', writable: true },
      { id: 'hidden', name: 'hidden', type: 'string', writable: false },
    ],
  };
  assertEquals(
    collectWritableXmpShapes(
      [table],
      { 'dc:subject': 'Bag', 'dc:hidden': 'Seq' },
      { dc: 'http://purl.org/dc/elements/1.1/' },
    ),
    { 'dc:subject': 'bag' },
  );
});

test('tag generation uses source IDs when XMP display names differ', () => {
  const table = {
    perlName: 'XMP::iptcExt',
    groups: { g1: 'XMP-iptcExt' },
    description: '',
    tags: [{ id: 'RegistryId', name: 'RegistryID', type: 'struct', writable: true }],
  };
  assertEquals(
    collectWritableXmpShapes(
      [table],
      { 'iptcExt:RegistryID': 'Bag' },
      { Iptc4xmpExt: 'http://iptc.org/std/Iptc4xmpExt/2008-02-29/' },
    ),
    { 'Iptc4xmpExt:RegistryId': 'bag' },
  );
});

test('writable EXIF catalog routes by WriteGroup, table WRITE_GROUP, then home group', () => {
  const tables = parseExifToolXml([
    "<table name='Exif::Main' g0='EXIF' g1='IFD0'>",
    " <tag id='11' name='ProcessingSoftware' type='string' writable='true'/>",
    " <tag id='37386' name='UserComment' type='string' writable='true' g2='Image'/>",
    '</table>',
    "<table name='GPS::Main' g0='GPS' g1='GPS'>",
    " <tag id='2' name='GPSLatitude' type='rational64u' writable='true'/>",
    '</table>',
  ].join('\n'));
  const tableByName = new Map(tables.map((table) => [table.perlName, table]));
  const groups = collectWritableExifTags([
    // Explicit per-tag WriteGroup wins over the table default.
    { table: 'Exif::Main', id: '11', name: 'ProcessingSoftware', writable: 'string', writeGroup: 'IFD0' },
    // No per-tag WriteGroup: falls back to the tag's home group (Groups{1}).
    { table: 'Exif::Main', id: '37386', name: 'UserComment', writable: 'string', groups1: 'ExifIFD' },
    // GPS::Main carries no write group at all: the table-level WRITE_GROUP applies.
    { table: 'GPS::Main', id: '2', name: 'GPSLatitude', writable: 'rational64u', tableWriteGroup: 'GPS' },
    { table: 'GPS::Main', id: 'x', name: 'Garbage', writable: 'string' },
  ], tableByName);
  assertEquals(groups.IFD0, [{ id: 11, name: 'ProcessingSoftware', type: 'string', protected: false, conditional: false }]);
  assertEquals(groups.ExifIFD, [{ id: 37386, name: 'UserComment', type: 'string', protected: false, conditional: false }]);
  assertEquals(groups.GPS, [{ id: 2, name: 'GPSLatitude', type: 'rational64u', protected: false, conditional: false }]);
});

test('writable EXIF catalog keeps conditional flags and joins PrintConv values', () => {
  const tables = parseExifToolXml([
    "<table name='Exif::Main' g0='EXIF' g1='IFD0'>",
    " <tag id='274' name='Orientation' type='int16u' writable='true'>",
    '  <values>',
    "   <key id='1'>",
    '    <val lang=\'en\'>Horizontal (normal)</val>',
    "   </key>",
    '  </values>',
    ' </tag>',
    '</table>',
  ].join('\n'));
  const tableByName = new Map(tables.map((table) => [table.perlName, table]));
  const groups = collectWritableExifTags([
    { table: 'Exif::Main', id: '274', name: 'Orientation', writable: 'int16u', writeGroup: 'IFD0' },
    { table: 'Exif::Main', id: '37500', name: 'MakerNoteCanon', writable: 'undef', groups1: 'ExifIFD', conditional: true },
  ], tableByName);
  assertEquals(groups.IFD0, [{ id: 274, name: 'Orientation', type: 'int16u', values: { 1: 'Horizontal (normal)' }, protected: false, conditional: false }]);
  // Conditional tags stay in the catalog with their flag; the writer refuses them.
  assertEquals(groups.ExifIFD, [{ id: 37500, name: 'MakerNoteCanon', type: 'undef', protected: false, conditional: true }]);
});
