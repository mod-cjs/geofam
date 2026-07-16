/**
 * CONTRAT I/O du moteur CALIBRAGE PRESSIOMETRIQUE (forage indeformable, `calcCalibrage`
 * de pressiometre__1_.html).
 *
 * Defini avec `defineEngineContract` de @roadsen/shared : entree bornee (sert aussi de
 * forme persistee) + sortie client-safe en WHITELIST STRICTE. Les deux schemas sont
 * verifies anti-passthrough a la construction (cf. engine-io.ts).
 *
 * --- ENTREE ---
 * Les points de calibrage (P, V60) tels que `calcCalibrage()` du HTML les lisait dans la
 * globale `calibRows`. Le calcul n'utilise QUE `p` (bar) et `v60` (cm³) ; `v15`/`v30`
 * sont acceptes pour fidelite de la ligne de saisie mais IGNORES par la science.
 *
 * --- SORTIE « zero ecart » (decision titulaire 14/07, extension ADR 0014) ---
 * Regle actee : « tout ce que l'outil client AFFICHE est exposable ». `renderCalibResult`
 * affiche, en plus de a/R²/RMS : les coefficients de la courbe polynomiale c0/c1/c2
 * (KPI + equation « Pc = c0 + c1·V + c2·V² ») et la TABLE DES RESIDUS (P, V60 mesure,
 * V60 ajuste, residu). Ces valeurs cessent donc d'etre confidentielles : on les
 * whiteliste. Reste SERVEUR le seul intermediaire NON affiche : la liste brute `pts`.
 * `projectEngineOutput` re-parse la sortie a travers ce schema `.strict()` et STRIPPE
 * tout champ non whiteliste (defense en profondeur).
 *
 * --- UNITES ---
 * P en bar, V60 en cm³. Sortie `a` (a_calib) en cm³/bar (valeur BRUTE ; le HTML affiche
 * a×10 en cm³/MPa a titre indicatif). `a` est le coefficient de correction de volume
 * reutilisable dans le depouillement (correction Vc = Vr − a·Pr).
 *
 * AUCUN symbole de calcul ici : pur Zod/TS, mais ce fichier appartient a
 * @roadsen/engines (importe par l'API seule, jamais le front).
 */
import { defineEngineContract } from '@roadsen/shared';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Entree : points (P, V60) mesures en tube indeformable
// ---------------------------------------------------------------------------

/** Un palier de calibrage. Seuls `p` (bar) et `v60` (cm³) alimentent la science. */
const CalibRowSchema = z
  .object({
    p: z.number().finite().min(-1e6).max(1e6),
    v15: z.number().finite().min(-1e6).max(1e6).optional(),
    v30: z.number().finite().min(-1e6).max(1e6).optional(),
    v60: z.number().finite().min(-1e6).max(1e6),
  })
  .strict();

/**
 * Entree complete : au moins 3 points (garde du moteur — l'ajustement 3×3 exige >= 3
 * mesures ; en-deca, le moteur rejette). Bornee (fail-closed).
 */
export const PressioCalibrageInputSchema = z
  .object({
    /** Libelle de projet (metadonnee d'affichage, hors calcul). */
    projet: z.string().max(200).optional(),
    /** Libelle d'essai (metadonnee d'affichage, hors calcul). */
    label: z.string().max(80).optional(),
    rows: z.array(CalibRowSchema).min(3).max(500),
  })
  .strict();
export type PressioCalibrageInput = z.infer<typeof PressioCalibrageInputSchema>;

// ---------------------------------------------------------------------------
// Sortie : WHITELIST stricte (coefficient metier + verdicts, aucun intermediaire)
// ---------------------------------------------------------------------------

/** Un residu de calibrage — colonnes EXACTES de la table client (HTML L.1973-1977). */
const CalibResiduSchema = z
  .object({
    /** P (bar) — colonne « P (bar) ». */
    p: z.number().finite(),
    /** V60 mesure (cm³) — colonne « V60 mesure ». */
    v60Mesure: z.number().finite(),
    /** V60 ajuste (cm³) — colonne « V60 ajuste ». */
    v60Ajuste: z.number().finite(),
    /** Residu = V60 mesure − V60 ajuste — colonne « Residu ». */
    residu: z.number().finite(),
  })
  .strict();

/**
 * Sortie client-safe : coefficient de calibrage + qualite d'ajustement + tout ce que
 * `renderCalibResult` affiche (c0/c1/c2 de la courbe polynomiale, table des residus).
 * Reste hors sortie le seul intermediaire non affiche : la liste brute `pts`.
 */
export const PressioCalibrageOutputSchema = z
  .object({
    /** a — coefficient de calibrage (pente dV/dP, moindres carres) (cm³/bar). */
    a: z.number().finite(),
    /** R² — coefficient de determination de l'ajustement (verdict de qualite). */
    R2: z.number().finite(),
    /** RMS des residus (bar) — verdict de qualite. */
    rms: z.number().finite(),
    // --- SORTIE « zero ecart » : coefficients + residus AFFICHES par renderCalibResult ---
    /** c0 — constante de la courbe Pc = c0 + c1·V + c2·V². */
    c0: z.number().finite(),
    /** c1 — coefficient de V. */
    c1: z.number().finite(),
    /** c2 — coefficient de V². */
    c2: z.number().finite(),
    /** Table des residus (P, V60 mesure, V60 ajuste, residu) — colonnes du client. */
    residus: z.array(CalibResiduSchema).max(500),
  })
  .strict();
export type PressioCalibrageOutput = z.infer<typeof PressioCalibrageOutputSchema>;

// ---------------------------------------------------------------------------
// Le contrat (verifie anti-passthrough a la construction)
// ---------------------------------------------------------------------------

/** Identifiant logique = cle de registre. */
export const PRESSIO_CALIBRAGE_ENGINE_ID = 'pressio-calibrage';

export const pressioCalibrageContract = defineEngineContract({
  id: PRESSIO_CALIBRAGE_ENGINE_ID,
  inputSchema: PressioCalibrageInputSchema,
  outputSchema: PressioCalibrageOutputSchema,
});
