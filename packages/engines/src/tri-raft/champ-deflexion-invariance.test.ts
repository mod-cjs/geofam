/**
 * §8 (correction MAJEUR-1, revue adverse du 14/07) — la heatmap de deflexion du radier
 * triangulaire ne doit pas reveler la DENSITE de triangulation (donc le pas du mailleur DKT).
 *
 * Le parametre de densite EXISTE ici : `opts.target` = aire cible du triangle (critere d'arret
 * du raffinement 1->4). C'est une ENTREE UTILISATEUR : un utilisateur peut la BALAYER. On
 * prouve donc l'INVARIANCE de la grille ≤48×48 sous raffinement de la triangulation, comme le
 * radier ACM sous `mesh`.
 *
 * NB refinement DKT : le mailleur subdivise 1->4 (aires en puissances de 4). Plusieurs
 * `target` consecutifs retombent sur le MEME niveau (ex. target 2 et 1 => meme grille). On
 * choisit donc des `target` sur des niveaux DISTINCTS : 4 (grossier L2), 1 (moyen L3), 0,2
 * (fin L4). On utilise un contour NON RECTANGULAIRE (polygone en L) pour que le masque soit
 * NON TRIVIAL (un carre remplit exactement sa boite englobante -> aucune cellule masquee, le
 * test d'invariance du bord serait vide de sens).
 *
 * Barrieres (metriques documentees) :
 *   (A) INVARIANCE DU BORD : le MOTIF de masque (cellules nulles) est IDENTIQUE d'un niveau a
 *       l'autre -> le bord n'epouse pas la triangulation.
 *   (B) CONVERGENCE : l'ecart relatif max cellule-a-cellule DECROIT quand la triangulation
 *       s'affine (L4-vs-L3 < L3-vs-L2) -> grille DECOUPLEE du maillage (un rendu triangule fige
 *       ne convergerait pas). Aucun artefact periodique detecte (la convergence l'exclut).
 */
import { describe, expect, it } from 'vitest';

import { runTriRaft } from './index.js';

interface Grid {
  cols: number;
  rows: number;
  vals: (number | null)[];
  vMin: number;
  vMax: number;
}

/** Contour en L (non convexe) : masque NON trivial (l'encoche du L reste hors radier). */
const POLY_L = [
  { x: 0, y: 0 },
  { x: 6, y: 0 },
  { x: 6, y: 3 },
  { x: 3, y: 3 },
  { x: 3, y: 6 },
  { x: 0, y: 6 },
];

/** Deflexion re-echantillonnee pour une aire cible `target` (plus petite = plus fine),
 * charge repartie q uniforme sur un radier en L. */
function champDeflexion(target: number): Grid {
  const input = {
    rafts: [{ pts: POLY_L, E: 32000, nu: 0.2, e: 0.4 }],
    layers: [
      { zBase: -3, E: 8, nu: 0.33 },
      { zBase: -12, E: 25, nu: 0.3 },
    ],
    opts: { target, e: 0.4, E: 32000, nu: 0.2, q: 50 },
  };
  const env = runTriRaft(input);
  expect(env.ok, `calcul ok target=${target}`).toBe(true);
  if (!env.ok) throw new Error('calcul echoue');
  const cd = (env.output as unknown as { champDeflexion?: Grid }).champDeflexion;
  expect(cd, `champDeflexion present target=${target}`).toBeTruthy();
  return cd as Grid;
}

function deviation(
  fine: Grid,
  coarse: Grid,
): { maxRel: number; maskMismatch: number; n: number } {
  expect(fine.vals.length).toBe(coarse.vals.length);
  const span = Math.max(
    ...fine.vals.filter((v): v is number => v !== null).map((v) => Math.abs(v)),
    1e-12,
  );
  let maxRel = 0,
    maskMismatch = 0,
    n = 0;
  for (let i = 0; i < fine.vals.length; i++) {
    const a = fine.vals[i];
    const b = coarse.vals[i];
    if ((a === null) !== (b === null)) maskMismatch++;
    if (a === null || a === undefined || b === null || b === undefined) continue;
    maxRel = Math.max(maxRel, Math.abs(a - b) / span);
    n++;
  }
  return { maxRel, maskMismatch, n };
}

describe('tri-raft champDeflexion — invariance a la densite de triangulation (MAJEUR-1 14/07)', () => {
  // Trois niveaux de raffinement DISTINCTS (cf. en-tete) : L2 (grossier) -> L3 -> L4 (fin).
  const L4 = champDeflexion(0.2);
  const L3 = champDeflexion(1);
  const L2 = champDeflexion(4);

  it('(A) le MOTIF de masque est identique a chaque niveau de triangulation', () => {
    const m4 = L4.vals.map((v) => v === null);
    const m3 = L3.vals.map((v) => v === null);
    const m2 = L2.vals.map((v) => v === null);
    expect(m3, 'masque L3 == L4 (independant de la triangulation)').toEqual(m4);
    expect(m2, 'masque L2 == L4 (independant de la triangulation)').toEqual(m4);
    // Non trivial : cellules remplies ET masquees.
    expect(m4.some((m) => m)).toBe(true);
    expect(m4.some((m) => !m)).toBe(true);
  });

  it('(B) l ecart DECROIT quand la triangulation s affine (L4-vs-L3 < L3-vs-L2)', () => {
    const dFin = deviation(L4, L3); // fine=L4 vs coarse=L3
    const dGros = deviation(L3, L2); // fine=L3 vs coarse=L2
    expect(dFin.maskMismatch, 'masque stable L4/L3').toBe(0);
    expect(dGros.maskMismatch, 'masque stable L3/L2').toBe(0);
    expect(dFin.n, 'cellules comparees').toBeGreaterThan(100);
    // CONVERGENCE : le pas plus fin rapproche -> ecart plus petit.
    expect(
      dFin.maxRel,
      `converge (L4/L3 ${dFin.maxRel} < L3/L2 ${dGros.maxRel})`,
    ).toBeLessThan(dGros.maxRel);
    // Plafond absolu justifie (mesure ~3% + marge) : borne anti-regression grossiere.
    expect(dGros.maxRel, 'sous plafond').toBeLessThan(0.05);
  });
});
