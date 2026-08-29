import { test } from 'vitest';
import { assertEquals } from '../../src/test/asserts.js';
import { expandInputs } from './glob.js';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function makeTree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'exiftool-ts-'));
  await mkdir(`${root}/sub/deep/node_modules`, { recursive: true });
  await writeFile(`${root}/b.txt`, 'x');
  await writeFile(`${root}/a.jpg`, 'x');
  await writeFile(`${root}/sub/2.JPG`, 'x');
  await writeFile(`${root}/sub/1.png`, 'x');
  await writeFile(`${root}/sub/deep/3.jpg`, 'x');
  await writeFile(`${root}/sub/deep/node_modules/4.jpg`, 'x');
  return root;
}

test('expandInputs keeps nonexistent paths in place for error reporting', async () => {
  const out = await expandInputs(['missing.jpg'], {
    recurse: false,
    extensions: [],
    ignoreDirs: [],
  });
  assertEquals(out, ['missing.jpg']);
});

test('expandInputs passes regular files through untouched', async () => {
  const root = await makeTree();
  try {
    const out = await expandInputs([`${root}/a.jpg`], {
      recurse: false,
      extensions: ['png'],
      ignoreDirs: [],
    });
    assertEquals(out, [`${root}/a.jpg`]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('expandInputs non-recursive walk lists direct children sorted', async () => {
  const root = await makeTree();
  try {
    const out = await expandInputs([root], {
      recurse: false,
      extensions: [],
      ignoreDirs: [],
    });
    assertEquals(out, [`${root}/a.jpg`, `${root}/b.txt`]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('expandInputs recursive walk covers nested directories', async () => {
  const root = await makeTree();
  try {
    const out = await expandInputs([root], {
      recurse: true,
      extensions: [],
      ignoreDirs: [],
    });
    assertEquals(out, [
      `${root}/a.jpg`,
      `${root}/b.txt`,
      `${root}/sub/1.png`,
      `${root}/sub/2.JPG`,
      `${root}/sub/deep/3.jpg`,
      `${root}/sub/deep/node_modules/4.jpg`,
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('expandInputs extension filter is case-insensitive and only affects walked files', async () => {
  const root = await makeTree();
  try {
    const out = await expandInputs([`${root}/b.txt`, root], {
      recurse: true,
      extensions: ['jpg'],
    });
    // Explicit b.txt arg survives; walked files are filtered to jpg/JPG.
    assertEquals(out, [
      `${root}/b.txt`,
      `${root}/a.jpg`,
      `${root}/sub/2.JPG`,
      `${root}/sub/deep/3.jpg`,
      `${root}/sub/deep/node_modules/4.jpg`,
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('expandInputs prunes ignored directory names during walks', async () => {
  const root = await makeTree();
  try {
    const out = await expandInputs([root], {
      recurse: true,
      extensions: [],
      ignoreDirs: ['node_modules'],
    });
    assertEquals(out.includes(`${root}/sub/deep/node_modules/4.jpg`), false);
    assertEquals(out.length, 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('expandInputs empty directory expands to nothing', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'exiftool-ts-'));
  try {
    const out = await expandInputs([empty], {
      recurse: true,
      extensions: [],
      ignoreDirs: [],
    });
    assertEquals(out, []);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

test('expandInputs skips symlinks instead of following or listing them', async () => {
  const root = await makeTree();
  try {
    await symlink(`${root}/a.jpg`, `${root}/link.jpg`);
    await symlink(`${root}/sub`, `${root}/dirlink`);
    const out = await expandInputs([root], {
      recurse: true,
      extensions: [],
      ignoreDirs: [],
    });
    assertEquals(out.includes(`${root}/link.jpg`), false);
    assertEquals(out.filter((p) => p.includes('dirlink')).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
