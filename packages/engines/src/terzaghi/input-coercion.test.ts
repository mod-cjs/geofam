/**
 * Anti-régression (audit adverse) — coercition des champs numériques `NumOrStr`.
 *
 * FAILLE #1 trouvee : les champs numeriques acceptaient toute chaine <= 32 car.,
 * coercee serveur via Number(). Une chaine NON numerique (`c = "abc"`) etait
 * silencieusement transformee en 0 -> resultat FAUX mais plausible, scellable dans
 * un PV. Le schema doit REJETER toute chaine qui ne represente pas un nombre fini,
 * tout en gardant les chaines numeriques valides (le front envoie du texte brut).
 */

import { describe, it, expect } from 'vitest';

import { TerzaghiInputSchema } from './contract.js';

// Entree minimale VALIDE (config pressiometre, cf. audit prod).
const BASE = {
  projet: 'Test',
  forme: 'carree',
  B: 2,
  L: 2,
  D: 1.5,
  beton: 'coule',
  solCat: 'sables',
  c: 0,
  phi: 30,
  eYoung: 20,
  nuSol: 0.33,
  nappe: 0,
  gAvant: 19,
  gApres: 19,
  gSous: 10,
  cphiOn: true,
  cphiMode: 'auto',
  talusOn: false,
  beta: 0,
  dTalus: 0,
  talusDir: 'ext',
  profilMode: 'essais',
  alphaSang: 0.5,
  essai: 'pressio',
  sondage: [
    { z: 1, pl: 1.0, em: 10, al: 0.5, qc: 0 },
    { z: 2, pl: 1.2, em: 12, al: 0.5, qc: 0 },
    { z: 3, pl: 1.5, em: 15, al: 0.5, qc: 0 },
  ],
  charges: [{ etat: 'ELU_F', fz: 500, fx: 0, fy: 0, mx: 0, my: 0 }],
} as const;

const withField = (k: string, v: unknown) => ({ ...BASE, [k]: v });

describe('NumOrStr — rejet des chaines non numeriques (faille #1)', () => {
  it('accepte l entree numerique de reference', () => {
    expect(TerzaghiInputSchema.safeParse(BASE).success).toBe(true);
  });

  // Chaines VALIDES (le front envoie du texte brut ; virgule decimale toleree comme
  // le moteur ; vide = absence intentionnelle) : doivent passer.
  for (const v of ['2', '30.5', '0', '-5', '1e2', '.5', '', '1,5', '0,5']) {
    it(`accepte la chaine numerique valide ${JSON.stringify(v)}`, () => {
      expect(TerzaghiInputSchema.safeParse(withField('c', v)).success).toBe(true);
    });
  }

  // Chaines INVALIDES (non vides, non numeriques) : REJETEES (avant le fix : absorbees
  // silencieusement en NaN -> resultat faux).
  for (const [field, v] of [
    ['c', 'abc'],
    ['phi', 'abc'],
    ['B', 'Infinity'],
    ['B', 'NaN'],
    ['nuSol', '0.4.4'], // double point -> Number()=NaN
    ['B', '1e999'], // -> Infinity
  ] as const) {
    it(`REJETTE ${field} = ${JSON.stringify(v)}`, () => {
      expect(TerzaghiInputSchema.safeParse(withField(field, v)).success).toBe(false);
    });
  }
});
