import { test } from 'vitest';
import { assertEquals } from '../src/test/asserts.js';
// src/tags.ts is a type-only module (TagDef / TableDef interfaces): a static
// import is elided by Deno's type stripping, so only a dynamic value import
// forces real module instantiation and makes the file appear in coverage.
// There are no runtime exports to assert on.
test('tags module is type-only and exports no runtime values', async () => {
  const tags = await import('./tags.js');
  assertEquals(Object.keys(tags).length, 0);
});
