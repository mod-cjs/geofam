/**
 * KIT DE VALIDATION SCIENTIFIQUE burmister — référence STARFIRE (#36).
 *
 * PROVENANCE : « Dossier de validation », section 11 du manuel utilisateur STARFIRE
 * (`03-Moteurs-client/ROADSEN_Manuel_Utilisateur_1.docx`, transmis le 17/06/2026).
 * Confrontation du moteur à des calculs de référence INDÉPENDANTS de la méthode
 * rationnelle (type Alizé-LCPC) sur deux structures complètes :
 *   - EX_1 : chaussée « bitumineuse épaisse » (BBSG / GB / GNT / sol) ;
 *   - EX_2 : chaussée « souple » (BBSG / GNT / sol).
 * Charge standard : jumelage 65 kN, p = 0,662 MPa, a = 0,125 m, d = 0,375 m.
 * Écart max constaté par STARFIRE : 0,4 % ; majorité des valeurs à 0,1 %.
 *
 * PORTÉE — ce kit prouve la JUSTESSE SCIENTIFIQUE (moteur ≈ référence externe), au
 * contraire de `engine.equivalence.test.ts` qui ne prouve que l'ÉQUIVALENCE DE PORTAGE
 * (module TS == HTML d'origine). Les deux sont nécessaires.
 *
 * ⚠️ NIVEAU MOTEUR BRUT OBLIGATOIRE. Les grandeurs de référence (ε_t à la base de GB,
 * ε_z au sommet de GNT…) sont des valeurs PAR INTERFACE. La sortie client-safe
 * (`runBurmister` / `BurmisterOutputSchema`) ne les expose PAS (elle ne garde que le
 * critère de fatigue GOUVERNANT + l'ε_z du sol — les ε par interface sont confidentiels).
 * La validation doit donc s'exécuter sur le résultat BRUT de `computeBurmister` (le `_D`
 * du moteur, index 0..n-1 = base des couches, index n = sommet PSC — cf. engine.ts:570),
 * jamais sur le contrat redacté.
 *
 * ── ÉTAT : BLOQUÉ SUR ENTRÉES (@science-unsigned) ─────────────────────────────────────
 * Le manuel §11 donne les SORTIES de référence (ci-dessous) mais PAS les STRUCTURES
 * D'ENTRÉE EX_1/EX_2 (couches / épaisseurs / modules / classe PF). Elles ne figurent dans
 * AUCUN fichier transmis (manuel, HTML d'origine, GeoSuite — vérifié le 01/07/2026).
 * Sans elles, tout golden-master serait CIRCULAIRE (on fitterait l'entrée pour retomber
 * sur la sortie → aucune preuve). Elles doivent être fournies par STARFIRE :
 *   pour EX_1 et EX_2 : pour chaque couche { matériau, épaisseur (m), module E (MPa), ν },
 *   la classe/module de PSC, et la classe de trafic (NE).
 * Une fois fournies : renseigner EX1_INPUT / EX2_INPUT, mapper les interfaces aux
 * grandeurs (INTERFACE_MAP), et le test `engine.starfire-validation.test.ts` passe de
 * SKIP BRUYANT à assertion réelle (tolérance 0,4 %).
 */
import type { BurmisterInput } from './contract.js';

/** Tolérance de validation scientifique STARFIRE : 0,4 % (écart max annoncé au §11). */
export const STARFIRE_REL_TOLERANCE = 0.004;

/**
 * Une grandeur de référence du §11 : la valeur du calcul de RÉFÉRENCE externe (colonne
 * « Référence »), la valeur documentée du moteur (colonne « ROADSEN », pour trace), et
 * l'écart annoncé. La cible d'assertion est `reference` (provenance externe) ; `roadsen`
 * n'est QUE documentaire (ne jamais asserter contre elle : ce serait de l'auto-référence).
 */
export interface StarfireGrandeur {
  /** Libellé exact du §11. */
  readonly libelle: string;
  /** Valeur du calcul de référence indépendant (μdef ; cible de l'assertion). */
  readonly reference: number;
  /** Valeur documentée du moteur au §11 (μdef ; TRACE seulement, jamais assertée). */
  readonly roadsen: number;
  /** Écart annoncé au §11 (documentaire). */
  readonly ecartAnnonce: string;
  /**
   * Où lire cette grandeur dans le résultat BRUT du moteur. À COMPLÉTER quand les
   * structures EX_1/EX_2 seront connues (index d'interface + champ ε_t/ε_z).
   * null = mapping non encore établi (structure d'entrée manquante).
   */
  readonly rawPath: string | null;
}

/** Table de référence §11 — EX_1 (chaussée bitumineuse épaisse). */
export const EX1_GRANDEURS: readonly StarfireGrandeur[] = [
  { libelle: 'εt base GB', reference: 170.4, roadsen: 170.3, ecartAnnonce: '−0,1 %', rawPath: null },
  { libelle: 'εt (traction) base BBSG', reference: -12.7, roadsen: -12.8, ecartAnnonce: '0,4 %', rawPath: null },
  { libelle: 'εz sommet GNT', reference: 347.2, roadsen: 347.4, ecartAnnonce: '+0,1 %', rawPath: null },
  { libelle: 'εz sommet sol', reference: 462.3, roadsen: 463.4, ecartAnnonce: '+0,2 %', rawPath: null },
];

/** Table de référence §11 — EX_2 (chaussée souple). */
export const EX2_GRANDEURS: readonly StarfireGrandeur[] = [
  { libelle: 'εt base BBSG', reference: 263.1, roadsen: 263.0, ecartAnnonce: '−0,1 %', rawPath: null },
  { libelle: 'εz sommet GNT', reference: 903.3, roadsen: 903.3, ecartAnnonce: '0,0 %', rawPath: null },
  { libelle: 'εz sommet sol', reference: 592.9, roadsen: 594.0, ecartAnnonce: '+0,2 %', rawPath: null },
];

/**
 * ε_t admissible (mêmes hypothèses d'entrée) : réf. 146,1 / ROADSEN 146,2 (≈ 0 %).
 * Grandeur de dimensionnement — accessible via la sortie client-safe
 * (`fatigue.admissible`), donc validable AUSSI au niveau contrat une fois EX_* connu.
 */
export const EPS_T_ADMISSIBLE = { reference: 146.1, roadsen: 146.2, ecartAnnonce: '≈ 0 %' } as const;

/** Charge standard des cas de validation (jumelage de référence 65 kN). */
export const CHARGE_STANDARD = { P_kN: 65, p_MPa: 0.662, a_m: 0.125, d_m: 0.375 } as const;

/**
 * Structures d'entrée EX_1 / EX_2 — À FOURNIR PAR STARFIRE (cf. en-tête).
 * `null` tant qu'elles ne sont pas transmises : le test SKIP BRUYAMMENT (jamais vert).
 */
export const EX1_INPUT: BurmisterInput | null = null;
export const EX2_INPUT: BurmisterInput | null = null;

/** true seulement quand les DEUX structures de validation sont renseignées. */
export function starfireInputsAvailable(): boolean {
  return EX1_INPUT !== null && EX2_INPUT !== null;
}
