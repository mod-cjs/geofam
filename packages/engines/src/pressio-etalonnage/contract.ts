/**
 * CONTRAT I/O du moteur ETALONNAGE PRESSIOMETRIQUE (sonde dans l'air, `calcEtalonnage`
 * de pressiometre__1_.html).
 *
 * Defini avec `defineEngineContract` de @roadsen/shared : entree bornee (sert aussi de
 * forme persistee) + sortie client-safe en WHITELIST STRICTE. Les deux schemas sont
 * verifies anti-passthrough a la construction (cf. engine-io.ts).
 *
 * --- ENTREE ---
 * Les points d'etalonnage (P, V60) tels que `calcEtalonnage()` du HTML les lisait dans
 * la globale `etalRows`. Le calcul n'utilise QUE `p` (bar) et `v60` (cm³) ; `v15`/`v30`
 * sont acceptes pour fidelite de la ligne de saisie mais IGNORES par la science
 * (comme dans le HTML).
 *
 * --- SORTIE « zero ecart » (decision titulaire 14/07, extension ADR 0014) ---
 * Regle actee : « tout ce que l'outil client AFFICHE est exposable ». `renderEtalResult`
 * affiche, en plus des coefficients Vs/Pe/a/R²/RMS : le Vs REEL (1er palier mesure), le
 * volume cible V_pe = 1,2·Vs, et la TABLE DES RESIDUS (P, V mesure, V ajuste, residu).
 * On whiteliste donc ces grandeurs. Reste SERVEUR le seul intermediaire NON affiche : la
 * liste brute `pts` (points reechantillonnes de travail). `projectEngineOutput` re-parse
 * la sortie a travers ce schema `.strict()` et STRIPPE tout champ non whiteliste, a tout
 * niveau (defense en profondeur).
 *
 * --- UNITES ---
 * P en bar, V60 en cm³. Vs en cm³, Pe en bar, a (pente d'air) en cm³/bar (valeur BRUTE ;
 * le HTML affiche a×10 en cm³/MPa a titre indicatif). Vs et Pe sont reutilisables comme
 * coefficients d'appareillage dans le depouillement. La pente d'air `a` N'est PAS le
 * coefficient de correction de volume (celui-ci vient du CALIBRAGE).
 *
 * AUCUN symbole de calcul ici : pur Zod/TS, mais ce fichier appartient a
 * @roadsen/engines (importe par l'API seule, jamais le front).
 */
import { defineEngineContract } from '@roadsen/shared';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Entree : points (P, V60) mesures sonde dans l'air
// ---------------------------------------------------------------------------

/** Un palier d'etalonnage. Seuls `p` (bar) et `v60` (cm³) alimentent la science. */
const EtalRowSchema = z
  .object({
    p: z.number().finite().min(-1e6).max(1e6),
    v15: z.number().finite().min(-1e6).max(1e6).optional(),
    v30: z.number().finite().min(-1e6).max(1e6).optional(),
    v60: z.number().finite().min(-1e6).max(1e6),
  })
  .strict();

/**
 * Entree complete : au moins 3 points (garde du moteur — la regression exige >= 3
 * mesures ; en-deca, le moteur rejette). Bornee (fail-closed).
 */
export const PressioEtalonnageInputSchema = z
  .object({
    /** Libelle de projet (metadonnee d'affichage, hors calcul). */
    projet: z.string().max(200).optional(),
    /** Libelle d'essai (metadonnee d'affichage, hors calcul). */
    label: z.string().max(80).optional(),
    rows: z.array(EtalRowSchema).min(3).max(500),
  })
  .strict();
export type PressioEtalonnageInput = z.infer<typeof PressioEtalonnageInputSchema>;

// ---------------------------------------------------------------------------
// Sortie : WHITELIST stricte des COEFFICIENTS + VERDICTS (aucun intermediaire)
// ---------------------------------------------------------------------------

/** Un residu d'etalonnage — colonnes EXACTES de la table client (HTML L.2162-2167). */
const EtalResiduSchema = z
  .object({
    /** P (bar) — colonne « P (bar) ». */
    p: z.number().finite(),
    /** V mesure (cm³) — colonne « V mesure ». */
    vMesure: z.number().finite(),
    /** V ajuste (cm³) — colonne « V ajuste ». */
    vAjuste: z.number().finite(),
    /** Residu = V mesure − V ajuste (cm³) — colonne « Residu ». */
    residu: z.number().finite(),
  })
  .strict();

/**
 * Sortie client-safe : coefficients d'appareillage + qualite d'ajustement + tout ce
 * que `renderEtalResult` affiche (Vs reel, V_pe, table des residus). Reste hors sortie
 * le seul intermediaire non affiche : la liste brute `pts`.
 */
export const PressioEtalonnageOutputSchema = z
  .object({
    /** Vs — ordonnee a l'origine de la droite ajustee V=Vs+a·P (cm³). */
    Vs: z.number().finite(),
    /** Pe — pression a V = 1,2 × Vs reel (bar). */
    Pe: z.number().finite(),
    /** a — pente d'air de la droite ajustee (cm³/bar) ; PAS le coefficient de correction. */
    a: z.number().finite(),
    /** R² — coefficient de determination de la droite (verdict de qualite). */
    R2: z.number().finite(),
    /** RMS des residus (cm³) — verdict de qualite. */
    rms: z.number().finite(),
    // --- SORTIE « zero ecart » : grandeurs AFFICHEES par renderEtalResult ---
    /** Vs REEL = volume au 1er palier mesure (cm³) — affiche « Vs reel=… ». */
    vsReel: z.number().finite(),
    /** V_pe = 1,2 × Vs reel (cm³) — volume cible de lecture de Pe. */
    vPe: z.number().finite(),
    /** Table des residus (P, V mesure, V ajuste, residu) — colonnes du client. */
    residus: z.array(EtalResiduSchema).max(500),
  })
  .strict();
export type PressioEtalonnageOutput = z.infer<typeof PressioEtalonnageOutputSchema>;

// ---------------------------------------------------------------------------
// Le contrat (verifie anti-passthrough a la construction)
// ---------------------------------------------------------------------------

/** Identifiant logique = cle de registre. */
export const PRESSIO_ETALONNAGE_ENGINE_ID = 'pressio-etalonnage';

export const pressioEtalonnageContract = defineEngineContract({
  id: PRESSIO_ETALONNAGE_ENGINE_ID,
  inputSchema: PressioEtalonnageInputSchema,
  outputSchema: PressioEtalonnageOutputSchema,
});
