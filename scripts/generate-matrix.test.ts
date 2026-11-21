import { test } from 'vitest';
import { assert, assertEquals } from '../src/test/asserts.js';
import { buildMatrix, checkMatrix, parseUpstreamTables } from './generate-matrix.js';
import type { ParityMatrix } from './generate-matrix.js';

const README_SAMPLE = `
  File Types
  ------------+-------------+-------------+------------
  360   r/w   | DR4   r/w/c | JNG   r/w   | O     r
  F4A/V r/w   | EXIF  r/w/c | FIT   r     | TIFF  r/w

  Meta Information
  ----------------------+----------------------+---------------------
  EXIF           r/w/c  |  CIFF           r/w  |  Ricoh RMETA    r
  GPS            r/w/c  |  AFCP           r/w  |  Picture Info   r

See html/index.html for more details.
`;

const MANIFEST = JSON.stringify({ exiftoolVersion: '13.64' });

function sampleCounts(matrix: ParityMatrix) {
  const fileTypes = new Set(matrix.fileTypes.map((f) => f.name));
  const families = new Set(matrix.families.map((f) => f.name));
  for (const key of Object.keys(matrix.cells)) {
    const [fileType, family] = key.split('|');
    if (!fileTypes.has(fileType!) || !families.has(family!)) delete matrix.cells[key];
  }
}

test('parseUpstreamTables reads modes, slashed and spaced names', () => {
  const { fileTypes, families } = parseUpstreamTables(README_SAMPLE);
  assertEquals(fileTypes.map((f) => [f.name, f.upstream]), [
    ['360', 'r/w'],
    ['DR4', 'r/w/c'],
    ['JNG', 'r/w'],
    ['O', 'r'],
    ['F4A/V', 'r/w'],
    ['EXIF', 'r/w/c'],
    ['FIT', 'r'],
    ['TIFF', 'r/w'],
  ]);
  assertEquals(families.map((f) => f.name), ['EXIF', 'CIFF', 'Ricoh RMETA', 'GPS', 'AFCP', 'Picture Info']);
  const fit = fileTypes.find((f) => f.name === 'FIT')!;
  assertEquals(fit.status, 'read-only');
  assertEquals(fileTypes.find((f) => f.name === 'TIFF')!.status, 'not-started');
});

test('buildMatrix pins the version from the catalog manifest', () => {
  const matrix = buildMatrix(README_SAMPLE, MANIFEST);
  assertEquals(matrix.exiftoolVersion, '13.64');
  assertEquals(matrix.version, 1);
});

test('buildMatrix fails loud on a manifest without a version', () => {
  let message: string | undefined;
  try {
    buildMatrix(README_SAMPLE, '{}');
  } catch (error) {
    message = (error as Error).message;
  }
  assertEquals(message, 'manifest.json missing exiftoolVersion');
});

test('checkMatrix rejects implemented cells without a test', () => {
  const matrix = buildMatrix(README_SAMPLE, MANIFEST);
  sampleCounts(matrix);
  matrix.cells['TIFF|EXIF|set'] = { status: 'implemented', reason: 'x', fixture: null, test: null };
  const errors = checkMatrix(matrix);
  assert(errors.some((e) => e.includes('implemented without test')), JSON.stringify(errors));
});

test('checkMatrix rejects cells naming unknown dimensions', () => {
  const matrix = buildMatrix(README_SAMPLE, MANIFEST);
  sampleCounts(matrix);
  matrix.cells['NOPE|EXIF|set'] = { status: 'partial', reason: 'x', fixture: null, test: null };
  const errors = checkMatrix(matrix);
  assert(errors.some((e) => e.includes('unknown fileType')), JSON.stringify(errors));
});

test('sample-parsed matrix is self-consistent once foreign cells are dropped', () => {
  const matrix = buildMatrix(README_SAMPLE, MANIFEST);
  sampleCounts(matrix);
  assertEquals(checkMatrix(matrix), []);
});
