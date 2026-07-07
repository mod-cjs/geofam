/**
 * Jeux d'ENTREES pour l'equivalence-portage du MODULE GNT AUTOMATIQUE (#87 etape
 * 1/2, gate `load.gntAuto`). Comme pour `test-fixtures.ts`, on ne fige PAS la
 * sortie attendue ici : elle est derivee en executant la reference DEFINITIVE
 * via jsdom (`gnt-auto-harness.ts`).
 *
 * IMPORTANT (portee) : aucune de ces structures ne comporte deux couches
 * RIGIDES (MTLH/beton) ADJACENTES -> `ifaceAuto()` (reference definitive) renvoie
 * toujours 'collee', qui EST le seul chemin transcrit dans engine.ts (le
 * traitement generalise des interfaces glissante/semi-collee est HORS PERIMETRE
 * de cette etape). Ce choix isole le delta teste au SEUL module GNT.
 *
 * Couverture du pre-traitement `applyGntAuto` :
 *   - hasBound=false (structure GNT/GNT nue) : couche de tete GNT fixee a 600 MPa ;
 *   - hasBound=false, cascade sur 2 puis 3 couches GNT (topG fixe, sous-couches
 *     en 3xE_sous-jacent) ;
 *   - hasBound=true (base GB/GC/SC liee) : plafond 360 MPa, cascade capee ET
 *     cascade NON capee (3xEb < 360) ;
 *   - GNT directement sur la plateforme (Eb = pf.E, pas une autre couche).
 */
import type { BurmisterInput } from './contract.js';

export interface GntAutoFixture {
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

const CP_GNT_AUTO: BurmisterInput['load'] = {
  p: 0.662,
  a: 0.125,
  d: 0.375,
  r: 'auto',
  sh: 'auto',
  ks: 'auto',
  gntAuto: true,
};

const PF1: BurmisterInput['subgrade'] = { cls: 'PF1', E: 20, nu: 0.35 };
const PF2: BurmisterInput['subgrade'] = { cls: 'PF2', E: 50, nu: 0.35 };
const PF3: BurmisterInput['subgrade'] = { cls: 'PF3', E: 120, nu: 0.35 };

export const GNT_AUTO_FIXTURES: readonly GntAutoFixture[] = [
  {
    id: 'gnt-hasbound-false-topg-fixe-600',
    description:
      'BBSG1/GNT1 sur PF2 (pas de couche liee sous surface) : hasBound=false => ' +
      'couche de tete GNT fixee a 600 MPa (E initial 300 ignore), nu impose 0,35.',
    input: {
      projet: 'GNT auto — GNT/GNT simple',
      layers: [
        { mat: 'BBSG1', h: 0.08, E: 1512, nu: 0.45 },
        { mat: 'GNT1', h: 0.3, E: 300, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: CP_GNT_AUTO,
    },
  },
  {
    id: 'gnt-hasbound-false-cascade-2',
    description:
      'BBSG1/GNT1/GNT2 sur PF2 : hasBound=false => GNT1 (topG) fixe a 600 MPa ; ' +
      'GNT2 (derniere couche) = min(3*pf.E, 600) = min(150,600) = 150 MPa.',
    input: {
      projet: 'GNT auto — cascade 2 couches GNT/GNT',
      layers: [
        { mat: 'BBSG1', h: 0.08, E: 1512, nu: 0.45 },
        { mat: 'GNT1', h: 0.15, E: 400, nu: 0.35 },
        { mat: 'GNT2', h: 0.2, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: CP_GNT_AUTO,
    },
  },
  {
    id: 'gnt-hasbound-false-cascade-3',
    description:
      'BBSG1/GNT1/GNT2/GNT1 sur PF1 (E=20) : hasBound=false => topG (index 1) ' +
      'fixe a 600 MPa MALGRE la cascade ; derniere couche (index 3) = ' +
      'min(3*20,600)=60 MPa ; couche intermediaire (index 2) = min(3*60,600)=180 MPa.',
    input: {
      projet: 'GNT auto — cascade 3 couches, topG force malgre chaine',
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GNT1', h: 0.15, E: 400, nu: 0.35 },
        { mat: 'GNT2', h: 0.15, E: 300, nu: 0.35 },
        { mat: 'GNT1', h: 0.15, E: 200, nu: 0.35 },
      ],
      subgrade: PF1,
      traffic: TR_REF,
      load: CP_GNT_AUTO,
    },
  },
  {
    id: 'gnt-hasbound-true-gb2-cascade-cape-360',
    description:
      'BBSG1/GB2/GNT1/GNT2 sur PF3 (E=120) : hasBound=true (GB2 lie hors surface) ' +
      '=> plafond 360 MPa. GNT2 (derniere) = min(3*120,360)=360 (cape). GNT1 = ' +
      'min(3*360,360)=360 (cape aussi, cascade saturee).',
    input: {
      projet: 'GNT auto — base liee GB2, cascade cape a 360',
      layers: [
        { mat: 'BBSG1', h: 0.08, E: 1512, nu: 0.45 },
        { mat: 'GB2', h: 0.2, E: 2588, nu: 0.45 },
        { mat: 'GNT1', h: 0.15, E: 400, nu: 0.35 },
        { mat: 'GNT2', h: 0.15, E: 300, nu: 0.35 },
      ],
      subgrade: PF3,
      traffic: TR_REF,
      load: CP_GNT_AUTO,
    },
  },
  {
    id: 'gnt-hasbound-true-gb2-non-cape',
    description:
      'BBSG1/GB2/GNT1 sur PF2 (E=50) : hasBound=true => plafond 360 MPa, mais ' +
      'GNT1 (derniere couche) = min(3*50,360) = 150 MPa (NON cape) : verifie la ' +
      'branche 3xEb quand elle est SOUS le plafond.',
    input: {
      projet: 'GNT auto — base liee GB2, cascade non capee',
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB2', h: 0.15, E: 2588, nu: 0.45 },
        { mat: 'GNT1', h: 0.3, E: 250, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: CP_GNT_AUTO,
    },
  },
  {
    id: 'gnt-hasbound-true-gb3-eme2',
    description:
      'BBSG1/EME2/GNT2 sur PF3 : hasBound=true (EME2 lie hors surface) => ' +
      'plafond 360 MPa ; GNT2 (derniere) = min(3*120,360) = 360 (cape).',
    input: {
      projet: 'GNT auto — base EME2',
      layers: [
        { mat: 'BBSG1', h: 0.08, E: 1512, nu: 0.45 },
        { mat: 'EME2', h: 0.16, E: 6151, nu: 0.45 },
        { mat: 'GNT2', h: 0.2, E: 250, nu: 0.35 },
      ],
      subgrade: PF3,
      traffic: TR_REF,
      load: CP_GNT_AUTO,
    },
  },
  {
    id: 'gnt-hasbound-true-gc3-seul',
    description:
      'BBSG1/GC3/GNT1 sur PF3 : hasBound=true (GC3 rigide, une SEULE couche ' +
      'rigide -> pas de paire rig/rig adjacente, ifaceAuto="collee") => plafond ' +
      '360 MPa ; GNT1 (derniere) = min(3*120,360) = 360 (cape).',
    input: {
      projet: 'GNT auto — base rigide GC3 isolee',
      layers: [
        { mat: 'BBSG1', h: 0.08, E: 1512, nu: 0.45 },
        { mat: 'GC3', h: 0.19, E: 23000, nu: 0.25 },
        { mat: 'GNT1', h: 0.2, E: 300, nu: 0.35 },
      ],
      subgrade: PF3,
      traffic: TR_REF,
      load: CP_GNT_AUTO,
    },
  },
  {
    id: 'gnt-hasbound-true-sc2-seul',
    description:
      'BBSG1/SC2/GNT1/GNT2 sur PF3 : hasBound=true (SC2 rigide isole) => plafond ' +
      '360 MPa ; cascade GNT2 (derniere, min(3*120,360)=360) puis GNT1 ' +
      '(min(3*360,360)=360).',
    input: {
      projet: 'GNT auto — base rigide SC2 isolee, cascade',
      layers: [
        { mat: 'BBSG1', h: 0.08, E: 1512, nu: 0.45 },
        { mat: 'SC2', h: 0.2, E: 12000, nu: 0.25 },
        { mat: 'GNT1', h: 0.15, E: 350, nu: 0.35 },
        { mat: 'GNT2', h: 0.15, E: 300, nu: 0.35 },
      ],
      subgrade: PF3,
      traffic: TR_REF,
      load: CP_GNT_AUTO,
    },
  },
  {
    id: 'gnt-souple-gnt-seul-sur-pf',
    description:
      'BBSG1/GNT2 seul, faible trafic, sur PF1 : hasBound=false => couche de tete ' +
      '(unique GNT) fixee a 600 MPa (topG=index unique).',
    input: {
      projet: 'GNT auto — souple, GNT seul directement sur PSC',
      layers: [
        { mat: 'BBSG1', h: 0.05, E: 1512, nu: 0.45 },
        { mat: 'GNT2', h: 0.25, E: 150, nu: 0.35 },
      ],
      subgrade: PF1,
      traffic: {
        T: 10,
        C: 0.5,
        N: 15,
        tau: 2.0,
        dir: 1.0,
        tv: 1.0,
      },
      load: CP_GNT_AUTO,
    },
  },
  {
    id: 'gnt-hasbound-true-gb3-cascade-mixte',
    description:
      'BBSG1/GB3/GNT2/GNT1/GNT2 sur PF2 (cascade a 3 couches, base liee GB3) : ' +
      'plafond 360 MPa ; GNT2 (derniere, index4) = min(3*50,360)=150 ; GNT1 ' +
      '(index3) = min(3*150,360)=360 (cape) ; GNT2 (index2) = min(3*360,360)=360.',
    input: {
      projet: 'GNT auto — cascade 3 couches, base liee, cape puis non-cape',
      layers: [
        { mat: 'BBSG1', h: 0.07, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.18, E: 2588, nu: 0.45 },
        { mat: 'GNT2', h: 0.1, E: 300, nu: 0.35 },
        { mat: 'GNT1', h: 0.1, E: 250, nu: 0.35 },
        { mat: 'GNT2', h: 0.15, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: CP_GNT_AUTO,
    },
  },
];
