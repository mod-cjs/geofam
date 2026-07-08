/**
 * Jeux d'ENTREES pour l'equivalence-portage du NE DIRECT (#93 sous-port 3b,
 * reference DEFINITIVE — `cp.neForce` court-circuite `calcNE()`).
 *
 * Comme pour `test-fixtures.ts`, on ne fige PAS la sortie attendue ici : elle
 * est derivee en executant la reference DEFINITIVE via jsdom (`gnt-auto-harness.ts`
 * — meme harnais reutilise, il pilote `doCalc()` independamment du module GNT).
 *
 * Couverture :
 *   - `neForce` fourni (valeurs variees : petite/grande/proche d'un seuil de
 *     risque 3.10^6) — le calcul TMJA x CAM x croissance x duree est ENTIEREMENT
 *     ignore ;
 *   - `neForce` ABSENT -> calcul historique (couvert par les fixtures existantes,
 *     pas reproduit ici : la gate est verifiee separement en test unitaire pur).
 */
import type { BurmisterInput } from './contract.js';

export interface NeDirectFixture {
  id: string;
  description: string;
  input: BurmisterInput;
}

const PF2: BurmisterInput['subgrade'] = { cls: 'PF2', E: 50, nu: 0.35 };
const PF3: BurmisterInput['subgrade'] = { cls: 'PF3', E: 120, nu: 0.35 };

/** Structure porteuse d'un critere de fatigue bitumineux (kr/rEff exerces). */
const LAYERS_BIT: BurmisterInput['layers'] = [
  { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
  { mat: 'GB3', h: 0.11, E: 2588, nu: 0.45 },
  { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 },
];

/**
 * Trafic « incoherent » avec le NE force (volontaire) : prouve que le calcul
 * TMJA x CAM x ... est bien ENTIEREMENT ignore quand `neForce` est fourni (si le
 * trafic pesait encore sur le resultat, le portage divergerait de la reference).
 */
const TR_INCOHERENT: BurmisterInput['traffic'] = {
  T: 999,
  C: 5,
  N: 40,
  tau: 10,
  dir: 1.4,
  tv: 1.3,
};

function loadWithNeForce(neForce: number): BurmisterInput['load'] {
  return { p: 0.662, a: 0.125, d: 0.375, r: 'auto', sh: 'auto', ks: 'auto', neForce };
}

export const NE_DIRECT_FIXTURES: readonly NeDirectFixture[] = [
  {
    id: 'ne-direct-petit',
    description: 'neForce=1e5 (petit) : force le risque 25 % (Tab. 70, NE<3.10^6)',
    input: {
      layers: LAYERS_BIT,
      subgrade: PF2,
      traffic: TR_INCOHERENT,
      load: loadWithNeForce(1e5),
    },
  },
  {
    id: 'ne-direct-grand',
    description: 'neForce=5e7 (grand) : force le risque 5 % (Tab. 70, NE>=3.10^6)',
    input: {
      layers: LAYERS_BIT,
      subgrade: PF3,
      traffic: TR_INCOHERENT,
      load: loadWithNeForce(5e7),
    },
  },
  {
    id: 'ne-direct-seuil-juste-sous',
    description: 'neForce=2 999 999 (juste sous le seuil 3.10^6) : risque 25 %',
    input: {
      layers: LAYERS_BIT,
      subgrade: PF2,
      traffic: TR_INCOHERENT,
      load: loadWithNeForce(2999999),
    },
  },
  {
    id: 'ne-direct-seuil-juste-dessus',
    description: 'neForce=3 000 001 (juste au-dessus du seuil 3.10^6) : risque 5 %',
    input: {
      layers: LAYERS_BIT,
      subgrade: PF2,
      traffic: TR_INCOHERENT,
      load: loadWithNeForce(3000001),
    },
  },
  {
    id: 'ne-direct-defaut-formulaire',
    description: 'neForce=3e7 (valeur par defaut du champ, reference definitive)',
    input: {
      layers: LAYERS_BIT,
      subgrade: PF3,
      traffic: TR_INCOHERENT,
      load: loadWithNeForce(3e7),
    },
  },
  {
    id: 'ne-direct-avec-r-personnalise',
    description: 'neForce combine avec un risque personnalise (r=12, hors table)',
    input: {
      layers: LAYERS_BIT,
      subgrade: PF2,
      traffic: TR_INCOHERENT,
      load: { p: 0.662, a: 0.125, d: 0.375, r: 12, sh: 'auto', ks: 'auto', neForce: 4e6 },
    },
  },
  {
    id: 'ne-direct-granulaire-pur',
    description: 'neForce sur structure granulaire pure (aucune couche liee)',
    input: {
      layers: [
        { mat: 'GNT1', h: 0.2, E: 200, nu: 0.35 },
        { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_INCOHERENT,
      load: loadWithNeForce(1.5e6),
    },
  },
  {
    id: 'ne-direct-mixte',
    description: 'neForce sur structure MIXTE (bitumineux + MTLH, K>=0,5)',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.12, E: 2588, nu: 0.45 },
        { mat: 'GLc1', h: 0.18, E: 2500, nu: 0.25 },
        { mat: 'GNT1', h: 0.15, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_INCOHERENT,
      load: loadWithNeForce(1e7),
    },
  },
  {
    id: 'ne-direct-borne-min',
    description: 'neForce a la borne basse bornee du contrat (>0, tres petit)',
    input: {
      layers: LAYERS_BIT,
      subgrade: PF2,
      traffic: TR_INCOHERENT,
      load: loadWithNeForce(1),
    },
  },
  {
    id: 'ne-direct-inverse',
    description:
      'neForce sur structure INVERSE (MTLH profond sous granulaire, §4.5) — GC3 ' +
      '(coefficient s6 NON touche par la revision materiaux #93 3c, isole le delta NE)',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.08, E: 2588, nu: 0.45 },
        { mat: 'GNT1', h: 0.12, E: 200, nu: 0.35 },
        { mat: 'GC3', h: 0.2, E: 23000, nu: 0.25 },
      ],
      subgrade: PF2,
      traffic: TR_INCOHERENT,
      load: loadWithNeForce(8e6),
    },
  },
];
