import { test } from 'vitest';
import { assertEquals } from '../../src/test/asserts.js';
import { parseXMP } from './xmp.js';

/** Wrap inner markup in a minimal realistic XMP packet (no xmptk — tested separately). */
function xmpDoc(inner: string): string {
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
${inner}
</rdf:RDF>
</x:xmpmeta>`;
}

test('parseXMP extracts element-form dc/tiff/xmp properties', () => {
  const xml = xmpDoc(`<rdf:Description rdf:about="">
  <dc:title>My Title</dc:title>
  <dc:description>A description</dc:description>
  <dc:format>image/jpeg</dc:format>
  <tiff:Make>Canon</tiff:Make>
  <tiff:Model>EOS R5</tiff:Model>
  <xmp:CreatorTool>Lightroom Classic</xmp:CreatorTool>
</rdf:Description>`);
  assertEquals(parseXMP(xml), {
    Title: 'My Title',
    Description: 'A description',
    Format: 'image/jpeg',
    Make: 'Canon',
    Model: 'EOS R5',
    CreatorTool: 'Lightroom Classic',
  });
});

test('parseXMP extracts attribute-form properties and skips xmlns/rdf/x attributes', () => {
  const xml = xmpDoc(
    `<rdf:Description rdf:about="" xmlns:tiff="http://ns.adobe.com/tiff/1.0/" xmlns:xap="http://ns.adobe.com/xap/1.0/" tiff:Make="Nikon" tiff:Model="Z8" xap:Rating="5"></rdf:Description>`,
  );
  assertEquals(parseXMP(xml), { Make: 'Nikon', Model: 'Z8', Rating: '5' });
});

test('parseXMP parses self-closing attribute-form rdf:Description', () => {
  const xml = xmpDoc(`<rdf:Description xmlns:tiff="urn:tiff" tiff:Make="Sony" tiff:Model="A7 IV"/>`);
  // Quirk: the self-closing-description pass skips rdf:-prefixed attributes but
  // NOT xmlns:-prefixed ones, so an inline namespace declaration leaks through
  // under its local name. Pinned as-is.
  assertEquals(parseXMP(xml), { Make: 'Sony', Model: 'A7 IV', tiff: 'urn:tiff' });
});

test('parseXMP maps rdf:Bag with multiple items to an array', () => {
  const xml = xmpDoc(`<rdf:Description rdf:about="">
  <dc:subject><rdf:Bag>
    <rdf:li>nature</rdf:li>
    <rdf:li>travel</rdf:li>
    <rdf:li>sunset</rdf:li>
  </rdf:Bag></dc:subject>
</rdf:Description>`);
  assertEquals(parseXMP(xml), { Subject: ['nature', 'travel', 'sunset'] });
});

test('parseXMP collapses a single-item rdf:Bag to a scalar', () => {
  const xml = xmpDoc(`<rdf:Description rdf:about="">
  <dc:creator><rdf:Bag><rdf:li>Jane Doe</rdf:li></rdf:Bag></dc:creator>
</rdf:Description>`);
  assertEquals(parseXMP(xml), { Creator: 'Jane Doe' });
});

test('parseXMP maps rdf:Seq ordered lists', () => {
  const xml = xmpDoc(`<rdf:Description rdf:about="">
  <exif:ISOSpeedRatings><rdf:Seq><rdf:li>400</rdf:li></rdf:Seq></exif:ISOSpeedRatings>
</rdf:Description>`);
  assertEquals(parseXMP(xml), { ISO: '400' });
});

test('parseXMP resolves lang-alt arrays via x-default', () => {
  const xml = xmpDoc(`<rdf:Description rdf:about="">
  <dc:rights><rdf:Alt>
    <rdf:li xml:lang="x-default">© 2026 Acme Corp</rdf:li>
    <rdf:li xml:lang="de">© 2026 Acme GmbH</rdf:li>
  </rdf:Alt></dc:rights>
</rdf:Description>`);
  const result = parseXMP(xml);
  // Rights is pinned to the x-default value and mirrored into CopyrightNotice.
  assertEquals(result['Rights'], '© 2026 Acme Corp');
  assertEquals(result['CopyrightNotice'], '© 2026 Acme Corp');
});

test('parseXMP passes character entities through literally in attribute values', () => {
  // Although one internal pass decodes &#x..; sequences, a later attribute pass
  // overwrites every value with its raw text, so entities survive verbatim.
  const xml = xmpDoc(`<rdf:Description tiff:Software="&#x41;pple Photos"></rdf:Description>`);
  assertEquals(parseXMP(xml)['Software'], '&#x41;pple Photos');
});

test('parseXMP falls back to the local name for unmapped tags', () => {
  const xml = xmpDoc(`<rdf:Description rdf:about="">
  <photoshop:City>Berlin</photoshop:City>
  <photoshop:Country>Germany</photoshop:Country>
  <mycustomprefix:Widget>gizmo</mycustomprefix:Widget>
</rdf:Description>`);
  assertEquals(parseXMP(xml), { City: 'Berlin', Country: 'Germany', Widget: 'gizmo' });
});

test('parseXMP derives copyright fields from rights tags', () => {
  const xml = xmpDoc(
    `<rdf:Description xmpRights:Marked="True" xmpRights:WebStatement="https://example.com/license" xmpRights:UsageTerms="CC BY 4.0"/>`,
  );
  assertEquals(parseXMP(xml), {
    Marked: 'true',
    WebStatement: 'https://example.com/license',
    UsageTerms: 'CC BY 4.0',
    CopyrightFlag: true,
    URL: 'https://example.com/license',
  });
});

test('parseXMP coerces Version values to numbers', () => {
  const xml = xmpDoc(`<rdf:Description crs:Version="15.3"/>`);
  const result = parseXMP(xml);
  assertEquals(result['Version'], 15.3);
});

test('parseXMP merges properties across multiple rdf:Description blocks', () => {
  const xml = xmpDoc(
    `<rdf:Description tiff:Make="Canon" tiff:Model="EOS R5"></rdf:Description>
<rdf:Description xmp:Rating="5"></rdf:Description>`,
  );
  assertEquals(parseXMP(xml), { Make: 'Canon', Model: 'EOS R5', Rating: '5' });
});

test('parseXMP extracts the XMP toolkit identifier', () => {
  const xml =
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Image::ExifTool 12.76"><rdf:RDF></rdf:RDF></x:xmpmeta>`;
  assertEquals(parseXMP(xml), { XMPToolkit: 'Image::ExifTool 12.76' });
});

test('parseXMP returns an empty record for empty input', () => {
  assertEquals(parseXMP(''), {});
});

test('parseXMP returns an empty record for malformed input without throwing', () => {
  assertEquals(parseXMP('not xml at all'), {});
  assertEquals(parseXMP('<<<>>>'), {});
  assertEquals(parseXMP('\x00\x01\xff garbage bytes \x1c'), {});
});

test('parseXMP picks up orphan elements even outside any rdf:Description', () => {
  // The child-element scan is unanchored, so elements with no enclosing
  // description still contribute tags.
  assertEquals(parseXMP('<dc:title>orphan element outside any description</dc:title>'), {
    Title: 'orphan element outside any description',
  });
});

test('parseXMP on a truncated document keeps attributes already parsed and does not throw', () => {
  // The closing </rdf:Description> never arrives, so element children are lost,
  // but the attribute pass over the unterminated open tag still yields Make.
  assertEquals(parseXMP('<rdf:Description tiff:Make="Canon"><dc:title>Ti'), { Make: 'Canon' });
});

test('parseXMP renames crs:Look and crs:CorrectionMasks context properties', () => {
  const xml = xmpDoc(`<rdf:Description rdf:about="">
  <crs:Look>
    <crs:Version>15.0</crs:Version>
    <crs:ProcessVersion>11.0</crs:ProcessVersion>
    <crs:ConvertToGrayscale>False</crs:ConvertToGrayscale>
    <crs:CameraProfile>Adobe Standard</crs:CameraProfile>
    <crs:LookTable>A0123</crs:LookTable>
    <crs:ToneCurvePV2012>0, 0</crs:ToneCurvePV2012>
    <crs:ToneCurvePV2012Blue>0, 255</crs:ToneCurvePV2012Blue>
    <crs:ToneCurvePV2012Green>0, 128</crs:ToneCurvePV2012Green>
    <crs:ToneCurvePV2012Red>0, 64</crs:ToneCurvePV2012Red>
  </crs:Look>
  <crs:CorrectionMasks>
    <crs:Version>15.0</crs:Version>
    <crs:What>Exposure</crs:What>
  </crs:CorrectionMasks>
</rdf:Description>`);
  assertEquals(parseXMP(xml), {
    LookParametersVersion: '15',
    LookParametersProcessVersion: '11',
    LookParametersConvertToGrayscale: 'false',
    LookParametersCameraProfile: 'Adobe Standard',
    LookParametersLookTable: 'A0123',
    LookParametersToneCurvePV2012: '0, 0',
    LookParametersToneCurvePV2012Blue: '0, 255',
    LookParametersToneCurvePV2012Green: '0, 128',
    LookParametersToneCurvePV2012Red: '0, 64',
    MaskGroupBasedCorrMaskVersion: '15',
    MaskGroupBasedCorrMaskWhat: 'Exposure',
  });
});

test('parseXMP skips x-prefixed description attributes and strips history bookkeeping keys', () => {
  const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="XMP Core 6.0">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" x:xmptk="XMP Core 6.0" acme:action="converted" dc:title="T"/>
</rdf:RDF>
</x:xmpmeta>`;
  assertEquals(parseXMP(xml), {
    xmptk: 'XMP Core 6.0',
    Title: 'T',
    XMPToolkit: 'XMP Core 6.0',
  });
});

test('parseXMP ignores rdf-prefixed child elements and x-prefixed attributes', () => {
  const xml = xmpDoc(`<rdf:Description rdf:about="" x:note="meta">
  <dc:title>T</dc:title>
  <rdf:type>Bag</rdf:type>
</rdf:Description>`);
  assertEquals(parseXMP(xml), { Title: 'T' });
});

test('parseXMP merges repeated multi-item bags into one flat array', () => {
  const xml = xmpDoc(`<rdf:Description rdf:about="">
  <dc:subject><rdf:Bag><rdf:li>one</rdf:li><rdf:li>two</rdf:li></rdf:Bag></dc:subject>
  <dc:subject><rdf:Bag><rdf:li>three</rdf:li><rdf:li>four</rdf:li></rdf:Bag></dc:subject>
</rdf:Description>`);
  assertEquals(parseXMP(xml), { Subject: ['one', 'two', 'three', 'four'] });
});

test('parseXMP accumulates repeated history attributes across self-closing descriptions', () => {
  const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" stEvt:action="saved" stEvt:when="2024-01-01"/>
<rdf:Description rdf:about="" stEvt:action="converted" stEvt:when="2024-02-02"/>
</rdf:RDF>
</x:xmpmeta>`;
  // The attribute pass re-reads every open tag, so the last attribute value wins.
  assertEquals(parseXMP(xml), { HistoryAction: 'converted', HistoryWhen: '2024-02-02' });
});

test('parseXMP collects attributed self-closing rdf:li elements into arrays', () => {
  const xml = xmpDoc(`<photoshop:SupplementalCategories>
  <rdf:Bag>
    <rdf:li photoshop:Country="DE"/>
    <rdf:li photoshop:Country="FR"/>
    <rdf:li rdf:parseType="Resource"/>
  </rdf:Bag>
</photoshop:SupplementalCategories>`);
  assertEquals(parseXMP(xml), { Country: ['DE', 'FR'] });
});

test('parseXMP merges repeated orphan history elements and coerces numeric picks', () => {
  const xml = [
    '<stEvt:softwareAgent>Lightroom</stEvt:softwareAgent>',
    '<stEvt:softwareAgent>Camera Raw</stEvt:softwareAgent>',
    '<stRef:instanceID>xmp.did:A</stRef:instanceID>',
    '<rdf:Description acme:ExifToolVersion="12.76"/>',
    '<crs:What>Exposure</crs:What>',
    '<xmpDM:pick>-1</xmpDM:pick>',
  ].join('\n');
  assertEquals(parseXMP(xml), {
    HistorySoftwareAgent: ['Lightroom', 'Camera Raw'],
    DerivedFromInstanceID: 'xmp.did:A',
    MaskGroupBasedCorrWhat: 'Exposure',
    Pick: -1,
    ExifToolVersion: 12.76,
  });
});

test('parseXMP falls back to the first non-default language when x-default is absent', () => {
  const xml = xmpDoc(`<rdf:Description rdf:about="">
  <dc:title><rdf:Alt><rdf:li xml:lang="de">Hallo</rdf:li></rdf:Alt></dc:title>
</rdf:Description>`);
  assertEquals(parseXMP(xml), { Title: 'Hallo' });
});

test('parseXMP wraps a scalar list value when a later bag adds more items', () => {
  const xml = xmpDoc(`<rdf:Description rdf:about="">
  <dc:subject><rdf:Bag><rdf:li>one</rdf:li></rdf:Bag></dc:subject>
  <dc:subject><rdf:Bag><rdf:li>two</rdf:li><rdf:li>three</rdf:li></rdf:Bag></dc:subject>
</rdf:Description>`);
  assertEquals(parseXMP(xml), { Subject: ['one', 'two', 'three'] });
});

test('parseXMP merges element and attribute history entries across passes', () => {
  const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about=""><stEvt:action>saved</stEvt:action></rdf:Description>
<rdf:Description rdf:about="" stEvt:action="converted"/>
</rdf:RDF>
</x:xmpmeta>`;
  // Later attribute/element passes re-read the same names, so the observable
  // result interleaves the values in pass order.
  assertEquals(parseXMP(xml), { HistoryAction: ['converted', 'saved'] });
});

test('parseXMP merges attributed list items with same-named leaf elements', () => {
  const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<stEvt:when>2020</stEvt:when>
<rdf:Seq>
  <rdf:li stEvt:when="a"/>
  <rdf:li stEvt:when="b"/>
</rdf:Seq>
<stEvt:when>2021</stEvt:when>
</rdf:RDF>
</x:xmpmeta>`;
  assertEquals(parseXMP(xml), { HistoryWhen: ['a', 'b', '2020', '2021'] });
});

test('parseXMP appends attribute values onto arrays built by earlier passes', () => {
  const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about=""><stEvt:when><rdf:Bag><rdf:li>a</rdf:li><rdf:li>b</rdf:li></rdf:Bag></stEvt:when></rdf:Description>
<photoshop:X><rdf:li stEvt:when="c"/></photoshop:X>
</rdf:RDF>
</x:xmpmeta>`;
  assertEquals(parseXMP(xml), { HistoryWhen: ['a', 'b', 'c'] });
});

test('parseXMP folds self-closing history attributes into previously built lists', () => {
  const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about=""><stEvt:action><rdf:Bag><rdf:li>saved</rdf:li><rdf:li>resaved</rdf:li></rdf:Bag></stEvt:action></rdf:Description>
<rdf:Description rdf:about="" stEvt:action="converted"/>
</rdf:RDF>
</x:xmpmeta>`;
  // The trailing attribute pass re-reads every open tag and resets the last
  // value, so the accumulated list is observable only through pass ordering.
  assertEquals(parseXMP(xml), { HistoryAction: 'converted' });
});
