import { assertEquals } from '../deps.ts';
// src/tags.ts is a type-only module (TagDef / TableDef interfaces): a static
// import is elided by Deno's type stripping, so only a dynamic value import
// forces real module instantiation and makes the file appear in coverage.
// There are no runtime exports to assert on.
Deno.test('tags module is type-only and exports no runtime values', async () => {
  const tags = await import('./tags.ts');
  assertEquals(Object.keys(tags).length, 0);
});
