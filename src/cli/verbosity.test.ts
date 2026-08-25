import { assertEquals } from 'jsr:@std/assert';
import { renderTagValue, verboseLines } from './verbosity.ts';

Deno.test('renderTagValue renders Uint8Array as byte count', () => {
  assertEquals(renderTagValue(new Uint8Array(5)), '[5 bytes]');
  assertEquals(renderTagValue(new Uint8Array(0)), '[0 bytes]');
});

Deno.test('renderTagValue renders scalars and arrays', () => {
  assertEquals(renderTagValue('hello'), 'hello');
  assertEquals(renderTagValue(42), '42');
  assertEquals(renderTagValue(null), '');
  assertEquals(renderTagValue(['a', 1]), 'a, 1');
});

Deno.test('verboseLines level 1 summary only', () => {
  assertEquals(verboseLines({ path: 'a.jpg', format: 'JPEG', tags: { Make: 'X' } }, 1), [
    '[verbose] a.jpg: 1 tags (JPEG)',
  ]);
});

Deno.test('verboseLines level 2 dumps each tag', () => {
  const info = {
    path: 'b.png',
    format: 'PNG',
    tags: { Make: 'X', Width: 3, Thumb: new Uint8Array(9) },
  };
  assertEquals(verboseLines(info, 2), [
    '[verbose] b.png: 3 tags (PNG)',
    '  Make: X',
    '  Width: 3',
    '  Thumb: [9 bytes]',
  ]);
});
