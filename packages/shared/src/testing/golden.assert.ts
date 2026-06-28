/**
 * Pont entre le comparateur golden (pur) et Vitest.
 * Importe `expect` de Vitest ; a n utiliser que dans du code de test.
 */
import { expect } from 'vitest';

import { compareGolden, formatGoldenDiffs, type GoldenCompareOptions } from './golden.js';

/**
 * Assertion golden : echoue avec un message detaille (champ par champ) si la
 * sortie `actual` s ecarte de la reference `expected` au-dela de la tolerance.
 */
export function expectGolden(
  actual: unknown,
  expected: unknown,
  opts: GoldenCompareOptions = {},
): void {
  const result = compareGolden(expected, actual, opts);
  if (!result.equal) {
    throw new Error(
      `Sortie non conforme a la reference golden :\n${formatGoldenDiffs(result.diffs)}`,
    );
  }
  // Marqueur explicite pour le runner (le throw ci-dessus est la vraie porte).
  expect(result.equal).toBe(true);
}
