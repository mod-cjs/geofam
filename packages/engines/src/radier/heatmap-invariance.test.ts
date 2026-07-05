/**
 * §8 (passe de VERIFICATION adverse) — la heatmap ne doit PAS reveler le maillage EF.
 *
 * Le 1er correctif basait lissage/masque sur la cellule d'affichage, mais (a) le masque
 * restait la distance au NŒUD le plus proche -> le bord epousait le placement des nœuds,
 * (b) le lissage a eps FIXE laissait transparaitre la trame nodale a maillage grossier.
 * Correctif : masque point-DANS-POLYGONE (contour saisi) + eps plancher a l'espacement
 * nodal. Cette sentinelle prouve l'INVARIANCE du BORD au maillage : a contour identique,
 * le MOTIF de masque (cellules nulles) est le MEME quel que soit `mesh` -> le pas EF n'est
 * plus inferable par balayage du maillage. (Le champ converge : valeurs proches, non figees.)
 */

import { describe, it, expect } from 'vitest';

import { runRadier } from './index.js';

type HM = { cols: number; rows: number; vals: (number | null)[] };
const model = (mesh: number) => ({
  rafts: [{ pts: [ { x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 0, y: 4 } ], E: 30000, nu: 0.2, e: 0.4 }],
  areaLoads: [{ x1: 0, y1: 0, x2: 6, y2: 4, q: 50, on: 'raft' }],
  layers: [{ zBase: 10, E: 8, nu: 0.33 }],
  opts: { mesh },
});

function heat(mesh: number): HM {
  const env = runRadier(model(mesh));
  expect(env.ok).toBe(true);
  if (!env.ok) throw new Error('calcul echoue');
  const hm = (env.output as { champDeflexion?: HM }).champDeflexion;
  expect(hm).toBeTruthy();
  return hm as HM;
}

describe('radier heatmap — invariance du bord au maillage (§8 anti-inference)', () => {
  it('le MOTIF de masque (cellules nulles) est identique a mesh 0,3 et 0,6', () => {
    const fin = heat(0.3);
    const gros = heat(0.6);
    expect(fin.cols).toBe(gros.cols);
    expect(fin.rows).toBe(gros.rows);
    // Bord independant du maillage : mask(mesh=0.3) === mask(mesh=0.6) cellule a cellule.
    const maskFin = fin.vals.map((v) => v === null);
    const maskGros = gros.vals.map((v) => v === null);
    expect(maskFin).toEqual(maskGros);
    // Au moins une cellule remplie ET une masquee (le test n'est pas trivialement vrai).
    expect(maskFin.some((m) => m)).toBe(true);
    expect(maskFin.some((m) => !m)).toBe(true);
  });

  it('le champ CONVERGE (valeurs proches entre maillages, pas une trame figee)', () => {
    const fin = heat(0.3);
    const gros = heat(0.6);
    let n = 0, maxRel = 0;
    const span = Math.max(...fin.vals.filter((v): v is number => v !== null).map(Math.abs), 1e-9);
    for (let i = 0; i < fin.vals.length; i++) {
      const a = fin.vals[i], b = gros.vals[i];
      if (a === null || a === undefined || b === null || b === undefined) continue;
      maxRel = Math.max(maxRel, Math.abs(a - b) / span);
      n++;
    }
    expect(n).toBeGreaterThan(100);
    expect(maxRel).toBeLessThan(0.15); // champ physiquement stable entre maillages
  });
});
