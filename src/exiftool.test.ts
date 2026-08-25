import { assertEquals } from 'jsr:@std/assert';
import { ExifTool } from './exiftool.ts';

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

Deno.test('ExifTool constructor builds tag db with known tags', () => {
  const tool = new ExifTool();
  const make = tool.tagDb.getByName('Make');
  assertEquals(make !== undefined, true);
  assertEquals(make!.name, 'Make');
});

Deno.test('ExifTool.read parses a JPEG asset', async () => {
  const tool = new ExifTool();
  const info = await tool.read('assets/01.jpg');
  assertEquals(info.format, 'JPEG');
  assertEquals(Object.keys(info.tags).length > 0, true);
  assertEquals(info.tags.Make, 'Canon');
});

Deno.test('ExifTool.read rejects on missing file', async () => {
  const tool = new ExifTool();
  let threw = false;
  try {
    await tool.read('assets/does-not-exist.jpg');
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test('run with no args prints help and returns 0', async () => {
  const tool = new ExifTool();
  const cap = captureConsole();
  try {
    const code = await tool.run([]);
    assertEquals(code, 0);
    assertEquals(cap.out.some((l) => l.includes('Usage:')), true);
  } finally {
    cap.restore();
  }
});

Deno.test('run --help prints help and returns 0', async () => {
  const tool = new ExifTool();
  const cap = captureConsole();
  try {
    const code = await tool.run(['--help']);
    assertEquals(code, 0);
    assertEquals(cap.out.some((l) => l.includes('exiftool-ts')), true);
  } finally {
    cap.restore();
  }
});

Deno.test('run --version prints version and returns 0', async () => {
  const tool = new ExifTool();
  const cap = captureConsole();
  try {
    const code = await tool.run(['--version']);
    assertEquals(code, 0);
    assertEquals(cap.out, ['0.1.0']);
  } finally {
    cap.restore();
  }
});

Deno.test('run -ver prints version and returns 0', async () => {
  const tool = new ExifTool();
  const cap = captureConsole();
  try {
    const code = await tool.run(['-ver']);
    assertEquals(code, 0);
    assertEquals(cap.out, ['0.1.0']);
  } finally {
    cap.restore();
  }
});

Deno.test('run stub path reports not-yet-implemented and returns 1', async () => {
  const tool = new ExifTool();
  const cap = captureConsole();
  try {
    const code = await tool.run(['x']);
    assertEquals(code, 1);
    assertEquals(cap.err.includes('exiftool-ts: not yet implemented'), true);
  } finally {
    cap.restore();
  }
});

Deno.test('ExifTool constructor merges custom options over defaults', () => {
  const tool = new ExifTool({ verbosity: 3 });
  assertEquals(tool.options.verbosity, 3);
  assertEquals(tool.options.composite, true); // untouched default
});
