/**
 * Jeux d'ENTREES radier/plaque (GEOPLAQUE, EF multicouche) pour l'equivalence-portage
 * et l'e2e (#54).
 *
 * Ces fixtures ne contiennent QUE des entrees (`input`) : la REFERENCE (sortie
 * attendue) n'est PAS figee ici — elle est derivee en executant le HTML d'origine via
 * jsdom dans le harnais d'equivalence (provenance 'HTML-origine'). On ne se compare
 * donc jamais a une valeur fabriquee a la main (anti faux-vert).
 *
 * --- UNITES (pas de piege) ---
 * Tout en metres + module E en MPa (unites internes du moteur). pts en m, e en m,
 * zBase en m (negatif vers le bas), Fz en kN, q surfacique en kPa, q lineique en
 * kN/ml, k de ressort en kN/m (ponctuel) ou kN/m par m (lineique), mesh en m.
 *
 * Couverture :
 *   - radier carre simple, charge centree, 2 couches ;
 *   - radier rectangulaire, charges ponctuelles multiples (distorsion entre charges) ;
 *   - charge surfacique sur la plaque ('raft') et sur le sol ('soil') ;
 *   - DEUX plaques (distorsion INTER-plaques betaInter/interDiff) ;
 *   - decollement (contact unilateral) ;
 *   - Winkler additionnel (kWink) ;
 *   - excavation/recompression (sigV0 + kRec) ;
 *   - pendage des interfaces (dipX) ;
 *   - DEGENERE : couches a E identiques (pas de saut de raideur) ;
 *   - DEGENERE : plaque non-convexe (polygone en L) ;
 *   - HORS-DOMAINE : maillage si grossier que la plaque genere < 4 nœuds (garde moteur).
 */
import type { RadierInput } from './contract.js';

export interface RadierFixture {
  id: string;
  description: string;
  /** true si l'on attend une erreur de calcul (garde du moteur). */
  horsDomaine?: boolean;
  input: RadierInput;
}

/** Profil de sol a 2 couches (E en MPa, zBase en m, negatif vers le bas). */
const LAYERS_2: RadierInput['layers'] = [
  { name: 'limon', zBase: -3, E: 8, nu: 0.33 },
  { name: 'sable', zBase: -12, E: 25, nu: 0.3 },
];

/** Profil a couches de MODULE IDENTIQUE (pas de contraste de raideur). */
const LAYERS_SAME: RadierInput['layers'] = [
  { name: 'a', zBase: -4, E: 15, nu: 0.3 },
  { name: 'b', zBase: -12, E: 15, nu: 0.3 },
];

/** Materiau beton typique d'une plaque. */
const BETON = { E: 32000, nu: 0.2, e: 0.4 } as const;

/** Carre [0..6]×[0..6]. */
const CARRE_6: RadierInput['rafts'][number]['pts'] = [
  { x: 0, y: 0 },
  { x: 6, y: 0 },
  { x: 6, y: 6 },
  { x: 0, y: 6 },
];

/** Rectangle [0..8]×[0..4]. */
const RECT_8x4: RadierInput['rafts'][number]['pts'] = [
  { x: 0, y: 0 },
  { x: 8, y: 0 },
  { x: 8, y: 4 },
  { x: 0, y: 4 },
];

/** Polygone en L (non convexe). */
const POLY_L: RadierInput['rafts'][number]['pts'] = [
  { x: 0, y: 0 },
  { x: 6, y: 0 },
  { x: 6, y: 3 },
  { x: 3, y: 3 },
  { x: 3, y: 6 },
  { x: 0, y: 6 },
];

const NO_OPT: RadierInput['opts'] = { mesh: 1.0 };

function base(over: Partial<RadierInput>): RadierInput {
  return {
    projet: 'Radier — exemple',
    rafts: [{ pts: CARRE_6, ...BETON }],
    pointLoads: [],
    lineLoads: [],
    areaLoads: [],
    pointSprings: [],
    lineSprings: [],
    layers: LAYERS_2,
    opts: NO_OPT,
    ...over,
  };
}

export const RADIER_FIXTURES: readonly RadierFixture[] = [
  {
    id: 'carre-charge-centree',
    description: 'Radier carré 6×6, charge ponctuelle centrée 1000 kN, 2 couches',
    input: base({ pointLoads: [{ x: 3, y: 3, Fz: 1000 }] }),
  },
  {
    id: 'carre-quatre-poteaux',
    description: 'Radier carré 6×6, 4 poteaux (distorsion entre charges voisines)',
    input: base({
      pointLoads: [
        { x: 1.5, y: 1.5, Fz: 600 },
        { x: 4.5, y: 1.5, Fz: 900 },
        { x: 1.5, y: 4.5, Fz: 700 },
        { x: 4.5, y: 4.5, Fz: 1200 },
      ],
    }),
  },
  {
    id: 'rect-charge-excentree',
    description: 'Radier rectangulaire 8×4, charge excentrée (inclinaison tilt)',
    input: base({
      rafts: [{ pts: RECT_8x4, ...BETON }],
      pointLoads: [{ x: 6, y: 2, Fz: 1500 }],
    }),
  },
  {
    id: 'carre-charge-surfacique-raft',
    description: 'Radier carré 6×6, charge surfacique 50 kPa sur la plaque',
    input: base({
      areaLoads: [{ x1: 1, y1: 1, x2: 5, y2: 5, q: 50, on: 'raft' }],
    }),
  },
  {
    id: 'carre-charge-soil-voisine',
    description: 'Radier 6×6 + charge surfacique 30 kPa sur le SOL voisin (champ libre)',
    input: base({
      pointLoads: [{ x: 3, y: 3, Fz: 800 }],
      areaLoads: [{ x1: 7, y1: 0, x2: 10, y2: 6, q: 30, on: 'soil' }],
    }),
  },
  {
    id: 'deux-plaques-inter',
    description: 'DEUX radiers voisins (distorsion INTER-plaques betaInter/interDiff)',
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
    id: 'decollement',
    description: 'Radier 6×6, charge très excentrée + décollement (contact unilatéral)',
    input: base({
      rafts: [{ pts: RECT_8x4, ...BETON }],
      pointLoads: [{ x: 0.5, y: 2, Fz: 2000 }],
      opts: { mesh: 1.0, decol: true },
    }),
  },
  {
    id: 'winkler-additionnel',
    description: 'Radier 6×6 + module de réaction Winkler additionnel 5000 kN/m³',
    input: base({
      pointLoads: [{ x: 3, y: 3, Fz: 1000 }],
      opts: { mesh: 1.0, kWink: 5000 },
    }),
  },
  {
    id: 'winkler-plastification',
    description:
      'Radier 6×6, Winkler 8000 kN/m³ PLASTIFIÉ à pLimWink=80 kPa (branche winkPlast)',
    input: base({
      pointLoads: [{ x: 3, y: 3, Fz: 2500 }],
      opts: { mesh: 1.0, kWink: 8000, pLimWink: 80 },
    }),
  },
  {
    id: 'charges-ligne-et-ressorts',
    description:
      'Radier 6×6 : charge LINÉIQUE + ressorts PONCTUELS + ressort LINÉIQUE (branches lineLoads/addNodalSpring)',
    input: base({
      pointLoads: [{ x: 3, y: 3, Fz: 400 }],
      lineLoads: [{ x1: 1, y1: 1, x2: 5, y2: 1, q: 120 }],
      pointSprings: [
        { x: 1, y: 5, k: 30000 },
        { x: 5, y: 5, k: 30000 },
      ],
      lineSprings: [{ x1: 0, y1: 3, x2: 6, y2: 3, k: 8000 }],
    }),
  },
  {
    id: 'excavation-recompression',
    description: 'Radier 6×6, fond de fouille σv0=60 kPa, recompression k=3, D=1,5 m',
    input: base({
      pointLoads: [{ x: 3, y: 3, Fz: 800 }],
      opts: { mesh: 1.0, sigV0: 60, kRec: 3, foundD: 1.5 },
    }),
  },
  {
    id: 'pendage-interfaces',
    description: 'Radier 6×6, interfaces de sol en pendage dipX=0,1 m/m',
    input: base({
      pointLoads: [{ x: 3, y: 3, Fz: 1000 }],
      opts: { mesh: 1.0, dipX: 0.1 },
    }),
  },
  {
    id: 'qlim-plastification',
    description: 'Radier 6×6, plastification de l’interface qLim=120 kPa + décollement',
    input: base({
      pointLoads: [{ x: 3, y: 3, Fz: 2500 }],
      opts: { mesh: 1.0, qLim: 120, decol: true },
    }),
  },
  {
    id: 'qlim-overcap-poinconnement',
    description:
      'Radier 6×6, charge 5000 kN concentrée + qLim=20 kPa insuffisant + décollement → ' +
      'poinçonnement (overCap : plus aucun nœud actif, résultats NON VALIDES)',
    input: base({
      pointLoads: [{ x: 3, y: 3, Fz: 5000 }],
      opts: { mesh: 1.0, qLim: 20, decol: true },
    }),
  },
  {
    id: 'ressorts-ponctuels-seuls',
    description:
      'Radier 6×6, charge centrée + ressorts PONCTUELS seuls (branche sprOn sans ressort linéique)',
    input: base({
      pointLoads: [{ x: 3, y: 3, Fz: 900 }],
      pointSprings: [
        { x: 1.5, y: 1.5, k: 25000 },
        { x: 4.5, y: 4.5, k: 25000 },
      ],
    }),
  },
  // --- DEGENERES -----------------------------------------------------------------
  {
    id: 'degenere-couches-E-identiques',
    description: 'DEGENERE : couches à module E identique (pas de contraste de raideur)',
    input: base({ layers: LAYERS_SAME, pointLoads: [{ x: 3, y: 3, Fz: 1000 }] }),
  },
  {
    id: 'degenere-plaque-non-convexe',
    description: 'DEGENERE : plaque non-convexe (polygone en L)',
    input: base({
      rafts: [{ pts: POLY_L, ...BETON }],
      pointLoads: [{ x: 1.5, y: 1.5, Fz: 900 }],
    }),
  },
  // --- HORS-DOMAINE : maillage TROP FIN -> > 1500 nœuds (garde moteur) ------------
  {
    id: 'hors-domaine-maillage-trop-fin',
    description:
      'Grande plaque 14×14 au pas plancher 0,3 m -> ~2209 nœuds > 1500 : erreur bornée (garde N>1500)',
    horsDomaine: true,
    input: {
      projet: 'Radier — hors domaine',
      rafts: [
        {
          pts: [
            { x: 0, y: 0 },
            { x: 14, y: 0 },
            { x: 14, y: 14 },
            { x: 0, y: 14 },
          ],
          ...BETON,
        },
      ],
      pointLoads: [{ x: 7, y: 7, Fz: 1000 }],
      lineLoads: [],
      areaLoads: [],
      pointSprings: [],
      lineSprings: [],
      layers: LAYERS_2,
      // h = max(0,3 ; mesh) : le pas est plancher a 0,3 m. 14/0,3 ≈ 47 -> 47×47 = 2209
      // nœuds > 1500 -> garde « Maillage trop fin ». (mesh 0,2 demande, floore a 0,3.)
      opts: { mesh: 0.2 },
    },
  },
];
