/**
 * Jeux d'ENTREES pour l'equivalence-portage du RISQUE PERSONNALISE (#93 sous-port
 * 3a, reference DEFINITIVE — `invNorm()`/`uRisk()`, algorithme d'Acklam).
 *
 * L'ANCIEN moteur repliait tout risque hors table {5,10,15,25,50} sur 1,282
 * (=10 %, bug de portage). La reference DEFINITIVE calcule le vrai quantile de
 * la loi normale inverse pour n'importe quel risque `r` (%).
 *
 * Comme pour `test-fixtures.ts`, on ne fige PAS la sortie attendue ici : elle
 * est derivee en executant la reference DEFINITIVE via jsdom (`gnt-auto-harness.ts`
 * — meme harnais, reutilise : il pilote `doCalc()` sans dependre du module GNT).
 *
 * Couverture :
 *   - les 5 risques STANDARD de la table (5/10/15/25/50) : DOIVENT rester
 *     identiques au bit pres (table exacte conservee) ;
 *   - des risques PERSONNALISES hors table (8, 12, 30, 1, 49, 0.5) : quantile
 *     continu (Acklam).
 */
import type { BurmisterInput } from './contract.js';

export interface RisquePersonnaliseFixture {
  id: string;
  description: string;
  input: BurmisterInput;
}

const TR_REF: BurmisterInput['traffic'] = {
  T: 150,
  C: 0.9,
  N: 20,
  tau: 4.0,
  dir: 1.0,
  tv: 1.0,
};
const PF2: BurmisterInput['subgrade'] = { cls: 'PF2', E: 50, nu: 0.35 };

/** Structure porteuse d'un critere de fatigue bitumineux (kr/krLCPC exerce). */
const LAYERS_BIT: BurmisterInput['layers'] = [
  { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
  { mat: 'GB3', h: 0.11, E: 2588, nu: 0.45 },
  { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 },
];

function loadWithRisk(r: number | 'auto'): BurmisterInput['load'] {
  return { p: 0.662, a: 0.125, d: 0.375, r, sh: 'auto', ks: 'auto' };
}

export const RISQUE_PERSONNALISE_FIXTURES: readonly RisquePersonnaliseFixture[] = [
  // --- Risques STANDARD (table exacte, doivent rester identiques au bit pres) ---
  {
    id: 'risque-standard-5',
    description: 'r=5 % (table exacte) : u_r=1,645 inchange',
    input: { layers: LAYERS_BIT, subgrade: PF2, traffic: TR_REF, load: loadWithRisk(5) },
  },
  {
    id: 'risque-standard-10',
    description: 'r=10 % (table exacte) : u_r=1,282 inchange',
    input: { layers: LAYERS_BIT, subgrade: PF2, traffic: TR_REF, load: loadWithRisk(10) },
  },
  {
    id: 'risque-standard-15',
    description: 'r=15 % (table exacte) : u_r=1,036 inchange',
    input: { layers: LAYERS_BIT, subgrade: PF2, traffic: TR_REF, load: loadWithRisk(15) },
  },
  {
    id: 'risque-standard-25',
    description: 'r=25 % (table exacte) : u_r=0,674 inchange',
    input: { layers: LAYERS_BIT, subgrade: PF2, traffic: TR_REF, load: loadWithRisk(25) },
  },
  {
    id: 'risque-standard-50',
    description: 'r=50 % (table exacte) : u_r=0,0 inchange',
    input: { layers: LAYERS_BIT, subgrade: PF2, traffic: TR_REF, load: loadWithRisk(50) },
  },
  // --- Risques PERSONNALISES hors table (quantile continu, algorithme d'Acklam) ---
  {
    id: 'risque-personnalise-8',
    description: 'r=8 % (hors table) : quantile continu (entre 5 % et 10 %)',
    input: { layers: LAYERS_BIT, subgrade: PF2, traffic: TR_REF, load: loadWithRisk(8) },
  },
  {
    id: 'risque-personnalise-12',
    description: 'r=12 % (hors table) : quantile continu (entre 10 % et 15 %)',
    input: { layers: LAYERS_BIT, subgrade: PF2, traffic: TR_REF, load: loadWithRisk(12) },
  },
  {
    id: 'risque-personnalise-30',
    description: 'r=30 % (hors table) : quantile continu (entre 25 % et 50 %)',
    input: { layers: LAYERS_BIT, subgrade: PF2, traffic: TR_REF, load: loadWithRisk(30) },
  },
  {
    id: 'risque-personnalise-1',
    description: 'r=1 % (hors table, borne basse) : queue basse de la loi normale inverse',
    input: { layers: LAYERS_BIT, subgrade: PF2, traffic: TR_REF, load: loadWithRisk(1) },
  },
  {
    id: 'risque-personnalise-49',
    description: 'r=49 % (hors table, proche de 50) : quantile proche de 0',
    input: { layers: LAYERS_BIT, subgrade: PF2, traffic: TR_REF, load: loadWithRisk(49) },
  },
  {
    id: 'risque-personnalise-0-5',
    description: 'r=0,5 % (hors table, borne tres basse) : queue basse (branche p<pl)',
    input: { layers: LAYERS_BIT, subgrade: PF2, traffic: TR_REF, load: loadWithRisk(0.5) },
  },
];
