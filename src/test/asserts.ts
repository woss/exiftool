import { expect } from 'vitest';

/**
 * Minimal assertion surface mirroring @std/assert semantics, backed by
 * vitest expectations so the suite runs under Node without Deno std libs.
 */

/** Truthiness assertion. */
export function assert(cond: unknown, msg = 'Expected value to be truthy'): asserts cond {
  if (!cond) throw new Error(msg);
}

/** Deep equality (NaN equal to NaN, structurally compared objects). */
export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  expect(actual, msg).toEqual(expected);
}
