/**
 * Jeux d'ENTREES du moteur AXISYMETRIQUE (plaque annulaire / radier circulaire) pour
 * l'equivalence-portage.
 *
 * Ces fixtures ne contiennent QUE des entrees (`input`) : la REFERENCE (sortie attendue)
 * n'est PAS figee ici — elle est DERIVEE en executant le HTML d'origine via jsdom dans le
 * harnais d'equivalence (provenance 'HTML-origine'). On ne se compare donc jamais a une
 * valeur fabriquee a la main (anti faux-vert).
 *
 * --- UNITES (meme decision que le radier, cf. contract.ts) ---
 * E en MPa (beton ~32000, sol ~8..50), zBase en m (negatif vers le bas), q en kPa, Pc en
 * kN, R/e en m. On feed les MEMES nombres au HTML et au module -> l'equivalence est
 * unite-agnostique (les deux cotes calculent a l'identique).
 *
 * Couverture :
 *   - charge repartie q seule ; charge centrale Pc seule ; q + Pc combinees ;
 *   - 2 couches contrastees ; couche unique ; couches a module identique (degenere) ;
 *   - cote d'assise D > 0 (foundD) ; assise TROP profonde (garde z0 = deepest - 0.5) ;
 *   - discretisation grossiere (ne=6, plancher moteur) et plus fine (ne=24) ;
 *   - HORS-DOMAINE : aucune couche de sol -> garde du moteur (throw).
 */
import type { AxiInput } from './contract.js';

export interface AxiFixture {
  id: string;
  description: string;
  /** true si l'on attend une erreur de calcul (garde du moteur). */
  horsDomaine?: boolean;
  input: AxiInput;
}

/** Sol a 2 couches contrastees (E en MPa, zBase en m). */
const LAYERS_2: AxiInput['layers'] = [
  { name: 'limon', zBase: -3, E: 8, nu: 0.33 },
  { name: 'sable', zBase: -12, E: 25, nu: 0.3 },
];

/** Sol a couche unique. */
const LAYERS_1: AxiInput['layers'] = [{ name: 'argile', zBase: -15, E: 12, nu: 0.33 }];

/** Sol a couches de MODULE IDENTIQUE (pas de contraste de raideur). */
const LAYERS_SAME: AxiInput['layers'] = [
  { name: 'a', zBase: -4, E: 15, nu: 0.3 },
  { name: 'b', zBase: -12, E: 15, nu: 0.3 },
];

/** Materiau beton typique (E en MPa). */
const BETON = { E: 32000, nu: 0.2 } as const;

export const AXI_FIXTURES: readonly AxiFixture[] = [
  {
    id: 'q-reparti-2couches',
    description: 'Dallage R=6 m, e=0,4 m, charge répartie 120 kPa, 2 couches, ne=12',
    input: {
      projet: 'Axi — q réparti',
      layers: LAYERS_2,
      o: { R: 6, e: 0.4, ...BETON, q: 120, Pc: 0, ne: 12, foundD: 0 },
    },
  },
  {
    id: 'pc-central-2couches',
    description: 'Dallage R=5 m, e=0,5 m, charge centrale 1500 kN seule, 2 couches, ne=16',
    input: {
      projet: 'Axi — Pc central',
      layers: LAYERS_2,
      o: { R: 5, e: 0.5, ...BETON, q: 0, Pc: 1500, ne: 16, foundD: 0 },
    },
  },
  {
    id: 'q-plus-pc-combinees',
    description: 'Dallage R=8 m, e=0,6 m, q=80 kPa + Pc=1000 kN combinées, 2 couches, ne=20',
    input: {
      projet: 'Axi — q + Pc',
      layers: LAYERS_2,
      o: { R: 8, e: 0.6, ...BETON, q: 80, Pc: 1000, ne: 20, foundD: 0 },
    },
  },
  {
    id: 'couche-unique',
    description: 'Dallage R=6 m, e=0,4 m, q=150 kPa, SOL a couche unique, ne=12',
    input: {
      projet: 'Axi — couche unique',
      layers: LAYERS_1,
      o: { R: 6, e: 0.4, ...BETON, q: 150, Pc: 0, ne: 12, foundD: 0 },
    },
  },
  {
    id: 'cote-assise-D',
    description: 'Dallage R=6 m, e=0,4 m, q=120 kPa, cote d’assise D=2 m (foundD), ne=16',
    input: {
      projet: 'Axi — assise D=2',
      layers: LAYERS_2,
      o: { R: 6, e: 0.4, ...BETON, q: 120, Pc: 0, ne: 16, foundD: 2 },
    },
  },
  {
    id: 'assise-trop-profonde-garde-z0',
    description:
      'Dallage R=6 m, q=120 kPa, assise D=20 m >= substratum -> garde z0 = deepest - 0,5, ne=12',
    input: {
      projet: 'Axi — assise trop profonde',
      layers: LAYERS_2,
      o: { R: 6, e: 0.4, ...BETON, q: 120, Pc: 0, ne: 12, foundD: 20 },
    },
  },
  {
    id: 'ne-grossier-6',
    description: 'Dallage R=4 m, e=0,3 m, q=200 kPa, discrétisation minimale ne=6 (plancher)',
    input: {
      projet: 'Axi — ne=6',
      layers: LAYERS_2,
      o: { R: 4, e: 0.3, ...BETON, q: 200, Pc: 0, ne: 6, foundD: 0 },
    },
  },
  {
    id: 'degenere-couches-E-identiques',
    description: 'DEGENERE : couches à module E identique (pas de contraste), q=120 kPa, ne=24',
    input: {
      projet: 'Axi — couches E identiques',
      layers: LAYERS_SAME,
      o: { R: 6, e: 0.4, ...BETON, q: 120, Pc: 0, ne: 24, foundD: 0 },
    },
  },
  // --- HORS-DOMAINE : aucune couche de sol -> garde du moteur ---------------------
  {
    id: 'hors-domaine-aucune-couche',
    description:
      'Aucune couche de sol -> erreur bornée « Définis au moins une couche de sol » (garde moteur)',
    horsDomaine: true,
    input: {
      projet: 'Axi — hors domaine',
      // layers vide : contourne le schema (le test appelle le MOTEUR directement) pour
      // exercer la garde interne de solveAxi (identique cote HTML).
      layers: [] as unknown as AxiInput['layers'],
      o: { R: 6, e: 0.4, ...BETON, q: 120, Pc: 0, ne: 12, foundD: 0 },
    },
  },
];
