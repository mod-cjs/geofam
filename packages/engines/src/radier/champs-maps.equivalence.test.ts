/**
 * RADIER — CARTES ETENDUES (`output.champs`, décision titulaire 14/07) : 9 champs
 * cartographiés par l'outil client, chacun ré-échantillonné ≤48×48 (patron design-sûr).
 *
 * Trois barrières :
 *   1. PRÉSENCE + méta : chaque champ présent, grille 48×48, `unit`/`label` == boutons de
 *      cartes du client (data-f de refreshResults). Leçon mémoire : les champs nodaux sont
 *      des Float64Array — la garde doit les accepter (tests positifs par champ).
 *   2. BORNE INDÉPENDANTE (anti auto-référence) : la grille (IDW = combinaison convexe des
 *      valeurs nodales) est STRICTEMENT dans [min, max] du champ nodal SOURCE lu DIRECTEMENT
 *      sur le R du HTML piloté (aucun ré-échantillonnage) — attrape un champ inversé ou
 *      gonflé, indépendamment de notre code de grille.
 *   3. ÉQUIVALENCE vs HTML : la grille projetée du module == `resampleField` appliqué au R
 *      du HTML d'origine (provenance HTML). MÉTRIQUE : erreur ABSOLUE max cellule-à-cellule
 *      sur les cellules non nulles (le ré-échantillonnage n'est pas comparé au rendu visuel
 *      du client mais au champ interne qu'il dessine — module R == HTML R prouvé par
 *      engine.equivalence, donc l'écart attendu est ~bruit flottant 1e-9).
 *
 * Gate LOCAL : SKIP BRUYANT si la source HTML est absente (CI). @science-unsigned.
 */
import { describe, expect, it } from 'vitest';

import { loadOriginalCompute, radierSourceAvailable } from './equivalence-harness.js';
import { RADIER_FIXTURES } from './test-fixtures.js';

import { resampleField, runRadier } from './index.js';

const fx = (id: string) => {
  const f = RADIER_FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`fixture "${id}" introuvable`);
  return f;
};

/** Les 9 cartes attendues : [clé sortie, champ nodal source, label bouton, unité]. */
const SPECS = [
  ['deflexion', 'w', 'Tassement', 'mm'],
  ['reaction', 'p', 'Réaction', 'kPa'],
  ['momentX', 'Mx', 'Moment Mx', 'kN·m/ml'],
  ['momentY', 'My', 'Moment My', 'kN·m/ml'],
  ['momentXY', 'Mxy', 'Moment Mxy', 'kN·m/ml'],
  ['raideur', 'kr', 'Coef. réaction', 'kPa/mm'],
  ['pente', 'slope', 'Distorsion |∇w|', '‰'],
  ['rotationX', 'tx', 'Rotation θx', '‰'],
  ['rotationY', 'ty', 'Rotation θy', '‰'],
] as const;

interface Grid {
  cols: number;
  rows: number;
  vals: (number | null)[];
  vMin: number;
  vMax: number;
  unit: string;
  label: string;
}

// ── Bloc 1 — présence + méta (SANS HTML) ───────────────────────────────────────────
describe('radier — cartes étendues : présence + libellés/unités (data-f client)', () => {
  it('given un radier chargé, when runRadier, then les 9 cartes sont émises (48×48)', () => {
    const env = runRadier(fx('carre-charge-centree').input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const champs = (env.output as unknown as { champs?: Record<string, Grid> }).champs;
    expect(champs, 'output.champs présent').toBeDefined();
    if (!champs) return;
    for (const [key, , label, unit] of SPECS) {
      const g = champs[key];
      expect(g, `carte « ${key} » présente (source Float64Array acceptée)`).toBeDefined();
      if (!g) continue;
      expect(g.cols).toBe(48);
      expect(g.rows).toBe(48);
      expect(g.vals.length).toBe(48 * 48);
      expect(
        g.vals.some((v) => v != null),
        `carte « ${key} » non vide`,
      ).toBe(true);
      expect(g.label).toBe(label);
      expect(g.unit).toBe(unit);
    }
  });

  it('champs.deflexion == champDeflexion (même grille, la carte étiquetée en est le miroir)', () => {
    const env = runRadier(fx('carre-charge-centree').input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const o = env.output as unknown as {
      champDeflexion?: { vals: (number | null)[] };
      champs?: Record<string, Grid>;
    };
    expect(o.champDeflexion?.vals).toEqual(o.champs?.deflexion?.vals);
  });
});

// ── Blocs 2 & 3 — bornes indépendantes + équivalence vs HTML (gate local) ───────────
const SOURCE_OK = radierSourceAvailable();

describe('radier — cartes étendues == champs du HTML d origine (@science-unsigned)', () => {
  if (!SOURCE_OK) {
    const msg =
      '[14/07] source GEOPLAQUE_V10.html ABSENTE : équivalence des cartes NON vérifiée — ' +
      'gate LOCAL. Ce skip n est PAS un succès.';
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`équivalence cartes NON vérifiée (source absente) — ${msg}`, () => {});
    return;
  }

  const { computeHtml, cleanup } = loadOriginalCompute();
  const nums = (o: unknown): number[] =>
    o && typeof o === 'object'
      ? (Object.values(o as Record<string, number>) as number[])
      : [];

  for (const id of ['carre-charge-centree', 'rect-charge-excentree']) {
    it(`[${id}] chaque carte est dans [min,max] nodal (borne indépendante) ET == resample(HTML)`, () => {
      const input = fx(id).input;
      const R = computeHtml(input) as Record<string, unknown>;
      const polys = input.rafts.map((r) => r.pts.map((p) => ({ x: p.x, y: p.y })));
      const env = runRadier(input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const champs = (env.output as unknown as { champs?: Record<string, Grid> }).champs;
      expect(champs).toBeDefined();
      if (!champs) return;
      const nodeX = nums(R.nodeX);
      const nodeY = nums(R.nodeY);

      let worstAbs = 0;
      for (const [key, srcKey] of SPECS) {
        const g = champs[key];
        expect(g, `carte ${key}`).toBeDefined();
        if (!g) continue;
        const field = nums(R[srcKey]);
        expect(field.length, `champ source ${srcKey} présent`).toBeGreaterThan(2);

        // (2) BORNE INDÉPENDANTE : IDW = moyenne pondérée -> valeurs ∈ [min,max] nodal.
        const nodalMin = Math.min(...field);
        const nodalMax = Math.max(...field);
        const span = Math.max(1e-9, nodalMax - nodalMin);
        expect(g.vMin, `${key}.vMin >= min nodal`).toBeGreaterThanOrEqual(
          nodalMin - 1e-6 * span,
        );
        expect(g.vMax, `${key}.vMax <= max nodal`).toBeLessThanOrEqual(
          nodalMax + 1e-6 * span,
        );

        // (3) ÉQUIVALENCE : grille projetée == resample appliqué au champ du HTML piloté.
        const attendu = resampleField(nodeX, nodeY, field, polys);
        expect(attendu, `resample HTML ${key}`).toBeDefined();
        if (!attendu) continue;
        expect(g.vals.length).toBe(attendu.vals.length);
        for (let i = 0; i < g.vals.length; i++) {
          const a = g.vals[i];
          const b = attendu.vals[i];
          // Même topologie de masque des deux côtés (null <-> null).
          expect(a == null).toBe(b == null);
          if (a != null && b != null) worstAbs = Math.max(worstAbs, Math.abs(a - b));
        }
      }
      // Métrique documentée : écart cellule-à-cellule ~ bruit flottant (module R == HTML R).
      expect(worstAbs, `erreur absolue max cellule vs HTML = ${worstAbs}`).toBeLessThan(
        1e-6,
      );
    });
  }

  it('teardown jsdom', () => {
    cleanup();
    expect(true).toBe(true);
  });
});
