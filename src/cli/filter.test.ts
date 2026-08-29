import { test } from 'vitest';
import { assertEquals } from '../../src/test/asserts.js';
import { evalCondition } from './filter.js';
import type { TagValue } from '../types.js';

const tags: Record<string, TagValue> = {
  Make: 'Apple',
  ISO: 200,
  Title: 'My Photo',
  Model: 'iPhone',
};

test('eq string match', () => {
  assertEquals(evalCondition('$Make eq Apple', tags), true);
  assertEquals(evalCondition('$Make eq Google', tags), false);
});

test('ne string', () => {
  assertEquals(evalCondition('$Make ne Google', tags), true);
  assertEquals(evalCondition('$Make ne Apple', tags), false);
});

test('numeric gt and le', () => {
  assertEquals(evalCondition('$ISO > 100', tags), true);
  assertEquals(evalCondition('$ISO > 200', tags), false);
  assertEquals(evalCondition('$ISO <= 200', tags), true);
  assertEquals(evalCondition('$ISO <= 199', tags), false);
});

test('numeric comparison coerces numeric strings on both sides', () => {
  assertEquals(evalCondition('$ISO > 199.5', tags), true);
});

test('non-numeric actual value falls back to string compare', () => {
  // 'iPhone' does not coerce; string comparison: 'iPhone' > '99'
  assertEquals(evalCondition('$Model > 99', tags), true);
  // 'Apple' < 'B'
  assertEquals(evalCondition('$Make < B', tags), true);
});

test('quoted value with spaces', () => {
  assertEquals(evalCondition("$Title eq 'My Photo'", tags), true);
  assertEquals(evalCondition("$Title eq 'Other Photo'", tags), false);
});

test('missing tag yields false even for ne', () => {
  assertEquals(evalCondition('$Missing eq x', tags), false);
  assertEquals(evalCondition('$Missing ne x', tags), false);
});

test('case-insensitive tag lookup', () => {
  assertEquals(evalCondition('$make eq Apple', tags), true);
  assertEquals(evalCondition('$iso > 150', tags), true);
});

test('leading/trailing whitespace tolerated', () => {
  assertEquals(evalCondition('  $ISO   >   50  ', tags), true);
  assertEquals(evalCondition("  $Title eq 'My Photo'  ", tags), true);
});

test('malformed expression returns false', () => {
  assertEquals(evalCondition('no dollar sign eq x', tags), false);
});

test('ge operator', () => {
  assertEquals(evalCondition('$ISO >= 200', tags), true);
  assertEquals(evalCondition('$ISO >= 201', tags), false);
});

test('empty value coerces to undefined and falls back to string compare', () => {
  assertEquals(evalCondition("$Make eq ''", tags), false);
  assertEquals(evalCondition("$Make ne ''", tags), true);
});

test('Uint8Array tag values compare as empty string', () => {
  const withBinary: Record<string, TagValue> = { ...tags, Thumb: new Uint8Array([1, 2, 3]) };
  assertEquals(evalCondition('$Thumb eq x', withBinary), false);
  assertEquals(evalCondition('$Thumb ne x', withBinary), true);
});

test('array tag values compare as comma-joined string', () => {
  const withArray: Record<string, TagValue> = { ...tags, Keywords: ['nature', 'sun'] };
  assertEquals(evalCondition('$Keywords eq nature, sun', withArray), true);
  assertEquals(evalCondition('$Keywords eq nature sun', withArray), false);
});
