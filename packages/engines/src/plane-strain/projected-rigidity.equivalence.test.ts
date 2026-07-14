/**
 * DEFORMATIONS PLANES — SORTIE PROJETEE : rigidite de flexion `D = EI` (ADR 0014).
 *
 * Grandeur que le handler `#ps-run` du HTML affiche EN PERMANENCE (« Rigidite D
 * (E·e³/12(1−ν²)) »). Forme fermee des entrees E/e/ν, PAS un intermediaire de maillage.
 * On prouve son EQUIVALENCE au HTML d'origine piloté (provenance = HTML) sur >= 2 fixtures.
 * Gate LOCAL : SKIP BRUYANT si la source est absente (CI). @science-unsigned.
 */
import { describe, expect, it } from 'vitest';

import {
  loadOriginalCompute,
  planeStrainSourceAvailable,
} from './equivalence-harness.js';
import { PLANE_STRAIN_FIXTURES } from './test-fixtures.js';

import { runPlaneStrain } from './index.js';

function closeTo(actual: number, expected: number, rel = 1e-8, abs = 1e-9): boolean {
  return Math.abs(actual - expected) <= abs + rel * Math.abs(expected);
}

const SOURCE_OK = planeStrainSourceAvailable();

describe('plane-strain — rigidite EI projetée == HTML d origine (@science-unsigned)', () => {
  if (!SOURCE_OK) {
    const msg =
      '[ADR 0014] source GEOPLAQUE_V10.html ABSENTE : equivalence EI NON verifiee — ' +
      'gate LOCAL. Ce skip n est PAS un succes.';
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`equivalence EI NON verifiee (source absente) — ${msg}`, () => {});
    return;
  }

  const { computeHtml, cleanup } = loadOriginalCompute();
  const fx = (id: string) => {
    const f = PLANE_STRAIN_FIXTURES.find((x) => x.id === id);
    if (!f) throw new Error(`fixture "${id}" introuvable`);
    return f;
  };

  for (const id of ['bande-repartie', 'bande-lineique-centree']) {
    it(`[${id}] EI (rigidite D) == R.EI (HTML)`, () => {
      const input = fx(id).input;
      const R = computeHtml(input) as { EI: number };
      const env = runPlaneStrain(input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(
        closeTo(env.output.EI, R.EI),
        `EI : module=${env.output.EI} origine=${R.EI}`,
      ).toBe(true);
      // Aussi : D est bien la forme fermee E·e³/12(1−ν²) des entrees publiques.
      const { E, e, nu } = input.opts;
      const dClosed = (E * e * e * e) / (12 * (1 - nu * nu));
      expect(closeTo(env.output.EI, dClosed, 1e-6, 1e-6)).toBe(true);
    });
  }

  it('teardown jsdom', () => {
    cleanup();
    expect(true).toBe(true);
  });
});
