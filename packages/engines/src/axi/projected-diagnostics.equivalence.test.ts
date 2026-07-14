/**
 * AXI — SORTIE PROJETEE : resultante `sumReact` + tassement differentiel `diff` (ADR 0014).
 *
 * Deux grandeurs GLOBALES que le handler `#ax-run` du HTML affiche (« Tassement
 * differentiel », « Charge / reaction Σ »). On prouve leur EQUIVALENCE au HTML d'origine
 * piloté (provenance = HTML, jamais notre module) sur >= 2 fixtures. `diff` est la derivee
 * `wMax − wMin` (comme le client). Gate LOCAL : SKIP BRUYANT si la source est absente (CI).
 * @science-unsigned : prouve le PORTAGE, pas la justesse scientifique.
 */
import { describe, expect, it } from 'vitest';

import { axiSourceAvailable, loadOriginalCompute } from './equivalence-harness.js';
import { AXI_FIXTURES } from './test-fixtures.js';

import { runAxi } from './index.js';

function closeTo(actual: number, expected: number, rel = 1e-8, abs = 1e-9): boolean {
  return Math.abs(actual - expected) <= abs + rel * Math.abs(expected);
}

const SOURCE_OK = axiSourceAvailable();

describe('axi — sumReact / diff projetes == HTML d origine (@science-unsigned)', () => {
  if (!SOURCE_OK) {
    const msg =
      '[ADR 0014] source GEOPLAQUE_V10.html ABSENTE : equivalence sumReact/diff NON ' +
      'verifiee — gate LOCAL. Ce skip n est PAS un succes.';
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`equivalence NON verifiee (source absente) — ${msg}`, () => {});
    return;
  }

  const { computeHtml, cleanup } = loadOriginalCompute();
  const fx = (id: string) => {
    const f = AXI_FIXTURES.find((x) => x.id === id);
    if (!f) throw new Error(`fixture "${id}" introuvable`);
    return f;
  };

  for (const id of ['q-reparti-2couches', 'q-plus-pc-combinees']) {
    it(`[${id}] sumReact == R.sumReact et diff == wMax−wMin (HTML)`, () => {
      const input = fx(id).input;
      const R = computeHtml(input) as { sumReact: number; wMax: number; wMin: number };
      const env = runAxi(input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(closeTo(env.output.sumReact, R.sumReact), `sumReact`).toBe(true);
      expect(closeTo(env.output.diff, R.wMax - R.wMin), `diff`).toBe(true);
    });
  }

  it('teardown jsdom', () => {
    cleanup();
    expect(true).toBe(true);
  });
});
