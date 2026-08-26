import { assertEquals } from '../../deps.ts';
import { detectParser } from './mod.ts';
import { extractEmbeddedJpegs } from './jpeg.ts';

function miniJpeg(marker = 0x01): Uint8Array {
  return new Uint8Array([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    marker, 0xFF, 0xD9,
  ]);
}

interface MpfItem {
  bytes?: Uint8Array;
  /** Overrides the declared image size (defaults to bytes.length or 0). */
  size?: number;
  /** Overrides the declared data offset (defaults to auto-placement). */
  off?: number;
}

/**
 * Builds a synthetic JPEG carrying an MPF APP2 segment whose index
 * advertises the given individual images laid out after the entry table.
 */
function buildMpf(
  opts: {
    endian?: 'II' | 'MM' | 'XX';
    omitB002?: boolean;
    items?: MpfItem[];
  } = {},
): Uint8Array {
  const endian = opts.endian ?? 'II';
  const le = endian === 'II';
  const items: MpfItem[] = opts.items ?? [
    { bytes: miniJpeg(0xA1) },
    { size: 0 },
    { bytes: miniJpeg(0xA2) },
  ];
  const n = items.length;
  const withB002 = opts.omitB002 !== true;
  const numEntries = withB002 ? 3 : 2;
  const verOff = 8 + 2 + 12 * numEntries + 4;
  const entriesOff = verOff + 4;
  const blobBase = entriesOff + 16 * n;

  const t: number[] = [];
  const u16 = (v: number) =>
    le ? t.push(v & 255, (v >> 8) & 255) : t.push((v >> 8) & 255, v & 255);
  const u32 = (v: number) =>
    le
      ? t.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255)
      : t.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);

  if (endian === 'II') t.push(0x49, 0x49);
  else if (endian === 'MM') t.push(0x4D, 0x4D);
  else t.push(0x58, 0x58); // 'XX' — invalid signature
  u16(0x2A);
  u32(8); // first IFD directly after the header
  u16(numEntries);
  const entry = (tag: number, type: number, count: number, valOff: number) => {
    u16(tag);
    u16(type);
    u32(count);
    u32(valOff);
  };
  entry(0xB000, 7, 4, verOff); // MPFVersion -> '0100'
  entry(0xB001, 4, 1, n); // NumberOfImages, inline value
  if (withB002) entry(0xB002, 7, n * 16, entriesOff);
  u32(0); // next IFD
  t.push(0x30, 0x31, 0x30, 0x30); // MPFVersion bytes

  let cursor = blobBase;
  const placed: Array<Uint8Array | undefined> = [];
  for (let i = 0; i < n; i++) {
    const it = items[i];
    const size = it.size ?? it.bytes?.length ?? 0;
    const off = it.off ?? (it.bytes && size > 0 ? cursor : 0);
    u32(0); // attributes
    u32(size);
    u32(off);
    u16(0);
    u16(0);
    placed.push(it.bytes && it.off === undefined ? it.bytes : undefined);
    cursor += size;
  }
  for (const bytes of placed) if (bytes) t.push(...bytes);

  const payload = [0x4D, 0x50, 0x46, 0x00, ...t]; // 'MPF\0'
  const segLen = payload.length + 2;
  return new Uint8Array([
    0xFF, 0xD8,
    0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // APP0 JFIF
    0xFF, 0xE2, (segLen >> 8) & 255, segLen & 255, ...payload,
    0xFF, 0xD9,
  ]);
}

Deno.test('extractEmbeddedJpegs returns both images in entry order (little-endian)', () => {
  const file = buildMpf();
  const docs = extractEmbeddedJpegs(file);
  assertEquals(docs.length, 2);
  assertEquals(docs[0], miniJpeg(0xA1));
  assertEquals(docs[1], miniJpeg(0xA2));
});

Deno.test('extractEmbeddedJpegs handles big-endian MP Endian field', () => {
  const docs = extractEmbeddedJpegs(buildMpf({ endian: 'MM' }));
  assertEquals(docs.length, 2);
  assertEquals(docs[0], miniJpeg(0xA1));
});

Deno.test('embedded images are standalone copies parseable as JPEG', async () => {
  const docs = extractEmbeddedJpegs(buildMpf());
  assertEquals(docs[0].buffer !== (undefined as unknown), true);
  const parser = detectParser(docs[0]);
  assertEquals(parser?.format, 'JPEG');
  const info = await parser!.parse(docs[0], '(synthetic)');
  assertEquals(info.format, 'JPEG');
});

Deno.test('plain JPEG without MPF segment yields no documents', () => {
  assertEquals(extractEmbeddedJpegs(miniJpeg()), []);
});

Deno.test('invalid endian signature yields no documents', () => {
  assertEquals(extractEmbeddedJpegs(buildMpf({ endian: 'XX' })), []);
});

Deno.test('missing MPEntry index tag yields no documents', () => {
  assertEquals(extractEmbeddedJpegs(buildMpf({ omitB002: true })), []);
});

Deno.test('truncated file stops cleanly', () => {
  const file = buildMpf();
  assertEquals(extractEmbeddedJpegs(file.slice(0, file.length - 14)), []);
});

Deno.test('entry whose data lies beyond the buffer is skipped', () => {
  const docs = extractEmbeddedJpegs(buildMpf({
    items: [{ bytes: miniJpeg() }, { size: 999_999 }],
  }));
  assertEquals(docs.length, 1);
  assertEquals(docs[0], miniJpeg());
});

Deno.test('entry without a SOI marker is skipped', () => {
  assertEquals(extractEmbeddedJpegs(buildMpf({
    items: [{ bytes: new Uint8Array([1, 2, 3, 4]) }],
  })), []);
});

Deno.test('zero-size entry is skipped', () => {
  assertEquals(extractEmbeddedJpegs(buildMpf({ items: [{ size: 0 }] })), []);
});

Deno.test('zero-offset entry is skipped', () => {
  assertEquals(extractEmbeddedJpegs(buildMpf({
    items: [{ bytes: miniJpeg(), off: 0 }],
  })), []);
});

Deno.test('non-JPEG container yields no documents', () => {
  assertEquals(extractEmbeddedJpegs(new TextEncoder().encode('not a jpeg')), []);
});

Deno.test('SOS before any APP2 ends the header walk', () => {
  const sosFirst = new Uint8Array([
    0xFF, 0xD8, 0xFF, 0xDA, 0x00, 0x02, 0xFF, 0xD9,
    0xFF, 0xE2, 0x00, 0x08, 0x4D, 0x50, 0x46, 0x00,
  ]);
  assertEquals(extractEmbeddedJpegs(sosFirst), []);
});

Deno.test('non-marker byte where a segment is expected aborts the walk', () => {
  const file = buildMpf();
  file[20] = 0x00; // APP2 segment position, corrupted marker byte
  assertEquals(extractEmbeddedJpegs(file), []);
});

Deno.test('RST markers without length fields are skipped during the walk', () => {
  const file = buildMpf();
  const withRst = new Uint8Array(file.length + 2);
  withRst.set(file.subarray(0, 20), 0);
  withRst.set([0xFF, 0xD0], 20); // RST0 between APP0 and APP2
  withRst.set(file.subarray(20), 22);
  assertEquals(extractEmbeddedJpegs(withRst).length, 2);
});

Deno.test('degenerate segment length aborts the walk', () => {
  const file = new Uint8Array([
    0xFF, 0xD8, 0xFF, 0xE2, 0x00, 0x01, 0xFF, 0xD9,
  ]);
  assertEquals(extractEmbeddedJpegs(file), []);
});

Deno.test('entry count claiming more entries than the buffer holds yields nothing', () => {
  const file = buildMpf();
  const numEntriesPos = 28 + 8; // tiffStart + ifdOffset
  file[numEntriesPos] = 0xFF;
  file[numEntriesPos + 1] = 0xFF;
  assertEquals(extractEmbeddedJpegs(file), []);
});

Deno.test('image-count style B002 count (not multiplied by 16) works', () => {
  const single = buildMpf({ items: [{ bytes: miniJpeg(0xC1) }] });
  // Default builder writes count = 16 x N; rewrite it to bare N.
  const b002CountPos = 28 + 8 + 2 + 12 * 2 + 4;
  single[b002CountPos] = 1;
  single[b002CountPos + 1] = 0;
  single[b002CountPos + 2] = 0;
  single[b002CountPos + 3] = 0;
  const docs = extractEmbeddedJpegs(single);
  assertEquals(docs.length, 1);
  assertEquals(docs[0], miniJpeg(0xC1));
});

Deno.test('normalized entry table overrunning the buffer yields nothing', () => {
  const single = buildMpf({ items: [{ bytes: miniJpeg(0xC1) }] });
  // B002 count field: claim one entry but blow the table size up so the
  // normalized table no longer fits the buffer.
  const b002CountPos = 28 + 8 + 2 + 12 * 2 + 4;
  const big = 1024;
  single[b002CountPos] = (big >> 24) & 255;
  single[b002CountPos + 1] = (big >> 16) & 255;
  single[b002CountPos + 2] = (big >> 8) & 255;
  single[b002CountPos + 3] = big & 255;
  assertEquals(extractEmbeddedJpegs(single), []);
});

Deno.test('corrupted IFD offset yields no documents', () => {
  const file = buildMpf();
  const tiffStart = 24; // SOI(2) + APP0(18) + APP2 header(4)
  file[tiffStart + 4] = 0xFF;
  file[tiffStart + 5] = 0xFF;
  file[tiffStart + 6] = 0xFF;
  file[tiffStart + 7] = 0xFF;
  assertEquals(extractEmbeddedJpegs(file), []);
});
