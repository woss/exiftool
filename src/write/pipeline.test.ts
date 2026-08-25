import { assertEquals } from '../../deps.ts';
import { ExifTool } from '../exiftool.ts';
import {
  UnsupportedFormatError,
  writeTags,
  writeTagsWithTmp,
} from './pipeline.ts';

const tool = new ExifTool();

async function makeTmpJpeg(): Promise<string> {
  const tmp = await Deno.makeTempFile({ suffix: '.jpg' });
  await Deno.writeFile(tmp, await Deno.readFile('assets/01.jpg'));
  return tmp;
}

Deno.test('writeTags updates tags and creates an _original backup by default', async () => {
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
    await Deno.remove(file);
    await Deno.remove(`${file}_original`);
  }
});

Deno.test('writeTags with overwriteOriginal skips the backup', async () => {
  const file = await makeTmpJpeg();
  try {
    const result = await writeTags(file, { Model: 'Omni' }, { overwriteOriginal: true });
    assertEquals(result.backup, undefined);
    let exists = true;
    try {
      await Deno.stat(`${file}_original`);
    } catch {
      exists = false;
    }
    assertEquals(exists, false);
  } finally {
    await Deno.remove(file);
  }
});

Deno.test('writeTags rejects unsupported formats leaving the file untouched', async () => {
  const txt = await Deno.makeTempFile({ suffix: '.txt' });
  try {
    await Deno.writeTextFile(txt, 'plain');
    let error: unknown;
    try {
      await writeTags(txt, { Make: 'X' });
    } catch (e) {
      error = e;
    }
    assertEquals(error instanceof UnsupportedFormatError, true);
    assertEquals(await Deno.readTextFile(txt), 'plain');
  } finally {
    await Deno.remove(txt);
  }
});

Deno.test('writeTagsWithTmp cleans the temp path when writing fails', async () => {
  const file = await makeTmpJpeg();
  const blockedTmp = `${file}.blocked`;
  // A directory at the temp path makes writeFile fail deterministically.
  await Deno.mkdir(blockedTmp);
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
      await Deno.stat(blockedTmp);
      tmpGone = false;
    } catch {
      // expected
    }
    assertEquals(tmpGone, true);
    // Original survived.
    assertEquals((await Deno.readFile(file)).length > 0, true);
    await Deno.remove(file);
  } finally {
    try {
      await Deno.remove(file);
    } catch {
      // removed in success path
    }
  }
});
