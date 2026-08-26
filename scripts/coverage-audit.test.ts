import { assertEquals } from '../deps.ts';
import { assertThresholds, parseLcov } from './coverage-audit.ts';

const SAMPLE = `
SF:/Users/dev/projects/exiftool-ts/src/exif/a.ts
FN:1,one
FNDA:1,one
LF:10
LH:10
FNF:1
FNH:1
end_of_record
SF:/Users/dev/projects/exiftool-ts/src/exif/b.ts
FN:2,two
FNDA:0,two
LF:8
LH:4
FNF:1
FNH:0
end_of_record
`;

Deno.test('parseLcov computes per-module line and function percentages', () => {
  const modules = parseLcov(SAMPLE);
  assertEquals(modules.length, 2);
  assertEquals(modules[0], { file: 'src/exif/a.ts', linePct: 100, functionPct: 100 });
  assertEquals(modules[1], { file: 'src/exif/b.ts', linePct: 50, functionPct: 0 });
});

Deno.test('assertThresholds reports each violated threshold per module', () => {
  const modules = parseLcov(SAMPLE);
  const failures = assertThresholds(modules, 100, 100);
  assertEquals(failures.length, 2);
  assertEquals(failures.some((f) => f.startsWith('src/exif/b.ts: line 50%')), true);
  assertEquals(failures.some((f) => f.includes('function 0%')), true);
});

Deno.test('assertThresholds passes fully compliant modules', () => {
  const modules = parseLcov(SAMPLE).filter((m) => m.linePct === 100);
  assertEquals(assertThresholds(modules, 100, 100), []);
});

Deno.test('parseLcov treats a module with zero functions as trivially complete', () => {
  const modules = parseLcov('SF:/repo/src/types.ts\nLF:4\nLH:4\nFNF:0\nFNH:0\nend_of_record\n');
  assertEquals(modules[0].functionPct, 100);
});
