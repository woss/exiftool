import { test } from 'vitest';
import { assertEquals } from '../test/asserts.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rm, writeFile } from 'node:fs/promises';
import { tempFile } from '../test/tmp.js';
import { parseXMP } from '../exif/xmp.js';
import type { TagStructValue } from '../types.js';
import { UnsupportedFormatError } from './writers.js';
import {
  buildXmpPropertiesPacket,
  deleteXmpProperties,
  mergeXmpProperties,
  serializeXmpProperty,
  toXmpPropertyName,
  toXmpPropertyRequest,
  writeXmpPacket,
} from './xmp-writer.js';

const execFileP = promisify(execFile);
const upstreamExifTool = new URL('../../vendor/exiftool/exiftool', import.meta.url).pathname;

test('mergeXmpProperties splices into an existing packet without re-serializing', () => {
  const original = [
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Test Tool">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"',
    ' dc:title="My Title" dc:creator="Woss">',
    '<dc:description><rdf:Alt><rdf:li xml:lang="x-default">Original description</rdf:li></rdf:Alt></dc:description>',
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('\n');
  const merged = mergeXmpProperties(original, [
    { name: 'dc:rights', value: 'Copyright 2026 Test & Co. <legal>' },
    { name: 'xmpRights:WebStatement', value: 'https://example.com/license' },
  ]);
  // Prior properties preserved verbatim.
  assertEquals(merged.includes('dc:title="My Title"'), true);
  assertEquals(merged.includes('dc:creator="Woss"'), true);
  assertEquals(merged.includes('<dc:description><rdf:Alt><rdf:li xml:lang="x-default">Original description</rdf:li></rdf:Alt></dc:description>'), true);
  // Namespaces added on rdf:RDF.
  assertEquals(merged.includes(`xmlns:dc="http://purl.org/dc/elements/1.1/"`), true);
  assertEquals(merged.includes(`xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"`), true);
  // New properties with xml:lang="x-default" Alt/li and XML escaping.
  assertEquals(merged.includes('<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">Copyright 2026 Test &amp; Co. &lt;legal&gt;</rdf:li></rdf:Alt></dc:rights>'), true);
  assertEquals(merged.includes('<xmpRights:WebStatement>https://example.com/license</xmpRights:WebStatement>'), true);
  const parsed = parseXMP(merged);
  assertEquals(parsed.Rights, 'Copyright 2026 Test & Co. <legal>');
  assertEquals(parsed.WebStatement, 'https://example.com/license');
  assertEquals(parsed.Title, 'My Title');
});

test('mergeXmpProperties replaces existing elements and attribute forms', () => {
  const original =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"><rdf:Description rdf:about="" xmpRights:WebStatement=\'https://old.example\'><dc:rights><rdf:Alt><rdf:li xml:lang="x-default">Old rights</rdf:li></rdf:Alt></dc:rights></rdf:Description></rdf:RDF></x:xmpmeta>';
  const merged = mergeXmpProperties(original, [
    { name: 'dc:rights', value: 'New rights' },
    { name: 'xmpRights:WebStatement', value: 'https://new.example' },
  ]);
  assertEquals(merged.includes('Old rights'), false);
  assertEquals(merged.includes('https://old.example'), false);
  assertEquals(merged.includes('<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">New rights</rdf:li></rdf:Alt></dc:rights>'), true);
  assertEquals(merged.includes('<xmpRights:WebStatement>https://new.example</xmpRights:WebStatement>'), true);
});

test('mergeXmpProperties replaces a property in a later top-level description', async () => {
  const original = '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:Description rdf:about="first"><dc:description>Keep this</dc:description></rdf:Description><rdf:Description rdf:about="second" dc:title="Old title"/></rdf:RDF>';
  const merged = mergeXmpProperties(original, [{ name: 'dc:title', value: 'New title' }]);
  assertEquals(merged.includes('Old title'), false);
  assertEquals((merged.match(/(?:dc:title=|<dc:title>)/g) ?? []).length, 1);
  assertEquals(parseXMP(merged).Title, 'New title');
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, merged);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-XMP-dc:Title', file]);
    assertEquals(JSON.parse(stdout)[0].Title, 'New title');
  } finally {
    await rm(file, { force: true });
  }
});

test('mergeXmpProperties recognizes single-quoted namespace declarations', () => {
  const original = "<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\" xmlns:dc='http://purl.org/dc/elements/1.1/'><rdf:Description rdf:about=\"\"></rdf:Description></rdf:RDF>";
  const merged = mergeXmpProperties(original, [{ name: 'dc:subject', value: ['one', 'two'] }]);
  assertEquals(merged.split('xmlns:dc=').length - 1, 1);
  assertEquals(merged.includes("xmlns:dc='http://purl.org/dc/elements/1.1/'"), true);
  assertEquals(merged.includes('<dc:subject><rdf:Bag>'), true);
});

test('XMP writer accepts generated ExifTool namespace prefixes', async () => {
  assertEquals(toXmpPropertyName('XMP-apple-fi:AngleInfoRoll'), 'apple-fi:AngleInfoRoll');
  const packet = writeXmpPacket(null, [{ name: 'apple-fi:AngleInfoRoll', value: 90 }]);
  assertEquals(packet.includes('xmlns:apple-fi="http://ns.apple.com/faceinfo/1.0/"'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-XMP-apple-fi:AngleInfoRoll', file]);
    assertEquals(JSON.parse(stdout)[0].AngleInfoRoll, 90);
  } finally {
    await rm(file, { force: true });
  }
});

test('mergeXmpProperties inserts into the top-level description, not nested ones', () => {
  // Camera Raw style: nested rdf:Description inside crs structures.
  const original = [
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '<dc:title>Outer</dc:title>',
    '<crs:Look xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/">',
    '<rdf:Description crs:Version="15.0"><crs:Parameters><crs:ToneCurve><rdf:Seq><rdf:li>0, 0</rdf:li></rdf:Seq></crs:ToneCurve></rdf:Description>',
    '</crs:Parameters>',
    '</crs:Look>',
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
  ].join('\n');
  const merged = mergeXmpProperties(original, [
    { name: 'dc:rights', value: 'Top-level rights' },
  ]);
  const crsLookEnd = merged.indexOf('</crs:Look>');
  const topDescEnd = merged.indexOf('</rdf:Description>', crsLookEnd);
  const rightsAt = merged.indexOf('<dc:rights>');
  assertEquals(rightsAt > crsLookEnd, true);
  assertEquals(rightsAt < topDescEnd, true);
});

test('mergeXmpProperties expands an empty self-closing description', () => {
  const original = '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:Description rdf:about=""/></rdf:RDF>';
  const merged = mergeXmpProperties(original, [{ name: 'dc:rights', value: 'Copyright' }]);
  assertEquals(merged.includes('<rdf:Description rdf:about=""><dc:rights>'), true);
  assertEquals(merged.includes('</dc:rights></rdf:Description>'), true);
});

test('mergeXmpProperties rejects packets without rdf:RDF', () => {
  let threw = false;
  try {
    mergeXmpProperties('<nothing/>', [{ name: 'dc:rights', value: 'R' }]);
  } catch (e) {
    threw = e instanceof UnsupportedFormatError;
  }
  assertEquals(threw, true);
});

test('mergeXmpProperties leaves unterminated descriptions unchanged apart from namespaces', () => {
  const malformed = '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="">body</rdf:RDF>';
  const out = mergeXmpProperties(malformed, [{ name: 'dc:rights', value: 'R' }]);
  assertEquals(out.includes('xmlns:dc='), true);
  assertEquals(out.includes('dc:rights'), false);
});

test('buildXmpPropertiesPacket creates a minimal conformant packet', () => {
  const packet = buildXmpPropertiesPacket([
    { name: 'dc:rights', value: 'R' },
    { name: 'xmpRights:WebStatement', value: 'https://w.example' },
    { name: 'dc:subject', value: ['kw1', 'kw2'] },
    { name: 'dc:creator', value: ['Byline'] },
  ]);
  const parsed = parseXMP(packet);
  assertEquals(parsed.Rights, 'R');
  assertEquals(parsed.WebStatement, 'https://w.example');
  assertEquals(parsed.Subject, ['kw1', 'kw2']);
  assertEquals(parsed.Creator, 'Byline');
  assertEquals(packet.includes('x:xmptk="exiftool-ts"'), true);
  assertEquals(packet.startsWith('<?xpacket'), true);
  assertEquals(packet.includes('xmlns:dc="http://purl.org/dc/elements/1.1/"'), true);
});

test('XMP writes are idempotent', () => {
  const props = [
    { name: 'dc:subject', value: ['a', 'b'] },
    { name: 'dc:title', value: 'T' },
  ];
  const fresh = writeXmpPacket(null, props);
  assertEquals(writeXmpPacket(fresh, props), fresh);
});

test('unknown namespace prefix throws', () => {
  let threw = false;
  try {
    writeXmpPacket(null, [{ name: 'nope:thing', value: 'x' }]);
  } catch (e) {
    threw = e instanceof UnsupportedFormatError;
  }
  assertEquals(threw, true);
});

test('serializeXmpProperty shapes: scalar, alt, bag, seq', () => {
  assertEquals(serializeXmpProperty('xmp:MetadataDate', '2026-09-29T00:00:00'), '<xmp:MetadataDate>2026-09-29T00:00:00</xmp:MetadataDate>');
  assertEquals(serializeXmpProperty('exifEX:PhotographicSensitivity', 320), '<exifEX:PhotographicSensitivity>320</exifEX:PhotographicSensitivity>');
  assertEquals(serializeXmpProperty('xmpRights:Marked', true), '<xmpRights:Marked>True</xmpRights:Marked>');
  assertEquals(serializeXmpProperty('xmpRights:UsageTerms', 'Terms'), '<xmpRights:UsageTerms><rdf:Alt><rdf:li xml:lang="x-default">Terms</rdf:li></rdf:Alt></xmpRights:UsageTerms>');
  assertEquals(serializeXmpProperty('xmpRights:Owner', ['Alice', 'Bob']), '<xmpRights:Owner><rdf:Bag><rdf:li>Alice</rdf:li><rdf:li>Bob</rdf:li></rdf:Bag></xmpRights:Owner>');
  assertEquals(serializeXmpProperty('Iptc4xmpExt:AltTextAccessibility', 'Accessible description'), '<Iptc4xmpExt:AltTextAccessibility><rdf:Alt><rdf:li xml:lang="x-default">Accessible description</rdf:li></rdf:Alt></Iptc4xmpExt:AltTextAccessibility>');
  assertEquals(serializeXmpProperty('dc:title', 'T'), '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">T</rdf:li></rdf:Alt></dc:title>');
  assertEquals(serializeXmpProperty('dc:subject', ['a', 'b']), '<dc:subject><rdf:Bag><rdf:li>a</rdf:li><rdf:li>b</rdf:li></rdf:Bag></dc:subject>');
  assertEquals(serializeXmpProperty('dc:creator', ['A']), '<dc:creator><rdf:Seq><rdf:li>A</rdf:li></rdf:Seq></dc:creator>');
  assertEquals(serializeXmpProperty('exifEX:LensSpecification', [24, 70, 4, 5]), '<exifEX:LensSpecification><rdf:Seq><rdf:li>24</rdf:li><rdf:li>70</rdf:li><rdf:li>4</rdf:li><rdf:li>5</rdf:li></rdf:Seq></exifEX:LensSpecification>');
  assertEquals(serializeXmpProperty('Iptc4xmpExt:ModelAge', [25, 30]), '<Iptc4xmpExt:ModelAge><rdf:Bag><rdf:li>25</rdf:li><rdf:li>30</rdf:li></rdf:Bag></Iptc4xmpExt:ModelAge>');
  assertEquals(serializeXmpProperty('tiff:Copyright', 'Rights'), '<tiff:Copyright><rdf:Alt><rdf:li xml:lang="x-default">Rights</rdf:li></rdf:Alt></tiff:Copyright>');
  assertEquals(serializeXmpProperty('exif:UserComment', 'Comment'), '<exif:UserComment><rdf:Alt><rdf:li xml:lang="x-default">Comment</rdf:li></rdf:Alt></exif:UserComment>');
  assertEquals(serializeXmpProperty('Iptc4xmpExt:ArtworkTitle', 'Artwork'), '<Iptc4xmpExt:ArtworkOrObjectAOTitle><rdf:Alt><rdf:li xml:lang="x-default">Artwork</rdf:li></rdf:Alt></Iptc4xmpExt:ArtworkOrObjectAOTitle>');
  assertEquals(serializeXmpProperty('crs:Name', 'Camera Raw profile'), '<crs:Name><rdf:Alt><rdf:li xml:lang="x-default">Camera Raw profile</rdf:li></rdf:Alt></crs:Name>');
  assertEquals(serializeXmpProperty('xmp:Title', 'Document title'), '<xmp:Title><rdf:Alt><rdf:li xml:lang="x-default">Document title</rdf:li></rdf:Alt></xmp:Title>');
});

test('serializeXmpProperty rejects arrays for scalar-shaped properties', () => {
  let threw = false;
  try {
    serializeXmpProperty('xmp:MetadataDate', ['a', 'b']);
  } catch (e) {
    threw = e instanceof UnsupportedFormatError;
  }
  assertEquals(threw, true);
});

test('serializeXmpProperty rejects ambiguous multiple language alternatives', () => {
  let threw = false;
  try {
    serializeXmpProperty('dc:title', ['English', 'Deutsch']);
  } catch (error) {
    threw = error instanceof UnsupportedFormatError;
  }
  assertEquals(threw, true);
});

test('serializeXmpProperty supports language-keyed rdf:Alt values', () => {
  assertEquals(
    serializeXmpProperty('dc:title', { fr: 'Coucher du soleil', 'x-default': 'Sunset' }),
    '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Sunset</rdf:li><rdf:li xml:lang="fr">Coucher du soleil</rdf:li></rdf:Alt></dc:title>',
  );
  let threw = false;
  try {
    serializeXmpProperty('dc:title', { 'bad lang': 'Invalid' });
  } catch (error) {
    threw = error instanceof UnsupportedFormatError;
  }
  assertEquals(threw, true);
});

test('toXmpPropertyRequest preserves namespace and property casing', () => {
  assertEquals(toXmpPropertyRequest('XMP-photoshop:Credit', 'Agency'), {
    name: 'photoshop:Credit',
    value: 'Agency',
  });
  assertEquals(toXmpPropertyRequest('XMP-Iptc4xmpCore:CiEmailWork', 'a@b.test'), {
    name: 'Iptc4xmpCore:CiEmailWork',
    value: 'a@b.test',
  });
  assertEquals(toXmpPropertyRequest('XMP-dc:Subject', ['one', 'two']), {
    name: 'dc:subject',
    value: ['one', 'two'],
  });
  assertEquals(toXmpPropertyRequest('XMP-exifEX:PhotographicSensitivity', 320), {
    name: 'exifEX:PhotographicSensitivity',
    value: 320,
  });
  assertEquals(toXmpPropertyRequest('XMP-exifEX:PhotographicSensitivity', Number.NaN), undefined);
  assertEquals(toXmpPropertyRequest('XMP-exifEX:LensSpecification', [24, 70, 4, 5]), {
    name: 'exifEX:LensSpecification',
    value: [24, 70, 4, 5],
  });
  assertEquals(toXmpPropertyRequest('XMP-exifEX:LensSpecification', [24, Number.POSITIVE_INFINITY]), undefined);
  assertEquals(toXmpPropertyRequest('XMP-xmpRights:Marked', true), {
    name: 'xmpRights:Marked',
    value: true,
  });
});

test('toXmpPropertyName resolves group-qualified names for deletes', () => {
  assertEquals(toXmpPropertyName('XMP-dc:Title'), 'dc:title');
  assertEquals(toXmpPropertyName('XMP-photoshop:Credit'), 'photoshop:Credit');
  assertEquals(toXmpPropertyName('XMP-exifEX:PhotographicSensitivity'), 'exifEX:PhotographicSensitivity');
  assertEquals(toXmpPropertyName('XMP-Iptc4xmpExt:PersonInImage'), 'Iptc4xmpExt:PersonInImage');
  assertEquals(toXmpPropertyName('Bogus:Value'), undefined);
});

test('registers canonical Photoshop and IPTC extended namespace URIs', () => {
  assertEquals(toXmpPropertyName('XMP-iptcExt:Creator'), 'Iptc4xmpExt:Creator');
  assertEquals(toXmpPropertyName('XMP-getty:AssetID'), 'GettyImagesGIFT:AssetID');
  const packet = writeXmpPacket(null, [
    { name: 'photoshop:Credit', value: 'Agency' },
    { name: 'Iptc4xmpExt:PersonInImage', value: 'Photographer' },
  ]);
  assertEquals(packet.includes('xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"'), true);
  assertEquals(packet.includes('xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"'), true);
});

test('writes EXIF extended XMP properties with their registered namespace', async () => {
  const request = toXmpPropertyRequest('XMP-exifEX:PhotographicSensitivity', 320)!;
  const packet = writeXmpPacket(null, [request]);
  assertEquals(packet.includes('xmlns:exifEX="http://cipa.jp/exif/1.0/"'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-XMP-exifEX:PhotographicSensitivity', file]);
    assertEquals(JSON.parse(stdout)[0].PhotographicSensitivity, 320);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes generated language alternatives for TIFF, EXIF, and IPTC XMP properties', async () => {
  const packet = writeXmpPacket(null, [
    { name: 'tiff:Copyright', value: 'Copyright holder' },
    { name: 'exif:UserComment', value: 'Capture note' },
    { name: 'Iptc4xmpExt:ArtworkTitle', value: 'Artwork name' },
  ]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-XMP-tiff:Copyright', '-XMP-exif:UserComment', '-XMP-iptcExt:ArtworkTitle', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.Copyright, 'Copyright holder');
    assertEquals(tags.UserComment, 'Capture note');
    assertEquals(tags.ArtworkTitle, 'Artwork name');
  } finally {
    await rm(file, { force: true });
  }
});

test('writes generated lang-alt properties from Camera Raw and XMP tables', async () => {
  const packet = writeXmpPacket(null, [
    { name: 'crs:Name', value: 'Camera Raw profile' },
    { name: 'xmp:Title', value: 'Document title' },
  ]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-XMP-crs:Name', '-XMP-xmp:Title', file]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.Name, 'Camera Raw profile');
    assertEquals(tags.Title, 'Document title');
  } finally {
    await rm(file, { force: true });
  }
});

test('writes xmpRights Owner as an unordered bag', async () => {
  const packet = writeXmpPacket(null, [{ name: 'xmpRights:Owner', value: ['Alice', 'Bob'] }]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-XMP-xmpRights:Owner', file]);
    assertEquals(JSON.parse(stdout)[0].Owner, ['Alice', 'Bob']);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes XMP Advisory and Identifier as unordered bags', async () => {
  const packet = writeXmpPacket(null, [
    { name: 'xmp:Advisory', value: ['xmp:CreatorTool', 'xmp:MetadataDate'] },
    { name: 'xmp:Identifier', value: ['asset-1', 'archive-2'] },
  ]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-XMP-xmp:Advisory', '-XMP-xmp:Identifier', file]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.Advisory, ['xmp:CreatorTool', 'xmp:MetadataDate']);
    assertEquals(tags.Identifier, ['asset-1', 'archive-2']);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes Photoshop DocumentAncestors and SupplementalCategories as bags', async () => {
  const packet = writeXmpPacket(null, [
    { name: 'photoshop:DocumentAncestors', value: ['parent-1', 'parent-2'] },
    { name: 'photoshop:SupplementalCategories', value: ['News', 'Portrait'] },
  ]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-XMP-photoshop:DocumentAncestors', '-XMP-photoshop:SupplementalCategories', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.DocumentAncestors, ['parent-1', 'parent-2']);
    assertEquals(tags.SupplementalCategories, ['News', 'Portrait']);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes IPTC Core Bags and paged-text PlateNames Sequence', async () => {
  const packet = writeXmpPacket(null, [
    { name: 'Iptc4xmpCore:Scene', value: ['landscape', 'city'] },
    { name: 'Iptc4xmpCore:SubjectCode', value: ['01000000', '02000000'] },
    { name: 'xmpTPg:PlateNames', value: ['Cyan', 'Magenta'] },
  ]);

  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-XMP-iptcCore:Scene', '-XMP-iptcCore:SubjectCode', '-XMP-xmpTPg:PlateNames', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.Scene, ['landscape', 'city']);
    assertEquals(tags.SubjectCode, ['01000000', '02000000']);
    assertEquals(tags.PlateNames, ['Cyan', 'Magenta']);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes Lightroom hierarchy and weighted subjects as Bags', async () => {
  const packet = writeXmpPacket(null, [
    { name: 'lr:HierarchicalSubject', value: ['Nature|Forest', 'Nature|Ocean'] },
    { name: 'lr:WeightedFlatSubject', value: ['forest', 'ocean'] },
  ]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-XMP-lr:HierarchicalSubject', '-XMP-lr:WeightedFlatSubject', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.HierarchicalSubject, ['Nature|Forest', 'Nature|Ocean']);
    assertEquals(tags.WeightedFlatSubject, ['forest', 'ocean']);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes Camera Raw ToneCurve as an ordered Seq', async () => {
  const points = ['0, 0', '0.25, 0.2', '0.75, 0.8', '1, 1'];
  const packet = writeXmpPacket(null, [{ name: 'crs:ToneCurve', value: points }]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-XMP-crs:ToneCurve', file]);
    assertEquals(JSON.parse(stdout)[0].ToneCurve, points);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes TIFF XMP BitsPerSample as an ordered Seq', async () => {
  const values = [8, 8, 8];
  const packet = writeXmpPacket(null, [{ name: 'tiff:BitsPerSample', value: values }]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-XMP-tiff:BitsPerSample', file]);
    assertEquals(JSON.parse(stdout)[0].BitsPerSample, values);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes xmpTPg MaxPageSize as a qualified RDF struct', async () => {
  const value = { 'stDim:w': 8.5, 'stDim:h': 11, 'stDim:unit': 'inch' };
  const request = toXmpPropertyRequest('XMP-xmpTPg:MaxPageSize', value)!;
  assertEquals(request, { name: 'xmpTPg:MaxPageSize', value });
  assertEquals(toXmpPropertyRequest('XMP-xmpTPg:MaxPageSize', { 'stDim:unknown': 1 }), undefined);
  const packet = writeXmpPacket(null, [request]);
  assertEquals(packet.includes('xmlns:stDim="http://ns.adobe.com/xap/1.0/sType/Dimensions#"'), true);
  assertEquals(packet.includes('<xmpTPg:MaxPageSize rdf:parseType="Resource">'), true);
  const existing = '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmpTPg="http://ns.adobe.com/xap/1.0/t/pg/"><rdf:Description rdf:about=""></rdf:Description></rdf:RDF>';
  const merged = mergeXmpProperties(existing, [request]);
  assertEquals(merged.includes('xmlns:stDim="http://ns.adobe.com/xap/1.0/sType/Dimensions#"'), true);
  assertEquals(merged.includes('<xmpTPg:MaxPageSize rdf:parseType="Resource">'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-struct', '-XMP-xmpTPg:MaxPageSize', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.MaxPageSize, { W: 8.5, H: 11, Unit: 'inch' });
  } finally {
    await rm(file, { force: true });
  }
});

test('writes xmpMM ResourceRef structs', async () => {
  const value = {
    'stRef:documentID': 'uuid:document',
    'stRef:instanceID': 'uuid:instance',
    'stRef:renditionClass': 'default',
  };
  const requests = [
    toXmpPropertyRequest('XMP-xmpMM:DerivedFrom', value)!,
    toXmpPropertyRequest('XMP-xmpMM:ManagedFrom', value)!,
  ];
  const packet = writeXmpPacket(null, requests);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-struct', '-XMP-xmpMM:DerivedFrom', '-XMP-xmpMM:ManagedFrom', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    const expected = {
      DocumentID: 'uuid:document',
      InstanceID: 'uuid:instance',
      RenditionClass: 'default',
    };
    assertEquals(tags.DerivedFrom, expected);
    assertEquals(tags.ManagedFrom, expected);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes xmpMM Versions as an ordered Seq of Version structs', async () => {
  const versions: TagStructValue[] = [
    {
      'stVer:version': '1.0',
      'stVer:comments': 'Initial',
      'stVer:event': { 'stEvt:action': 'created', 'stEvt:softwareAgent': 'Scanner' },
    },
    { 'stVer:version': '2.0', 'stVer:modifier': 'Editor' },
  ];
  const request = toXmpPropertyRequest('XMP-xmpMM:Versions', versions)!;
  const packet = writeXmpPacket(null, [request]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-xmpMM:Versions', file]);
    assertEquals(JSON.parse(stdout)[0].Versions, [
      { Version: 1, Comments: 'Initial', Event: { Action: 'created', SoftwareAgent: 'Scanner' } },
      { Version: 2, Modifier: 'Editor' },
    ]);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes xmpMM History as an ordered Seq of ResourceEvent structs', async () => {
  const history: TagStructValue[] = [
    { 'stEvt:action': 'created', 'stEvt:when': '2024-01-02T03:04:05Z', 'stEvt:softwareAgent': 'Scanner' },
    { 'stEvt:action': 'saved', 'stEvt:when': '2024-01-03T03:04:05Z', 'stEvt:softwareAgent': 'Editor' },
  ];
  const request = toXmpPropertyRequest('XMP-xmpMM:History', history)!;
  const packet = writeXmpPacket(null, [request]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-xmpMM:History', file]);
    assertEquals(JSON.parse(stdout)[0].History, [
      { Action: 'created', When: '2024:01:02 03:04:05Z', SoftwareAgent: 'Scanner' },
      { Action: 'saved', When: '2024:01:03 03:04:05Z', SoftwareAgent: 'Editor' },
    ]);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes scalar xmpDM Markers as an ordered Seq of structs', async () => {
  const markers: TagStructValue[] = [
    {
      'xmpDM:name': 'Opening',
      'xmpDM:comment': 'Start',
      'xmpDM:type': 'Chapter',
      'xmpDM:cuePointParams': [{ 'xmpDM:key': 'kind', 'xmpDM:value': 'intro' }],
    },
    { 'xmpDM:name': 'Ending', 'xmpDM:comment': 'Finish', 'xmpDM:type': 'Chapter' },
  ];
  const request = toXmpPropertyRequest('XMP-xmpDM:markers', markers)!;
  const packet = writeXmpPacket(null, [request]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-xmpDM:markers', file]);
    assertEquals(JSON.parse(stdout)[0], {
      SourceFile: file,
      Markers: [
        {
          Name: 'Opening',
          Comment: 'Start',
          Type: 'Chapter',
          CuePointParams: [{ Key: 'kind', Value: 'intro' }],
        },
        { Name: 'Ending', Comment: 'Finish', Type: 'Chapter' },
      ],
    });
  } finally {
    await rm(file, { force: true });
  }
});

test('writes xmpMM Pantry as a Bag with required InstanceID', async () => {
  const pantry: TagStructValue[] = [
    { 'xmpMM:InstanceID': 'uuid:ingredient-one' },
    { 'xmpMM:InstanceID': 'uuid:ingredient-two' },
  ];
  const request = toXmpPropertyRequest('XMP-xmpMM:Pantry', pantry)!;
  assertEquals(toXmpPropertyRequest('XMP-xmpMM:Pantry', [{ 'xmpMM:DocumentID': 'uuid:missing' }]), undefined);
  const packet = writeXmpPacket(null, [request]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-xmpMM:Pantry', file]);
    assertEquals(JSON.parse(stdout)[0].Pantry, [
      { InstanceID: 'uuid:ingredient-one' },
      { InstanceID: 'uuid:ingredient-two' },
    ]);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes IPTC Core CreatorContactInfo as a qualified struct', async () => {
  const value: TagStructValue = {
    'Iptc4xmpCore:CiAdrCity': 'Paris',
    'Iptc4xmpCore:CiAdrCtry': 'France',
    'Iptc4xmpCore:CiEmailWork': 'editor@example.test',
    'Iptc4xmpCore:CiTelWork': '+33 1 23 45 67 89',
  };
  const request = toXmpPropertyRequest('XMP-Iptc4xmpCore:CreatorContactInfo', value)!;
  const packet = writeXmpPacket(null, [request]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-struct', '-XMP-iptcCore:CreatorContactInfo', file,
    ]);
    assertEquals(JSON.parse(stdout)[0].CreatorContactInfo, {
      CiAdrCity: 'Paris',
      CiAdrCtry: 'France',
      CiEmailWork: 'editor@example.test',
      CiTelWork: '+33 1 23 45 67 89',
    });
  } finally {
    await rm(file, { force: true });
  }
});

test('writes AboutCvTerm Bag entries with multilingual CvTermName fields', async () => {
  const terms: TagStructValue[] = [{
    'Iptc4xmpExt:CvTermId': 'scene-001',
    'Iptc4xmpExt:CvId': 'urn:example:vocab',
    'Iptc4xmpExt:CvTermName': { 'x-default': 'Landscape', fr: 'Paysage' },
  }];
  const request = toXmpPropertyRequest('XMP-Iptc4xmpExt:AboutCvTerm', terms)!;
  const packet = writeXmpPacket(null, [request]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-iptcExt:AboutCvTerm', file]);
    assertEquals(JSON.parse(stdout)[0].AboutCvTerm, [{
      CvTermId: 'scene-001',
      CvId: 'urn:example:vocab',
      CvTermName: 'Landscape',
      'CvTermName-fr': 'Paysage',
    }]);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes IPTC Extension Genre as a CVTerm Bag', async () => {
  const genre: TagStructValue[] = [{
    'Iptc4xmpExt:CvTermId': 'genre-001',
    'Iptc4xmpExt:CvTermName': { 'x-default': 'Documentary', fr: 'Documentaire' },
  }];
  const request = toXmpPropertyRequest('XMP-Iptc4xmpExt:Genre', genre)!;
  const packet = writeXmpPacket(null, [request]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-iptcExt:Genre', file]);
    assertEquals(JSON.parse(stdout)[0].Genre, [{
      CvTermId: 'genre-001',
      CvTermName: 'Documentary',
      'CvTermName-fr': 'Documentaire',
    }]);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes multiple dc:title language alternatives', async () => {
  const value = { 'x-default': 'Sunset', fr: 'Coucher du soleil' };
  const request = toXmpPropertyRequest('XMP-dc:Title', value)!;
  const packet = writeXmpPacket(null, [request]);
  assertEquals(packet.includes('<rdf:li xml:lang="x-default">Sunset</rdf:li>'), true);
  assertEquals(packet.includes('<rdf:li xml:lang="fr">Coucher du soleil</rdf:li>'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-dc:Title', file]);
    assertEquals(JSON.parse(stdout)[0].Title, 'Sunset');
  } finally {
    await rm(file, { force: true });
  }
});

test('writes xmpMM Ingredients as a Bag of ResourceRef structs', async () => {
  const ingredients = [
    { 'stRef:documentID': 'uuid:first' },
    { 'stRef:documentID': 'uuid:second' },
  ];
  const request = toXmpPropertyRequest('XMP-xmpMM:Ingredients', ingredients)!;
  const packet = writeXmpPacket(null, [request]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-xmpMM:Ingredients', file]);
    assertEquals(JSON.parse(stdout)[0].Ingredients, [
      { DocumentID: 'uuid:first' },
      { DocumentID: 'uuid:second' },
    ]);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes scalar xmpMM ManifestItem fields as Bag structs', async () => {
  const manifest = [
    {
      'stMfs:linkForm': 'embed',
      'xmpMM:placedXResolution': 300,
      'xmpMM:placedYResolution': 150,
      'stMfs:reference': { 'stRef:documentID': 'uuid:source', 'stRef:filePath': '/source.pdf' },
    },
  ];
  const request = toXmpPropertyRequest('XMP-xmpMM:Manifest', manifest)!;
  const packet = writeXmpPacket(null, [request]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-xmpMM:Manifest', file]);
    assertEquals(JSON.parse(stdout)[0].Manifest, [
      {
        LinkForm: 'embed',
        PlacedXResolution: 300,
        PlacedYResolution: 150,
        Reference: { DocumentID: 'uuid:source', FilePath: '/source.pdf' },
      },
    ]);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes xmpTPg Colorants as an ordered Seq of Colorant structs', async () => {
  const colorants: TagStructValue[] = [
    { 'xmpG:swatchName': 'Cyan', 'xmpG:type': 'PROCESS', 'xmpG:cyan': 100 },
    { 'xmpG:swatchName': 'Magenta', 'xmpG:type': 'PROCESS', 'xmpG:magenta': 100 },
  ];
  const request = toXmpPropertyRequest('XMP-xmpTPg:Colorants', colorants)!;
  const packet = writeXmpPacket(null, [request]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-xmpTPg:Colorants', file]);
    assertEquals(JSON.parse(stdout)[0].Colorants, [
      { SwatchName: 'Cyan', Type: 'PROCESS', Cyan: 100 },
      { SwatchName: 'Magenta', Type: 'PROCESS', Magenta: 100 },
    ]);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes xmpTPg Fonts as a Bag of scalar Font struct fields', async () => {
  const fonts: TagStructValue[] = [{
    'stFnt:fontName': 'Avenir',
    'stFnt:fontFamily': 'Avenir',
    'stFnt:fontFace': 'Book',
    'stFnt:fontType': 'TrueType',
    'stFnt:versionString': '1.0',
    'stFnt:composite': false,
    'stFnt:fontFileName': 'Avenir.ttf',
    'stFnt:childFontFiles': ['Avenir-Regular.ttf', 'Avenir-Bold.ttf'],
  }];
  const request = toXmpPropertyRequest('XMP-xmpTPg:Fonts', fonts)!;
  const packet = writeXmpPacket(null, [request]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-xmpTPg:Fonts', file]);
    assertEquals(JSON.parse(stdout)[0].Fonts, [{
      FontName: 'Avenir',
      FontFamily: 'Avenir',
      FontFace: 'Book',
      FontType: 'TrueType',
      VersionString: 1,
      Composite: false,
      FontFileName: 'Avenir.ttf',
      ChildFontFiles: ['Avenir-Regular.ttf', 'Avenir-Bold.ttf'],
    }]);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes scalar xmpTPg SwatchGroups as an ordered Seq of structs', async () => {
  const swatchGroups: TagStructValue[] = [
    {
      'xmpG:groupName': 'Print',
      'xmpG:groupType': 0,
      'xmpG:Colorants': [{ 'xmpG:swatchName': 'Cyan', 'xmpG:type': 'PROCESS', 'xmpG:cyan': 100 }],
    },
    { 'xmpG:groupName': 'Web', 'xmpG:groupType': 1 },
  ];
  const request = toXmpPropertyRequest('XMP-xmpTPg:SwatchGroups', swatchGroups)!;
  const packet = writeXmpPacket(null, [request]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-xmpTPg:SwatchGroups', file]);
    assertEquals(JSON.parse(stdout)[0].SwatchGroups, [
      {
        GroupName: 'Print',
        GroupType: 0,
        Colorants: [{ SwatchName: 'Cyan', Type: 'PROCESS', Cyan: 100 }],
      },
      { GroupName: 'Web', GroupType: 1 },
    ]);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes XMP boolean properties using ExifTool lexical values', async () => {
  for (const value of [true, false]) {
    const request = toXmpPropertyRequest('XMP-xmpRights:Marked', value)!;
    const packet = writeXmpPacket(null, [request]);
    assertEquals(packet.includes(`<xmpRights:Marked>${value ? 'True' : 'False'}</xmpRights:Marked>`), true);
    const file = await tempFile('.xmp');
    try {
      await writeFile(file, packet);
      const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-XMP-xmpRights:Marked', file]);
      assertEquals(JSON.parse(stdout)[0].Marked, value);
    } finally {
      await rm(file, { force: true });
    }
  }
});

test('writes XMP enum labels as numeric values and rejects unknown labels', async () => {
  const packet = writeXmpPacket(null, [
    { name: 'photoshop:ColorMode', value: 'RGB' },
    { name: 'exifEX:SensitivityType', value: 'ISO Speed' },
    { name: 'tiff:Orientation', value: 'Rotate 90' },
    { name: 'tiff:PlanarConfiguration', value: 'Chunky' },
    { name: 'tiff:YCbCrPositioning', value: 'Co-sited' },
    { name: 'tiff:Compression', value: 'LZW' },
    { name: 'tiff:PhotometricInterpretation', value: 'RGB' },
    { name: 'exif:ExposureProgram', value: 'Portrait' },
  ]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-XMP-photoshop:ColorMode', '-XMP-exifEX:SensitivityType',
      '-XMP-tiff:Orientation', '-XMP-tiff:PlanarConfiguration', '-XMP-tiff:YCbCrPositioning', file,
      '-XMP-tiff:Compression', '-XMP-tiff:PhotometricInterpretation', '-XMP-exif:ExposureProgram',
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.ColorMode, 3);
    assertEquals(tags.SensitivityType, 3);
    assertEquals(tags.Orientation, 6);
    assertEquals(tags.PlanarConfiguration, 1);
    assertEquals(tags.YCbCrPositioning, 2);
    assertEquals(tags.Compression, 5);
    assertEquals(tags.PhotometricInterpretation, 2);
    assertEquals(tags.ExposureProgram, 7);
    const { stdout: displayStdout } = await execFileP(upstreamExifTool, [
      '-j', '-XMP-exif:ExposureProgram', file,
    ]);
    assertEquals(JSON.parse(displayStdout)[0].ExposureProgram, 'Portrait');
  } finally {
    await rm(file, { force: true });
  }
  let threw = false;
  try {
    writeXmpPacket(null, [{ name: 'photoshop:ColorMode', value: 'Not a mode' }]);
  } catch (error) {
    threw = error instanceof UnsupportedFormatError;
  }
  assertEquals(threw, true);
  threw = false;
  try {
    writeXmpPacket(null, [{ name: 'tiff:Orientation', value: 'Mirror' }]);
  } catch (error) {
    threw = error instanceof UnsupportedFormatError;
  }
  assertEquals(threw, true);
});

test('writes string-coded XMP enum labels as their catalog codes', async () => {
  const packet = writeXmpPacket(null, [
    { name: 'exif:GPSDestBearingRef', value: 'Magnetic North' },
    { name: 'xmpDM:AudioSampleType', value: '16-bit integer' },
  ]);
  assertEquals(packet.includes('<exif:GPSDestBearingRef>M</exif:GPSDestBearingRef>'), true);
  assertEquals(packet.includes('<xmpDM:audioSampleType>16Int</xmpDM:audioSampleType>'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout: rawStdout } = await execFileP(upstreamExifTool, [
      '-j', '-n', '-XMP-exif:GPSDestBearingRef', '-XMP-xmpDM:AudioSampleType', file,
    ]);
    const rawTags = JSON.parse(rawStdout)[0];
    assertEquals(rawTags.GPSDestBearingRef, 'M');
    assertEquals(rawTags.AudioSampleType, '16Int');
    const { stdout: displayStdout } = await execFileP(upstreamExifTool, [
      '-j', '-XMP-exif:GPSDestBearingRef', file,
    ]);
    assertEquals(JSON.parse(displayStdout)[0].GPSDestBearingRef, 'Magnetic North');
  } finally {
    await rm(file, { force: true });
  }
});

test('normalizes EXIF-style dates for XMP scalar and sequence properties', async () => {
  const packet = writeXmpPacket(null, [
    { name: 'xmp:CreateDate', value: '2024:01:02 03:04:05' },
    { name: 'dc:date', value: ['2024:01:02 03:04:05+02:00', '2024-01-03'] },
  ]);
  assertEquals(packet.includes('<xmp:CreateDate>2024-01-02T03:04:05</xmp:CreateDate>'), true);
  assertEquals(packet.includes('<rdf:li>2024-01-02T03:04:05+02:00</rdf:li>'), true);
  assertEquals(packet.includes('<rdf:li>2024-01-03</rdf:li>'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-XMP-xmp:CreateDate', '-XMP-dc:Date', file]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.CreateDate, '2024:01:02 03:04:05');
    assertEquals(tags.Date, ['2024:01:02 03:04:05+02:00', '2024:01:03']);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes generated XMP enum values inside RDF list shapes', async () => {
  const request = toXmpPropertyRequest('XMP-prism:OriginPlatform', ['web', 'print']);
  assertEquals(request !== undefined, true);
  const packet = writeXmpPacket(null, [request!]);
  assertEquals(packet.includes('<prism:originPlatform><rdf:Bag><rdf:li>web</rdf:li><rdf:li>print</rdf:li></rdf:Bag>'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-XMP-prism:OriginPlatform', file]);
    assertEquals(JSON.parse(stdout)[0].OriginPlatform, ['web', 'print']);
  } finally {
    await rm(file, { force: true });
  }
});

test('rejects invalid calendar dates and timezone offsets in XMP date values', () => {
  for (const value of ['2024:02:30', '2024:01:01T12:00:00+99:99']) {
    let threw = false;
    try {
      writeXmpPacket(null, [{ name: 'xmp:CreateDate', value }]);
    } catch (error) {
      threw = error instanceof UnsupportedFormatError;
    }
    assertEquals(threw, true);
  }
});

test('normalizes generated date fields in PDF, PRISM, PUR, and DICOM namespaces', async () => {
  const packet = writeXmpPacket(null, [
    { name: 'pdf:CreationDate', value: '2024:01:02 03:04:05' },
    { name: 'prism:CreationDate', value: '2024:01:03' },
    { name: 'pur:ExpirationDate', value: '2024-01-04' },
    { name: 'DICOM:PatientBirthDate', value: '2001:02:03' },
  ]);
  assertEquals(packet.includes('<pdf:CreationDate>2024-01-02T03:04:05</pdf:CreationDate>'), true);
  assertEquals(packet.includes('<prism:creationDate>2024-01-03</prism:creationDate>'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-G1', '-XMP-pdf:CreationDate', '-XMP-prism:CreationDate',
      '-XMP-pur:ExpirationDate', '-XMP-DICOM:PatientBirthDate', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags['XMP-pdf:CreationDate'], '2024:01:02 03:04:05');
    assertEquals(tags['XMP-prism:CreationDate'], '2024:01:03');
    assertEquals(tags['XMP-pur:ExpirationDate'], '2024:01:04');
    assertEquals(tags['XMP-DICOM:PatientBirthDate'], '2001:02:03');
  } finally {
    await rm(file, { force: true });
  }
});

test('derives Photoshop and Dynamic Media date fields from generated metadata', async () => {
  const packet = writeXmpPacket(null, [
    { name: 'photoshop:DateCreated', value: '2024:02:03 04:05:06' },
    { name: 'xmpDM:ShotDate', value: '2024:02:04 05:06:07' },
  ]);
  assertEquals(packet.includes('<photoshop:DateCreated>2024-02-03T04:05:06</photoshop:DateCreated>'), true);
  assertEquals(packet.includes('<xmpDM:shotDate>2024-02-04T05:06:07</xmpDM:shotDate>'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-XMP-photoshop:DateCreated', '-XMP-xmpDM:ShotDate', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    assertEquals(tags.DateCreated, '2024:02:03 04:05:06');
    assertEquals(tags.ShotDate, '2024:02:04 05:06:07');
  } finally {
    await rm(file, { force: true });
  }
});

test('derives Creative Commons, IDimager, and Getty Images date fields', async () => {
  const packet = writeXmpPacket(null, [
    { name: 'cc:DeprecatedOn', value: '2024:03:04' },
    { name: 'ics:TimeStamp', value: '2024:03:05T06:07:08Z' },
    { name: 'GettyImagesGIFT:OriginalCreateDateTime', value: '2024:03:06 07:08:09' },
  ]);
  assertEquals(packet.includes('<cc:deprecatedOn>2024-03-04</cc:deprecatedOn>'), true);
  assertEquals(packet.includes('<ics:TimeStamp>2024-03-05T06:07:08Z</ics:TimeStamp>'), true);
  assertEquals(packet.includes('<GettyImagesGIFT:OriginalCreateDateTime>2024-03-06T07:08:09</GettyImagesGIFT:OriginalCreateDateTime>'), true);
});

test('XMP trailing # writes numeric enum storage values directly', async () => {
  const request = toXmpPropertyRequest('XMP-photoshop:ColorMode#', 3)!;
  assertEquals(request, { name: 'photoshop:ColorMode', value: 3, raw: true });
  const packet = writeXmpPacket(null, [request]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-XMP-photoshop:ColorMode', file]);
    assertEquals(JSON.parse(stdout)[0].ColorMode, 3);
  } finally {
    await rm(file, { force: true });
  }
  let threw = false;
  try {
    writeXmpPacket(null, [toXmpPropertyRequest('XMP-photoshop:ColorMode#', 'RGB')!]);
  } catch (error) {
    threw = error instanceof UnsupportedFormatError;
  }
  assertEquals(threw, true);
});

test('writes EXIF extended lens specification as an ordered rational sequence', async () => {
  const request = toXmpPropertyRequest('XMP-exifEX:LensSpecification', [24, 70, 4, 5])!;
  const packet = writeXmpPacket(null, [request]);
  assertEquals(packet.includes('<exifEX:LensSpecification><rdf:Seq>'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-n', '-XMP-exifEX:LensInfo', file]);
    assertEquals(JSON.parse(stdout)[0].LensInfo, '24 70 4 5');
  } finally {
    await rm(file, { force: true });
  }
});

test('writes xmpDM Tracks as a Bag with nested Marker Sequences', async () => {
  const request = toXmpPropertyRequest('XMP-xmpDM:Tracks', [{
    'xmpDM:trackName': 'Video Track',
    'xmpDM:trackType': 'Video',
    'xmpDM:frameRate': '24',
    'xmpDM:markers': [{ 'xmpDM:name': 'Intro', 'xmpDM:type': 'Chapter' }],
  }]);
  assertEquals(request !== undefined, true);
  const packet = writeXmpPacket(null, [request!]);
  assertEquals(packet.includes('<xmpDM:Tracks><rdf:Bag>'), true);
  assertEquals(packet.includes('<xmpDM:markers><rdf:Seq>'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-xmpDM:Tracks', file]);
    assertEquals(JSON.parse(stdout)[0].Tracks, [{
      TrackName: 'Video Track',
      TrackType: 'Video',
      FrameRate: 24,
      Markers: [{ Name: 'Intro', Type: 'Chapter' }],
    }]);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes scalar XMP Thumbnails structs as rdf:Alt resources', async () => {
  const request = toXmpPropertyRequest('XMP-xmp:Thumbnails', [{
    'xmpGImg:height': 480,
    'xmpGImg:width': 640,
    'xmpGImg:format': 'JPEG',
  }]);
  assertEquals(request !== undefined, true);
  const packet = writeXmpPacket(null, [request!]);
  assertEquals(packet.includes('<xmp:Thumbnails><rdf:Alt>'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-xmp:Thumbnails', file]);
    assertEquals(JSON.parse(stdout)[0].Thumbnails, [{ Height: 480, Width: 640, Format: 'JPEG' }]);
  } finally {
    await rm(file, { force: true });
  }
});

test('base64-encodes binary XMP Thumbnail image fields', async () => {
  const image = new Uint8Array([0, 1, 2, 253, 254, 255]);
  const request = toXmpPropertyRequest('XMP-xmp:Thumbnails', [{
    'xmpGImg:height': 480,
    'xmpGImg:width': 640,
    'xmpGImg:format': 'JPEG',
    'xmpGImg:image': image,
  }]);
  assertEquals(request !== undefined, true);
  const packet = writeXmpPacket(null, [request!]);
  assertEquals(packet.includes('<xmpGImg:image>AAEC/f7/</xmpGImg:image>'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-xmp:Thumbnails', file]);
    const thumbnail = JSON.parse(stdout)[0].Thumbnails[0];
    assertEquals(thumbnail.Height, 480);
    assertEquals(thumbnail.Width, 640);
    assertEquals(thumbnail.Format, 'JPEG');
    assertEquals(thumbnail.Image, '(Binary data 6 bytes, use -b option to extract)');
    const { stdout: imageBytes } = await execFileP(upstreamExifTool, ['-b', '-XMP-xmp:ThumbnailImage', file], { encoding: 'buffer' });
    assertEquals(new Uint8Array(imageBytes), image);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes xmp:PageInfo as a Seq of page image structs', async () => {
  const image = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const request = toXmpPropertyRequest('XMP-xmp:PageInfo', [{
    'xmpTPg:PageNumber': 1,
    'xmpGImg:height': 480,
    'xmpGImg:width': 640,
    'xmpGImg:format': 'JPEG',
    'xmpGImg:image': image,
  }]);
  assertEquals(request !== undefined, true);
  const packet = writeXmpPacket(null, [request!]);
  assertEquals(packet.includes('<xmp:PageInfo><rdf:Seq>'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-xmp:PageInfo', file]);
    assertEquals(JSON.parse(stdout)[0].PageInfo, [{
      PageNumber: 1,
      Height: 480,
      Width: 640,
      Format: 'JPEG',
      Image: '(Binary data 4 bytes, use -b option to extract)',
    }]);
    const { stdout: imageBytes } = await execFileP(upstreamExifTool, ['-b', '-XMP-xmp:PageImage', file], { encoding: 'buffer' });
    assertEquals(new Uint8Array(imageBytes), image);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes IPTC extended PersonInImage as an unordered bag', async () => {
  const request = toXmpPropertyRequest('XMP-Iptc4xmpExt:PersonInImage', ['Alice', 'Bob'])!;
  const packet = writeXmpPacket(null, [request]);
  assertEquals(packet.includes('<Iptc4xmpExt:PersonInImage><rdf:Bag>'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-XMP-iptcExt:PersonInImage', file]);
    assertEquals(JSON.parse(stdout)[0].PersonInImage, ['Alice', 'Bob']);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes generated XMP Bag shapes omitted from the manual shape map', async () => {
  const request = toXmpPropertyRequest('XMP-prism:Link', ['https://one.example', 'https://two.example'])!;
  const packet = writeXmpPacket(null, [request]);
  assertEquals(packet.includes('<prism:link><rdf:Bag>'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-XMP-prism:Link', file]);
    assertEquals(JSON.parse(stdout)[0].Link, ['https://one.example', 'https://two.example']);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes xmpBJ JobRef as a Bag of Resource structs', async () => {
  const request = toXmpPropertyRequest('XMP-xmpBJ:JobRef', [{
    'stJob:id': 'job-1',
    'stJob:name': 'Retouch',
    'stJob:url': 'https://example.test/job-1',
  }]);
  assertEquals(request !== undefined, true);
  const packet = writeXmpPacket(null, [request!]);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-xmpBJ:JobRef', file]);
    assertEquals(JSON.parse(stdout)[0].JobRef, [{ Id: 'job-1', Name: 'Retouch', Url: 'https://example.test/job-1' }]);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes IPTC Extension Contributor as EntityWithRole structs', async () => {
  const values = [{
    'xmp:Identifier': ['person:42'],
    'Iptc4xmpExt:Name': { 'x-default': 'A. Photographer' },
    'Iptc4xmpExt:Role': ['Photographer', 'Editor'],
  }];
  const contributor = toXmpPropertyRequest('XMP-iptcExt:Contributor', values);
  const creator = toXmpPropertyRequest('XMP-iptcExt:Creator', values);
  assertEquals(contributor !== undefined, true);
  assertEquals(creator !== undefined, true);
  const packet = writeXmpPacket(null, [contributor!, creator!]);
  assertEquals(packet.includes('<Iptc4xmpExt:Contributor><rdf:Bag>'), true);
  assertEquals(packet.includes('<Iptc4xmpExt:Creator><rdf:Bag>'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, [
      '-j', '-struct', '-XMP-iptcExt:Contributor', '-XMP-iptcExt:Creator', file,
    ]);
    const tags = JSON.parse(stdout)[0];
    const expected = [{
      Identifier: ['person:42'],
      Name: 'A. Photographer',
      Role: ['Photographer', 'Editor'],
    }];
    assertEquals(tags.Contributor, expected);
    assertEquals(tags.Creator, expected);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes IPTC Extension ProductInImage Bags with multilingual fields', async () => {
  const request = toXmpPropertyRequest('XMP-iptcExt:ProductInImage', [{
    'Iptc4xmpExt:ProductName': { 'x-default': 'Camera', fr: 'Appareil photo' },
    'Iptc4xmpExt:ProductGTIN': '1234567890123',
    'Iptc4xmpExt:ProductDescription': { 'x-default': 'Mirrorless camera' },
    'Iptc4xmpExt:ProductId': 'camera-1',
  }]);
  assertEquals(request !== undefined, true);
  const packet = writeXmpPacket(null, [request!]);
  assertEquals(packet.includes('<Iptc4xmpExt:ProductInImage><rdf:Bag>'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-iptcExt:ProductInImage', file]);
    assertEquals(JSON.parse(stdout)[0].ProductInImage, [{
      ProductName: 'Camera',
      'ProductName-fr': 'Appareil photo',
      ProductGTIN: 1234567890123,
      ProductDescription: 'Mirrorless camera',
      ProductId: 'camera-1',
    }]);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes IPTC Extension PublicationEvent Bags', async () => {
  const request = toXmpPropertyRequest('XMP-iptcExt:PublicationEvent', [{
    'Iptc4xmpExt:Date': '2024-01-02T03:04:05Z',
    'Iptc4xmpExt:Identifier': 'event-1',
  }]);
  assertEquals(request !== undefined, true);
  const packet = writeXmpPacket(null, [request!]);
  assertEquals(packet.includes('<Iptc4xmpExt:PublicationEvent><rdf:Bag>'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-iptcExt:PublicationEvent', file]);
    assertEquals(JSON.parse(stdout)[0].PublicationEvent, [{
      Date: '2024:01:02 03:04:05Z',
      Identifier: 'event-1',
    }]);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes IPTC Extension DopesheetLink Bags', async () => {
  const request = toXmpPropertyRequest('XMP-iptcExt:DopesheetLink', [{
    'Iptc4xmpExt:Link': 'https://example.test/shot-1',
    'Iptc4xmpExt:LinkQualifier': 'production',
  }]);
  assertEquals(request !== undefined, true);
  const packet = writeXmpPacket(null, [request!]);
  assertEquals(packet.includes('<Iptc4xmpExt:DopesheetLink><rdf:Bag>'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-iptcExt:DopesheetLink', file]);
    assertEquals(JSON.parse(stdout)[0].DopesheetLink, [{
      Link: 'https://example.test/shot-1',
      LinkQualifier: 'production',
    }]);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes IPTC Extension RegistryID Bags', async () => {
  assertEquals(toXmpPropertyName('XMP-iptcExt:RegistryID'), 'Iptc4xmpExt:RegistryId');
  const request = toXmpPropertyRequest('XMP-iptcExt:RegistryID', [{
    'Iptc4xmpExt:RegEntryRole': 'creator',
    'Iptc4xmpExt:RegItemId': 'item-1',
    'Iptc4xmpExt:RegOrgId': 'org-1',
  }]);
  assertEquals(request !== undefined, true);
  const packet = writeXmpPacket(null, [request!]);
  assertEquals(packet.includes('<Iptc4xmpExt:RegistryId><rdf:Bag>'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-iptcExt:RegistryID', file]);
    assertEquals(JSON.parse(stdout)[0].RegistryID, [{
      RegEntryRole: 'creator',
      RegItemId: 'item-1',
      RegOrgId: 'org-1',
    }]);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes PRISM OnSaleDay as a Bag of structs', async () => {
  const request = toXmpPropertyRequest('XMP-prism:OnSaleDay', [{
    'prism:day': 'Monday',
    'prism:a-platform': 'web',
  }]);
  assertEquals(request !== undefined, true);
  const packet = writeXmpPacket(null, [request!]);
  assertEquals(packet.includes('<prism:onSaleDay><rdf:Bag>'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-prism:OnSaleDay', file]);
    assertEquals(JSON.parse(stdout)[0].OnSaleDay, [{ 'A-platform': 'web', Day: 'Monday' }]);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes PRISM URL as a Bag of structs', async () => {
  const request = toXmpPropertyRequest('XMP-prism:URL', [{
    'prism:url': 'https://example.test/article',
    'prism:a-platform': 'web',
  }]);
  assertEquals(request !== undefined, true);
  const packet = writeXmpPacket(null, [request!]);
  assertEquals(packet.includes('<prism:url><rdf:Bag>'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-prism:URL', file]);
    assertEquals(JSON.parse(stdout)[0].URL, [{ 'A-platform': 'web', Url: 'https://example.test/article' }]);
  } finally {
    await rm(file, { force: true });
  }
});

test('writes Photoshop TextLayers as a Seq of Resource structs', async () => {
  const request = toXmpPropertyRequest('XMP-photoshop:TextLayers', [
    { 'photoshop:LayerName': 'Header', 'photoshop:LayerText': 'Metadata' },
    { 'photoshop:LayerName': 'Footer', 'photoshop:LayerText': 'Copyright' },
  ]);
  assertEquals(request !== undefined, true);
  const packet = writeXmpPacket(null, [request!]);
  assertEquals(packet.includes('<photoshop:TextLayers><rdf:Seq>'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, packet);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-struct', '-XMP-photoshop:TextLayers', file]);
    assertEquals(JSON.parse(stdout)[0].TextLayers, [
      { LayerName: 'Header', LayerText: 'Metadata' },
      { LayerName: 'Footer', LayerText: 'Copyright' },
    ]);
  } finally {
    await rm(file, { force: true });
  }
});

test('deleteXmpProperties removes element and attribute forms only', () => {
  const packet = '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" dc:title="Attribute"><dc:rights><rdf:Alt><rdf:li xml:lang="x-default">Rights</rdf:li></rdf:Alt></dc:rights><dc:description>Keep this</dc:description></rdf:Description></rdf:RDF>';
  const deleted = deleteXmpProperties(packet, ['dc:title', 'dc:rights']);
  assertEquals(deleted?.includes('dc:title'), false);
  assertEquals(deleted?.includes('dc:rights'), false);
  assertEquals(deleted?.includes('<dc:description>Keep this</dc:description>'), true);
});

test('deleteXmpProperties handles later top-level descriptions without dropping siblings', async () => {
  const packet = '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:Description rdf:about="first"/><rdf:Description rdf:about="second" dc:title="Old title"><dc:description>Keep this</dc:description></rdf:Description></rdf:RDF>';
  const deleted = deleteXmpProperties(packet, ['dc:title']);
  assertEquals(deleted?.includes('Old title'), false);
  assertEquals(deleted?.includes('<dc:description>Keep this</dc:description>'), true);
  const file = await tempFile('.xmp');
  try {
    await writeFile(file, deleted!);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-XMP-dc:Title', '-XMP-dc:Description', file]);
    const metadata = JSON.parse(stdout)[0];
    assertEquals(metadata.Title, undefined);
    assertEquals(metadata.Description, 'Keep this');
  } finally {
    await rm(file, { force: true });
  }
});

test('mergeXmpProperties rejects unknown namespace prefixes', () => {
  let threw = false;
  try {
    mergeXmpProperties(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""/></rdf:RDF></x:xmpmeta>',
      [{ name: 'nope:thing', value: 'x' }],
    );
  } catch (e) {
    threw = e instanceof UnsupportedFormatError;
  }
  assertEquals(threw, true);
});

test('mergeXmpProperties removes duplicate properties across top-level descriptions', () => {
  const original = '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:Description rdf:about="first" dc:title="Old title"><dc:description>Keep first</dc:description></rdf:Description><rdf:Description rdf:about="second"><dc:title>Duplicate title</dc:title><dc:description>Keep second</dc:description></rdf:Description></rdf:RDF>';
  const merged = mergeXmpProperties(original, [{ name: 'dc:title', value: 'New title' }]);
  assertEquals((merged.match(/(?:dc:title=|<dc:title(?:\s|>))/g) ?? []).length, 1);
  assertEquals(merged.includes('New title'), true);
  assertEquals(merged.includes('Keep first'), true);
  assertEquals(merged.includes('Keep second'), true);

  const duplicateElements = '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:Description rdf:about=""><dc:title>First</dc:title><dc:title>Second</dc:title><dc:description>Keep</dc:description></rdf:Description></rdf:RDF>';
  const deduplicated = mergeXmpProperties(duplicateElements, [{ name: 'dc:title', value: 'Updated' }]);
  assertEquals((deduplicated.match(/<dc:title(?:\s|>)/g) ?? []).length, 1);
  assertEquals(deduplicated.includes('Updated'), true);
  assertEquals(deduplicated.includes('Keep'), true);
});

test('serializeXmpProperty rejects incompatible value shapes', () => {
  const invalidValues = [
    () => serializeXmpProperty('xmp:CreateDate', 123),
    () => serializeXmpProperty('xmpMM:DerivedFrom', 'not a struct'),
    () => serializeXmpProperty('xmp:Thumbnails', 'not a struct list'),
    () => serializeXmpProperty('dc:subject', [{ field: 'value' }]),
    () => serializeXmpProperty('xmp:MetadataDate', ['first', 'second']),
    () => serializeXmpProperty('tiff:Orientation', ['not an enum']),
    () => serializeXmpProperty('tiff:Orientation', 99),
    () => serializeXmpProperty('tiff:Orientation', '6', true),
  ];

  for (const serialize of invalidValues) {
    let threw = false;
    try {
      serialize();
    } catch (error) {
      threw = error instanceof UnsupportedFormatError;
    }
    assertEquals(threw, true);
  }
});
