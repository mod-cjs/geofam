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
 * --- POURQUOI une sortie reduite (anti-fuite, DoD §8) ---
 * Le calcul produit, en interne (objet `e`), les INTERMEDIAIRES DE REGRESSION qui
 * constituent la methode : la liste `pts`, le tableau `residuals` (V ajuste + residu
 * par palier), `V_pe` et `Vs_reel`. On ne whiteliste QUE les COEFFICIENTS
 * D'APPAREILLAGE reutilisables (Vs, Pe, la pente d'air a) et les VERDICTS de qualite
 * (R², RMS). `projectEngineOutput` re-parse la sortie a travers ce schema `.strict()`
 * et STRIPPE tout champ non whiteliste, a tout niveau (defense en profondeur).
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

/**
 * Sortie client-safe : coefficients d'appareillage + qualite d'ajustement. Aucun
 * intermediaire de regression (pts / residuals / V_pe / Vs_reel).
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
