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

type HM = {
  cols: number;
  rows: number;
  vals: (number | null)[];
  vMin: number;
  vMax: number;
};
const model = (mesh: number) => ({
  rafts: [
    {
      pts: [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
        { x: 6, y: 4 },
        { x: 0, y: 4 },
      ],
      E: 30000,
      nu: 0.2,
      e: 0.4,
    },
  ],
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
    let n = 0,
      maxRel = 0;
    const span = Math.max(
      ...fin.vals.filter((v): v is number => v !== null).map(Math.abs),
      1e-9,
    );
    for (let i = 0; i < fin.vals.length; i++) {
      const a = fin.vals[i],
        b = gros.vals[i];
      if (a === null || a === undefined || b === null || b === undefined) continue;
      maxRel = Math.max(maxRel, Math.abs(a - b) / span);
      n++;
    }
    expect(n).toBeGreaterThan(100);
    expect(maxRel).toBeLessThan(0.15); // champ physiquement stable entre maillages
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXTENSION MAJEUR-1 (revue adverse du 14/07) — les blocs ci-dessus ne couvraient
// QUE `champDeflexion` (champ w). La sentinelle anti-inference de maillage est ici
// ETENDUE aux 9 cartes de `output.champs`, avec attention particuliere a `raideur`
// (kr = p/w, la plus « methode-adjacente » : division -> risque de pics pres de w≈0
// qui, mesh-dependants, rouvriraient un canal d'inference du pas EF).
//
// Ce que ces tests prouvent (metriques documentees) :
//   (A) INVARIANCE DU BORD : pour CHAQUE champ, le MOTIF de masque (cellules nulles)
//       est IDENTIQUE cellule-a-cellule a mesh 0,3 et 0,6 -> le bord n'epouse pas le
//       maillage (meme preuve que le bloc champDeflexion, generalisee).
//   (B) CONVERGENCE SOUS RAFFINEMENT (Richardson) : le plancher de maillage du moteur
//       est mesh=0,3 (verifie : mesh<=0,3 collapse sur la meme grille). On compare donc
//       la grille la PLUS FINE (0,3) a des grilles de plus en plus fines (coarse
//       0,6 -> 0,5 -> 0,4) : l'ecart relatif max DECROIT STRICTEMENT pour chaque champ.
//       Une carte qui « figerait » la trame nodale ne convergerait pas -> cette
//       decroissance monotone est la preuve que la grille est DECOUPLEE du maillage.
//   (C) `raideur` NE DIVERGE PAS pres de w≈0 : sous un cas de decollement/soulevement
//       (w change de signe, donc traverse 0), kr reste BORNE (O(10), pas O(1e6)) et ne
//       « spike » pas -> la crainte de la revue adverse (pics mesh-dependants de kr) N'EST
//       PAS realisee. Mesure et rapportee honnetement ci-dessous.

/** Les 9 cartes de `output.champs` (cle exposee). raideur = kr = p/w (cf. revue 14/07). */
const CHAMP_KEYS = [
  'deflexion',
  'reaction',
  'momentX',
  'momentY',
  'momentXY',
  'raideur',
  'pente',
  'rotationX',
  'rotationY',
] as const;

/** Plafonds d'ecart relatif JUSTIFIES (mesure a fine=0,3 vs coarse=0,6, le pire cas),
 * avec marge. Signes/explicites (anti faux-vert) : un comparateur laxiste masquerait une
 * regression de calcul. Les champs derives d'ordre eleve (reaction, momentXY, raideur =
 * p/w) sont naturellement plus bruites a maillage grossier -> plafond plus large. */
const CEIL_06: Record<(typeof CHAMP_KEYS)[number], number> = {
  deflexion: 0.05,
  reaction: 0.3,
  momentX: 0.2,
  momentY: 0.2,
  momentXY: 0.3,
  raideur: 0.3,
  pente: 0.2,
  rotationX: 0.25,
  rotationY: 0.15,
};

function champs(mesh: number): Record<string, HM> {
  const env = runRadier(model(mesh));
  expect(env.ok).toBe(true);
  if (!env.ok) throw new Error('calcul echoue');
  const c = (env.output as { champs?: Record<string, HM> }).champs;
  expect(c, 'output.champs present').toBeTruthy();
  return c as Record<string, HM>;
}

/** Ecart relatif max cellule-a-cellule (cellules communes non nulles), normalise par
 * l'etendue |val| de la grille FINE. Retourne aussi le nb de discordances de masque. */
function deviation(
  fine: HM,
  coarse: HM,
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

describe('radier cartes etendues (9 champs) — invariance du bord au maillage (MAJEUR-1 14/07)', () => {
  it('(A) pour CHAQUE champ, le MOTIF de masque est identique a mesh 0,3 et 0,6', () => {
    const fin = champs(0.3);
    const gros = champs(0.6);
    for (const k of CHAMP_KEYS) {
      const a = fin[k];
      const b = gros[k];
      expect(a, `carte ${k} presente (mesh 0,3)`).toBeTruthy();
      expect(b, `carte ${k} presente (mesh 0,6)`).toBeTruthy();
      if (!a || !b) continue;
      const maskFin = a.vals.map((v) => v === null);
      const maskGros = b.vals.map((v) => v === null);
      expect(maskFin, `masque du champ ${k} independant du maillage`).toEqual(maskGros);
      // Non trivial : au moins une cellule remplie ET une masquee.
      expect(
        maskFin.some((m) => m),
        `${k} a des cellules masquees`,
      ).toBe(true);
      expect(
        maskFin.some((m) => !m),
        `${k} a des cellules remplies`,
      ).toBe(true);
    }
  });
});

describe('radier cartes etendues (9 champs) — CONVERGENCE sous raffinement (Richardson)', () => {
  it('(B) l ecart a la grille fine (0,3) DECROIT STRICTEMENT quand la grille coarse s affine (0,6->0,5->0,4)', () => {
    const fine = champs(0.3);
    const g06 = champs(0.6);
    const g05 = champs(0.5);
    const g04 = champs(0.4);
    for (const k of CHAMP_KEYS) {
      const d06 = deviation(fine[k]!, g06[k]!);
      const d05 = deviation(fine[k]!, g05[k]!);
      const d04 = deviation(fine[k]!, g04[k]!);
      // Masque stable a chaque maillage (aucune discordance).
      expect(d06.maskMismatch, `${k}: masque stable 0,3 vs 0,6`).toBe(0);
      expect(d05.maskMismatch, `${k}: masque stable 0,3 vs 0,5`).toBe(0);
      expect(d04.maskMismatch, `${k}: masque stable 0,3 vs 0,4`).toBe(0);
      expect(d06.n, `${k}: cellules comparees`).toBeGreaterThan(100);
      // CONVERGENCE : l ecart decroit STRICTEMENT en affinant la grille coarse.
      // (Un artefact figeant le maillage ne convergerait pas -> ce test le detecterait.)
      expect(
        d05.maxRel,
        `${k}: converge 0,5<0,6 (${d05.maxRel} < ${d06.maxRel})`,
      ).toBeLessThan(d06.maxRel);
      expect(
        d04.maxRel,
        `${k}: converge 0,4<0,5 (${d04.maxRel} < ${d05.maxRel})`,
      ).toBeLessThan(d05.maxRel);
      // Plafond absolu justifie (mesure + marge) : borne haute anti-regression grossiere.
      expect(d06.maxRel, `${k}: sous plafond ${CEIL_06[k]}`).toBeLessThan(CEIL_06[k]);
    }
  });
});

describe('radier raideur (kr=p/w) — NE DIVERGE PAS pres de w≈0 (crainte revue adverse 14/07)', () => {
  // Cas de DECOLLEMENT / soulevement : charge ponctuelle forte tres excentree -> une partie
  // du radier se souleve, w change de signe (traverse 0). Si kr=p/w « spikait » pres de w≈0,
  // la carte raideur exploserait (O(1e6)) et bougerait avec le maillage. On PROUVE le contraire.
  const eccModel = (mesh: number) => ({
    rafts: [
      {
        pts: [
          { x: 0, y: 0 },
          { x: 6, y: 0 },
          { x: 6, y: 4 },
          { x: 0, y: 4 },
        ],
        E: 30000,
        nu: 0.2,
        e: 0.4,
      },
    ],
    pointLoads: [{ x: 0.4, y: 0.4, Fz: 4000 }],
    layers: [{ zBase: 10, E: 8, nu: 0.33 }],
    opts: { mesh, decol: true },
  });

  it('(C) sous soulevement (w traverse 0), raideur reste BORNEE et deflexion change de signe', () => {
    for (const mesh of [0.3, 0.4, 0.5, 0.6]) {
      const env = runRadier(eccModel(mesh));
      expect(env.ok, `calcul ok mesh=${mesh}`).toBe(true);
      if (!env.ok) continue;
      const c = (env.output as { champs?: Record<string, HM> }).champs;
      expect(c, `champs presents mesh=${mesh}`).toBeTruthy();
      if (!c) continue;
      const kr = c.raideur;
      const w = c.deflexion;
      expect(kr, `raideur presente mesh=${mesh}`).toBeTruthy();
      expect(w, `deflexion presente mesh=${mesh}`).toBeTruthy();
      if (!kr || !w) continue;
      // La deflexion traverse 0 (soulevement) : min<0<max -> w passe bien pres de 0.
      expect(w.vMin, `deflexion negative (soulevement) mesh=${mesh}`).toBeLessThan(0);
      expect(w.vMax, `deflexion positive mesh=${mesh}`).toBeGreaterThan(0);
      // raideur RESTE BORNEE : aucun pic O(1e6) pres de w≈0. Marge enorme (obs. ~O(10)).
      // Si un jour kr divergeait vraiment, ce plafond sauterait -> finding a remonter (pas
      // a relacher en douce). C'est l'arbitre de la crainte de la revue adverse.
      expect(Math.abs(kr.vMin), `|raideur.vMin| borne mesh=${mesh}`).toBeLessThan(1e3);
      expect(Math.abs(kr.vMax), `|raideur.vMax| borne mesh=${mesh}`).toBeLessThan(1e3);
      expect(Number.isFinite(kr.vMin) && Number.isFinite(kr.vMax)).toBe(true);
    }
  });
});
