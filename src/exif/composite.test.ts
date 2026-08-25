import { assertEquals } from 'jsr:@std/assert@1/equals';
import { computeCompositeTags } from './composite.ts';

Deno.test('FocalLength35efl renders fractional focal length without trailing zero', () => {
  const tags: Record<string, unknown> = {
    FocalLength: 4.5,
    FocalLengthIn35mmFormat: 28,
  };
  computeCompositeTags(tags as never);
  const value = tags['FocalLength35efl'] as string;
  assertEquals(
    value.startsWith('4.5 mm (35 mm equivalent: 28 mm)'),
    true,
    `got: ${value}`,
  );
});

Deno.test('FocalLength35efl keeps integer focal length as N.0 mm', () => {
  const tags: Record<string, unknown> = {
    FocalLength: 50,
    FocalLengthIn35mmFormat: 75,
  };
  computeCompositeTags(tags as never);
  const value = tags['FocalLength35efl'] as string;
  assertEquals(
    value.startsWith('50.0 mm (35 mm equivalent: 75 mm)'),
    true,
    `got: ${value}`,
  );
});

Deno.test('no FocalLength35efl without 35mm equivalent', () => {
  const tags: Record<string, unknown> = { FocalLength: 4.5 };
  computeCompositeTags(tags as never);
  assertEquals('FocalLength35efl' in tags, false);
});
