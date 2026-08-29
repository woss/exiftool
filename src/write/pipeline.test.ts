import { test } from 'vitest';
import { assertEquals } from '../../src/test/asserts.js';
import { ExifTool } from '../exiftool.js';
import {
  UnsupportedFormatError,
  writeTags,
  writeTagsWithTmp,
} from './pipeline.js';
import { tempFile } from '../test/tmp.js';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';

const tool = new ExifTool();

async function makeTmpJpeg(): Promise<string> {
  const tmp = await tempFile('.jpg');
  await writeFile(tmp, await readFile('assets/01.jpg'));
  return tmp;
}

test('writeTags updates tags and creates an _original backup by default', async () => {
  const file = await makeTmpJpeg();
  try {
    const result = await writeTags(file, { Make: 'Zeta' });
    assertEquals(result.written.includes('Make'), true);
    assertEquals(result.backup, `${file}_original`);
    const backupInfo = await tool.read(`${file}_original`);
    assertEquals(backupInfo.tags.Make, 'Canon');
    const info = await tool.read(file);
    assertEquals(info.tags.Make, 'Zeta');
  } finally {
    await rm(file, { force: true });
    await rm(`${file}_original`, { force: true });
  }
});

test('writeTags with overwriteOriginal skips the backup', async () => {
  const file = await makeTmpJpeg();
  try {
    const result = await writeTags(file, { Model: 'Omni' }, { overwriteOriginal: true });
    assertEquals(result.backup, undefined);
    let exists = true;
    try {
      await stat(`${file}_original`);
    } catch {
      exists = false;
    }
    assertEquals(exists, false);
  } finally {
    await rm(file, { force: true });
  }
});

test('writeTags rejects unsupported formats leaving the file untouched', async () => {
  const txt = await tempFile('.txt');
  try {
    await writeFile(txt, 'plain');
    let error: unknown;
    try {
      await writeTags(txt, { Make: 'X' });
    } catch (e) {
      error = e;
    }
    assertEquals(error instanceof UnsupportedFormatError, true);
    assertEquals(await readFile(txt, 'utf8'), 'plain');
  } finally {
    await rm(txt, { force: true });
  }
});

test('writeTagsWithTmp cleans the temp path when writing fails', async () => {
  const file = await makeTmpJpeg();
  const blockedTmp = `${file}.blocked`;
  // A directory at the temp path makes writeFile fail deterministically.
  await mkdir(blockedTmp);
  try {
    let error: unknown;
    try {
      await writeTagsWithTmp(file, { Make: 'X' }, {}, blockedTmp);
    } catch (e) {
      error = e;
    }
    assertEquals(error !== undefined, true);
    assertEquals(error instanceof Error, true);
    // The pipeline's cleanup already removed the blocked temp path.
    let tmpGone = true;
    try {
      await stat(blockedTmp);
      tmpGone = false;
    } catch {
      // expected
    }
    assertEquals(tmpGone, true);
    // Original survived.
    assertEquals((await readFile(file)).length > 0, true);
    await rm(file, { force: true });
  } finally {
    try {
      await rm(file, { force: true });
    } catch {
      // removed in success path
    }
  }
});
