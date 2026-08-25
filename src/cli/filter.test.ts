import { assertEquals } from 'jsr:@std/assert';
import { evalCondition } from './filter.ts';
import type { TagValue } from '../types.ts';

const tags: Record<string, TagValue> = {
  Make: 'Apple',
  ISO: 200,
  Title: 'My Photo',
  Model: 'iPhone',
};

Deno.test('eq string match', () => {
  assertEquals(evalCondition('$Make eq Apple', tags), true);
  assertEquals(evalCondition('$Make eq Google', tags), false);
});

Deno.test('ne string', () => {
  assertEquals(evalCondition('$Make ne Google', tags), true);
  assertEquals(evalCondition('$Make ne Apple', tags), false);
});

Deno.test('numeric gt and le', () => {
  assertEquals(evalCondition('$ISO > 100', tags), true);
  assertEquals(evalCondition('$ISO > 200', tags), false);
  assertEquals(evalCondition('$ISO <= 200', tags), true);
  assertEquals(evalCondition('$ISO <= 199', tags), false);
});

Deno.test('numeric comparison coerces numeric strings on both sides', () => {
  assertEquals(evalCondition('$ISO > 199.5', tags), true);
});

Deno.test('non-numeric actual value falls back to string compare', () => {
  // 'iPhone' does not coerce; string comparison: 'iPhone' > '99'
  assertEquals(evalCondition('$Model > 99', tags), true);
  // 'Apple' < 'B'
  assertEquals(evalCondition('$Make < B', tags), true);
});

Deno.test('quoted value with spaces', () => {
  assertEquals(evalCondition("$Title eq 'My Photo'", tags), true);
  assertEquals(evalCondition("$Title eq 'Other Photo'", tags), false);
});

Deno.test('missing tag yields false even for ne', () => {
  assertEquals(evalCondition('$Missing eq x', tags), false);
  assertEquals(evalCondition('$Missing ne x', tags), false);
});

Deno.test('case-insensitive tag lookup', () => {
  assertEquals(evalCondition('$make eq Apple', tags), true);
  assertEquals(evalCondition('$iso > 150', tags), true);
});

Deno.test('leading/trailing whitespace tolerated', () => {
  assertEquals(evalCondition('  $ISO   >   50  ', tags), true);
  assertEquals(evalCondition("  $Title eq 'My Photo'  ", tags), true);
});

Deno.test('malformed expression returns false', () => {
  assertEquals(evalCondition('no dollar sign eq x', tags), false);
});
