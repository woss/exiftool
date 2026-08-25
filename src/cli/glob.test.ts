import { assertEquals } from '../../deps.ts';
import { expandInputs } from './glob.ts';

async function makeTree(): Promise<string> {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(`${root}/sub/deep/node_modules`, { recursive: true });
  await Deno.writeTextFile(`${root}/b.txt`, 'x');
  await Deno.writeTextFile(`${root}/a.jpg`, 'x');
  await Deno.writeTextFile(`${root}/sub/2.JPG`, 'x');
  await Deno.writeTextFile(`${root}/sub/1.png`, 'x');
  await Deno.writeTextFile(`${root}/sub/deep/3.jpg`, 'x');
  await Deno.writeTextFile(`${root}/sub/deep/node_modules/4.jpg`, 'x');
  return root;
}

Deno.test('expandInputs keeps nonexistent paths in place for error reporting', async () => {
  const out = await expandInputs(['missing.jpg'], {
    recurse: false,
    extensions: [],
    ignoreDirs: [],
  });
  assertEquals(out, ['missing.jpg']);
});

Deno.test('expandInputs passes regular files through untouched', async () => {
  const root = await makeTree();
  try {
    const out = await expandInputs([`${root}/a.jpg`], {
      recurse: false,
      extensions: ['png'],
      ignoreDirs: [],
    });
    assertEquals(out, [`${root}/a.jpg`]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('expandInputs non-recursive walk lists direct children sorted', async () => {
  const root = await makeTree();
  try {
    const out = await expandInputs([root], {
      recurse: false,
      extensions: [],
      ignoreDirs: [],
    });
    assertEquals(out, [`${root}/a.jpg`, `${root}/b.txt`]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('expandInputs recursive walk covers nested directories', async () => {
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
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('expandInputs extension filter is case-insensitive and only affects walked files', async () => {
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
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('expandInputs prunes ignored directory names during walks', async () => {
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
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('expandInputs empty directory expands to nothing', async () => {
  const empty = await Deno.makeTempDir();
  try {
    const out = await expandInputs([empty], {
      recurse: true,
      extensions: [],
      ignoreDirs: [],
    });
    assertEquals(out, []);
  } finally {
    await Deno.remove(empty);
  }
});

Deno.test('expandInputs skips symlinks instead of following or listing them', async () => {
  const root = await makeTree();
  try {
    await Deno.symlink(`${root}/a.jpg`, `${root}/link.jpg`);
    await Deno.symlink(`${root}/sub`, `${root}/dirlink`);
    const out = await expandInputs([root], {
      recurse: true,
      extensions: [],
      ignoreDirs: [],
    });
    assertEquals(out.includes(`${root}/link.jpg`), false);
    assertEquals(out.filter((p) => p.includes('dirlink')).length, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
