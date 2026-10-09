import { test } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertEquals } from '../../src/test/asserts.js';
import { iccParser } from './icc.js';

const execFileP = promisify(execFile);
const upstreamExifTool = new URL('../../vendor/exiftool/exiftool', import.meta.url).pathname;
const fixturePath = 'vendor/exiftool/t/images/ICC_Profile.icc';

test('iccParser reads a standalone ICC profile', async () => {
  const bytes = new Uint8Array(readFileSync(fixturePath));
  assertEquals(iccParser.canParse(bytes), true);
  const info = await iccParser.parse(bytes, 'profile.icc');
  assertEquals(info.format, 'ICC');
  assertEquals(info.tags.FileType, 'ICC');
  assertEquals(info.tags.ProfileFileSignature, 'acsp');
});

test('iccParser replaces the profile block byte-for-byte', () => {
  const profile = new Uint8Array(readFileSync(fixturePath));
  const changed = profile.slice();
  changed[40] ^= 0x01;
  const result = iccParser.writeBytes!(profile, { ICC_Profile: changed });
  assertEquals(result.written, ['ICC_Profile']);
  assertEquals(Array.from(result.bytes), Array.from(changed));
});

test('vendored ExifTool reads a standalone ICC profile replacement', async () => {
  const profile = new Uint8Array(readFileSync(fixturePath));
  const changed = profile.slice();
  changed[40] ^= 0x01;
  const result = iccParser.writeBytes!(profile, { ICC_Profile: changed });
  const { writeFile, rm } = await import('node:fs/promises');
  const { tempFile } = await import('../test/tmp.js');
  const file = await tempFile('.icc');
  try {
    await writeFile(file, result.bytes);
    const { stdout } = await execFileP(upstreamExifTool, ['-j', '-ProfileFileSignature', file]);
    const info = JSON.parse(stdout)[0];
    assertEquals(info.ProfileFileSignature, 'acsp');
  } finally {
    await rm(file, { force: true });
  }
});