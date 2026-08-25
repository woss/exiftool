import { assertEquals } from '../../deps.ts';
import { parseXMP } from './xmp.ts';

/** Wrap inner markup in a minimal realistic XMP packet (no xmptk — tested separately). */
function xmpDoc(inner: string): string {
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
${inner}
</rdf:RDF>
</x:xmpmeta>`;
}

Deno.test('parseXMP extracts element-form dc/tiff/xmp properties', () => {
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

Deno.test('parseXMP extracts attribute-form properties and skips xmlns/rdf/x attributes', () => {
  const xml = xmpDoc(
    `<rdf:Description rdf:about="" xmlns:tiff="http://ns.adobe.com/tiff/1.0/" xmlns:xap="http://ns.adobe.com/xap/1.0/" tiff:Make="Nikon" tiff:Model="Z8" xap:Rating="5"></rdf:Description>`,
  );
  assertEquals(parseXMP(xml), { Make: 'Nikon', Model: 'Z8', Rating: '5' });
});

Deno.test('parseXMP parses self-closing attribute-form rdf:Description', () => {
  const xml = xmpDoc(`<rdf:Description xmlns:tiff="urn:tiff" tiff:Make="Sony" tiff:Model="A7 IV"/>`);
  // Quirk: the self-closing-description pass skips rdf:-prefixed attributes but
  // NOT xmlns:-prefixed ones, so an inline namespace declaration leaks through
  // under its local name. Pinned as-is.
  assertEquals(parseXMP(xml), { Make: 'Sony', Model: 'A7 IV', tiff: 'urn:tiff' });
});

Deno.test('parseXMP maps rdf:Bag with multiple items to an array', () => {
  const xml = xmpDoc(`<rdf:Description rdf:about="">
  <dc:subject><rdf:Bag>
    <rdf:li>nature</rdf:li>
    <rdf:li>travel</rdf:li>
    <rdf:li>sunset</rdf:li>
  </rdf:Bag></dc:subject>
</rdf:Description>`);
  assertEquals(parseXMP(xml), { Subject: ['nature', 'travel', 'sunset'] });
});

Deno.test('parseXMP collapses a single-item rdf:Bag to a scalar', () => {
  const xml = xmpDoc(`<rdf:Description rdf:about="">
  <dc:creator><rdf:Bag><rdf:li>Jane Doe</rdf:li></rdf:Bag></dc:creator>
</rdf:Description>`);
  assertEquals(parseXMP(xml), { Creator: 'Jane Doe' });
});

Deno.test('parseXMP maps rdf:Seq ordered lists', () => {
  const xml = xmpDoc(`<rdf:Description rdf:about="">
  <exif:ISOSpeedRatings><rdf:Seq><rdf:li>400</rdf:li></rdf:Seq></exif:ISOSpeedRatings>
</rdf:Description>`);
  assertEquals(parseXMP(xml), { ISO: '400' });
});

Deno.test('parseXMP resolves lang-alt arrays via x-default', () => {
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

Deno.test('parseXMP passes character entities through literally in attribute values', () => {
  // Although one internal pass decodes &#x..; sequences, a later attribute pass
  // overwrites every value with its raw text, so entities survive verbatim.
  const xml = xmpDoc(`<rdf:Description tiff:Software="&#x41;pple Photos"></rdf:Description>`);
  assertEquals(parseXMP(xml)['Software'], '&#x41;pple Photos');
});

Deno.test('parseXMP falls back to the local name for unmapped tags', () => {
  const xml = xmpDoc(`<rdf:Description rdf:about="">
  <photoshop:City>Berlin</photoshop:City>
  <photoshop:Country>Germany</photoshop:Country>
  <mycustomprefix:Widget>gizmo</mycustomprefix:Widget>
</rdf:Description>`);
  assertEquals(parseXMP(xml), { City: 'Berlin', Country: 'Germany', Widget: 'gizmo' });
});

Deno.test('parseXMP derives copyright fields from rights tags', () => {
  const xml = xmpDoc(
    `<rdf:Description xmpRights:Marked="True" xmpRights:WebStatement="https://example.com/license" xmpRights:UsageTerms="CC BY 4.0"/>`,
  );
  assertEquals(parseXMP(xml), {
    Marked: 'True',
    WebStatement: 'https://example.com/license',
    UsageTerms: 'CC BY 4.0',
    CopyrightFlag: true,
    URL: 'https://example.com/license',
  });
});

Deno.test('parseXMP coerces Version values to numbers', () => {
  const xml = xmpDoc(`<rdf:Description crs:Version="15.3"/>`);
  const result = parseXMP(xml);
  assertEquals(result['Version'], 15.3);
});

Deno.test('parseXMP merges properties across multiple rdf:Description blocks', () => {
  const xml = xmpDoc(
    `<rdf:Description tiff:Make="Canon" tiff:Model="EOS R5"></rdf:Description>
<rdf:Description xmp:Rating="5"></rdf:Description>`,
  );
  assertEquals(parseXMP(xml), { Make: 'Canon', Model: 'EOS R5', Rating: '5' });
});

Deno.test('parseXMP extracts the XMP toolkit identifier', () => {
  const xml =
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Image::ExifTool 12.76"><rdf:RDF></rdf:RDF></x:xmpmeta>`;
  assertEquals(parseXMP(xml), { XMPToolkit: 'Image::ExifTool 12.76' });
});

Deno.test('parseXMP returns an empty record for empty input', () => {
  assertEquals(parseXMP(''), {});
});

Deno.test('parseXMP returns an empty record for malformed input without throwing', () => {
  assertEquals(parseXMP('not xml at all'), {});
  assertEquals(parseXMP('<<<>>>'), {});
  assertEquals(parseXMP('\x00\x01\xff garbage bytes \x1c'), {});
});

Deno.test('parseXMP picks up orphan elements even outside any rdf:Description', () => {
  // The child-element scan is unanchored, so elements with no enclosing
  // description still contribute tags.
  assertEquals(parseXMP('<dc:title>orphan element outside any description</dc:title>'), {
    Title: 'orphan element outside any description',
  });
});

Deno.test('parseXMP on a truncated document keeps attributes already parsed and does not throw', () => {
  // The closing </rdf:Description> never arrives, so element children are lost,
  // but the attribute pass over the unterminated open tag still yields Make.
  assertEquals(parseXMP('<rdf:Description tiff:Make="Canon"><dc:title>Ti'), { Make: 'Canon' });
});
