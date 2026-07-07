/**
 * Jeux d'ENTREES pour le CALIBRAGE pressiometrique (calcCalibrage, pressiometre__1_.html)
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
 *   - jeu de DEMO d'origine (10 paliers) ;
 *   - droite quasi PARFAITE (R²~1) ;
 *   - courbure NON negligeable (c2 != 0, degre 2 utile) ;
 *   - MINIMUM de 3 points ;
 *   - entree NON triee en P (le calibrage TRIE : verifie que le tri est bien porte) ;
 *   - plage de pression LARGE (grands P, conditionnement du 3×3) ;
 *   - HORS-DOMAINE : 2 points seulement (garde « >= 3 points »).
 */
import type { PressioCalibrageInput } from './contract.js';

export interface PressioCalibrageFixture {
  id: string;
  description: string;
  /** true si l'on attend une erreur de calcul (garde du moteur). */
  horsDomaine?: boolean;
  input: PressioCalibrageInput;
}

export const PRESSIO_CALIBRAGE_FIXTURES: readonly PressioCalibrageFixture[] = [
  {
    id: 'demo-origine-10-paliers',
    description: 'Jeu de demo d origine (10 paliers), P de 1 a 26 bar',
    input: {
      projet: 'Calibrage — demo',
      label: 'Tube',
      rows: [
        { p: 1, v15: 1, v30: 1, v60: 1 },
        { p: 3, v15: 2, v30: 2, v60: 2 },
        { p: 5, v15: 3, v30: 3, v60: 3 },
        { p: 8, v15: 4, v30: 4, v60: 4 },
        { p: 11, v15: 5, v30: 6, v60: 6 },
        { p: 14, v15: 7, v30: 7, v60: 7 },
        { p: 17, v15: 8, v30: 9, v60: 9 },
        { p: 20, v15: 10, v30: 10, v60: 10 },
        { p: 23, v15: 11, v30: 12, v60: 12 },
        { p: 26, v15: 13, v30: 13, v60: 13 },
      ],
    },
  },
  {
    id: 'droite-quasi-parfaite',
    description: 'Relation quasi lineaire V=0,4·P (R²~1)',
    input: {
      label: 'Tube lineaire',
      rows: [
        { p: 2, v60: 0.8 },
        { p: 5, v60: 2.0 },
        { p: 10, v60: 4.0 },
        { p: 15, v60: 6.0 },
        { p: 20, v60: 8.0 },
        { p: 25, v60: 10.0 },
      ],
    },
  },
  {
    id: 'courbure-degre2',
    description: 'Courbure non negligeable (c2 != 0) — ajustement degre 2 utile',
    input: {
      label: 'Tube courbe',
      rows: [
        { p: 1, v60: 0.5 },
        { p: 4, v60: 1.4 },
        { p: 8, v60: 3.2 },
        { p: 12, v60: 6.0 },
        { p: 16, v60: 10.1 },
        { p: 20, v60: 15.6 },
      ],
    },
  },
  {
    id: 'minimum-3-points',
    description: 'Minimum de 3 points valides',
    input: {
      label: 'Tube 3 pts',
      rows: [
        { p: 2, v60: 1 },
        { p: 6, v60: 3 },
        { p: 10, v60: 5 },
      ],
    },
  },
  {
    id: 'ordre-non-trie',
    description: 'Entree NON triee en P — le calibrage TRIE (verifie le portage du tri)',
    input: {
      label: 'Tube non trie',
      rows: [
        { p: 20, v60: 10 },
        { p: 3, v60: 2 },
        { p: 26, v60: 13 },
        { p: 8, v60: 4 },
        { p: 14, v60: 7 },
        { p: 1, v60: 1 },
      ],
    },
  },
  {
    id: 'plage-pression-large',
    description: 'Grands P (jusqu a 50 bar) — conditionnement du systeme 3×3',
    input: {
      label: 'Tube large',
      rows: [
        { p: 5, v60: 2 },
        { p: 12, v60: 5 },
        { p: 22, v60: 9 },
        { p: 33, v60: 14 },
        { p: 42, v60: 18 },
        { p: 50, v60: 22 },
      ],
    },
  },
  // --- HORS-DOMAINE : < 3 points (garde moteur) --------------------------------------
  {
    id: 'hors-domaine-deux-points',
    description: '2 points seulement -> erreur bornee (garde « >= 3 points »)',
    horsDomaine: true,
    input: {
      label: 'Tube insuffisant',
      rows: [
        { p: 2, v60: 1 },
        { p: 6, v60: 3 },
      ] as unknown as PressioCalibrageInput['rows'],
    },
  },
];
