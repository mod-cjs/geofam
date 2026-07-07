/**
 * Jeux d'ENTREES pour l'ETALONNAGE pressiometrique (calcEtalonnage, pressiometre__1_.html)
 * — equivalence-portage.
 *
 * Ces fixtures ne contiennent QUE des entrees (`input`) : la REFERENCE (sortie attendue)
 * n'est PAS figee ici — elle est derivee en executant le HTML d'origine via jsdom dans le
 * harnais d'equivalence (provenance 'HTML-origine'). On ne se compare donc jamais a une
 * valeur fabriquee a la main (anti faux-vert).
 *
 * --- UNITES ---
 * P en bar, V15/V30/V60 en cm³. Seuls `p` et `v60` alimentent la science.
 *
 * Couverture :
 *   - jeu de DEMO d'origine (7 paliers) — Pe interpole DANS la plage (1,2·Vs encadre) ;
 *   - droite quasi PARFAITE (residus ~0, R²~1) ;
 *   - Pe par EXTRAPOLATION (aucun palier n'atteint 1,2·Vs -> branche (V_pe−Vs)/a) ;
 *   - MINIMUM de 3 points ;
 *   - beaucoup de points, forte courbure de fin ;
 *   - ordre d'entree NON trie en P (l'etalonnage NE trie PAS : verifie qu'on ne trie pas
 *     par accident, et que Vs_reel = 1er palier d'ENTREE) ;
 *   - HORS-DOMAINE : 2 points seulement (garde « >= 3 points »).
 */
import type { PressioEtalonnageInput } from './contract.js';

export interface PressioEtalonnageFixture {
  id: string;
  description: string;
  /** true si l'on attend une erreur de calcul (garde du moteur). */
  horsDomaine?: boolean;
  input: PressioEtalonnageInput;
}

export const PRESSIO_ETALONNAGE_FIXTURES: readonly PressioEtalonnageFixture[] = [
  {
    id: 'demo-origine-7-paliers',
    description: 'Jeu de demo d origine (7 paliers) — 1,2·Vs=630 encadre par 606/645',
    input: {
      projet: 'Etalonnage — demo',
      label: 'Air',
      rows: [
        { p: 0.2, v15: 524, v30: 525, v60: 525 },
        { p: 0.4, v15: 547, v30: 548, v60: 548 },
        { p: 0.6, v15: 573, v30: 574, v60: 574 },
        { p: 0.8, v15: 605, v30: 606, v60: 606 },
        { p: 1.0, v15: 644, v30: 645, v60: 645 },
        { p: 1.2, v15: 693, v30: 694, v60: 694 },
        { p: 1.4, v15: 754, v30: 755, v60: 755 },
      ],
    },
  },
  {
    id: 'droite-quasi-parfaite',
    description: 'Droite quasi parfaite V=200+30·P (residus ~0, R²~1)',
    input: {
      label: 'Air lineaire',
      rows: [
        { p: 0, v60: 200 },
        { p: 1, v60: 230 },
        { p: 2, v60: 260 },
        { p: 3, v60: 290 },
        { p: 4, v60: 320 },
        { p: 5, v60: 350 },
      ],
    },
  },
  {
    id: 'pe-extrapolation',
    description: 'Aucun palier n atteint 1,2·Vs (100->120) : Pe par extrapolation (V_pe−Vs)/a',
    input: {
      label: 'Air extrapolation',
      rows: [
        { p: 0.5, v60: 100 },
        { p: 1.0, v60: 103 },
        { p: 1.5, v60: 106 },
        { p: 2.0, v60: 109 },
        { p: 2.5, v60: 112 },
      ],
    },
  },
  {
    id: 'minimum-3-points',
    description: 'Minimum de 3 points valides',
    input: {
      label: 'Air 3 pts',
      rows: [
        { p: 0.3, v60: 500 },
        { p: 0.6, v60: 540 },
        { p: 0.9, v60: 700 },
      ],
    },
  },
  {
    id: 'nombreux-paliers-courbure',
    description: '10 paliers, forte courbure de fin (Pe interpole en plage)',
    input: {
      label: 'Air courbe',
      rows: [
        { p: 0.1, v60: 300 },
        { p: 0.2, v60: 305 },
        { p: 0.3, v60: 311 },
        { p: 0.4, v60: 318 },
        { p: 0.5, v60: 327 },
        { p: 0.6, v60: 340 },
        { p: 0.7, v60: 360 },
        { p: 0.8, v60: 392 },
        { p: 0.9, v60: 445 },
        { p: 1.0, v60: 540 },
      ],
    },
  },
  {
    id: 'ordre-non-trie',
    description: 'Entree NON triee en P — l etalonnage ne trie pas ; Vs_reel = 1er palier saisi',
    input: {
      label: 'Air non trie',
      rows: [
        { p: 1.2, v60: 694 },
        { p: 0.2, v60: 525 },
        { p: 0.8, v60: 606 },
        { p: 1.4, v60: 755 },
        { p: 0.4, v60: 548 },
        { p: 1.0, v60: 645 },
        { p: 0.6, v60: 574 },
      ],
    },
  },
  // --- HORS-DOMAINE : < 3 points (garde moteur) --------------------------------------
  {
    id: 'hors-domaine-deux-points',
    description: '2 points seulement -> erreur bornee (garde « >= 3 points »)',
    horsDomaine: true,
    input: {
      label: 'Air insuffisant',
      // 2 points : contourne le schema (min 3) ; exerce via le harnais/moteur direct.
      rows: [
        { p: 0.5, v60: 500 },
        { p: 1.0, v60: 560 },
      ] as unknown as PressioEtalonnageInput['rows'],
    },
  },
];
