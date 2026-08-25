import { assertEquals } from '../../deps.ts';
import { detectParser } from './mod.ts';
import './avif.ts';

const encoder = new TextEncoder();

/** Build one ISO BMFF box: u32 big-endian size + 4-byte type + payload. */
function buildBox(type: string, payload: Uint8Array): Uint8Array {
  const box = new Uint8Array(8 + payload.length);
  new DataView(box.buffer).setUint32(0, box.length, false);
  box.set(encoder.encode(type), 4);
  box.set(payload, 8);
  return box;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Minimal ftyp box so detectParser/canParse accept the buffer. */
function buildFtyp(majorBrand = 'avif'): Uint8Array {
  return buildBox('ftyp', encoder.encode(majorBrand + '\0\0\0\0'));
}

Deno.test('avif regression: minimal ftyp+mdat resolves without hanging', async () => {
  // mdat carries arbitrary opaque bytes the walker must skip, not re-read.
  const mdatPayload = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff, 0x42]);
  const mdat = buildBox('mdat', mdatPayload);
  const bytes = concat(buildFtyp(), mdat);

  const parser = detectParser(bytes)!;
  assertEquals(parser.format, 'AVIF');

  const startedAt = Date.now();
  const result = await parser.parse(bytes, 'test.avif');
  const elapsedMs = Date.now() - startedAt;

  // Reaching these assertions proves the old infinite mdat re-read loop is gone.
  assertEquals(result.format, 'AVIF');
  assertEquals(result.tags['FileTypeBrand'], 'avif');
  assertEquals(elapsedMs < 1000, true);
});

Deno.test('avif: meta container with infe child traverses recursively without error', async () => {
  // infe item-info entry: version/flags-free layout; opaque fields suffice here.
  const infePayload = new Uint8Array([0x00, 0x01, 0x00, 0x00]);
  const infe = buildBox('infe', infePayload);
  const meta = buildBox('meta', infe);
  const bytes = concat(buildFtyp(), meta);

  const parser = detectParser(bytes)!;
  const result = await parser.parse(bytes, 'container.avif');

  assertEquals(result.format, 'AVIF');
  assertEquals(result.tags['FileTypeBrand'], 'avif');
});

Deno.test('avif: truncated final box header breaks walk cleanly without throwing', async () => {
  // Buffer ends mid-header: only 5 of the required 8 header bytes present.
  const partialHeader = encoder.encode('\x00\x00\x01m');
  assertEquals(partialHeader.length, 4); // even fewer than 8 total
  const trailing = new Uint8Array([0x64, 0x61, 0x74]); // 3 more bytes, still < 8
  const bytes = concat(buildFtyp(), partialHeader, trailing);

  const parser = detectParser(bytes)!;
  const result = await parser.parse(bytes, 'truncated.avif');

  assertEquals(result.format, 'AVIF');
  assertEquals(result.tags['FileTypeBrand'], 'avif');
});
