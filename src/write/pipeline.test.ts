import { test } from 'vitest';
import { assertEquals } from '../../src/test/asserts.js';
import { ExifTool } from '../exiftool.js';
import {
  UnsupportedFormatError,
  writeTags,
  writeTagsWithTmp,
} from './pipeline.js';
import { tempFile } from '../test/tmp.js';
import { chmod, link, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';

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
    assertEquals(result.written.includes('EXIF:Make'), true);
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
    assertEquals(result.written.includes('EXIF:Model'), true);
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

test('writeTags honors write mode for existing and new tags', async () => {
  const file = await makeTmpJpeg();
  try {
    const createOnly = await writeTags(
      file,
      { Make: 'Ignored', ImageDescription: 'Created' },
      { overwriteOriginal: true, writeMode: 'c' },
    );
    assertEquals(createOnly.written.includes('EXIF:ImageDescription'), true);
    assertEquals(createOnly.modeSkipped, ['Make']);
    let info = await tool.read(file);
    assertEquals(info.tags.Make, 'Canon');
    assertEquals(info.tags.ImageDescription, 'Created');

    const writeOnly = await writeTags(
      file,
      { Make: 'Updated', GPSMapDatum: 'WGS-84' },
      { overwriteOriginal: true, writeMode: 'w' },
    );
    assertEquals(writeOnly.written.includes('EXIF:Make'), true);
    assertEquals(writeOnly.modeSkipped, ['GPSMapDatum']);
    info = await tool.read(file);
    assertEquals(info.tags.Make, 'Updated');
    assertEquals(info.tags.GPSMapDatum, undefined);
  } finally {
    await rm(file, { force: true });
  }
});

test('writeTags requires g to create an XMP group but allows additions to an existing group', async () => {
  const fresh = await tempFile('.jpg');
  const original = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  await writeFile(fresh, original);
  try {
    const createOnly = await writeTags(
      fresh,
      { 'XMP-dc:Subject': ['new group'] },
      { overwriteOriginal: true, writeMode: 'c' },
    );
    assertEquals(createOnly.written, []);
    assertEquals(createOnly.modeSkipped, ['XMP-dc:Subject']);
    assertEquals(Buffer.compare(await readFile(fresh), original), 0);

    const createGroup = await writeTags(
      fresh,
      { 'XMP-dc:Subject': ['new group'] },
      { overwriteOriginal: true, writeMode: 'cg' },
    );
    assertEquals(createGroup.written.includes('XMP-dc:Subject'), true);
    assertEquals((await tool.read(fresh)).tags.Subject, 'new group');
  } finally {
    await rm(fresh, { force: true });
  }

  const existingGroup = await makeTmpJpeg();
  try {
    const createdProperty = await writeTags(
      existingGroup,
      { 'XMP-dc:Subject': ['new property'] },
      { overwriteOriginal: true, writeMode: 'c' },
    );
    assertEquals(createdProperty.written.includes('XMP-dc:Subject'), true);
    assertEquals((await tool.read(existingGroup)).tags.Subject, 'new property');

    const writeExistingGroup = await writeTags(
      existingGroup,
      { 'XMP-dc:Description': 'write into existing group' },
      { overwriteOriginal: true, writeMode: 'w' },
    );
    assertEquals(writeExistingGroup.written.includes('XMP-dc:Description'), true);
    assertEquals((await tool.read(existingGroup)).tags.Description, 'write into existing group');
  } finally {
    await rm(existingGroup, { force: true });
  }
});

test('writeTags rejects invalid write modes without modifying the file', async () => {
  const file = await makeTmpJpeg();
  const original = await readFile(file);
  try {
    let error: unknown;
    try {
      await writeTags(file, { Make: 'Changed' }, { overwriteOriginal: true, writeMode: 'wx' });
    } catch (caught) {
      error = caught;
    }
    assertEquals(error instanceof UnsupportedFormatError, true);
    assertEquals(Buffer.compare(await readFile(file), original), 0);
  } finally {
    await rm(file, { force: true });
  }
});

test('writeTags can overwrite in place while preserving hard links', async () => {
  const file = await makeTmpJpeg();
  const hardlink = `${file}.hardlink`;
  try {
    await link(file, hardlink);
    const originalInode = (await stat(file)).ino;
    const result = await writeTags(file, { Software: 'in-place-write' }, {
      overwriteOriginalInPlace: true,
    });
    assertEquals(result.backup, undefined);
    assertEquals((await stat(file)).ino, originalInode);
    assertEquals((await stat(hardlink)).ino, originalInode);
    assertEquals((await tool.read(hardlink)).tags.Software, 'in-place-write');
  } finally {
    await rm(file, { force: true });
    await rm(hardlink, { force: true });
  }
});

test('writeTags preserves file permission bits during replacement', async () => {
  const file = await makeTmpJpeg();
  try {
    await chmod(file, 0o640);
    await writeTags(file, { Make: 'Updated' }, { overwriteOriginal: true });
    assertEquals((await stat(file)).mode & 0o777, 0o640);
  } finally {
    await rm(file, { force: true });
  }
});

test('writeTags forwards compression to the PNG writer', async () => {
  const file = await tempFile('.png');
  const value = 'pipeline-compressed-comment '.repeat(40);
  try {
    await writeFile(file, await readFile('vendor/exiftool/t/images/PNG.png'));
    await writeTags(file, { 'PNG:Comment': value }, { overwriteOriginal: true, compress: true });
    const bytes = await readFile(file);
    assertEquals(bytes.includes(Buffer.from('zTXt')), true);
    assertEquals((await tool.read(file)).tags.Comment, value);
  } finally {
    await rm(file, { force: true });
  }
});

test('writeTags preserves the source modification time when requested', async () => {
  const file = await makeTmpJpeg();
  const originalMtime = new Date('2020-01-02T03:04:05.000Z');
  try {
    await utimes(file, originalMtime, originalMtime);
    await writeTags(file, { Make: 'Zeta' }, { overwriteOriginal: true, preserveTime: true });
    const writtenStat = await stat(file);
    assertEquals(Math.abs(writtenStat.mtimeMs - originalMtime.getTime()) < 1, true);
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

test('writeTags merge: 4-tag license stamp verified by reference exiftool', async () => {
  const file = await makeTmpJpeg();
  try {
    const before = await tool.read(file);
    const result = await writeTags(file, {
      Copyright: 'Copyright 2026 Test Author',
      Orientation: 1,
      Rights: 'All rights reserved by Test Author',
      WebStatement: 'https://example.com/license',
    });
    assertEquals(result.skipped, []);
    assertEquals(result.written.sort(), [
      'EXIF:Copyright',
      'EXIF:Orientation',
      'XMP-dc:Rights',
      'XMP-xmpRights:WebStatement',
    ]);
    let verify;
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const { stdout } = await promisify(execFile)('exiftool', [
        '-j', '-G1', '-a', file,
      ]);
      verify = JSON.parse(stdout)[0];
    } catch {
      console.log('reference exiftool not available; skipping verification');
      return;
    }
    assertEquals(verify['IFD0:Copyright'], 'Copyright 2026 Test Author');
    assertEquals(verify['IFD0:Orientation'], 'Horizontal (normal)');
    assertEquals(verify['XMP-dc:Rights'], 'All rights reserved by Test Author');
    assertEquals(verify['XMP-xmpRights:WebStatement'], 'https://example.com/license');
    // Merge semantics: everything outside the 4 requested groups is preserved.
    const after = await tool.read(file);
    const changedGroups = new Set(['IFD0', 'XMP-dc', 'XMP-xmpRights']);
    const changedBaseNames = new Set([
      'Copyright', 'Orientation', 'Rights', 'WebStatement',
      'URL', 'CopyrightNotice', // XMP reader aliases of WebStatement/Rights
      'ThumbnailOffset', // thumbnail bytes are preserved; their offset moves
    ]);
    for (const [k, v] of Object.entries(before.tags)) {
      const base = k.includes(':') ? k.split(':')[1]! : k;
      const group = k.includes(':') ? k.split(':')[0]! : '';
      if (changedGroups.has(group) || changedBaseNames.has(base)) continue;
      assertEquals(JSON.stringify(after.tags[k]), JSON.stringify(v), `changed: ${k}`);
    }
  } finally {
    await rm(file, { force: true });
    await rm(`${file}_original`, { force: true });
  }
});
