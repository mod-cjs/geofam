/**
 * Anti-régression (audit adverse) — rejet des polygones de plaque DEGENERES.
 *
 * FAILLE trouvee (LOW) : un contour de radier AUTO-INTERSECTANT (bowtie) ou a
 * sommets ALIGNES etait accepte et produisait un resultat vide silencieux (wMax=0,
 * aucune erreur) — scellable dans un PV comme un calcul valide. Le schema doit
 * rejeter tout polygone d'aire (shoelace) quasi nulle.
 */

import { describe, it, expect } from 'vitest';

import { RadierInputSchema } from './contract.js';

const withPts = (pts: Array<{ x: number; y: number }>) => ({
  rafts: [{ pts, E: 30000, nu: 0.2, e: 0.4 }],
  areaLoads: [{ x1: 0, y1: 0, x2: 6, y2: 6, q: 50, on: 'raft' }],
  layers: [{ zBase: 10, E: 8, nu: 0.33 }],
  opts: { mesh: 0.5 },
});

const CARRE = [
  { x: 0, y: 0 },
  { x: 6, y: 0 },
  { x: 6, y: 6 },
  { x: 0, y: 6 },
];
const BOWTIE = [
  { x: 0, y: 0 },
  { x: 6, y: 6 },
  { x: 6, y: 0 },
  { x: 0, y: 6 },
]; // aire shoelace = 0
const COLLINEAIRE = [
  { x: 0, y: 0 },
  { x: 3, y: 0 },
  { x: 6, y: 0 },
]; // sommets alignes -> aire 0
// Bowtie ASYMETRIQUE : aire shoelace NON nulle (passe le controle d'aire) mais aretes
// non adjacentes qui SE CROISENT -> doit etre rejete par le controle de simplicite.
const BOWTIE_ASYM = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 0, y: 3 },
  { x: 4, y: 3 },
];

describe('RaftSchema — rejet des polygones degeneres (faille bowtie)', () => {
  it('accepte un radier carre valide', () => {
    expect(RadierInputSchema.safeParse(withPts(CARRE)).success).toBe(true);
  });
  it('REJETTE un contour auto-intersectant (bowtie, aire nulle)', () => {
    expect(RadierInputSchema.safeParse(withPts(BOWTIE)).success).toBe(false);
  });
  it('REJETTE un contour a sommets alignes (aire nulle)', () => {
    expect(RadierInputSchema.safeParse(withPts(COLLINEAIRE)).success).toBe(false);
  });
  it('REJETTE un bowtie ASYMETRIQUE (aire non nulle mais aretes croisees)', () => {
    // Verifie que le controle de SIMPLICITE (et pas seulement l'aire) mord.
    expect(RadierInputSchema.safeParse(withPts(BOWTIE_ASYM)).success).toBe(false);
  });
});
