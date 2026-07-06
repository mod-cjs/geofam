/**
 * CONTRAT I/O du moteur pressiometre Menard — essai pressiometrique
 * (NF EN ISO 22476-4) (#47, #56).
 *
 * Defini avec `defineEngineContract` de @roadsen/shared : entree bornee (sert
 * aussi de forme persistee) + sortie client-safe en WHITELIST STRICTE. Les deux
 * schemas sont verifies anti-passthrough a la construction (cf. engine-io.ts).
 *
 * --- ENTREE ---
 * L'etat de depouillement d'UNE profondeur d'essai :
 *   - `params`  : parametres sonde/correction { a, Ph, Pe, V0, k0 }. ATTENTION :
 *     le moteur travaille en UNITES INTERNES (bar) et attend `a` en cm³/bar
 *     (le HTML lit la saisie utilisateur en cm³/MPa puis DIVISE par 10 dans
 *     `getParams()`). On declare donc `a` deja convertie cote module (l'appelant
 *     API / le front fait la conversion de saisie comme le HTML). Idem Ph/Pe en
 *     bar, V0 en cm³.
 *   - `gamma`   : poids volumique du sol (kN/m³) ;
 *   - `nappe`   : profondeur de la nappe (m), 0 = absente ;
 *   - `label`   : libelle de profondeur ; le moteur en derive z par parseFloat
 *     (parite HTML `parseFloat(d.label)`). On le declare en chaine pour rester
 *     FIDELE au comportement d'origine (ex. "2.0 m" -> z=2.0).
 *   - `rows`    : paliers de mesure [{ p, v15, v30, v60 }] (>= 4 valides) ;
 *   - `pf_idx` / `plm_idx` : indices de selection manuelle des seuils
 *     pseudo-elastique (p0) / fin de plage (pf). -1 ou absent = automatique.
 *
 * Contrairement au HTML qui lit des CHAMPS DE SAISIE, on declare ici des NOMBRES
 * finis bornes (l'appelant a deja converti `+value`).
 *
 * --- POURQUOI une sortie reduite (anti-fuite, DoD §8) ---
 * Le calcul produit, en interne (objet `_res`), une foule d'intermediaires
 * CONFIDENTIELS qui CONSTITUENT la methode :
 *   - la COURBE CORRIGEE complete `C` (par palier : p corrige, pression nette pS,
 *     volumes corriges v15/v30/v60) ;
 *   - la decomposition de la contrainte au repos (sigH0/sigV0/sigVp/u0) ;
 *   - l'analyse de pente de la plage pseudo-elastique (mE, beta, iE, indices
 *     auto_p0I/auto_pfI) ;
 *   - les COEFFICIENTS A/B de la regression de la courbe inverse (extrapolation
 *     §D.4.3.2) et la courbe de fluage ;
 *   - les pressions/volumes de calage intermediaires (pE, p0, Pf bruts, VE/V0c/Vf).
 * Exposer cet objet reviendrait a publier la methode par ses intermediaires. On
 * ne whiteliste donc QUE les grandeurs de RESULTAT du depouillement, celles qui
 * vont au PV et alimentent le dimensionnement de fondation :
 *   - pression limite pL et pression limite NETTE pL* (pLS) ;
 *   - pression de fluage NETTE pf* (PfS) ;
 *   - module pressiometrique EM ;
 *   - rapport EM/pL* (ratio) et coefficient rheologique alpha (Menard) ;
 *   - categorie de sol + consolidation (libelles).
 * Ce sont les ANALOGUES de Rtot/taux pour terzaghi (resultat d'ingenierie final).
 *
 * Tout le reste reste SERVEUR. `projectEngineOutput` re-parse la sortie a travers
 * ce schema et STRIPPE tout champ non whiteliste, a tout niveau (cf. index.ts).
 *
 * AUCUN symbole de calcul ici : pur Zod/TS, mais ce fichier appartient a
 * @roadsen/engines (importe par l'API seule, jamais le front).
 */
import { defineEngineContract } from '@roadsen/shared';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Entree : etat de depouillement d'une profondeur (nombres finis bornes)
// ---------------------------------------------------------------------------

/**
 * Parametres sonde / correction NF EN ISO 22476-4 (deja en unites internes bar).
 */
const ParamsSchema = z
  .object({
    /** Inertie de l'appareillage `a` (cm³/bar interne) — deja /10 par l'appelant. */
    a: z.number().finite().min(0).max(100),
    /** Pression hydrostatique colonne d'eau Ph (bar). */
    Ph: z.number().finite().min(0).max(50),
    /** Resistance propre de la sonde Pe (bar). */
    Pe: z.number().finite().min(0).max(50),
    /** Volume initial de la sonde V0 (cm³). */
    V0: z.number().finite().min(1).max(10000),
    /** Coefficient des terres au repos K0. */
    k0: z.number().finite().min(0).max(5),
  })
  .strict();

/** Un palier de mesure pression/volumes (saisie convertie en nombres). */
const RowSchema = z
  .object({
    /** Pression appliquee P (bar). */
    p: z.number().finite().min(0).max(500),
    /** Volume lu a 15 s (cm³). */
    v15: z.number().finite().min(0).max(10000),
    /** Volume lu a 30 s (cm³). */
    v30: z.number().finite().min(0).max(10000),
    /** Volume lu a 60 s (cm³). */
    v60: z.number().finite().min(0).max(10000),
  })
  .strict();

/**
 * Entree complete du moteur pressiometre (depouillement d'une profondeur).
 * Bornee. Voir l'en-tete pour le sens et les unites internes.
 */
export const PressiometreInputSchema = z
  .object({
    /** Libelle de projet (metadonnee d'affichage, hors calcul). */
    projet: z.string().max(200).optional(),
    /**
     * Libelle de profondeur ; z = parseFloat(label) (parite HTML). Borne pour
     * eviter une entree libre demesuree ; le calcul n'en lit que le prefixe
     * numerique.
     */
    label: z.string().min(1).max(40),
    params: ParamsSchema,
    /** Poids volumique du sol (kN/m³). Defaut moteur = 19 si <= 0. */
    gamma: z.number().finite().min(0).max(40),
    /** Profondeur de la nappe (m) ; 0 = absente. */
    nappe: z.number().finite().min(0).max(1000),
    /** Paliers de mesure ; le moteur exige >= 4 paliers VALIDES (sinon erreur bornee). */
    rows: z.array(RowSchema).min(1).max(60),
    /** Indice de selection manuelle du debut pseudo-elastique p0 (-1/absent = auto). */
    pf_idx: z.number().int().min(-1).max(59).optional(),
    /** Indice de selection manuelle de la fin de plage pf (-1/absent = auto). */
    plm_idx: z.number().int().min(-1).max(59).optional(),
  })
  .strict();
export type PressiometreInput = z.infer<typeof PressiometreInputSchema>;

// ---------------------------------------------------------------------------
// Sortie : WHITELIST stricte des resultats affichables (aucun intermediaire)
// ---------------------------------------------------------------------------

/**
 * Sortie client-safe du moteur pressiometre. Les grandeurs FINALES du
 * depouillement + la classification. Aucune courbe corrigee, aucun coefficient
 * de regression, aucun intermediaire de plage pseudo-elastique.
 */
export const PressiometreOutputSchema = z
  .object({
    /** Erreur de calcul (science levee / donnees insuffisantes) : message borne. */
    erreur: z.string().max(500).nullable(),
    /**
     * Avertissements (redactes des valeurs confidentielles). STRUCTURELLEMENT VIDE
     * aujourd'hui : le moteur emet des `console.warn` mais ne pose aucun champ
     * `warn` dans son resultat brut (cf. index.ts) — `warnings` ressort donc `[]`
     * en fonctionnement normal. Le champ + la redaction sont une defense en
     * profondeur fail-closed pour une evolution future, pas un canal de fuite actif.
     */
    warnings: z.array(z.string().max(500)).max(50),
    /** Pression limite pL (bar). */
    pL: z.number().finite(),
    /** Pression limite NETTE pL* = pL - sigH0 (bar). */
    pLNette: z.number().finite(),
    /** Pression de fluage NETTE pf* = pf - sigH0 (bar). */
    pfNette: z.number().finite(),
    /** Module pressiometrique EM (MPa). */
    EM: z.number().finite(),
    /** Rapport EM/pL* (sans dimension) — base du coefficient rheologique. */
    ratioEMpL: z.number().finite(),
    /** Coefficient rheologique alpha (Menard). */
    alpha: z.number().finite(),
    /**
     * Module d'Young derive Ey = EM/alpha (MPa). Grandeur de RESULTAT publique
     * (affichee par l'outil d'origine, « Ey = E/α ») : simple rapport de deux
     * resultats deja exposes (EM, alpha), aucun intermediaire de methode.
     */
    Ey: z.number().finite(),
    /** pL direct mesure ? false = extrapole (§D.4.3). */
    pLDirect: z.boolean(),
    /** Categorie de sol (A..E) — libelle court. */
    categorie: z.string().max(4),
    /** Libelle de categorie de sol. */
    categorieLibelle: z.string().max(80),
    /** Etat de consolidation (libelle). */
    consolidation: z.string().max(80),
  })
  .strict();
export type PressiometreOutput = z.infer<typeof PressiometreOutputSchema>;

// ---------------------------------------------------------------------------
// Le contrat (verifie anti-passthrough a la construction)
// ---------------------------------------------------------------------------

/** Identifiant logique = cle de registre (cf. packages/engines/registry). */
export const PRESSIOMETRE_ENGINE_ID = 'pressiometre-menard';

export const pressiometreContract = defineEngineContract({
  id: PRESSIOMETRE_ENGINE_ID,
  inputSchema: PressiometreInputSchema,
  outputSchema: PressiometreOutputSchema,
});
