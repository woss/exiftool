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

Deno.test('avif canParse rejects short buffers, wrong box, unknown brand', () => {
  const parser = detectParser(buildFtyp())!;
  assertEquals(parser.format, 'AVIF');
  assertEquals(parser.canParse(new Uint8Array(11)), false);
  const notFtyp = concat(buildBox('moov', new Uint8Array(8)), new Uint8Array(4));
  assertEquals(parser.canParse(notFtyp), false);
  assertEquals(parser.canParse(buildFtyp('zzzz')), false);
});

Deno.test('avif ftyp compatible brands collected, null brands skipped', async () => {
  const data = encoder.encode('avifmif1\0\0\0\0avis');
  const bytes = concat(buildBox('ftyp', data), buildBox('mdat', new Uint8Array(4)));
  const result = detectParser(bytes)!.parse(bytes, 'brands.avif');
  assertEquals((await result).tags['CompatibleBrands'], ['mif1', 'avis']);
});

Deno.test('avif extended-size box (size==1 + largesize) is traversed', async () => {
  const xmpPayload = encoder.encode('<x:xmpmeta>ext</x:xmpmeta>');
  const inner = buildBox('xml ', xmpPayload);
  // Wrap in an extended-size CONTAINER box: u32 size=1, type, u64 largesize.
  const ext = new Uint8Array(16 + inner.length);
  new DataView(ext.buffer).setUint32(0, 1, false);
  ext.set(encoder.encode('meta'), 4);
  new DataView(ext.buffer).setBigUint64(8, BigInt(ext.length), false);
  ext.set(inner, 16);
  const bytes = concat(buildFtyp(), ext);
  const result = await detectParser(bytes)!.parse(bytes, 'ext.avif');
  assertEquals(result.tags['XMP'], '<x:xmpmeta>ext</x:xmpmeta>');
});

Deno.test('avif extended-size header truncated to 8 bytes breaks the walk', async () => {
  const stub = new Uint8Array(8);
  new DataView(stub.buffer).setUint32(0, 1, false);
  stub.set(encoder.encode('abcd'), 4); // largesize bytes missing
  const bytes = concat(buildFtyp(), stub);
  const result = await detectParser(bytes)!.parse(bytes, 'trunc-ext.avif');
  assertEquals(result.tags['FileTypeBrand'], 'avif');
});

Deno.test('avif size==0 box extends to end of stream', async () => {
  const payload = encoder.encode('<x:xmpmeta>tail</x:xmpmeta>');
  // Declare size 0: walker must treat the box as running to EOF.
  const last = new Uint8Array(8 + payload.length);
  new DataView(last.buffer).setUint32(0, 0, false);
  last.set(encoder.encode('xml '), 4);
  last.set(payload, 8);
  const bytes = concat(buildFtyp(), last);
  const result = await detectParser(bytes)!.parse(bytes, 'toend.avif');
  assertEquals(result.tags['XMP'], '<x:xmpmeta>tail</x:xmpmeta>');
});

Deno.test('avif box claiming size beyond the limit stops the walk', async () => {
  const bogus = new Uint8Array(8);
  new DataView(bogus.buffer).setUint32(0, 0x7fffffff, false);
  bogus.set(encoder.encode('huge'), 4);
  const bytes = concat(buildFtyp(), bogus);
  const result = await detectParser(bytes)!.parse(bytes, 'huge.avif');
  assertEquals(result.tags['FileTypeBrand'], 'avif');
});

Deno.test('avif Exif box extracts TIFF tags; bad tiffOffset skipped', async () => {
  const tiff = minimalTiffLE();
  const withOffset = new Uint8Array(4 + tiff.length);
  new DataView(withOffset.buffer).setUint32(0, 4, false);
  withOffset.set(tiff, 4);

  const okBytes = concat(buildFtyp(), buildBox('Exif', withOffset));
  const ok = await detectParser(okBytes)!.parse(okBytes, 'exif.avif', undefined, { coordFormat: '%.6f' });
  assertEquals(ok.tags['Make'], 'Cam');

  const badOffset = new Uint8Array(4);
  new DataView(badOffset.buffer).setUint32(0, 9999, false);
  const badBytes = concat(buildFtyp(), buildBox('Exif', badOffset));
  const bad = await detectParser(badBytes)!.parse(badBytes, 'bad.avif');
  assertEquals('Make' in bad.tags, false);
});
Deno.test('avif tiny Exif box (<=4 bytes payload) is ignored safely', async () => {
  const bytes = concat(buildFtyp(), buildBox('Exif', new Uint8Array([1, 2, 3, 4])));
  const result = await detectParser(bytes)!.parse(bytes, 'tiny.avif');
  assertEquals('Make' in result.tags, false);
});

Deno.test('avif colr nclx exposes color metadata; rICC/prof expose ICC blob', async () => {
  const nclx = new Uint8Array(10);
  nclx.set(encoder.encode('nclx'), 0);
  const dv = new DataView(nclx.buffer);
  dv.setUint16(4, 1, false); // primaries
  dv.setUint16(6, 13, false); // transfer
  nclx[8] = 6; // matrix
  nclx[9] = 0x80; // full range flag
  const nclxBytes = concat(buildFtyp(), buildBox('colr', nclx));
  const r1 = await detectParser(nclxBytes)!.parse(nclxBytes, 'nclx.avif');
  assertEquals(r1.tags['ColorPrimaries'], 1);
  assertEquals(r1.tags['TransferCharacteristics'], 13);
  assertEquals(r1.tags['MatrixCoefficients'], 6);
  assertEquals(r1.tags['VideoFullRange'], 1);

  for (const kind of ['rICC', 'prof']) {
    const payload = concat(encoder.encode(kind), new Uint8Array([1, 2, 3]));
    const b = concat(buildFtyp(), buildBox('colr', payload));
    const r = await detectParser(b)!.parse(b, `${kind}.avif`);
    assertEquals([...(r.tags['ICC_Profile'] as Uint8Array)], [1, 2, 3]);
  }
});


Deno.test('avif colr with unrecognized color type stores nothing', async () => {
  const bytes = concat(buildFtyp(), buildBox('colr', encoder.encode('xxxx1234')));
  const result = await detectParser(bytes)!.parse(bytes, 'colr-x.avif');
  assertEquals('ICC_Profile' in result.tags, false);
  assertEquals('ColorPrimaries' in result.tags, false);
});

Deno.test('avif colr nclx with clear full-range flag reports 0', async () => {
  const nclx = new Uint8Array(10);
  nclx.set(encoder.encode('nclx'), 0);
  const bytes = concat(buildFtyp(), buildBox('colr', nclx));
  const result = await detectParser(bytes)!.parse(bytes, 'nclx0.avif');
  assertEquals(result.tags['VideoFullRange'], 0);
});
Deno.test('avif pixi and ispe carry bit depth and dimensions', async () => {
  const pixiFull = buildBox('pixi', new Uint8Array([10]));
  const pixiEmpty = buildBox('pixi', new Uint8Array([])); // short-data guard skips it
  const ispeDims = new Uint8Array(8);
  new DataView(ispeDims.buffer).setUint32(0, 640, false);
  new DataView(ispeDims.buffer).setUint32(4, 480, false);
  const bytes = concat(buildFtyp(), pixiFull, pixiEmpty, buildBox('ispe', ispeDims));
  const result = await detectParser(bytes)!.parse(bytes, 'dims.avif');
  assertEquals(result.tags['BitDepth'], 10);
  assertEquals(result.tags['ImageWidth'], 640);
  assertEquals(result.tags['ImageLength'], 480);
});

Deno.test('avif parse on sub-8-byte buffer bails via header guard', async () => {
  const result = await detectParser(buildFtyp())!.parse(new Uint8Array(4), 'tiny.avif');
  assertEquals(result.format, 'AVIF');
});

Deno.test('avif box smaller than its own header stops the walk', async () => {
  const stub = new Uint8Array(8);
  new DataView(stub.buffer).setUint32(0, 4, false); // size < 8-byte header
  stub.set(encoder.encode('tiny'), 4);
  const bytes = concat(buildFtyp(), stub);
  const result = await detectParser(bytes)!.parse(bytes, 'undersized.avif');
  assertEquals(result.tags['FileTypeBrand'], 'avif');
});

Deno.test('avif long xml box summarized; ispe shorter than 8 skipped', async () => {
  const longXmp = encoder.encode('<x:xmpmeta>' + 'y'.repeat(2000) + '</x:xmpmeta>');
  const shortIspe = new Uint8Array([1, 2, 3, 4]);
  const bytes = concat(buildFtyp(), buildBox('xml ', longXmp), buildBox('ispe', shortIspe));
  const result = await detectParser(bytes)!.parse(bytes, 'long.avif');
  assertEquals(result.tags['XMP'], `[XML document: ${longXmp.length} chars]`);
  assertEquals('ImageWidth' in result.tags, false);
});
Deno.test('avif nesting deeper than 20 levels terminates the recursion', async () => {
  // Ancestor rescan makes very deep chains costly; 22 is the cheapest chain
  // that still pushes recursion past the depth-20 guard.
  let box = buildBox('mdat', new Uint8Array(2));
  for (let i = 0; i < 22; i++) {
    box = buildBox('meta', box);
  }
  const bytes = concat(buildFtyp(), box);
  const startedAt = Date.now();
  const result = await detectParser(bytes)!.parse(bytes, 'deep.avif');
  assertEquals(result.format, 'AVIF');
  // Coverage instrumentation slows the rescan-heavy walk by orders of
  // magnitude, so only bound it generously.
  assertEquals(Date.now() - startedAt < 30000, true);
});

function minimalTiffLE(): Uint8Array {
  const tiff = new Uint8Array(8 + 2 + 12 + 4);
  const dv = new DataView(tiff.buffer);
  tiff[0] = 0x49;
  tiff[1] = 0x49;
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, 1, true);
  dv.setUint16(10, 0x010f, true);
  dv.setUint16(12, 2, true);
  dv.setUint32(14, 4, true);
  tiff.set(encoder.encode('Cam\0'), 18);
  dv.setUint32(22, 0, true);
  return tiff;
}
