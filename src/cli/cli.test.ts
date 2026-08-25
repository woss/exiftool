import { assertEquals } from 'jsr:@std/assert';
import { cmd, normalizeArgs, runAction } from '../../cli.ts';
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

Deno.test('runAction error on first file stops before later files', async () => {
  const cap = captureConsole();
  try {
    const code = await runAction({}, 'missing.jpg', 'assets/01.jpg');
    assertEquals(code, 1);
    assertEquals(cap.out.length, 0);
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
