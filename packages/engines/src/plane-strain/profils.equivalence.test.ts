/**
 * DEFORMATIONS PLANES — PROFILS RE-ECHANTILLONNES (`output.profils`, décision 14/07).
 *
 * Trois barrières :
 *   1. PRÉSENCE + méta : deflexion/moment/reaction présents, 97 points fixes, `unit`/`label`
 *      == tracé `psPlot` du client ; abscisses régulières bornées à [X0, Xn] (leçon mémoire :
 *      champs nodaux = Float64Array — la garde les accepte).
 *   2. BORNE INDÉPENDANTE (anti auto-référence) : chaque valeur interpolée ∈ [min, max] du
 *      champ nodal SOURCE lu DIRECTEMENT sur le R du HTML piloté (interpolation linéaire =
 *      convexe → bornée) — attrape un champ inversé/gonflé sans dépendre de notre resample.
 *   3. ÉQUIVALENCE vs HTML : le profil projeté du module == `resampleProfile` appliqué au R
 *      du HTML d'origine (provenance HTML). MÉTRIQUE : erreur absolue max point-à-point
 *      (module R == HTML R prouvé par engine.equivalence → écart attendu ~1e-9).
 *
 * Gate LOCAL : SKIP BRUYANT si la source HTML est absente (CI). @science-unsigned.
 */
import { describe, expect, it } from 'vitest';

import {
  loadOriginalCompute,
  planeStrainSourceAvailable,
} from './equivalence-harness.js';
import { PLANE_STRAIN_FIXTURES } from './test-fixtures.js';

import { resampleProfile, runPlaneStrain } from './index.js';

const fx = (id: string) => {
  const f = PLANE_STRAIN_FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`fixture "${id}" introuvable`);
  return f;
};

const SPECS = [
  ['deflexion', 'w', 'tassement w', 'mm'],
  ['moment', 'M', 'moment M', 'kN·m/m'],
  ['reaction', 'p', 'réaction p', 'kPa'],
] as const;

interface Prof {
  x: number[];
  v: number[];
  unit: string;
  label: string;
}

describe('plane-strain — profils : présence + libellés/unités (psPlot client)', () => {
  it('given une coupe chargée, when runPlaneStrain, then 3 profils émis (97 points)', () => {
    const env = runPlaneStrain(fx('bande-repartie').input);
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
      // Abscisses régulières strictement croissantes.
      for (let i = 1; i < p.x.length; i++) expect(p.x[i]!).toBeGreaterThan(p.x[i - 1]!);
    }
  });
});

const SOURCE_OK = planeStrainSourceAvailable();

describe('plane-strain — profils == champs du HTML d origine (@science-unsigned)', () => {
  if (!SOURCE_OK) {
    const msg =
      '[14/07] source GEOPLAQUE_V10.html ABSENTE : équivalence profils NON vérifiée — ' +
      'gate LOCAL. Ce skip n est PAS un succès.';
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`équivalence profils NON vérifiée (source absente) — ${msg}`, () => {});
    return;
  }

  const { computeHtml, cleanup } = loadOriginalCompute();
  const nums = (o: unknown): number[] =>
    o && typeof o === 'object'
      ? (Object.values(o as Record<string, number>) as number[])
      : [];

  for (const id of ['bande-repartie', 'bande-lineique-centree']) {
    it(`[${id}] chaque profil est dans [min,max] nodal (borne indép.) ET == resample(HTML)`, () => {
      const input = fx(id).input;
      const R = computeHtml(input) as Record<string, unknown>;
      const env = runPlaneStrain(input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const profils = (env.output as unknown as { profils?: Record<string, Prof> })
        .profils;
      expect(profils).toBeDefined();
      if (!profils) return;
      const X = nums(R.X);
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
        // Endpoints alignés sur l'étendue de la coupe.
        expect(Math.abs(p.x[0]! - Math.min(...X))).toBeLessThan(1e-9);
        expect(Math.abs(p.x[96]! - Math.max(...X))).toBeLessThan(1e-9);
        // Équivalence vs resample du champ HTML piloté.
        const attendu = resampleProfile(X, field, label, unit)!;
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
