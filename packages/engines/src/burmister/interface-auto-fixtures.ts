/**
 * Jeux d'ENTREES pour l'equivalence-portage des CONDITIONS D'INTERFACE (Tab. 68
 * AGEROUTE, #87 etape 2/2, gate `load.ifaceAuto`). Comme pour
 * `gnt-auto-fixtures.ts`, on ne fige PAS la sortie attendue ici : elle est
 * derivee en executant la reference DEFINITIVE via jsdom
 * (`gnt-auto-harness.ts` — meme harnais, il pilote `doCalc()` generiquement).
 *
 * PORTEE : chaque structure comporte AU MOINS DEUX couches RIGIDES (MTLH/beton)
 * ADJACENTES (`ifaceAuto()` de la reference renvoie alors 'semi-collee' ou
 * 'glissante', jamais 'collee') — le cas que l'etape 1/2 (GNT) excluait
 * explicitement. C'est le seul perimetre ou le calcul PRINCIPAL (`_r0/_rd2/_rd`
 * — fatigue ε_t/σ_t ET orniérage ε_z) peut DIFFERER du chemin collee historique :
 *   - semi-rigide (§4.3) : paquet BBSG/GC-T3/GC-T3 (2 GC adjacents -> semi-collee) ;
 *   - mixte (§4.4, K>=0,5) : paquet BBSG/GB3/GLc1/GLc1 sur GNT (2 GLc1 adjacents
 *     dans le paquet lie -> semi-collee) ;
 *   - inverse (§4.5) : segment MTLH PROFOND a 2 couches (GLc2/GLc2) sous une
 *     couche granulaire -> semi-collee, HORS du paquet de surface (donc PAS
 *     masque par le bloc `rigL`, qui ne regarde que `i<bitEnd`) ;
 *   - beton multi-couches en surface (BC5/BC5, prefixe "BC") -> 'glissante'
 *     (et non 'semi-collee') : couvre l'AUTRE branche de `ifaceAuto`.
 *
 * Chaque scenario est execute avec `load.ifaceAuto=true` : la reference
 * DEFINITIVE integre alors ces interfaces au calcul principal (comme le module
 * TS sous gate) ; sans le flag, les deux resteraient au chemin collee et ne
 * prouveraient RIEN sur le module ajoute (cf. gate teste separement dans le
 * fichier de test).
 *
 * MISE EN GARDE (hors perimetre de cette etape, decouverte en verifiant ces
 * fixtures) : la table `AGEROUTE_MATERIALS` figee cote module (engine.ts) est
 * LEGEREMENT DESYNCHRONISEE de la reference DEFINITIVE sur DEUX coefficients
 * s6 (calage de fatigue MTLH) : `GLc2.s6` = 0,37 (module) vs 0,3705
 * (definitive) et `BQc.s6` = 0,3 (module) vs 0,304 (definitive). Ecart
 * PRE-EXISTANT (present avant ce travail sur les interfaces), SANS RAPPORT avec
 * les conditions d'interface : bug de CALIBRATION (science), pas un defaut de
 * PORTAGE. Aucune fixture ci-dessous n'utilise GLc2 ni BQc pour ne pas
 * confondre ce delta de calage avec l'equivalence testee ici. A SIGNALER a
 * `expert-genie-civil`/STARFIRE pour arbitrage (rebase complet de la table
 * materiaux — hors scope de l'etape 2/2 interface).
 */
import type { BurmisterInput } from './contract.js';

export interface InterfaceAutoFixture {
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
  T: 400,
  C: 0.9,
  N: 20,
  tau: 4.0,
  dir: 1.0,
  tv: 1.0,
};

const CP_IFACE_AUTO: BurmisterInput['load'] = {
  p: 0.662,
  a: 0.125,
  d: 0.375,
  r: 'auto',
  sh: 'auto',
  ks: 'auto',
  ifaceAuto: true,
};

const PF2: BurmisterInput['subgrade'] = { cls: 'PF2', E: 50, nu: 0.35 };
const PF3: BurmisterInput['subgrade'] = { cls: 'PF3', E: 120, nu: 0.35 };

export const INTERFACE_AUTO_FIXTURES: readonly InterfaceAutoFixture[] = [
  {
    id: 'iface-semi-rigide-gc3-gc3',
    description:
      'BBSG1/GC3/GC3 sur PF3 : famille semi-rigide (§4.3, K<0,5), 2 couches GC3 ' +
      "adjacentes (rig, prefixe non-BC) -> interface AUTO 'semi-collee' entre " +
      'elles. Le calcul PRINCIPAL (ε_z sommet PSC notamment) integre cette ' +
      'interface avec ifaceAuto=true, contrairement au chemin collee historique.',
    input: {
      projet: 'Interface auto — semi-rigide GC3/GC3',
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GC3', h: 0.19, E: 23000, nu: 0.25 },
        { mat: 'GC3', h: 0.18, E: 23000, nu: 0.25 },
      ],
      subgrade: PF3,
      traffic: TR_REF,
      load: CP_IFACE_AUTO,
    },
  },
  {
    id: 'iface-semi-rigide-sc2-sc2-pf2',
    description:
      'BBSG1/SC2/SC2 sur PF2 : semi-rigide, 2 couches SC2 adjacentes (rig, ' +
      "non-BC) -> 'semi-collee'. Variante de PSC et d'epaisseurs vs le cas GC3.",
    input: {
      projet: 'Interface auto — semi-rigide SC2/SC2',
      layers: [
        { mat: 'BBSG1', h: 0.08, E: 1512, nu: 0.45 },
        { mat: 'SC2', h: 0.22, E: 12000, nu: 0.25 },
        { mat: 'SC2', h: 0.18, E: 12000, nu: 0.25 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: CP_IFACE_AUTO,
    },
  },
  {
    id: 'iface-mixte-bit-glc1-glc1',
    description:
      'BBSG1/GB3/GLc1/GLc1/GNT1 sur PF2 : famille MIXTE (§4.4, K>=0,5). Le ' +
      'paquet lie comporte 2 couches GLc1 (rig) adjacentes en son sein -> ' +
      "interface AUTO 'semi-collee' entre elles. Isole le delta du calcul " +
      'principal (ε_z sommet PSC/GNT) dans une structure MIXTE, distincte de la ' +
      'phase 2 (et2, calculee separement, non affectee par ce gate).',
    input: {
      projet: 'Interface auto — mixte GLc1/GLc1',
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.14, E: 2588, nu: 0.45 },
        { mat: 'GLc1', h: 0.09, E: 2500, nu: 0.25 },
        { mat: 'GLc1', h: 0.09, E: 2500, nu: 0.25 },
        { mat: 'GNT1', h: 0.15, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: CP_IFACE_AUTO,
    },
  },
  {
    id: 'iface-inverse-gc3-gc3-profond',
    description:
      'BBSG1/GB3/GNT1/GC3/GC3 sur PF2 : structure INVERSE (§4.5), segment ' +
      'MTLH PROFOND a 2 couches GC3 adjacentes SOUS la couche granulaire -> ' +
      "interface AUTO 'semi-collee' HORS du paquet de surface (bitEnd), donc " +
      'PAS masquee par le bloc `rigL` (qui ne regarde que i<bitEnd) : le ' +
      'critere σ_t inverse (st2) ET la fatigue de surface (et, via le ' +
      'propagateur commun) DIFFERENT tous deux entre collee et effectif. ' +
      '(GC3 — pas GLc2/BQc, dont le coefficient s6 differe deja entre la ' +
      "table figee du module et la reference definitive : hors perimetre " +
      'de cette etape, cf. mise en garde en pied de fichier.)',
    input: {
      projet: 'Interface auto — inverse GC3/GC3 profond',
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.08, E: 2588, nu: 0.45 },
        { mat: 'GNT1', h: 0.12, E: 200, nu: 0.35 },
        { mat: 'GC3', h: 0.15, E: 23000, nu: 0.25 },
        { mat: 'GC3', h: 0.15, E: 23000, nu: 0.25 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: CP_IFACE_AUTO,
    },
  },
  {
    id: 'iface-beton-multi-bc5-glissante',
    description:
      "BC5/BC5/GNT1 sur PF2, trafic fort : 2 couches de BETON adjacentes (prefixe " +
      "'BC') en surface -> interface AUTO 'glissante' (branche distincte de " +
      "'semi-collee'). rigL masque et/etA (deja domines par stC/stG, inchanges), " +
      'mais ε_z (sommet PSC) integre le propagateur GATE, donc differe.',
    input: {
      projet: 'Interface auto — beton multi-couches glissante',
      layers: [
        { mat: 'BC5', h: 0.2, E: 35000, nu: 0.25 },
        { mat: 'BC5', h: 0.18, E: 35000, nu: 0.25 },
        { mat: 'GNT1', h: 0.2, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_FORT,
      load: CP_IFACE_AUTO,
    },
  },
  {
    id: 'iface-mixte-3-rig-cascade',
    description:
      'BBSG1/GB2/GC3/GC3/GC3 sur PF3 : 3 couches GC3 adjacentes (cascade de 2 ' +
      "interfaces 'semi-collee' consecutives) dans un paquet lie MIXTE -> " +
      "exerce _solveSet avec |sS|>1 (plusieurs interfaces non-collees a la fois).",
    input: {
      projet: 'Interface auto — cascade 3 couches rigides adjacentes',
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB2', h: 0.1, E: 2588, nu: 0.45 },
        { mat: 'GC3', h: 0.16, E: 23000, nu: 0.25 },
        { mat: 'GC3', h: 0.16, E: 23000, nu: 0.25 },
        { mat: 'GC3', h: 0.16, E: 23000, nu: 0.25 },
      ],
      subgrade: PF3,
      traffic: TR_REF,
      load: CP_IFACE_AUTO,
    },
  },
  {
    id: 'iface-override-manuel-glissante',
    description:
      "BBSG1/GLc1/GLc1/GNT1 sur PF2 : interface EFFECTIVE entre les deux GLc1 " +
      "imposee MANUELLEMENT a 'glissante' (`layers[2].iface`), alors que l'AUTO " +
      "(materiaux non-BC) aurait donne 'semi-collee'. Prouve que l'override par " +
      'couche (contract.ts) est bien porte jusqu au calcul (`_ifEff`), pas ' +
      'seulement la branche automatique.',
    input: {
      projet: 'Interface auto — override manuel glissante',
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GLc1', h: 0.1, E: 2500, nu: 0.25 },
        { mat: 'GLc1', h: 0.1, E: 2500, nu: 0.25, iface: 'glissante' },
        { mat: 'GNT1', h: 0.15, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: CP_IFACE_AUTO,
    },
  },
];
