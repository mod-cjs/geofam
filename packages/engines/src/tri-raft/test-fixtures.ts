/**
 * Jeux d'ENTREES radier TRIANGULAIRE (GEOPLAQUE / solveTriRaft, DKT multicouche) pour
 * l'equivalence-portage et le determinisme.
 *
 * Ces fixtures ne contiennent QUE des entrees (`input`) : la REFERENCE (sortie attendue)
 * n'est PAS figee ici — elle est derivee en executant le HTML d'origine via jsdom dans
 * le harnais d'equivalence (provenance 'HTML-origine'). On ne se compare jamais a une
 * valeur fabriquee a la main (anti faux-vert).
 *
 * --- UNITES (pas de piege pour l'equivalence) ---
 * Tout en metres + module E en MPa (unites internes, meme convention que le radier ACM).
 * pts en m, e en m, zBase en m (negatif vers le bas), Fz en kN, q surfacique en kPa, q
 * lineique en kN/ml, target = aire cible du triangle en m². Module et HTML recoivent des
 * entrees IDENTIQUES : l'equivalence est neutre au choix d'unite.
 *
 * Couverture :
 *   - carre, charge ponctuelle centree ;
 *   - carre, charge repartie uniforme q (opts.q, branche assemblage F) ;
 *   - rectangle, charge ponctuelle excentree ;
 *   - carre, charge LINEIQUE (subdivision + _distribTri) ;
 *   - carre, charge SURFACIQUE sur la plaque (branche areaLoads 'raft') ;
 *   - DEUX plaques (offset d'indices + couplage par le sol) ;
 *   - plaque NON-CONVEXE (polygone en L : ear-clipping non trivial) ;
 *   - excavation foundD>0 (cote d'assise z0) ;
 *   - plaque SANS materiau propre -> repli sur opts.E/opts.nu/opts.e ;
 *   - HORS-DOMAINE : target si petit que le maillage depasse 1200 nœuds (garde moteur).
 */
import type { TriRaftInput } from './contract.js';

export interface TriRaftFixture {
  id: string;
  description: string;
  /** true si l'on attend une erreur de calcul (garde du moteur). */
  horsDomaine?: boolean;
  input: TriRaftInput;
}

/** Profil de sol a 2 couches (E en MPa, zBase en m, negatif vers le bas). */
const LAYERS_2: TriRaftInput['layers'] = [
  { name: 'limon', zBase: -3, E: 8, nu: 0.33 },
  { name: 'sable', zBase: -12, E: 25, nu: 0.3 },
];

/** Materiau beton typique d'une plaque (E en MPa). */
const BETON = { E: 32000, nu: 0.2, e: 0.4 } as const;

/** Carre [0..6]×[0..6]. */
const CARRE_6: TriRaftInput['rafts'][number]['pts'] = [
  { x: 0, y: 0 },
  { x: 6, y: 0 },
  { x: 6, y: 6 },
  { x: 0, y: 6 },
];

/** Rectangle [0..8]×[0..4]. */
const RECT_8x4: TriRaftInput['rafts'][number]['pts'] = [
  { x: 0, y: 0 },
  { x: 8, y: 0 },
  { x: 8, y: 4 },
  { x: 0, y: 4 },
];

/** Polygone en L (non convexe). */
const POLY_L: TriRaftInput['rafts'][number]['pts'] = [
  { x: 0, y: 0 },
  { x: 6, y: 0 },
  { x: 6, y: 3 },
  { x: 3, y: 3 },
  { x: 3, y: 6 },
  { x: 0, y: 6 },
];

/** Options de base : target 2 m², materiau par defaut = beton. */
const OPTS_BASE: TriRaftInput['opts'] = { target: 2, e: 0.4, E: 32000, nu: 0.2 };

function base(over: Partial<TriRaftInput>): TriRaftInput {
  return {
    projet: 'Radier triangulaire — exemple',
    rafts: [{ pts: CARRE_6, ...BETON }],
    pointLoads: [],
    lineLoads: [],
    areaLoads: [],
    layers: LAYERS_2,
    opts: OPTS_BASE,
    ...over,
  };
}

export const TRI_RAFT_FIXTURES: readonly TriRaftFixture[] = [
  {
    id: 'carre-charge-centree',
    description: 'Radier carré 6×6, charge ponctuelle centrée 1000 kN, 2 couches',
    input: base({ pointLoads: [{ x: 3, y: 3, Fz: 1000 }] }),
  },
  {
    id: 'carre-charge-repartie-q',
    description: 'Radier carré 6×6, charge répartie uniforme q=50 kPa (branche assemblage F)',
    input: base({ opts: { ...OPTS_BASE, q: 50 } }),
  },
  {
    id: 'rect-charge-excentree',
    description: 'Radier rectangulaire 8×4, charge ponctuelle excentrée 1500 kN',
    input: base({
      rafts: [{ pts: RECT_8x4, ...BETON }],
      pointLoads: [{ x: 6, y: 2, Fz: 1500 }],
    }),
  },
  {
    id: 'carre-charge-lineique',
    description: 'Radier carré 6×6, charge LINÉIQUE 120 kN/ml (subdivision + _distribTri)',
    input: base({ lineLoads: [{ x1: 1, y1: 1, x2: 5, y2: 1, q: 120 }] }),
  },
  {
    id: 'carre-charge-surfacique-raft',
    description: 'Radier carré 6×6, charge surfacique 50 kPa sur la plaque (branche areaLoads raft)',
    input: base({
      areaLoads: [{ x1: 1, y1: 1, x2: 5, y2: 5, q: 50, on: 'raft' }],
    }),
  },
  {
    id: 'carre-mixte-charges',
    description: 'Radier 6×6 : ponctuelle + répartie q + surfacique raft (superposition des branches)',
    input: base({
      pointLoads: [{ x: 2, y: 2, Fz: 600 }],
      areaLoads: [{ x1: 3, y1: 3, x2: 5, y2: 5, q: 40, on: 'raft' }],
      opts: { ...OPTS_BASE, q: 20 },
    }),
  },
  {
    id: 'deux-plaques',
    description: 'DEUX radiers voisins (offset d’indices + couplage par le sol)',
    input: base({
      rafts: [
        { pts: CARRE_6, ...BETON },
        {
          pts: [
            { x: 8, y: 0 },
            { x: 12, y: 0 },
            { x: 12, y: 6 },
            { x: 8, y: 6 },
          ],
          ...BETON,
        },
      ],
      pointLoads: [
        { x: 3, y: 3, Fz: 1500 },
        { x: 10, y: 3, Fz: 500 },
      ],
    }),
  },
  {
    id: 'plaque-non-convexe-L',
    description: 'Plaque non-convexe (polygone en L : ear-clipping non trivial)',
    input: base({
      rafts: [{ pts: POLY_L, ...BETON }],
      pointLoads: [{ x: 1.5, y: 1.5, Fz: 900 }],
    }),
  },
  {
    id: 'excavation-foundD',
    description: 'Radier 6×6, cote d’assise D=1,5 m (souplesse des couches sous D)',
    input: base({
      pointLoads: [{ x: 3, y: 3, Fz: 800 }],
      opts: { ...OPTS_BASE, foundD: 1.5 },
    }),
  },
  {
    id: 'raft-materiau-defaut',
    description: 'Plaque SANS matériau propre -> repli sur opts.E/opts.nu/opts.e',
    input: base({
      rafts: [{ pts: CARRE_6 }],
      pointLoads: [{ x: 3, y: 3, Fz: 1000 }],
      opts: { target: 2, e: 0.5, E: 30000, nu: 0.2 },
    }),
  },
  // --- HORS-DOMAINE : maillage TROP FIN -> > 1200 nœuds (garde moteur) --------------
  {
    id: 'hors-domaine-maillage-trop-fin',
    description:
      'Grande plaque 12×12 avec target=0,05 m² -> raffinement massif > 1200 nœuds : erreur bornée (garde N>1200)',
    horsDomaine: true,
    input: {
      projet: 'Radier triangulaire — hors domaine',
      rafts: [
        {
          pts: [
            { x: 0, y: 0 },
            { x: 12, y: 0 },
            { x: 12, y: 12 },
            { x: 0, y: 12 },
          ],
          ...BETON,
        },
      ],
      pointLoads: [{ x: 6, y: 6, Fz: 1000 }],
      lineLoads: [],
      areaLoads: [],
      layers: LAYERS_2,
      opts: { target: 0.05, e: 0.4, E: 32000, nu: 0.2 },
    },
  },
];
