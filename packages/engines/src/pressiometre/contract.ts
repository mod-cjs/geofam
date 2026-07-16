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
 * --- SORTIE ELARGIE « ZERO ECART » (decision titulaire 14/07, extension ADR 0014) ---
 * Regle actee : « tout ce que l'outil client AFFICHE est exposable ; reprendre
 * comme le client ». Le seul secret est le CODE moteur, pas les valeurs rendues a
 * l'ecran. On whiteliste donc, en plus des grandeurs de resultat historiques
 * (pL, pL* net, pf* net, EM, ratio, alpha, Ey, categorie, consolidation), TOUT ce que
 * renderResults du HTML met sous les yeux de l'operateur :
 *   - les pressions de calage AFFICHEES : pf brut (KPI de tete), pE, p0 ;
 *   - la contrainte au repos AFFICHEE sigH0 (avec la profondeur z annotee) ;
 *   - les volumes de reference {VE, V(p0), V(pf), VLim} ;
 *   - l'extrapolation par courbe inverse {A, B, pLM au V conventionnel, pLM
 *     asymptote, ecart d'ajustement errV} ;
 *   - la synthese de plage {beta, mE, plage auto L..→L..} ;
 *   - la COURBE CORRIGEE telle que la table « Mesures corrigees » l'affiche
 *     (colonnes exactes : P brut, P corr., V60 corr., Δ60/30, Phase).
 *
 * --- CE QUI RESTE SERVEUR (jamais affiche par le client -> jamais expose) ---
 * La whitelist continue de STRIPPER les intermediaires que l'outil ne montre PAS :
 *   - la decomposition de la contrainte au repos sigV0/sig'v0/u0 (le client
 *     n'affiche QUE le total sigH0) ;
 *   - la pression nette PAR PALIER pS et les volumes corriges v15/v30 (la table ne
 *     montre que P brut/P corr./V60/Δ60-30) ;
 *   - l'analyse de pente brute _slopes, l'indice iE de pente minimale, la courbe de
 *     fluage complete, la fonction `gen` (closure de regression) de `ext`.
 * `projectEngineOutput` re-parse la sortie a travers ce schema `.strict()` et STRIPPE
 * tout champ non whiteliste, a tout niveau (cf. index.ts) — defense en profondeur.
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

/** Un point de la COURBE CORRIGEE, colonnes EXACTES de la table client (L.1247-1262).
 * Aucune valeur non affichee (pas de pS net, pas de v15/v30 corriges). */
const CourbePointSchema = z
  .object({
    /** P brut (bar) — colonne « P brut ». */
    p: z.number().finite(),
    /** P corrige = P + Ph - Pe (bar) — colonne « P corr. ». */
    pCorr: z.number().finite(),
    /** V60 corrige (cm³) — colonne « V60 corr. ». */
    v60: z.number().finite(),
    /** Δ60/30 brut (cm³) — colonne « Δ60/30 ». */
    d6030: z.number().finite(),
    /** Phase (verbatim client) — colonne « Phase ». */
    phase: z.enum(['Recompression', 'Pseudo-élast.', 'Plastique']),
  })
  .strict();

/**
 * Sortie client-safe du moteur pressiometre. Les grandeurs FINALES du depouillement
 * + la classification + TOUT ce que renderResults affiche (decision « zero ecart »
 * 14/07). Les intermediaires NON affiches (sigV0/sig'v0/u0, pS/v15/v30 par palier,
 * _slopes/iE, `gen`) restent strippes (cf. en-tete).
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
    // --- SORTIE ELARGIE « zero ecart » (decision titulaire 14/07) : valeurs AFFICHEES
    //     par renderResults, en UNITES INTERNES (bar/cm³/coeff bruts). La conversion
    //     d'AFFICHAGE (bar->MPa ×0.1, mE ×10 cm³/MPa...) est faite par l'adaptateur
    //     client-facing, verbatim comme le HTML. ---
    /** Pression de fluage BRUTE pf (bar) — KPI de tete « P_f » du client (affiche en MPa). */
    pf: z.number().finite(),
    /** Pression pE de restitution (bar) — table « Parametres normalises » (affiche en MPa). */
    pE: z.number().finite(),
    /** Pression p0 debut pseudo-elastique (bar) — table (affiche en MPa). */
    p0: z.number().finite(),
    /** Contrainte horizontale totale au repos sigH0 (bar) — table (affiche en MPa). */
    sigmaH0: z.number().finite(),
    /** Profondeur de l'essai z (m) — annotation « (z=… m) » du client. */
    z: z.number().finite(),
    /** Description de la categorie de sol (phrase, ex. « Argile molle, limon… »). */
    categorieDescription: z.string().max(200),
    /** Volumes de reference AFFICHES (cm³) — table « Volume ». */
    volumes: z
      .object({
        /** V_E restitution (cm³) = _res.VE. */
        vE: z.number().finite(),
        /** V(p0) debut pseudo-elastique (cm³) = _res.V0c. */
        v0: z.number().finite(),
        /** V(pf) fluage (cm³) = _res.Vf. */
        vf: z.number().finite(),
        /** V_Lim = Vs+2·V(p0) (cm³) = _res.VsP2V1. */
        vLim: z.number().finite(),
      })
      .strict(),
    /** Extrapolation par courbe inverse §D.4.3.2 (encart client). */
    extrapolation: z
      .object({
        /** Coefficient A de 1/(V−Vs) = A + B·p (brut, affiche en notation exp). */
        a: z.number().finite(),
        /** Coefficient B (brut). */
        b: z.number().finite(),
        /** pLM extrapolee au volume conventionnel Vs+2·V(p0) (bar) — affiche en MPa. */
        plmVLim: z.number().finite(),
        /** pLM asymptote de reference −A/B (bar) — affiche en MPa. */
        plmAsymptote: z.number().finite(),
        /** Ecart d'ajustement moyen (cm³) ; null si non fini (client affiche « — »). */
        errV: z.number().finite().nullable(),
      })
      .strict(),
    /** Synthese de la plage pseudo-elastique (bandeau « Synthese » du client). */
    synthese: z
      .object({
        /** Coefficient d'extension β (borne 1,5..4). */
        beta: z.number().finite(),
        /** Pente minimale mE (cm³/bar interne ; affichee ×10 en cm³/MPa). */
        mE: z.number().finite(),
        /** Debut de plage auto (indice 0-base ; affiche « L{+1} »). */
        plageAutoDebut: z.number().int().min(0),
        /** Fin de plage auto (indice 0-base ; affiche « L{+1} »). */
        plageAutoFin: z.number().int().min(0),
      })
      .strict(),
    /** Courbe corrigee (table « Mesures corrigees ») — colonnes exactes du client. */
    courbe: z.array(CourbePointSchema).max(60),
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
