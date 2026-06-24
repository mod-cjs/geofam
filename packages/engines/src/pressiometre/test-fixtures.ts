/**
 * Jeux d'ENTREES pressiometre Menard pour l'equivalence-portage et l'e2e (#47).
 *
 * Ces fixtures ne contiennent QUE des entrees (`input`) : la REFERENCE (sortie
 * attendue) n'est PAS figee ici — elle est derivee en executant le HTML d'origine
 * via jsdom dans le harnais d'equivalence (provenance 'HTML-origine'). On ne se
 * compare donc jamais a une valeur fabriquee a la main (anti faux-vert).
 *
 * --- PROVENANCE DES DONNEES NOMINALES ---
 * Les 4 profondeurs (2/4/6/8 m) et les parametres sonde proviennent du jeu de
 * demonstration `loadExempleFictif()` du HTML d'origine (sondage SP-DEMO). Les
 * parametres y sont saisis en cm³/MPa (a='5') ; `getParams()` du HTML DIVISE par
 * 10 -> a=0,5 cm³/bar (unite interne du moteur). Nos fixtures fournissent donc
 * `params.a = 0.5` (deja converti, cf. en-tete du contrat). gamma non saisi dans
 * l'exemple -> defaut DOM 19 kN/m³ ; nappe='3.0' m.
 *
 * Couverture :
 *   - 4 profondeurs reelles (categories B/C/D selon la coupe) — seuils manuels
 *     (pf_idx=2, plm_idx=5) comme l'exemple d'origine ;
 *   - selection AUTO des seuils (pf_idx/plm_idx absents) ;
 *   - sans nappe (nappe=0 -> u0=0) ;
 *   - parametres sonde alternatifs (a=0, k0 different) ;
 *   - bornes : `a` volontairement trop grand (le moteur force a=0, §validation) ;
 *     profondeur faible (z petit) ;
 *   - HORS-DOMAINE : moins de 4 paliers valides (le moteur renvoie une erreur
 *     bornee, parite avec `calcDepth` qui ne pose pas `_res`).
 */
import type { PressiometreInput } from './contract.js';

export interface PressiometreFixture {
  id: string;
  description: string;
  /** true si l'on attend une erreur de calcul (hors-domaine / donnees insuffisantes). */
  horsDomaine?: boolean;
  input: PressiometreInput;
}

/** Parametres sonde de l'exemple d'origine (a deja converti en cm³/bar : 5/10). */
const PARAMS_DEMO: PressiometreInput['params'] = {
  a: 0.5,
  Ph: 0.5,
  Pe: 1.0,
  V0: 535,
  k0: 0.5,
};

/** Paliers de mesure des 4 profondeurs (verbatim loadExempleFictif). */
const ROWS_2M: PressiometreInput['rows'] = [
  { p: 0.8, v15: 21, v30: 22, v60: 24 },
  { p: 1.2, v15: 44, v30: 45, v60: 47 },
  { p: 1.6, v15: 68, v30: 69, v60: 70 },
  { p: 2, v15: 88, v30: 89, v60: 90 },
  { p: 2.4, v15: 108, v30: 109, v60: 110 },
  { p: 2.8, v15: 127, v30: 128, v60: 130 },
  { p: 3.2, v15: 144, v30: 148, v60: 154 },
  { p: 3.6, v15: 171, v30: 177, v60: 188 },
  { p: 4, v15: 219, v30: 227, v60: 242 },
  { p: 4.4, v15: 310, v30: 321, v60: 340 },
];
const ROWS_4M: PressiometreInput['rows'] = [
  { p: 1, v15: 82, v30: 83, v60: 86 },
  { p: 2, v15: 100, v30: 101, v60: 103 },
  { p: 3, v15: 118, v30: 119, v60: 120 },
  { p: 4, v15: 133, v30: 134, v60: 135 },
  { p: 5, v15: 148, v30: 149, v60: 150 },
  { p: 6, v15: 163, v30: 164, v60: 165 },
  { p: 7, v15: 174, v30: 177, v60: 182 },
  { p: 8, v15: 190, v30: 194, v60: 202 },
  { p: 9, v15: 213, v30: 219, v60: 229 },
  { p: 10, v15: 245, v30: 252, v60: 265 },
  { p: 11, v15: 290, v30: 299, v60: 315 },
  { p: 12, v15: 361, v30: 371, v60: 390 },
];
const ROWS_6M: PressiometreInput['rows'] = [
  { p: 1, v15: 88, v30: 89, v60: 92 },
  { p: 2, v15: 98, v30: 99, v60: 101 },
  { p: 3, v15: 108, v30: 109, v60: 110 },
  { p: 5, v15: 124, v30: 125, v60: 126 },
  { p: 7, v15: 140, v30: 141, v60: 142 },
  { p: 9, v15: 155, v30: 156, v60: 158 },
  { p: 11, v15: 166, v30: 170, v60: 178 },
  { p: 12, v15: 177, v30: 183, v60: 194 },
  { p: 13, v15: 193, v30: 201, v60: 215 },
  { p: 14, v15: 219, v30: 229, v60: 246 },
  { p: 15, v15: 266, v30: 277, v60: 297 },
];
const ROWS_8M: PressiometreInput['rows'] = [
  { p: 2, v15: 78, v30: 79, v60: 82 },
  { p: 4, v15: 88, v30: 89, v60: 91 },
  { p: 6, v15: 98, v30: 99, v60: 100 },
  { p: 9, v15: 110, v30: 111, v60: 112 },
  { p: 12, v15: 122, v30: 123, v60: 124 },
  { p: 15, v15: 133, v30: 134, v60: 136 },
  { p: 18, v15: 142, v30: 145, v60: 150 },
  { p: 21, v15: 154, v30: 159, v60: 168 },
  { p: 24, v15: 174, v30: 181, v60: 193 },
  { p: 27, v15: 204, v30: 213, v60: 229 },
  { p: 30, v15: 259, v30: 270, v60: 289 },
  { p: 33, v15: 358, v30: 370, v60: 393 },
];

export const PRESSIOMETRE_FIXTURES: readonly PressiometreFixture[] = [
  {
    id: 'demo-2m-seuils-manuels',
    description:
      'Profondeur 2 m (exemple SP-DEMO), seuils manuels pf_idx=2/plm_idx=5 — sol mou/ferme',
    input: {
      projet: 'Exemple fictif — sondage de démonstration',
      label: '2.0 m',
      params: PARAMS_DEMO,
      gamma: 19,
      nappe: 3.0,
      rows: ROWS_2M,
      pf_idx: 2,
      plm_idx: 5,
    },
  },
  {
    id: 'demo-4m-seuils-manuels',
    description: 'Profondeur 4 m (exemple SP-DEMO), seuils manuels — sol ferme',
    input: {
      label: '4.0 m',
      params: PARAMS_DEMO,
      gamma: 19,
      nappe: 3.0,
      rows: ROWS_4M,
      pf_idx: 2,
      plm_idx: 5,
    },
  },
  {
    id: 'demo-6m-seuils-manuels',
    description: 'Profondeur 6 m (exemple SP-DEMO), seuils manuels — sol dense',
    input: {
      label: '6.0 m',
      params: PARAMS_DEMO,
      gamma: 19,
      nappe: 3.0,
      rows: ROWS_6M,
      pf_idx: 2,
      plm_idx: 5,
    },
  },
  {
    id: 'demo-8m-seuils-manuels',
    description: 'Profondeur 8 m (exemple SP-DEMO), seuils manuels — sol dense/raide',
    input: {
      label: '8.0 m',
      params: PARAMS_DEMO,
      gamma: 19,
      nappe: 3.0,
      rows: ROWS_8M,
      pf_idx: 2,
      plm_idx: 5,
    },
  },
  {
    id: 'demo-4m-seuils-auto',
    description:
      'Profondeur 4 m, selection AUTO des seuils (pf_idx/plm_idx absents) : analyse de pente §D.5.1',
    input: {
      label: '4.0 m',
      params: PARAMS_DEMO,
      gamma: 19,
      nappe: 3.0,
      rows: ROWS_4M,
    },
  },
  {
    id: 'demo-6m-seuils-auto',
    description: 'Profondeur 6 m, selection AUTO des seuils',
    input: {
      label: '6.0 m',
      params: PARAMS_DEMO,
      gamma: 19,
      nappe: 3.0,
      rows: ROWS_6M,
    },
  },
  {
    id: 'demo-8m-sans-nappe',
    description: 'Profondeur 8 m, SANS nappe (nappe=0 -> u0=0, sigH0 = k0·γ·z)',
    input: {
      label: '8.0 m',
      params: PARAMS_DEMO,
      gamma: 19,
      nappe: 0,
      rows: ROWS_8M,
      pf_idx: 2,
      plm_idx: 5,
    },
  },
  {
    id: 'demo-4m-a-nul',
    description: 'Profondeur 4 m, inertie a=0 (pas de correction de volume)',
    input: {
      label: '4.0 m',
      params: { a: 0, Ph: 0.5, Pe: 1.0, V0: 535, k0: 0.5 },
      gamma: 19,
      nappe: 3.0,
      rows: ROWS_4M,
      pf_idx: 2,
      plm_idx: 5,
    },
  },
  {
    id: 'demo-6m-k0-fort',
    description: 'Profondeur 6 m, K0=1,0 (terres au repos eleve -> sigH0 plus grand)',
    input: {
      label: '6.0 m',
      params: { a: 0.5, Ph: 0.5, Pe: 1.0, V0: 535, k0: 1.0 },
      gamma: 21,
      nappe: 3.0,
      rows: ROWS_6M,
      pf_idx: 2,
      plm_idx: 5,
    },
  },
  {
    id: 'borne-a-trop-grand',
    description:
      'Borne : a volontairement TRES grand (a·Pmax > 0,5·V60_moy) -> le moteur force a=0 (validation, console.warn)',
    input: {
      label: '2.0 m',
      params: { a: 50, Ph: 0.5, Pe: 1.0, V0: 535, k0: 0.5 },
      gamma: 19,
      nappe: 3.0,
      rows: ROWS_2M,
      pf_idx: 2,
      plm_idx: 5,
    },
  },
  {
    id: 'borne-profondeur-faible',
    description: 'Borne : profondeur faible (z=0,5 m, au-dessus de la nappe -> u0=0)',
    input: {
      label: '0.5 m',
      params: PARAMS_DEMO,
      gamma: 19,
      nappe: 3.0,
      rows: ROWS_2M,
      pf_idx: 2,
      plm_idx: 5,
    },
  },
  // --- CHEMINS DEGENERES (MINEUR-3) : couvrir les branches non-nominales ---------
  {
    id: 'degenere-em-nul-dv-negatif',
    description:
      'Chemin EM=0 : courbe v60 NON-MONOTONE, seuils manuels bracketant un creux -> _dV<=0 (V(pf) < V(p0)). Le moteur emet le console.warn « EM=0 » et pose EM=0.',
    input: {
      label: '4.0 m',
      params: PARAMS_DEMO,
      gamma: 19,
      nappe: 3.0,
      // v60 monte puis REDESCEND : avec p0I=2 (v60=110) et pfI=4 (v60=92), _dV=-18<=0.
      rows: [
        { p: 1, v15: 22, v30: 23, v60: 24 },
        { p: 2, v15: 60, v30: 62, v60: 65 },
        { p: 3, v15: 104, v30: 107, v60: 110 },
        { p: 4, v15: 98, v30: 100, v60: 102 },
        { p: 5, v15: 88, v30: 90, v60: 92 },
      ],
      pf_idx: 2,
      plm_idx: 4,
    },
  },
  {
    id: 'degenere-pl-extrapole-pf-fois-2',
    description:
      'Chemin pL=Pf×2 : seuil pf place sur le DERNIER palier -> zone plastique a < 2 points -> fitRecip B=0 -> recipPLM=0 (non > Pf) -> pL=Pf×2 (puis borne >= derniere pression). pL_direct null (extrapole).',
    input: {
      label: '4.0 m',
      params: PARAMS_DEMO,
      gamma: 19,
      nappe: 3.0,
      rows: [
        { p: 1, v15: 80, v30: 82, v60: 86 },
        { p: 2, v15: 100, v30: 102, v60: 105 },
        { p: 3, v15: 120, v30: 123, v60: 128 },
        { p: 4, v15: 142, v30: 146, v60: 153 },
        { p: 5, v15: 168, v30: 173, v60: 182 },
      ],
      pf_idx: 1,
      plm_idx: 4,
    },
  },
  // --- HORS-DOMAINE : moins de 4 paliers valides -> le moteur n'ecrit pas _res ---
  {
    id: 'hors-domaine-paliers-insuffisants',
    description:
      'Moins de 4 paliers valides : le moteur renvoie une erreur bornee (donnees insuffisantes)',
    horsDomaine: true,
    input: {
      label: '2.0 m',
      params: PARAMS_DEMO,
      gamma: 19,
      nappe: 3.0,
      rows: [
        { p: 0.8, v15: 21, v30: 22, v60: 24 },
        { p: 1.2, v15: 44, v30: 45, v60: 47 },
        { p: 1.6, v15: 68, v30: 69, v60: 70 },
      ],
    },
  },
];
