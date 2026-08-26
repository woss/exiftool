import { assertEquals } from 'jsr:@std/assert';
import { cmd, main, normalizeArgs, runAction } from '../../cli.ts';
import type { CliOptions } from '../../cli.ts';
import { ExifTool } from '../../src/exiftool.ts';

function captureConsole() {
  const origLog = console.log;
  const origErr = console.error;
  const out: string[] = [];
  const err: string[] = [];
  console.log = (...a: unknown[]) => out.push(a.map(String).join(' '));
  console.error = (...a: unknown[]) => err.push(a.map(String).join(' '));
  return {
    out,
    err,
    restore() {
      console.log = origLog;
      console.error = origErr;
    },
  };
}

// --- normalizeArgs ---

Deno.test('normalizeArgs — -ver maps to --version', () => {
  assertEquals(normalizeArgs(['-ver']), ['--version']);
});

Deno.test('normalizeArgs — attached short values split', () => {
  assertEquals(normalizeArgs(['-g1']), ['-g', '1']);
  assertEquals(normalizeArgs(['-G2']), ['-G', '2']);
});

Deno.test('normalizeArgs — bare -g/-G expand to group flags with defaults', () => {
  assertEquals(normalizeArgs(['-g']), ['--group-headings', '0']);
  assertEquals(normalizeArgs(['-G']), ['--group-prefix', '1']);
});

Deno.test('normalizeArgs — multi-dash args pass through untouched', () => {
  assertEquals(normalizeArgs(['--json', '--csv']), ['--json', '--csv']);
});

Deno.test('normalizeArgs — plain operands and short boolean flags unchanged', () => {
  assertEquals(normalizeArgs(['photo.jpg', '-v', '-q']), ['photo.jpg', '-v', '-q']);
});

// --- runAction ---

Deno.test('runAction default tabular output returns 0', async () => {
  const cap = captureConsole();
  try {
    const code = await runAction({}, 'assets/01.jpg');
    assertEquals(code, 0);
    const text = cap.out.join('\n');
    assertEquals(text.includes('Make'), true);
    assertEquals(text.includes('Canon EOS 700D'), true);
  } finally {
    cap.restore();
  }
});

Deno.test('runAction multiple files tabular includes each source file', async () => {
  const cap = captureConsole();
  try {
    const code = await runAction({}, 'assets/01.jpg', 'assets/03.jpg');
    assertEquals(code, 0);
    const text = cap.out.join('\n');
    assertEquals(text.includes('01.jpg'), true);
    assertEquals(text.includes('03.jpg'), true);
  } finally {
    cap.restore();
  }
});

Deno.test('runAction --json emits parseable JSON array', async () => {
  const cap = captureConsole();
  try {
    const code = await runAction({ json: true }, 'assets/01.jpg');
    assertEquals(code, 0);
    const parsed = JSON.parse(cap.out.join('\n'));
    assertEquals(Array.isArray(parsed), true);
    assertEquals(parsed[0].Make, 'Canon');
  } finally {
    cap.restore();
  }
});

Deno.test('runAction --csv emits CSV rows', async () => {
  const cap = captureConsole();
  try {
    const code = await runAction({ csv: true }, 'assets/01.jpg');
    assertEquals(code, 0);
    const text = cap.out.join('\n');
    assertEquals(text.split('\n').length >= 2, true); // header + data row
    assertEquals(text.includes('Make'), true);
  } finally {
    cap.restore();
  }
});

Deno.test('runAction -b dumps raw binary bytes to stdout', async () => {
  // Expected bytes: every Uint8Array value of the parsed file, in tag order.
  const tool = new ExifTool();
  const info = await tool.read('assets/01.jpg');
  const expected: number[] = [];
  for (const value of Object.values(info.tags)) {
    if (value instanceof Uint8Array && value.length > 0) expected.push(...value);
  }
  assertEquals(expected.length > 0, true);
  // Stub seam: shadow Deno.stdout.write to capture raw bytes without touching a TTY.
  const stdout = Deno.stdout as unknown as { write: (data: Uint8Array) => Promise<number> };
  const origWrite = stdout.write.bind(stdout);
  const collected: number[] = [];
  stdout.write = (data: Uint8Array): Promise<number> => {
    collected.push(...data);
    return Promise.resolve(data.length);
  };
  const cap = captureConsole();
  try {
    const code = await runAction({ binary: true }, 'assets/01.jpg');
    assertEquals(code, 0);
    assertEquals(collected.length, expected.length);
    assertEquals(new Uint8Array(collected), new Uint8Array(expected));
  } finally {
    stdout.write = origWrite;
    cap.restore();
  }
});

Deno.test('runAction -b without binary tags reports failure and returns 1', async () => {
  const tmp = await Deno.makeTempFile({ suffix: '.bin' });
  try {
    await Deno.writeFile(tmp, new TextEncoder().encode('plain text, no metadata'));
    const cap = captureConsole();
    try {
      const code = await runAction({ binary: true }, tmp);
      assertEquals(code, 1);
      assertEquals(cap.err.includes('No binary tags found.'), true);
    } finally {
      cap.restore();
    }
  } finally {
    await Deno.remove(tmp);
  }
});

Deno.test('runAction -b --json embeds base64 binary instead of raw dump', async () => {
  const cap = captureConsole();
  try {
    const code = await runAction({ binary: true, json: true }, 'assets/01.jpg');
    assertEquals(code, 0);
    const parsed = JSON.parse(cap.out.join('\n'));
    assertEquals(parsed[0].ThumbnailImage.length % 4, 0); // base64 shape
  } finally {
    cap.restore();
  }
});

Deno.test('runAction nonexistent file prints error and returns 1', async () => {
  const cap = captureConsole();
  try {
    const code = await runAction({}, 'no-such-file.jpg');
    assertEquals(code, 1);
    assertEquals(cap.err.some((l) => l.startsWith('Error reading no-such-file.jpg:')), true);
  } finally {
    cap.restore();
  }
});


Deno.test('runAction -if keeps matching files only', async () => {
  const cap = captureConsole();
  try {
    const opts: CliOptions = { json: true, if: ['$ISO > 100'] };
    const code = await runAction(opts, 'assets/01.jpg', 'assets/03.jpg');
    assertEquals(code, 0);
    assertEquals(cap.err.length, 0); // nothing filtered out
    const parsed = JSON.parse(cap.out.join('\n'));
    assertEquals(parsed.length, 2);
  } finally {
    cap.restore();
  }
});

Deno.test('runAction -if drops non-matching files and reports count', async () => {
  const tmp = await Deno.makeTempFile({ suffix: '.jpg' });
  try {
    // Copy of a real JPEG so both operands parse; only 03.jpg matches the condition.
    await Deno.writeFile(tmp, await Deno.readFile('assets/01.jpg'));
    const cap = captureConsole();
    try {
      const code = await runAction({ json: true, if: ['$FileName eq 03.jpg'] }, 'assets/03.jpg', tmp);
      assertEquals(code, 0);
      assertEquals(cap.err.includes('1 files failed condition'), true);
      const parsed = JSON.parse(cap.out.join('\n'));
      assertEquals(parsed.length, 1);
      assertEquals(parsed[0].FileName, '03.jpg');
    } finally {
      cap.restore();
    }
  } finally {
    await Deno.remove(tmp);
  }
});

Deno.test('runAction quiet suppresses condition-failure message', async () => {
  const cap = captureConsole();
  try {
    const opts: CliOptions = { json: true, if: ['$Missing eq x'], quiet: [true] };
    const code = await runAction(opts, 'assets/01.jpg');
    assertEquals(code, 0);
    assertEquals(cap.err.join('\n').includes('failed condition'), false);
    assertEquals(JSON.parse(cap.out.join('\n')).length, 0);
  } finally {
    cap.restore();
  }
});

Deno.test('runAction verbose writes diagnostic lines to stderr', async () => {
  const cap = captureConsole();
  try {
    const code = await runAction({ verbose: [true] }, 'assets/01.jpg');
    assertEquals(code, 0);
    assertEquals(cap.err.length > 0, true);
  } finally {
    cap.restore();
  }
});

Deno.test('runAction group headings render GROUP banners', async () => {
  const cap = captureConsole();
  try {
    const code = await runAction({ groupHeadings: '0' }, 'assets/01.jpg');
    assertEquals(code, 0);
    assertEquals(cap.out.join('\n').includes('------ GROUP:'), true);
  } finally {
    cap.restore();
  }
});

Deno.test('runAction group prefix renders Group:Tag names', async () => {
  const cap = captureConsole();
  try {
    const code = await runAction({ groupPrefix: '1' }, 'assets/01.jpg');
    assertEquals(code, 0);
    assertEquals(/:Make\t/.test(cap.out.join('\n')), true);
  } finally {
    cap.restore();
  }
});

Deno.test('runAction date format reformats date tags', async () => {
  const cap = captureConsole();
  try {
    const code = await runAction({ dateFormat: '%Y-%m-%d' }, 'assets/01.jpg');
    assertEquals(code, 0);
    assertEquals(cap.out.join('\n').includes('2023-08-02'), true);
  } finally {
    cap.restore();
  }
});

// --- Phase 4: input expansion, error continuation, XML, output redirect, -ee ---

function buildMpfFixture(): Uint8Array {
  const miniJpeg = (marker: number): Uint8Array =>
    new Uint8Array([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00,
      0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, marker, 0xFF, 0xD9,
    ]);
  const imgs = [miniJpeg(0xB1), miniJpeg(0xB2)];
  const t: number[] = [0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x03, 0x00];
  const u32 = (v: number) =>
    t.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
  const entry = (tag: number, count: number, valOff: number) => {
    t.push(tag & 255, tag >> 8, 7, 0);
    u32(count);
    u32(valOff);
  };
  const verOff = 8 + 2 + 12 * 3 + 4;
  const entriesOff = verOff + 4;
  const blobBase = entriesOff + 16 * imgs.length;
  entry(0xb000, 4, verOff);
  entry(0xb001, 1, imgs.length);
  entry(0xb002, imgs.length * 16, entriesOff);
  t.push(0, 0, 0, 0);
  t.push(0x30, 0x31, 0x30, 0x30);
  let cursor = blobBase;
  for (const img of imgs) {
    u32(0);
    u32(img.length);
    u32(cursor);
    t.push(0, 0, 0, 0);
    cursor += img.length;
  }
  for (const img of imgs) t.push(...img);
  const payload = [0x4d, 0x50, 0x46, 0x00, ...t];
  const segLen = payload.length + 2;
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xe2, (segLen >> 8) & 255, segLen & 255, ...payload,
    0xff, 0xd9,
  ]);
}

Deno.test('normalizeArgs maps -ext and -ee to long-only options', () => {
  assertEquals(normalizeArgs(['-ext', 'jpg']), ['--extension', 'jpg']);
  assertEquals(normalizeArgs(['-ee']), ['--extract-embedded']);
  assertEquals(normalizeArgs(['-overwrite_original']), ['--overwrite-original']);
  assertEquals(normalizeArgs(['--overwrite_original']), ['--overwrite-original']);
});

Deno.test('runAction walks directories with recurse, extension filter, and ignore', async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/nested/skipme`, { recursive: true });
    await Deno.writeFile(`${root}/top.jpg`, await Deno.readFile('assets/01.jpg'));
    await Deno.writeTextFile(`${root}/note.txt`, 'x');
    await Deno.writeFile(`${root}/nested/in.jpg`, await Deno.readFile('assets/03.jpg'));
    await Deno.writeTextFile(`${root}/nested/skipme/hidden.jpg`, 'x');
    const cap = captureConsole();
    try {
      const opts: CliOptions = {
        json: true,
        recurse: true,
        extension: ['JPG'],
        ignore: ['skipme'],
      };
      const code = await runAction(opts, root);
      assertEquals(code, 0);
      const parsed = JSON.parse(cap.out.join('\n'));
      assertEquals(parsed.length, 2);
      assertEquals(
        parsed.map((f: { SourceFile: string }) => f.SourceFile.endsWith('top.jpg'))
          .includes(true),
        true,
      );
    } finally {
      cap.restore();
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('runAction continues after unreadable files and reports each failure', async () => {
  const cap = captureConsole();
  try {
    const code = await runAction({ json: true }, 'missing.jpg', 'assets/01.jpg');
    assertEquals(code, 1);
    assertEquals(
      cap.err.some((l) => l.startsWith('Error reading missing.jpg:')),
      true,
    );
    // The readable file still made it through to the formatter.
    const parsed = JSON.parse(cap.out.join('\n'));
    assertEquals(parsed.length, 1);
    assertEquals(parsed[0].Make, 'Canon');
  } finally {
    cap.restore();
  }
});

Deno.test('runAction quiet suppresses per-file failure lines but keeps exit code', async () => {
  const cap = captureConsole();
  try {
    const opts: CliOptions = { json: true, quiet: [true] };
    const code = await runAction(opts, 'missing.jpg');
    assertEquals(code, 1);
    assertEquals(cap.err.length, 0);
  } finally {
    cap.restore();
  }
});

Deno.test('runAction --xml emits an XML document', async () => {
  const cap = captureConsole();
  try {
    const code = await runAction({ xml: true }, 'assets/01.jpg');
    assertEquals(code, 0);
    const text = cap.out.join('\n');
    assertEquals(text.startsWith('<?xml'), true);
    assertEquals(text.includes('<tag name="Make">Canon</tag>'), true);
  } finally {
    cap.restore();
  }
});

Deno.test('runAction -o writes formatter output to a file instead of stdout', async () => {
  const out = await Deno.makeTempFile({ suffix: '.txt' });
  try {
    const cap = captureConsole();
    try {
      const code = await runAction({ output: out }, 'assets/01.jpg');
      assertEquals(code, 0);
      assertEquals(cap.out.join('\n').length, 0);
    } finally {
      cap.restore();
    }
    const written = await Deno.readTextFile(out);
    assertEquals(written.includes('Canon EOS 700D'), true);
  } finally {
    await Deno.remove(out);
  }
});

Deno.test('runAction -o failure is reported and returns 1', async () => {
  const cap = captureConsole();
  try {
    const code = await runAction(
      { output: '/no-such-dir/out.txt' },
      'assets/01.jpg',
    );
    assertEquals(code, 1);
    assertEquals(cap.out.length, 0);
    assertEquals(
      cap.err.some((l) => l.startsWith('Error writing /no-such-dir/out.txt:')),
      true,
    );
  } finally {
    cap.restore();
  }
});

Deno.test('runAction -ee appends embedded MPF images as documents', async () => {
  const tmp = await Deno.makeTempFile({ suffix: '.jpg' });
  try {
    await Deno.writeFile(tmp, buildMpfFixture());
    const cap = captureConsole();
    try {
      const code = await runAction({ json: true, extractEmbedded: true }, tmp);
      assertEquals(code, 0);
      const parsed = JSON.parse(cap.out.join('\n'));
      // Container + two embedded MPF individual images.
      assertEquals(parsed.length, 3);
      assertEquals(parsed[0].SourceFile, tmp);
      assertEquals(parsed[1].SourceFile, tmp);
      assertEquals(parsed[2].FileType, 'JPEG');
    } finally {
      cap.restore();
    }
  } finally {
    await Deno.remove(tmp);
  }
});

Deno.test('runAction -ee on a plain JPEG adds no documents', async () => {
  const cap = captureConsole();
  try {
    const code = await runAction(
      { json: true, extractEmbedded: true },
      'assets/01.jpg',
    );
    assertEquals(code, 0);
    assertEquals(JSON.parse(cap.out.join('\n')).length, 1);
  } finally {
    cap.restore();
  }
});

Deno.test('normalizeArgs — generic single-dash flag converts to long form', () => {
  assertEquals(normalizeArgs(['-json']), ['--json']);
  assertEquals(normalizeArgs(['-csv', '-b']), ['--csv', '-b']);
});


Deno.test('cmd.parse drives the registered action end to end', async () => {
  const cap = captureConsole();
  try {
    // Real cliffy parse: invokes the action callback, which delegates to runAction.
    await cmd.parse(['assets/01.jpg']);
    assertEquals(cap.out.join('\n').includes('Make'), true);
  } finally {
    cap.restore();
  }
});

// Runs cli.ts as a real entrypoint so the import.meta.main block, cmd.parse,
// and the non-zero exit branch execute; coverage reaches these lines through
// the DENO_COVERAGE_DIR the test runner exports to subprocesses.
Deno.test('CLI entrypoint exits nonzero on unreadable file', async () => {
  const entry = new URL('../../cli.ts', import.meta.url).pathname;
  const child = new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', '--config', new URL('../../deno.json', import.meta.url).pathname, entry, 'definitely-missing.jpg'],
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  });
  const { code, stderr } = await child.output();
  const errText = new TextDecoder().decode(stderr);
  assertEquals(code !== 0, true);
  assertEquals(errText.includes('Error reading definitely-missing.jpg:'), true);
});

Deno.test('CLI entrypoint succeeds on a real file', async () => {
  const entry = new URL('../../cli.ts', import.meta.url).pathname;
  const child = new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', '--config', new URL('../../deno.json', import.meta.url).pathname, entry, 'assets/01.jpg'],
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  });
  const { code, stdout } = await child.output();
  const outText = new TextDecoder().decode(stdout);
  assertEquals(code, 0);
  assertEquals(outText.includes('Make'), true);
});

// --- Phase 5: TAG=VALUE write mode ---

Deno.test('runAction write mode updates file and creates backup', async () => {
  const tmp = await Deno.makeTempFile({ suffix: '.jpg' });
  await Deno.writeFile(tmp, await Deno.readFile('assets/01.jpg'));
  const cap = captureConsole();
  try {
    const code = await runAction({}, '-Make=Acme', tmp);
    assertEquals(code, 0);
    assertEquals(cap.out.join('\n').includes('1 image files updated'), true);
    const tool = new ExifTool();
    const info = await tool.read(tmp);
    assertEquals(info.tags.Make, 'Acme');
    const originalInfo = await tool.read(`${tmp}_original`);
    assertEquals(originalInfo.tags.Make, 'Canon');
  } finally {
    try { await Deno.remove(`${tmp}_original`); } catch { /* absent */ }
    await Deno.remove(tmp);
  }
});

Deno.test('runAction write mode with overwriteOriginal skips backup', async () => {
  const tmp = await Deno.makeTempFile({ suffix: '.jpg' });
  await Deno.writeFile(tmp, await Deno.readFile('assets/01.jpg'));
  const cap = captureConsole();
  try {
    const opts: CliOptions = { overwriteOriginal: true };
    const code = await runAction(opts, '-Software=tiny', tmp);
    assertEquals(code, 0);
    let exists = true;
    try {
      await Deno.stat(`${tmp}_original`);
    } catch {
      exists = false;
    }
    assertEquals(exists, false);
    const tool = new ExifTool();
    assertEquals((await tool.read(tmp)).tags.Software, 'tiny');
  } finally {
    cap.restore();
    await Deno.remove(tmp);
  }
});

Deno.test('runAction write mode reports unsupported files and returns 1', async () => {
  const txt = await Deno.makeTempFile({ suffix: '.txt' });
  await Deno.writeTextFile(txt, 'plain');
  const cap = captureConsole();
  try {
    const code = await runAction({}, '-Make=X', txt);
    assertEquals(code, 1);
    assertEquals(
      cap.err.some((l) => l.startsWith('Error writing')),
      true,
    );
    // No summary line when nothing was updated.
    assertEquals(cap.out.join('\n').includes('updated'), false);
  } finally {
    cap.restore();
    await Deno.remove(txt);
  }
});

Deno.test('main routes one-shot runs through runAction', async () => {
  const cap = captureConsole();
  try {
    const code = await main({ json: true }, ['assets/01.jpg']);
    assertEquals(code, 0);
    assertEquals(JSON.parse(cap.out.join('\n')).length, 1);
  } finally {
    cap.restore();
  }
});

Deno.test('main runs the -stay_open daemon over an injected stream', async () => {
  const tmp = await Deno.makeTempFile({ suffix: '.jpg' });
  await Deno.writeFile(tmp, await Deno.readFile('assets/01.jpg'));
  const enc = new TextEncoder();
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(`-Software=daemon\r\n${tmp}\r\n-execute\r\n-stay_open\r\nFalse\r\n`));
      controller.close();
    },
  });
  const cap = captureConsole();
  try {
    const code = await main({ overwriteOriginal: true, stayOpen: 'True' }, [], input);
    assertEquals(code, 0);
    const tool = new ExifTool();
    assertEquals((await tool.read(tmp)).tags.Software, 'daemon');
    // {ready} sentinel emitted per -execute batch.
    assertEquals(cap.out.includes('{ready}'), true);
  } finally {
    cap.restore();
    await Deno.remove(tmp);
  }
});

Deno.test('main propagates a failing batch exit code on shutdown', async () => {
  const enc = new TextEncoder();
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode('missing.jpg\n-execute\n-stay_open\nFalse\n'));
      controller.close();
    },
  });
  const cap = captureConsole();
  try {
    const code = await main({ stayOpen: true }, [], input);
    assertEquals(code, 1);
  } finally {
    cap.restore();
  }
});
