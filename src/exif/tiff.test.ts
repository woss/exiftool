import { assertEquals } from 'jsr:@std/assert';
import { formatGPSWithRef } from './tiff.ts';

Deno.test('default DMS output unchanged (seconds present)', () => {
  assertEquals(formatGPSWithRef([43, 28, 2], 'N'), `43 deg 28' 2.00" N`);
});

Deno.test('default DMS output unchanged (no seconds)', () => {
  assertEquals(formatGPSWithRef([43, 28, 0], 'N'), `43 deg 28.0000' N`);
});

Deno.test('default DMS with missing ref omits trailing space', () => {
  assertEquals(formatGPSWithRef([43, 28, 2], ''), `43 deg 28' 2.00"`);
});

Deno.test('decimal unsigned format', () => {
  // 43 + 28/60 = 43.466666...
  assertEquals(formatGPSWithRef([43, 28, 0], 'N', '%.3f'), '43.467');
});

Deno.test('decimal signed format honors precision and N/E positive', () => {
  assertEquals(formatGPSWithRef([43, 28, 0], 'N', '%+.6f'), '+43.466667');
  assertEquals(formatGPSWithRef([10, 30, 0], 'E', '%+.6f'), '+10.500000');
});

Deno.test('decimal S/W negation', () => {
  assertEquals(formatGPSWithRef([43, 28, 0], 'S', '%+.6f'), '-43.466667');
  assertEquals(formatGPSWithRef([43, 28, 0], 'W', '%+.6f'), '-43.466667');
});

Deno.test('decimal without + flag omits explicit sign', () => {
  assertEquals(formatGPSWithRef([43, 28, 0], 'N', '%.6f'), '43.466667');
});

Deno.test('template tokens: %d %.2f %c', () => {
  // 43.463889 deg → 43 deg 27.83'
  assertEquals(
    formatGPSWithRef([43, 27.83334, 0], 'N', `%d deg %.2f' %c`),
    `43 deg 27.83' N`,
  );
});

Deno.test('template seconds token %.Ns', () => {
  // 43 deg 28 min 15.5 sec
  const out = formatGPSWithRef([43, 28, 15.5], 'E', '%d/%c %.2s');
  assertEquals(out, '43/E 15.50');
});

Deno.test('template unknown tokens pass through literally', () => {
  assertEquals(formatGPSWithRef([43, 28, 0], 'N', '%x %d'), '%x 43');
});

Deno.test('template %c with missing ref renders empty', () => {
  assertEquals(formatGPSWithRef([43, 28, 0], '', '%d%c'), '43');
});

Deno.test('unrecognized coord format falls back to default DMS', () => {
  assertEquals(formatGPSWithRef([43, 28, 2], 'N', 'nonsense'), `43 deg 28' 2.00" N`);
});

Deno.test('non-array value passes through for all formats', () => {
  assertEquals(formatGPSWithRef('oops', 'N'), 'oops');
  assertEquals(formatGPSWithRef('oops', 'N', '%+.6f'), 'oops');
});
