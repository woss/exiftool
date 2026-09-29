import { test } from 'vitest';
/**
 * AI-forensics read parity: generative-AI provenance tags (A1111 parameters
 * chunk, InvokeAI XMP namespace, DMI DigitalSourceType, xmpMM:History
 * flattening) must match reference exiftool's flat `-j` JSON.
 *
 * Requires the real `exiftool` CLI on PATH and healthy child argv; otherwise
 * a single skipped placeholder keeps CI green (same contract as
 * exiftool-parity.test.ts).
 */
import { assertEquals } from './test/asserts.js';
import { ExifTool } from './exiftool.js';
import { formatJSON } from './cli/output.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const A1111_FIXTURE = 'assets/06-ai-a1111.png';
const INVOKEAI_FIXTURE = 'assets/06-ai-invokeai.png';
const BASE_AI = 'assets/04-ai.png';

let exiftoolAvailable = false;
try {
  const r = await execFileP('exiftool', ['-ver']);
  exiftoolAvailable = /^\d+\.\d+/.test(r.stdout.trim());
} catch {
  exiftoolAvailable = false;
}

const tool = new ExifTool();

async function referenceJSON(file: string): Promise<Record<string, unknown>> {
  const { stdout } = await execFileP('exiftool', ['-j', file]);
  return JSON.parse(stdout)[0] as Record<string, unknown>;
}

async function ourJSON(file: string): Promise<Record<string, unknown>> {
  const info = await tool.read(file);
  return JSON.parse(formatJSON([info]))[0] as Record<string, unknown>;
}

/** Reference-equal assertion for a set of tag keys on one file. */
async function assertReferenceEqual(
  file: string,
  keys: string[],
): Promise<void> {
  const [real, ours] = await Promise.all([referenceJSON(file), ourJSON(file)]);
  const norm = (v: unknown) => (Array.isArray(v) ? JSON.stringify(v) : String(v));
  for (const key of keys) {
    assertEquals(
      key in ours,
      true,
      `${file}: key ${key} missing from our output`,
    );
    assertEquals(
      norm(ours[key]),
      norm(real[key]),
      `${file}: ${key} differs from reference`,
    );
  }
}

if (!exiftoolAvailable) {
  test('ai-parity: skipped — exiftool not installed', () => {
    console.log('ai-parity tests skipped (exiftool missing)');
  });
} else {
  test('ai-parity: A1111 parameters chunk surfaces Parameters reference-equal', async () => {
    await assertReferenceEqual(A1111_FIXTURE, ['Parameters']);
    const ours = await ourJSON(A1111_FIXTURE);
    // The parsed parameters string carries prompt/seed/steps from the chunk.
    const params = String(ours['Parameters']);
    assertEquals(params.includes('prompt: a viking mug of beer, oil painting'), true);
    assertEquals(params.includes('Seed: 12345'), true);
    assertEquals(params.includes('Steps: 20'), true);
  });

  test('ai-parity: InvokeAI XMP metadata/graph + DMI + History flatten reference-equal', async () => {
    await assertReferenceEqual(INVOKEAI_FIXTURE, [
      'Metadata',
      'Graph',
      'DigitalSourceType',
      'HistoryAction',
      'HistorySoftwareAgent',
      'HistoryWhen',
    ]);
    // The raw History container never surfaces.
    const ours = await ourJSON(INVOKEAI_FIXTURE);
    assertEquals('History' in ours, false);
  });

  test('ai-parity: base AI PNG IHDR fields and XMP reader path reference-equal', async () => {
    await assertReferenceEqual(BASE_AI, [
      'Filter',
      'Interlace',
      'SRGBRendering',
      'Description',
      'CreatorTool',
      'UserComment',
    ]);
  });
}
