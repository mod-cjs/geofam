/**
 * Hygiene d'erreur (audit adverse) — pas de fuite d'exception JS interne.
 *
 * FAILLE trouvee (MEDIUM) : sur des paliers aberrants (volumes decroissants,
 * courbe plate), le moteur levait une exception JS non geree et le message BRUT
 * (« Cannot read properties of undefined (reading 'p') ») fuitait dans le champ
 * `erreur` -> divulgation d'implementation. Les erreurs de DOMAINE (messages metier
 * FR) doivent rester visibles ; toute signature d'exception technique est remplacee
 * par un message generique.
 */

import { describe, it, expect } from 'vitest';

import { runPressiometre } from './index.js';

const rows = (rs: Array<{ p: number; v15: number; v30: number; v60: number }>) => ({
  projet: 'x',
  label: 'l',
  params: { a: 0.5, Ph: 0, Pe: 0, V0: 535, k0: 0.5 },
  gamma: 19,
  nappe: 0,
  rows: rs,
});

const VALIDE = rows([
  { p: 2, v15: 90, v30: 95, v60: 100 },
  { p: 4, v15: 130, v30: 135, v60: 140 },
  { p: 6, v15: 175, v30: 182, v60: 189 },
  { p: 8, v15: 230, v30: 245, v60: 262 },
  { p: 10, v15: 320, v30: 355, v60: 400 },
]);

// Volumes DECROISSANTS (aberrant) -> exception JS interne avant le fix.
const DECROISSANT = rows([
  { p: 2, v15: 500, v30: 480, v60: 460 },
  { p: 4, v15: 400, v30: 380, v60: 360 },
  { p: 6, v15: 300, v30: 280, v60: 260 },
  { p: 8, v15: 200, v30: 180, v60: 160 },
]);

const TROIS_PALIERS = rows([
  { p: 2, v15: 90, v30: 95, v60: 100 },
  { p: 4, v15: 130, v30: 135, v60: 140 },
  { p: 6, v15: 175, v30: 182, v60: 189 },
]);

const outputOf = (input: unknown) => {
  const env = runPressiometre(input as never);
  return env.ok ? (env.output as { erreur: string | null }) : { erreur: 'NOT_OK' };
};

describe('pressiometre — hygiene d erreur (anti-fuite exception JS)', () => {
  it('entree valide : aucune erreur', () => {
    expect(outputOf(VALIDE).erreur).toBeNull();
  });

  it('paliers aberrants : AUCUNE signature d exception JS ne fuit', () => {
    const err = outputOf(DECROISSANT).erreur ?? '';
    expect(err).not.toMatch(/cannot read|undefined|reading '|typeerror|is not a function/i);
    // Un message est tout de meme fourni (non vide).
    expect(err.length).toBeGreaterThan(0);
  });

  it('erreur de DOMAINE conservee (< 4 paliers -> message metier)', () => {
    const err = outputOf(TROIS_PALIERS).erreur ?? '';
    expect(err).toMatch(/palier|insuffis/i);
  });
});
