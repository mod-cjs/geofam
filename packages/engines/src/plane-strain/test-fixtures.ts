/**
 * Jeux d'ENTREES pour la coupe en DEFORMATIONS PLANES / poutre (solvePlaneStrain,
 * GEOPLAQUE_V10) — equivalence-portage.
 *
 * Ces fixtures ne contiennent QUE des entrees (`input`) : la REFERENCE (sortie
 * attendue) n'est PAS figee ici — elle est derivee en executant le HTML d'origine via
 * jsdom dans le harnais d'equivalence (provenance 'HTML-origine'). On ne se compare
 * donc jamais a une valeur fabriquee a la main (anti faux-vert).
 *
 * --- UNITES (pas de piege) ---
 * E en MPa, e/Bw/zBase en m (zBase negatif vers le bas), q en kPa, P (charge lineique)
 * en kN/ml, foundD en m.
 *
 * Couverture :
 *   - bande chargee repartie q, 2 couches ;
 *   - bande charge lineique centree ;
 *   - bande charges lineiques MULTIPLES excentrees ;
 *   - bande q + loads COMBINES ;
 *   - bande a maillage fin impose (ne=200) ;
 *   - bande avec assise profonde foundD (souplesse sous D) ;
 *   - bande foundD SOUS le substratum (garde-fou z0) ;
 *   - DECOLLEMENT (contact unilateral, charge tres excentree) ;
 *   - DEGENERE : couches a E identique (pas de contraste de raideur) ;
 *   - HORS-DOMAINE : aucune couche de sol (garde moteur -> erreur bornee).
 */
import type { PlaneStrainInput } from './contract.js';

export interface PlaneStrainFixture {
  id: string;
  description: string;
  /** true si l'on attend une erreur de calcul (garde du moteur). */
  horsDomaine?: boolean;
  input: PlaneStrainInput;
}

/** Profil de sol a 2 couches (E en MPa, zBase en m, negatif vers le bas). */
const LAYERS_2: PlaneStrainInput['layers'] = [
  { name: 'limon', zBase: -3, E: 8, nu: 0.33 },
  { name: 'sable', zBase: -12, E: 25, nu: 0.3 },
];

/** Profil a couches de MODULE IDENTIQUE (pas de contraste de raideur). */
const LAYERS_SAME: PlaneStrainInput['layers'] = [
  { name: 'a', zBase: -4, E: 15, nu: 0.3 },
  { name: 'b', zBase: -12, E: 15, nu: 0.3 },
];

/** Poutre beton typique (E en MPa). */
const BETON = { E: 32000, nu: 0.2, e: 0.4 } as const;

export const PLANE_STRAIN_FIXTURES: readonly PlaneStrainFixture[] = [
  {
    id: 'bande-repartie',
    description: 'Bande 6 m, charge repartie q=50 kPa, 2 couches',
    input: {
      projet: 'Coupe — repartie',
      layers: LAYERS_2,
      opts: { Bw: 6, ...BETON, q: 50 },
    },
  },
  {
    id: 'bande-lineique-centree',
    description: 'Bande 6 m, charge lineique 300 kN/ml au centre (x=3)',
    input: {
      projet: 'Coupe — lineique centree',
      layers: LAYERS_2,
      opts: { Bw: 6, ...BETON, loads: [{ x: 3, P: 300 }] },
    },
  },
  {
    id: 'bande-lineiques-multiples',
    description: 'Bande 8 m, 3 charges lineiques excentrees',
    input: {
      projet: 'Coupe — lineiques multiples',
      layers: LAYERS_2,
      opts: {
        Bw: 8,
        ...BETON,
        loads: [
          { x: 2, P: 250 },
          { x: 4, P: 400 },
          { x: 6.5, P: 180 },
        ],
      },
    },
  },
  {
    id: 'bande-repartie-plus-lineique',
    description: 'Bande 6 m, q=30 kPa + charge lineique 500 kN/ml excentree (x=1,5)',
    input: {
      projet: 'Coupe — combinee',
      layers: LAYERS_2,
      opts: { Bw: 6, ...BETON, q: 30, loads: [{ x: 1.5, P: 500 }] },
    },
  },
  {
    id: 'bande-maillage-fin',
    description: 'Bande 6 m, ne=200 elements (maillage fin), charge lineique centree',
    input: {
      projet: 'Coupe — maillage fin',
      layers: LAYERS_2,
      opts: { Bw: 6, ...BETON, ne: 200, loads: [{ x: 3, P: 300 }] },
    },
  },
  {
    id: 'bande-assise-profonde',
    description: 'Bande 6 m, assise foundD=1,5 m (souplesse sous D), q=40 kPa',
    input: {
      projet: 'Coupe — assise',
      layers: LAYERS_2,
      opts: { Bw: 6, ...BETON, foundD: 1.5, q: 40 },
    },
  },
  {
    id: 'bande-assise-sous-substratum',
    description: 'Bande 6 m, foundD=20 m (sous le substratum) -> garde-fou z0',
    input: {
      projet: 'Coupe — assise garde-fou',
      layers: LAYERS_2,
      opts: { Bw: 6, ...BETON, foundD: 20, q: 40 },
    },
  },
  {
    id: 'bande-decollement',
    description: 'Bande 8 m, charge tres excentree (x=0,3) + decollement',
    input: {
      projet: 'Coupe — decollement',
      layers: LAYERS_2,
      opts: { Bw: 8, ...BETON, e: 0.5, loads: [{ x: 0.3, P: 900 }], decol: true },
    },
  },
  {
    id: 'degenere-couches-E-identiques',
    description: 'DEGENERE : couches a module E identique (pas de contraste de raideur)',
    input: {
      projet: 'Coupe — degenere E identique',
      layers: LAYERS_SAME,
      opts: { Bw: 6, ...BETON, loads: [{ x: 3, P: 300 }] },
    },
  },
  {
    id: 'bande-poutre-souple',
    description: 'Bande 6 m, poutre mince/souple (e=0,15 m) -> forte flexion',
    input: {
      projet: 'Coupe — poutre souple',
      layers: LAYERS_2,
      opts: { Bw: 6, E: 32000, nu: 0.2, e: 0.15, loads: [{ x: 3, P: 200 }] },
    },
  },
  // --- HORS-DOMAINE : aucune couche de sol (garde moteur) -------------------------
  {
    id: 'hors-domaine-aucune-couche',
    description: 'Aucune couche de sol -> erreur bornee (garde « au moins une couche »)',
    horsDomaine: true,
    input: {
      projet: 'Coupe — hors domaine',
      // volontairement vide : declenche la garde moteur (contourne le schema, exerce
      // via le harnais qui appelle le moteur directement).
      layers: [] as unknown as PlaneStrainInput['layers'],
      opts: { Bw: 6, ...BETON, q: 50 },
    },
  },
];
