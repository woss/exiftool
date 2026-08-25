import { assertEquals } from '../../deps.ts';
import { decodeUTF8, encodeUTF8, escapeJSON, escapeXML, unescapeC } from './encoding.ts';

Deno.test('encodeUTF8 encodes strings as UTF-8 bytes', () => {
  assertEquals([...encodeUTF8('abc')], [0x61, 0x62, 0x63]);
  assertEquals([...encodeUTF8('é')], [0xc3, 0xa9]);
});

Deno.test('decodeUTF8 decodes UTF-8 bytes to strings', () => {
  assertEquals(decodeUTF8(Uint8Array.from([0x61, 0x62, 0x63])), 'abc');
  assertEquals(decodeUTF8(Uint8Array.from([0xc3, 0xa9])), 'é');
});

Deno.test('encode/decode round-trip preserves text', () => {
  const text = 'héllo wörld ✓';
  assertEquals(decodeUTF8(encodeUTF8(text)), text);
});

Deno.test('escapeJSON escapes every control character', () => {
  assertEquals(
    escapeJSON('a\\b"c\td\ne\rf'),
    'a\\\\b\\"c\\td\\ne\\rf',
  );
});

Deno.test('escapeJSON leaves clean strings untouched', () => {
  assertEquals(escapeJSON('plain text'), 'plain text');
});

Deno.test('unescapeC resolves known C escapes', () => {
  assertEquals(unescapeC('\\n\\r\\t\\\\\\"'), '\n\r\t\\"');
});

Deno.test('unescapeC passes unknown escapes through without the backslash', () => {
  assertEquals(unescapeC('a\\qb'), 'aqb');
});

Deno.test('escapeXML escapes markup characters', () => {
  assertEquals(
    escapeXML(`<a href="x">&'</a>`),
    '&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;',
  );
});
