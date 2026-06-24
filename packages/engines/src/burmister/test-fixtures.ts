/**
 * Jeux d'ENTREES burmister pour l'equivalence-portage et l'e2e (#46).
 *
 * Ces fixtures ne contiennent QUE des entrees (`state`) : la REFERENCE (sortie
 * attendue) n'est PAS figee ici — elle est derivee en executant le HTML
 * d'origine via jsdom dans le harnais d'equivalence (provenance 'HTML-origine').
 * On ne se compare donc jamais a une valeur fabriquee a la main (anti faux-vert).
 *
 * Couverture (familles LCPC §4.2-4.5 + bornes + hors-domaine) :
 *   - souple (bitumineux mince sur granulaire), faible trafic (exempte ε_z) ;
 *   - bitumineuse epaisse ;
 *   - semi-rigide (paquet MTLH, K<0,5) et mixte (bitumineux+MTLH, K≥0,5) ;
 *   - structure inverse (MTLH profond sous granulaire) ;
 *   - granulaire pur (pas de couche liee) ;
 *   - beton/MTLH multi-couches (interface glissante/semi-collee) ;
 *   - override manuel risque/Sh/ks ;
 *   - bornes (charge centree d=0) ;
 *   - HORS-DOMAINE (materiau inconnu -> le moteur leve, capture en { err }).
 *
 * Les couches portent E/ν explicites (le HTML edite E/ν par couche apres choix
 * du materiau) ; on reste fidele a ces valeurs d'usine.
 */
import type { BurmisterInput } from './contract.js';

export interface BurmisterFixture {
  id: string;
  description: string;
  /** true si l'on attend une erreur de calcul (hors-domaine, science levee). */
  horsDomaine?: boolean;
  input: BurmisterInput;
}

/** Trafic de reference (saisie d'usine du HTML). */
const TR_REF: BurmisterInput['traffic'] = {
  T: 150,
  C: 0.9,
  N: 20,
  tau: 4.0,
  dir: 1.0,
  tv: 1.0,
};
/** Trafic faible (NE < 250 000 -> exemption ε_z souple). */
const TR_FAIBLE: BurmisterInput['traffic'] = {
  T: 10,
  C: 0.5,
  N: 15,
  tau: 2.0,
  dir: 1.0,
  tv: 1.0,
};
/** Trafic fort (NE > 3·10⁶ -> risque 5 %). */
const TR_FORT: BurmisterInput['traffic'] = {
  T: 800,
  C: 1.2,
  N: 20,
  tau: 4.0,
  dir: 1.0,
  tv: 1.0,
};
/** Charge de reference (jumelage, saisie d'usine). */
const CP_REF: BurmisterInput['load'] = {
  p: 0.662,
  a: 0.125,
  d: 0.375,
  r: 'auto',
  sh: 'auto',
  ks: 'auto',
};
/** PSC de reference. */
const PF2: BurmisterInput['subgrade'] = { cls: 'PF2', E: 50, nu: 0.35 };
const PF3: BurmisterInput['subgrade'] = { cls: 'PF3', E: 120, nu: 0.35 };

export const BURMISTER_FIXTURES: readonly BurmisterFixture[] = [
  {
    id: 'bitumineuse-epaisse-defaut',
    description:
      "Structure d'usine : BBSG1/GB3/GL1 sur PF2, trafic ref — H_bit=0,16 m > 0,15 => famille bitumineuse epaisse (§4.2)",
    input: {
      projet: 'Structure de reference ROADSENS',
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.1, E: 2588, nu: 0.45 },
        { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: CP_REF,
    },
  },
  {
    id: 'souple-faible-trafic',
    description:
      'Bitumineux mince (≤15 cm) sur GNT, faible trafic : exemption ε_z (§4.2.2)',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.05, E: 1512, nu: 0.45 },
        { mat: 'GNT1', h: 0.2, E: 200, nu: 0.35 },
        { mat: 'GNT2', h: 0.2, E: 150, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_FAIBLE,
      load: CP_REF,
    },
  },
  {
    id: 'bitumineuse-epaisse-fort-trafic',
    description: 'GB3 epais sur GNT, fort trafic (NE>3M -> risque 5 %)',
    input: {
      layers: [
        { mat: 'BBSG2', h: 0.06, E: 1896, nu: 0.45 },
        { mat: 'GB3', h: 0.12, E: 2588, nu: 0.45 },
        { mat: 'GB3', h: 0.12, E: 2588, nu: 0.45 },
        { mat: 'GNT1', h: 0.2, E: 200, nu: 0.35 },
      ],
      subgrade: PF3,
      traffic: TR_FORT,
      load: CP_REF,
    },
  },
  {
    id: 'eme2-sur-pf3',
    description: 'EME2 (module eleve) sur PF3, trafic ref',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'EME2', h: 0.13, E: 6151, nu: 0.45 },
        { mat: 'GNT1', h: 0.15, E: 200, nu: 0.35 },
      ],
      subgrade: PF3,
      traffic: TR_REF,
      load: CP_REF,
    },
  },
  {
    id: 'semi-rigide-glc',
    description: 'BBSG sur GLc2 (MTLH), K<0,5 : famille semi-rigide (§4.3, σ_t)',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GLc2', h: 0.22, E: 3000, nu: 0.25 },
        { mat: 'GLc2', h: 0.22, E: 3000, nu: 0.25 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: CP_REF,
    },
  },
  {
    id: 'mixte-bit-mtlh',
    description: 'Paquet bitumineux epais + MTLH (K≥0,5) : famille mixte (§4.4)',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.12, E: 2588, nu: 0.45 },
        { mat: 'GLc1', h: 0.18, E: 2500, nu: 0.25 },
        { mat: 'GNT1', h: 0.15, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: CP_REF,
    },
  },
  {
    id: 'beton-multi-bc5',
    description: 'BC5 multi-couches (interface glissante, Tab. 68 AGEROUTE) sur GNT',
    input: {
      layers: [
        { mat: 'BC5', h: 0.2, E: 35000, nu: 0.25 },
        { mat: 'BC5', h: 0.18, E: 35000, nu: 0.25 },
        { mat: 'GNT1', h: 0.2, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_FORT,
      load: CP_REF,
    },
  },
  {
    id: 'inverse-mtlh-profond',
    description: 'MTLH profond (GLc2) sous granulaire : structure inverse (§4.5)',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.08, E: 2588, nu: 0.45 },
        { mat: 'GNT1', h: 0.12, E: 200, nu: 0.35 },
        { mat: 'GLc2', h: 0.2, E: 3000, nu: 0.25 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: CP_REF,
    },
  },
  {
    id: 'granulaire-pur',
    description: 'Aucune couche liee (GNT/laterite sur PF2) : famille granulaire',
    input: {
      layers: [
        { mat: 'GNT1', h: 0.2, E: 200, nu: 0.35 },
        { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_FAIBLE,
      load: CP_REF,
    },
  },
  {
    id: 'override-manuel-rsk-sh-ks',
    description: 'Overrides manuels risque=10 %, Sh=2,5 cm, ks=0,95',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.11, E: 2588, nu: 0.45 },
        { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: { p: 0.662, a: 0.125, d: 0.375, r: 10, sh: 2.5, ks: 0.95 },
    },
  },
  {
    id: 'borne-charge-centree-d0',
    description: 'Borne : entraxe jumelage d=0 (charge unique centree)',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.07, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.12, E: 2588, nu: 0.45 },
        { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: { p: 0.662, a: 0.125, d: 0, r: 'auto', sh: 'auto', ks: 'auto' },
    },
  },
  {
    id: 'borne-pf-faible',
    description: 'Borne : PSC tres faible (PF1, E=20 MPa) -> orniarage critique',
    input: {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.1, E: 2588, nu: 0.45 },
        { mat: 'GL1', h: 0.2, E: 200, nu: 0.35 },
      ],
      subgrade: { cls: 'PF1', E: 20, nu: 0.35 },
      traffic: TR_REF,
      load: CP_REF,
    },
  },
  // --- HORS-DOMAINE : materiau inconnu -> M[mat] undefined -> le moteur leve ---
  {
    id: 'hors-domaine-materiau-inconnu',
    description:
      'Materiau inconnu (cle absente du referentiel) : le moteur renvoie une erreur',
    horsDomaine: true,
    input: {
      layers: [
        { mat: 'INCONNU_XYZ', h: 0.06, E: 1500, nu: 0.45 },
        { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 },
      ],
      subgrade: PF2,
      traffic: TR_REF,
      load: CP_REF,
    },
  },
];
