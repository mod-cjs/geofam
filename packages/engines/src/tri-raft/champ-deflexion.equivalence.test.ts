/**
 * TRI-RAFT (DKT) — HEATMAP DE DEFLEXION (`output.champDeflexion`, décision 14/07).
 *
 * Le champ de déflexion aux nœuds du MAILLAGE TRIANGULAIRE est ré-échantillonné sur une
 * grille ≤48×48 DÉCOUPLÉE de ce maillage (IDW + masque contour) : on expose le MOTIF (le
 * RÉSULTAT), JAMAIS le rendu triangulé, les coordonnées `P`, la connectivité `tris`, ni la
 * densité `N`/`nt` (la MÉTHODE — décision design-sûr 04/07 + titulaire 14/07).
 *
 * Barrières :
 *   1. PRÉSENCE : grille 48×48 remplie (leçon mémoire : `R.w` = Float64Array — accepté).
 *   2. BORNE INDÉPENDANTE (HTML piloté, anti auto-référence) : la grille (IDW = combinaison
 *      convexe) ∈ [min, max] du champ nodal `w` lu DIRECTEMENT sur le R du HTML d'origine.
 *   3. §8 : la sortie ne contient NI `P`/`tris`/`nodeX`… NI aucun tableau numérique hors la
 *      grille ≤48×48 (aucune topologie triangulaire ne fuit).
 *
 * Gate LOCAL : SKIP BRUYANT si la source HTML est absente (CI). @science-unsigned.
 */
import { describe, expect, it } from 'vitest';

import { loadOriginalCompute, triRaftSourceAvailable } from './equivalence-harness.js';
import { TRI_RAFT_FIXTURES } from './test-fixtures.js';

import { runTriRaft } from './index.js';

const fx = (id: string) => {
  const f = TRI_RAFT_FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`fixture "${id}" introuvable`);
  return f;
};

interface Grid {
  cols: number;
  rows: number;
  vals: (number | null)[];
  vMin: number;
  vMax: number;
}

interface FoundArray {
  path: string;
  numeric: boolean;
  length: number;
}
function collectArrays(value: unknown, path: string, acc: FoundArray[]): void {
  if (Array.isArray(value)) {
    acc.push({
      path,
      numeric: value.some((v) => typeof v === 'number'),
      length: value.length,
    });
    value.forEach((v, i) => collectArrays(v, `${path}[${i}]`, acc));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      collectArrays(v, path ? `${path}.${k}` : k, acc);
    }
  }
}

describe('tri-raft — heatmap de déflexion : présence + §8 (aucune topologie triangulaire)', () => {
  for (const f of TRI_RAFT_FIXTURES.filter((x) => !x.horsDomaine)) {
    it(`[${f.id}] grille 48×48 remplie + AUCUN tableau nodal/topologie ne fuit`, () => {
      const env = runTriRaft(f.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const cd = (env.output as unknown as { champDeflexion?: Grid }).champDeflexion;
      expect(cd, 'champDeflexion présent (R.w Float64Array accepté)').toBeDefined();
      if (!cd) return;
      expect(cd.cols).toBe(48);
      expect(cd.rows).toBe(48);
      expect(cd.vals.length).toBe(48 * 48);
      expect(cd.vals.some((v) => v != null)).toBe(true);
      // §8 : aucune clé de topologie triangulaire ; seul tableau numérique = la grille.
      const serial = JSON.stringify(env.output);
      expect(serial).not.toMatch(/"(P|tris|nodeX|nodeY|N|nt|w|p)"\s*:/);
      const arrays: FoundArray[] = [];
      collectArrays(env.output, '', arrays);
      for (const a of arrays.filter((x) => x.numeric)) {
        expect(a.path, `tableau numérique inattendu en ${a.path}`).toBe(
          'champDeflexion.vals',
        );
        expect(a.length).toBeLessThanOrEqual(48 * 48);
      }
    });
  }
});

const SOURCE_OK = triRaftSourceAvailable();

describe('tri-raft — heatmap ∈ champ nodal du HTML d origine (@science-unsigned)', () => {
  if (!SOURCE_OK) {
    const msg =
      '[14/07] source GEOPLAQUE_V10.html ABSENTE : borne HTML NON vérifiée — gate LOCAL. ' +
      'Ce skip n est PAS un succès.';
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`borne HTML NON vérifiée (source absente) — ${msg}`, () => {});
    return;
  }

  const { computeHtml, cleanup } = loadOriginalCompute();
  const nums = (o: unknown): number[] =>
    o && typeof o === 'object'
      ? (Object.values(o as Record<string, number>) as number[])
      : [];

  for (const id of ['carre-charge-repartie-q', 'rect-charge-excentree']) {
    it(`[${id}] grille ∈ [min,max] du champ w nodal (borne indépendante, HTML piloté)`, () => {
      const input = fx(id).input;
      const R = computeHtml(input) as Record<string, unknown>;
      const env = runTriRaft(input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const cd = (env.output as unknown as { champDeflexion?: Grid }).champDeflexion;
      expect(cd).toBeDefined();
      if (!cd) return;
      const w = nums(R.w);
      expect(w.length).toBeGreaterThan(2);
      const nodalMin = Math.min(...w);
      const nodalMax = Math.max(...w);
      const span = Math.max(1e-9, nodalMax - nodalMin);
      // IDW = moyenne pondérée -> la grille ne peut sortir de l'étendue nodale.
      expect(cd.vMin).toBeGreaterThanOrEqual(nodalMin - 1e-6 * span);
      expect(cd.vMax).toBeLessThanOrEqual(nodalMax + 1e-6 * span);
      for (const v of cd.vals) {
        if (v == null) continue;
        expect(v).toBeGreaterThanOrEqual(nodalMin - 1e-6 * span);
        expect(v).toBeLessThanOrEqual(nodalMax + 1e-6 * span);
      }
    });
  }

  it('teardown jsdom', () => {
    cleanup();
    expect(true).toBe(true);
  });
});
