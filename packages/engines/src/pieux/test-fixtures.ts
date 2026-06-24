/**
 * Jeux d'ENTREES pieux (NF P 94-262) pour l'equivalence-portage et l'e2e (#48).
 *
 * Ces fixtures ne contiennent QUE des entrees (`input`) : la REFERENCE (sortie
 * attendue) n'est PAS figee ici — elle est derivee en executant le HTML d'origine
 * via jsdom dans le harnais d'equivalence (provenance 'HTML-origine'). On ne se
 * compare donc jamais a une valeur fabriquee a la main (anti faux-vert).
 *
 * --- PROVENANCE DES PARAMETRES NOMINAUX ---
 * Le jeu de base (B=0,60 m circulaire, z0=0, D=15 m, G=800 kN, Q=350 kN, nappe=3 m,
 * surface 2500 m², 1 profil) provient du jeu de demonstration `fillFictitious()` du
 * HTML d'origine (« Projet exemple — Dakar »). Le HTML ne renseigne PAS de couches
 * dans cet exemple : on construit ici des profils geotechniques realistes (couvrant
 * les natures de sol et les methodes) pour exercer le calcul.
 *
 * Les coefficients partiels editables (k_*, cr_*) prennent les DEFAUTS du HTML
 * (PIEUX_DEFAULT_COEFFS) sauf mention contraire.
 *
 * Couverture :
 *   - methode PRESSIOMETRIQUE (pmt) — pieu fore, sol argile/sable/marne ;
 *   - methode PENETROMETRIQUE (cpt) — penetrogramme genere depuis les qc de couches ;
 *   - methode c-φ (cphi) — Nq/Nc effectifs ;
 *   - approches DA1 / DA2 (NA France) / DA3 (jeu M2 sur c'/φ') ;
 *   - TRACTION (sens='trac', plafond §4.3.3 sans essais) ;
 *   - MICROPIEU (cat 17 : pas de pointe, α non tabules) ;
 *   - EFFET DE GROUPE (entraxe < 3·B -> Cₑ < 1) ;
 *   - ancrage dans la CRAIE (gammaRd1 specifique) ;
 *   - DEGENERE : D depassant le profil de sol (warning, pas d'erreur) ;
 *   - HORS-DOMAINE : D <= z0 (le moteur renvoie une erreur bornee).
 *
 * NB (MINEUR-4 #48) : la garde « profil vide » du moteur (engine.ts, `!layers.length`)
 * n'est PAS atteignable via une fixture validee — le contrat impose `layers.min(1)`.
 * Elle est donc exercee SEPAREMENT en appelant `computePieux` AU NIVEAU MOTEUR (avant
 * schema) dans engine.determinism / contract tests, pas par une fixture (qui serait
 * rejetee a la validation). Aucune fixture « profil vide » n'existe ici, a dessein.
 */
import { PIEUX_DEFAULT_COEFFS, type PieuxInput } from './contract.js';

export interface PieuxFixture {
  id: string;
  description: string;
  /** true si l'on attend une erreur de calcul (garde du moteur). */
  horsDomaine?: boolean;
  input: PieuxInput;
}

const COEFFS = PIEUX_DEFAULT_COEFFS;

/** Geometrie circulaire B=0,60 m (exemple Dakar). */
const GEOM_CIRC_060: PieuxInput['geom'] = { section: 'circ', g_B: 0.6 };

/** Penetrogramme vide : le moteur le genere depuis les qc de couches (methode CPT). */
const CPT_EMPTY: PieuxInput['cpt'] = { step: 0.2, pts: [] };

/** Effet de groupe NEUTRE (pieu isole). */
const GRP_ISOLE: PieuxInput['grp'] = { grp_n: 1, grp_m: 1, grp_s: 0 };

/** Profil PMT a 3 couches : argile molle / sable / marne porteuse (pl en MPa, em en MPa). */
const LAYERS_PMT: PieuxInput['layers'] = [
  { soil: 'argile', th: 4, pl: 0.4, em: 4, gamma: 18 },
  { soil: 'sable', th: 6, pl: 1.2, em: 12, gamma: 19 },
  { soil: 'marne', th: 10, pl: 3.5, em: 35, gamma: 21 },
];

/** Profil CPT a 3 couches (qc en MPa). */
const LAYERS_CPT: PieuxInput['layers'] = [
  { soil: 'argile', th: 4, qc: 1.5, em: 4, gamma: 18 },
  { soil: 'sable', th: 6, qc: 8, em: 12, gamma: 19 },
  { soil: 'sable', th: 10, qc: 18, em: 30, gamma: 20 },
];

/** Profil c-φ a 3 couches (c en kPa, phi en deg). */
const LAYERS_CPHI: PieuxInput['layers'] = [
  { soil: 'argile', th: 4, c: 20, phi: 18, gamma: 18 },
  { soil: 'sable', th: 6, c: 0, phi: 32, gamma: 19 },
  { soil: 'sable', th: 10, c: 5, phi: 36, gamma: 20 },
];

/** Profil PMT avec couche porteuse en CRAIE (gammaRd1 specifique). */
const LAYERS_PMT_CRAIE: PieuxInput['layers'] = [
  { soil: 'argile', th: 5, pl: 0.5, em: 5, gamma: 18 },
  { soil: 'craie', th: 12, pl: 4.0, em: 40, gamma: 21 },
];

/** Base commune des entrees (jeu Dakar), surchargee par fixture. */
function base(over: Partial<PieuxInput>): PieuxInput {
  return {
    projet: 'Projet exemple — Dakar',
    pieu: 'P1',
    geom: GEOM_CIRC_060,
    g_z0: 0,
    g_D: 15,
    cat: 1, // FS — fore simple
    meth: 'pmt',
    da: 'da2',
    sens: 'comp',
    essais: 'non',
    c_G: 800,
    c_Q: 350,
    o_nappe: 3,
    o_nprofil: 1,
    o_surf: 2500,
    o_redis: 'non',
    grp: GRP_ISOLE,
    coeffs: COEFFS,
    layers: LAYERS_PMT,
    cpt: CPT_EMPTY,
    ...over,
  };
}

export const PIEUX_FIXTURES: readonly PieuxFixture[] = [
  {
    id: 'pmt-fore-da2-comp',
    description:
      'Pressiometrique, foré simple (cat 1), DA2 (NA France), compression — cas nominal Dakar',
    input: base({}),
  },
  {
    id: 'pmt-fore-da1',
    description: 'Pressiometrique, foré simple, DA1 (2 combinaisons C1/C2)',
    input: base({ da: 'da1' }),
  },
  {
    id: 'pmt-fore-da3',
    description:
      'Pressiometrique, foré simple, DA3 (jeu M2 sur c′/φ′ — sans effet en pmt)',
    input: base({ da: 'da3' }),
  },
  {
    id: 'pmt-battu-da2',
    description:
      'Pressiometrique, battu béton préfabriqué (cat 9, refoulement) — fluage 0,7·Rb',
    input: base({ cat: 9 }),
  },
  {
    id: 'pmt-fore-traction',
    description: 'Pressiometrique, traction sans essais (plafond ELS-QP 0,15·Rs, §4.3.3)',
    input: base({ sens: 'trac' }),
  },
  {
    id: 'pmt-craie-porteuse',
    description: 'Pressiometrique, base ancrée dans la craie (γR;d1 = 1,4 spécifique)',
    input: base({ layers: LAYERS_PMT_CRAIE, g_D: 14 }),
  },
  {
    id: 'pmt-groupe-entraxe-court',
    description:
      'Pressiometrique, GROUPE 3×3 entraxe S=1,2 m < 3·B -> Cₑ < 1 sur Rs (warning)',
    input: base({ grp: { grp_n: 3, grp_m: 3, grp_s: 1.2 } }),
  },
  {
    id: 'pmt-micropieu',
    description:
      'Pressiometrique, MICROPIEU type I (cat 17) : pas de pointe, α non tabulés (frUncov)',
    input: base({ cat: 17 }),
  },
  {
    id: 'cpt-fore-da2',
    description:
      'Pénétrométrique (cpt), foré simple — pénétrogramme généré depuis les qc de couches',
    input: base({ meth: 'cpt', layers: LAYERS_CPT }),
  },
  {
    id: 'cpt-battu-acier',
    description: 'Pénétrométrique, battu acier fermé (cat 12, classe 4)',
    input: base({ meth: 'cpt', layers: LAYERS_CPT, cat: 12 }),
  },
  {
    id: 'cphi-fore-da2',
    description: 'c-φ, foré simple, DA2 — Nq/Nc effectifs, terme de pointe c·Nc + σ′v·Nq',
    input: base({ meth: 'cphi', layers: LAYERS_CPHI }),
  },
  {
    id: 'cphi-fore-da3',
    description: 'c-φ, foré simple, DA3 — paramètres c′/φ′ réduits par le jeu M2',
    input: base({ meth: 'cphi', layers: LAYERS_CPHI, da: 'da3' }),
  },
  {
    id: 'pmt-redistribution-rigide',
    description:
      'Pressiometrique, structure rigide redistribuant les charges (ξ ÷ 1,1, §9.2.3)',
    input: base({ o_redis: 'oui', o_nprofil: 3 }),
  },
  {
    id: 'pmt-section-rectangulaire',
    description:
      'Pressiometrique, section RECTANGULAIRE 0,6×0,4 m (B = min, périmètre 2(b+h))',
    input: base({ geom: { section: 'rect', g_B: 0.6, g_b2: 0.4 } }),
  },
  // --- DEGENERE : D depasse le profil -> warning (PAS une erreur) ---------------
  {
    id: 'degenere-D-depasse-profil',
    description:
      'D = 22 m > profil de sol (20 m) : le moteur AVERTIT (couche porteuse à ajouter) mais calcule (soilAt extrapole la dernière couche).',
    input: base({ g_D: 22 }),
  },
  // --- HORS-DOMAINE : gardes du moteur (renderResults({err:...})) ---------------
  {
    id: 'hors-domaine-D-inferieur-z0',
    description: 'D <= z0 : le moteur renvoie une erreur bornée (base sous la tête).',
    horsDomaine: true,
    input: base({ g_z0: 10, g_D: 8 }),
  },
];
