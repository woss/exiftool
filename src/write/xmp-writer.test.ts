import { test } from 'vitest';
import { assertEquals } from '../test/asserts.js';
import { parseXMP } from '../exif/xmp.js';
import { UnsupportedFormatError } from './writers.js';
import {
  buildXmpPropertiesPacket,
  mergeXmpProperties,
  serializeXmpProperty,
  writeXmpPacket,
} from './xmp-writer.js';

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
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"><rdf:Description rdf:about="" xmpRights:WebStatement="https://old.example"><dc:rights><rdf:Alt><rdf:li xml:lang="x-default">Old rights</rdf:li></rdf:Alt></dc:rights></rdf:Description></rdf:RDF></x:xmpmeta>';
  const merged = mergeXmpProperties(original, [
    { name: 'dc:rights', value: 'New rights' },
    { name: 'xmpRights:WebStatement', value: 'https://new.example' },
  ]);
  assertEquals(merged.includes('Old rights'), false);
  assertEquals(merged.includes('https://old.example'), false);
  assertEquals(merged.includes('<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">New rights</rdf:li></rdf:Alt></dc:rights>'), true);
  assertEquals(merged.includes('<xmpRights:WebStatement>https://new.example</xmpRights:WebStatement>'), true);
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
  assertEquals(serializeXmpProperty('dc:title', 'T'), '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">T</rdf:li></rdf:Alt></dc:title>');
  assertEquals(serializeXmpProperty('dc:subject', ['a', 'b']), '<dc:subject><rdf:Bag><rdf:li>a</rdf:li><rdf:li>b</rdf:li></rdf:Bag></dc:subject>');
  assertEquals(serializeXmpProperty('dc:creator', ['A']), '<dc:creator><rdf:Seq><rdf:li>A</rdf:li></rdf:Seq></dc:creator>');
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
