import { test } from 'vitest';
import { assertEquals } from '../test/asserts.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ExifToolCore } from '../exiftool-core.js';
import { pngParser } from '../format/png.js';

const execFileP = promisify(execFile);

/** Structural diff of Perl-exiftool JSON dumps: which tag keys changed. */
async function exiftoolTagKeys(path: string): Promise<Record<string, unknown>> {
  const { stdout } = await execFileP('exiftool', ['-j', '-G1', '-a', '-struct', path]);
  return JSON.parse(stdout)[0];
}

/**
 * Preservation gate (WRITE-TAGS-NEEDED feature 4): an XMP/IPTC-only write
 * must change ONLY the requested tags in reference-exiftool's own view —
 * every other tag key keeps the same value, including camera EXIF.
 */
async function assertOnlyRequestedChanged(
  file: string,
  bytes: Uint8Array,
  tags: Record<string, unknown>,
  expectedKeys: string[],
): Promise<void> {
  const core = new ExifToolCore();
  const out = await core.writeBytes(bytes, tags as never);
  const tmp = `/tmp/exiftool-ts-preservation-${file.replace(/[^a-zA-Z0-9.]/g, '-')}`;
  writeFileSync(tmp, out.bytes);
  const before = await exiftoolTagKeys(file);
  const after = await exiftoolTagKeys(tmp);
  const changed = new Set<string>();
  for (const [k, v] of Object.entries(before)) {
    if (k === 'SourceFile' || k.startsWith('System:')) continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.add(k);
  }
  for (const k of Object.keys(after)) {
    if (!(k in before) && k !== 'SourceFile' && !k.startsWith('System:')) changed.add(k);
  }
  assertEquals(
    [...changed].sort(),
    [...expectedKeys].sort(),
    `unexpected tag changes on ${file}`,
  );
}

test('JPEG: XMP-only write changes only XMP tags (reference exiftool view)', async () => {
  await assertOnlyRequestedChanged('assets/raw/Olympus.jpg', new Uint8Array(readFileSync('assets/raw/Olympus.jpg')), {
    'XMP-dc:Subject': ['kelp'],
    'XMP-dc:Title': 'Preservation check',
  }, ['XMP-dc:Subject', 'XMP-dc:Title', 'XMP-x:XMPToolkit']);
});

test('JPEG: IPTC+XMP write adds keywords without touching anything else', async () => {
  await assertOnlyRequestedChanged('assets/raw/Olympus.jpg', new Uint8Array(readFileSync('assets/raw/Olympus.jpg')), {
    'IPTC:Keywords': ['kelp', 'forêt'],
    'XMP-dc:Subject': ['kelp', 'forêt'],
  }, ['IPTC:Keywords', 'IPTC:CodedCharacterSet', 'File:CurrentIPTCDigest', 'XMP-dc:Subject', 'XMP-x:XMPToolkit']);
});

test('DNG: XMP+EXIF write changes only the requested tags', async () => {
  // IFD1:ThumbnailOffset is a recomputed structural offset (thumbnail bytes
  // copied verbatim); XMP-x:XMPToolkit is the writer's packet tool stamp.
  await assertOnlyRequestedChanged('assets/02.dng', new Uint8Array(readFileSync('assets/02.dng')), {
    'XMP-dc:Subject': ['smoke'],
    'EXIF:Copyright': '2026 woss',
  }, ['XMP-dc:Subject', 'IFD0:Copyright', 'IFD1:ThumbnailOffset']);
});

test('PNG: XMP write preserves eXIf/IDAT chunk counts and adds XMP', async () => {
  const png = new Uint8Array(readFileSync('assets/04-ai.png'));
  const core = new ExifToolCore();
  const out = await core.writeBytes(png, { 'XMP-dc:Subject': ['kelp'] });
  const chunks = (type: string, bytes: Uint8Array): number => {
    let n = 0;
    let pos = 8;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (pos + 12 <= bytes.length) {
      const len = dv.getUint32(pos, false);
      if (String.fromCharCode(...bytes.subarray(pos + 4, pos + 8)) === type) n++;
      pos += 12 + len;
    }
    return n;
  };
  assertEquals(chunks('eXIf', png), chunks('eXIf', out.bytes));
  assertEquals(chunks('IDAT', png), chunks('IDAT', out.bytes));
  const info = await pngParser.parse(out.bytes, '(test)');
  assertEquals(info.tags.Subject !== undefined, true);
});
