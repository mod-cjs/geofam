/**
 * Jeux d'ENTREES pour l'equivalence-portage de la REVISION MATERIAUX « definitive »
 * (#93 sous-port 3c, GATE SCIENCE — `load.materialsRev==='definitive'`).
 *
 * ⚠️ CHANGEMENT DE CALAGE (science STARFIRE), pas un simple port : la reference
 * DEFINITIVE corrige GLc2 s6 0.37->0.3705, BQc s6 0.30->0.304, et AJOUTE le
 * materiau BC5g (Beton BC5 dalle GOUJONNEE, kd=1/1,47). Son activation produit
 * necessite une validation `expert-genie-civil`/STARFIRE prealable.
 *
 * Comme pour `test-fixtures.ts`, on ne fige PAS la sortie attendue ici : elle
 * est derivee en executant la reference DEFINITIVE via jsdom (`gnt-auto-harness.ts`
 * — meme harnais reutilise).
 *
 * Couverture :
 *   - GLc2 (semi-rigide) AVEC `materialsRev='definitive'` : s6=0.3705 ;
 *   - BQc (semi-rigide) AVEC `materialsRev='definitive'` : s6=0.304 ;
 *   - BC5g (beton dalle goujonnee, structure S17 catalogue) AVEC `materialsRev` ;
 *   - les MEMES structures SANS `materialsRev` (table historique, s6 0.37/0.30 —
 *     preuve que le defaut reste inchange, comparee a la reference definitive
 *     PILOTEE SANS materialsRev cote jsdom, cf. remarque dans le test).
 */
import type { BurmisterInput } from './contract.js';

export interface MaterialsDefinitiveFixture {
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
const TR_FORT: BurmisterInput['traffic'] = {
  T: 800,
  C: 1.2,
  N: 20,
  tau: 4.0,
  dir: 1.0,
  tv: 1.0,
};
const PF2: BurmisterInput['subgrade'] = { cls: 'PF2', E: 50, nu: 0.35 };
const PF3: BurmisterInput['subgrade'] = { cls: 'PF3', E: 120, nu: 0.35 };
const PF4: BurmisterInput['subgrade'] = { cls: 'PF4', E: 200, nu: 0.35 };

// NOTE (isolation du delta teste) : plusieurs fixtures ci-dessous comportent DEUX
// couches RIGIDES adjacentes (GLc2/GLc2, BQc/BQc, BC5g/BC2, BC5g/BC5g). La
// reference DEFINITIVE (HTML) n'a PAS de gate : elle applique TOUJOURS la
// condition d'interface automatique (Tab. 68, `ifaceAuto`/`_solveSet`) au calcul
// PRINCIPAL (#87 etape 2/2, deja porte et prouve equivalent separement). Le
// module TS, lui, GATE ce comportement derriere `load.ifaceAuto` (absent =
// chemin "collee" historique). Pour ISOLER ICI le SEUL delta de la revision
// materiaux (3c) — et non re-tester le rebase d'interface (deja couvert par
// `engine.interface-auto.equivalence.test.ts`) — on active EXPLICITEMENT
// `ifaceAuto:true` : les deux moteurs empruntent alors le MEME chemin de calcul
// principal, et la comparaison isole strictement l'effet du recalage materiaux.
const CP_DEFINITIVE: BurmisterInput['load'] = {
  p: 0.662,
  a: 0.125,
  d: 0.375,
  r: 'auto',
  sh: 'auto',
  ks: 'auto',
  materialsRev: 'definitive',
  ifaceAuto: true,
};

export const MATERIALS_DEFINITIVE_FIXTURES: readonly MaterialsDefinitiveFixture[] = [
  {
    id: 'materiaux-def-glc2-semi-rigide',
    description:
      'BBSG/GLc2/GLc2 (semi-rigide, latérite ciment) AVEC materialsRev=definitive : s6=0,3705',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.08, E: 1512, nu: 0.45 },
        { mat: 'GLc2', h: 0.2, E: 3000, nu: 0.25 },
        { mat: 'GLc2', h: 0.18, E: 3000, nu: 0.25 },
      ],
      subgrade: PF3,
      traffic: TR_REF,
      load: CP_DEFINITIVE,
    },
  },
  {
    id: 'materiaux-def-glc2-mixte',
    description: 'GLc2 dans une structure MIXTE (bitumineux + MTLH, K>=0,5) AVEC definitive',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.12, E: 2588, nu: 0.45 },
        { mat: 'GLc2', h: 0.18, E: 3000, nu: 0.25 },
        { mat: 'GNT1', h: 0.15, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: CP_DEFINITIVE,
    },
  },
  {
    id: 'materiaux-def-bqc-semi-rigide',
    description:
      'BBSG/BQc/BQc (semi-rigide, banco-coquillage) AVEC materialsRev=definitive : s6=0,304',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.08, E: 1512, nu: 0.45 },
        { mat: 'BQc', h: 0.29, E: 10000, nu: 0.25 },
        { mat: 'BQc', h: 0.27, E: 10000, nu: 0.25 },
      ],
      subgrade: PF4,
      traffic: TR_REF,
      load: CP_DEFINITIVE,
    },
  },
  {
    id: 'materiaux-def-bqc-inverse',
    description: 'BQc en structure INVERSE (MTLH profond sous granulaire) AVEC definitive',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.08, E: 2588, nu: 0.45 },
        { mat: 'GNT1', h: 0.12, E: 200, nu: 0.35 },
        { mat: 'BQc', h: 0.25, E: 10000, nu: 0.25 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: CP_DEFINITIVE,
    },
  },
  {
    id: 'materiaux-def-bc5g-dalle-goujonnee',
    description:
      'BC5g/BC2 (rigide, dalle GOUJONNEE, S17 catalogue) : kd=1/1,47 — materiau AJOUTE par la definitive',
    input: {
      layers: [
        { mat: 'BC5g', h: 0.22, E: 35000, nu: 0.25 },
        { mat: 'BC2', h: 0.15, E: 20000, nu: 0.25 },
      ],
      subgrade: PF3,
      traffic: TR_FORT,
      load: CP_DEFINITIVE,
    },
  },
  {
    id: 'materiaux-def-bc5g-vs-bc5-non-goujonne',
    description: 'BC5g seul sur GNT (comparaison structurelle avec BC5 non goujonne)',
    input: {
      layers: [
        { mat: 'BC5g', h: 0.2, E: 35000, nu: 0.25 },
        { mat: 'GNT1', h: 0.2, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_FORT,
      load: CP_DEFINITIVE,
    },
  },
  {
    id: 'materiaux-def-bc5g-multi',
    description: 'BC5g multi-couches (interface glissante, Tab. 68) sur GNT AVEC definitive',
    input: {
      layers: [
        { mat: 'BC5g', h: 0.2, E: 35000, nu: 0.25 },
        { mat: 'BC5g', h: 0.18, E: 35000, nu: 0.25 },
        { mat: 'GNT1', h: 0.2, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_FORT,
      load: CP_DEFINITIVE,
    },
  },
  {
    id: 'materiaux-def-glc2-risque-personnalise',
    description:
      'GLc2 (definitive) COMBINE avec un risque personnalise hors table (r=12, #93 sous-port 3a)',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.08, E: 1512, nu: 0.45 },
        { mat: 'GLc2', h: 0.2, E: 3000, nu: 0.25 },
        { mat: 'GLc2', h: 0.18, E: 3000, nu: 0.25 },
      ],
      subgrade: PF3,
      traffic: TR_REF,
      load: { ...CP_DEFINITIVE, r: 12 },
    },
  },
  {
    id: 'materiaux-def-bqc-ne-direct',
    description: 'BQc (definitive) COMBINE avec un NE direct (#93 sous-port 3b)',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.08, E: 1512, nu: 0.45 },
        { mat: 'BQc', h: 0.29, E: 10000, nu: 0.25 },
        { mat: 'BQc', h: 0.27, E: 10000, nu: 0.25 },
      ],
      subgrade: PF4,
      traffic: TR_REF,
      load: { ...CP_DEFINITIVE, neForce: 1.2e7 },
    },
  },
  {
    id: 'materiaux-def-bc5g-goujonnee-catalogue-s17',
    description:
      'BC5g/BC2 (structure catalogue S17, épaisseurs catalogue) AVEC definitive — trafic reference',
    input: {
      layers: [
        { mat: 'BC5g', h: 0.22, E: 35000, nu: 0.25 },
        { mat: 'BC2', h: 0.2, E: 20000, nu: 0.25 },
      ],
      subgrade: PF3,
      traffic: TR_REF,
      load: CP_DEFINITIVE,
    },
  },
];
