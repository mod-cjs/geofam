/**
 * AXI — PROFILS RADIAUX RE-ECHANTILLONNES (`output.profils`, décision 14/07).
 *
 * Mêmes trois barrières que plane-strain : présence + méta (tracé `axiPlot` du client),
 * borne indépendante (valeur interpolée ∈ [min,max] nodal du R HTML), équivalence vs
 * `resampleProfile` appliqué au R du HTML piloté. 4 champs : deflexion/momentR/momentT/
 * reaction en fonction du rayon `r`. Gate LOCAL. @science-unsigned.
 */
import { describe, expect, it } from 'vitest';

import { axiSourceAvailable, loadOriginalCompute } from './equivalence-harness.js';
import { AXI_FIXTURES } from './test-fixtures.js';

import { resampleProfile, runAxi } from './index.js';

const fx = (id: string) => {
  const f = AXI_FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`fixture "${id}" introuvable`);
  return f;
};

const SPECS = [
  ['deflexion', 'w', 'tassement w', 'mm'],
  ['momentR', 'Mr', 'moment M_r', 'kN·m/m'],
  ['momentT', 'Mt', 'moment M_t', 'kN·m/m'],
  ['reaction', 'p', 'réaction p', 'kPa'],
] as const;

interface Prof {
  x: number[];
  v: number[];
  unit: string;
  label: string;
}

describe('axi — profils radiaux : présence + libellés/unités (axiPlot client)', () => {
  it('given un dallage chargé, when runAxi, then 4 profils émis (97 points)', () => {
    const env = runAxi(fx('q-reparti-2couches').input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const profils = (env.output as unknown as { profils?: Record<string, Prof> }).profils;
    expect(profils, 'output.profils présent').toBeDefined();
    if (!profils) return;
    for (const [key, , label, unit] of SPECS) {
      const p = profils[key];
      expect(p, `profil « ${key} » présent`).toBeDefined();
      if (!p) continue;
      expect(p.x.length).toBe(97);
      expect(p.v.length).toBe(97);
      expect(p.label).toBe(label);
      expect(p.unit).toBe(unit);
      for (let i = 1; i < p.x.length; i++) expect(p.x[i]!).toBeGreaterThan(p.x[i - 1]!);
    }
  });
});

const SOURCE_OK = axiSourceAvailable();

describe('axi — profils radiaux == champs du HTML d origine (@science-unsigned)', () => {
  if (!SOURCE_OK) {
    const msg =
      '[14/07] source GEOPLAQUE_V10.html ABSENTE : équivalence profils axi NON vérifiée — ' +
      'gate LOCAL. Ce skip n est PAS un succès.';
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`équivalence profils axi NON vérifiée (source absente) — ${msg}`, () => {});
    return;
  }

  const { computeHtml, cleanup } = loadOriginalCompute();
  const nums = (o: unknown): number[] =>
    o && typeof o === 'object'
      ? (Object.values(o as Record<string, number>) as number[])
      : [];

  for (const id of ['q-reparti-2couches', 'q-plus-pc-combinees']) {
    it(`[${id}] chaque profil ∈ [min,max] nodal (borne indép.) ET == resample(HTML)`, () => {
      const input = fx(id).input;
      const R = computeHtml(input) as Record<string, unknown>;
      const env = runAxi(input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const profils = (env.output as unknown as { profils?: Record<string, Prof> })
        .profils;
      expect(profils).toBeDefined();
      if (!profils) return;
      const r = nums(R.r);
      let worstAbs = 0;
      for (const [key, srcKey, label, unit] of SPECS) {
        const p = profils[key];
        expect(p, `profil ${key}`).toBeDefined();
        if (!p) continue;
        const field = nums(R[srcKey]);
        const nodalMin = Math.min(...field);
        const nodalMax = Math.max(...field);
        const span = Math.max(1e-9, nodalMax - nodalMin);
        for (const v of p.v) {
          expect(v).toBeGreaterThanOrEqual(nodalMin - 1e-6 * span);
          expect(v).toBeLessThanOrEqual(nodalMax + 1e-6 * span);
        }
        expect(Math.abs(p.x[0]! - Math.min(...r))).toBeLessThan(1e-9);
        expect(Math.abs(p.x[96]! - Math.max(...r))).toBeLessThan(1e-9);
        const attendu = resampleProfile(r, field, label, unit)!;
        for (let i = 0; i < p.v.length; i++) {
          worstAbs = Math.max(worstAbs, Math.abs(p.v[i]! - attendu.v[i]!));
        }
      }
      expect(worstAbs, `erreur absolue max point vs HTML = ${worstAbs}`).toBeLessThan(
        1e-6,
      );
    });
  }

  it('teardown jsdom', () => {
    cleanup();
    expect(true).toBe(true);
  });
});
