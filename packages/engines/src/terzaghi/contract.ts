/**
 * CONTRAT I/O du moteur terzaghi — Fondations superficielles, NF P 94-261 (#56).
 *
 * Defini avec `defineEngineContract` de @roadsen/shared : entree bornee (sert
 * aussi de forme persistee) + sortie client-safe en WHITELIST STRICTE. Les deux
 * schemas sont verifies anti-passthrough a la construction (cf. engine-io.ts).
 *
 * --- POURQUOI une sortie tres reduite par rapport a l'objet moteur ---
 * Le moteur produit, en interne (objet `R`), une foule d'intermediaires :
 * facteurs partiels, coefficients de forme (kf, kc, bv, bB...), surface comprimee
 * A', moyennes harmoniques par tranche, Nq/Nc/Ng, etc. Exposer cet objet brut au
 * client reviendrait a PUBLIER la formule par ses intermediaires (fuite de PI
 * confidentielle, DoD §8). On ne whiteliste donc QUE des grandeurs de RESULTAT
 * destinees a l'affichage / au PV :
 *   - le verdict par cas de charge (portance / glissement / tassement OK ? taux) ;
 *   - les grandeurs physiques finales (Rtot, qRvd, tassement, deplacement vertical) ;
 *   - la capacite portante de reference (R_v;d par etat-limite, charge centree).
 *
 * Tout le reste (kp, ple, De, coefficients, A'...) reste SERVEUR. Le mecanisme
 * `projectEngineOutput` re-parse la sortie brute a travers ce schema et STRIPPE
 * tout champ non whiteliste, a tout niveau (cf. index.ts).
 *
 * --- ENTREE ---
 * On accepte les nombres EN CHAINE (« 1,5 », « 0,33 ») car le moteur d'origine
 * parse lui-meme via num() (virgule decimale FR). Pour PRESERVER LE COMPORTEMENT
 * a l'identique (equivalence-portage), on NE pre-convertit PAS : on laisse passer
 * la chaine ou le nombre, et le moteur fait foi. `coerce`/`transform` sont
 * interdits par le garde-fou anti-passthrough sur l'entree ; on declare donc des
 * unions number|string explicites et bornees.
 *
 * AUCUN symbole de calcul ici : pur Zod/TS, mais ce fichier appartient a
 * @roadsen/engines (importe par l'API seule, jamais le front).
 */
import { defineEngineContract } from '@roadsen/shared';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Entree : le `state` du moteur (forme bornee, nombres en chaine FR tolérés)
// ---------------------------------------------------------------------------

/** Valeur numerique tolerante : nombre fini OU chaine (parsee par le moteur). */
// Le front envoie les nombres en TEXTE brut (inputs). On tolere donc les chaines,
// mais on REJETTE une chaine NON VIDE qui ne represente pas un nombre fini une fois
// coercee comme le fait le moteur (`num()` : trim, espaces retires, virgule -> point,
// puis Number). Une chaine vide reste toleree (absence intentionnelle, ex. `pl:''` ->
// le moteur lit NaN et ignore/defaute). Sans ce garde-fou, `c = "abc"` etait
// silencieusement absorbe -> resultat FAUX mais plausible, scellable dans un PV
// (faille #1, audit adverse). Le calage sur `num()` garde les decimales a virgule
// (`"1,5"`) valides et rejette `"abc"` / `"Infinity"` / `"NaN"` / `"1e999"`.
const NumOrStr = z.union([
  z.number().finite(),
  z
    .string()
    .max(32)
    .refine(
      (s) => {
        const t = s.trim().replace(/\s/g, '').replace(',', '.');
        return t === '' || Number.isFinite(Number(t));
      },
      { message: 'valeur numerique invalide' },
    ),
]);
/** Champ numerique facultatif (vide possible : le moteur lit alors NaN). */
const OptNumOrStr = NumOrStr.optional();

/** Une ligne de sondage in situ (profondeur + grandeurs mesurees). */
const SondageRowSchema = z
  .object({
    z: OptNumOrStr,
    pl: OptNumOrStr,
    em: OptNumOrStr,
    al: OptNumOrStr,
    qc: OptNumOrStr,
  })
  .strict();

/** Un cas de charge (etat-limite + efforts). */
const ChargeRowSchema = z
  .object({
    etat: z.enum(['ELU_F', 'ELU_A', 'ELS_C', 'ELS_F', 'ELS_QP']),
    fz: OptNumOrStr,
    fx: OptNumOrStr,
    fy: OptNumOrStr,
    mx: OptNumOrStr,
    my: OptNumOrStr,
  })
  .strict();

/**
 * Entree complete du moteur. Bornee (`.strict()`), pas de champ libre. Le `projet`
 * (libelle) n'intervient pas dans le calcul ; on l'accepte comme metadonnee
 * d'affichage bornee.
 */
export const TerzaghiInputSchema = z
  .object({
    projet: z.string().max(200).optional(),
    sondage: z.array(SondageRowSchema).max(200),
    solCat: z.enum(['argiles', 'sables', 'craies', 'marnes', 'roches']),
    nappe: OptNumOrStr,
    gAvant: OptNumOrStr,
    gApres: OptNumOrStr,
    c: OptNumOrStr,
    phi: OptNumOrStr,
    eYoung: OptNumOrStr,
    nuSol: OptNumOrStr,
    cphiOn: z.boolean().optional(),
    cphiMode: z.enum(['auto', 'nd', 'd']).optional(),
    gSous: OptNumOrStr,
    essai: z.enum(['pressio', 'penetro', 'labo']),
    alphaSang: OptNumOrStr,
    profilMode: z.enum(['couches', 'essais']),
    forme: z.enum(['filante', 'carree', 'rect', 'circ']),
    B: OptNumOrStr,
    L: OptNumOrStr,
    D: OptNumOrStr,
    talusOn: z.boolean().optional(),
    beta: OptNumOrStr,
    dTalus: OptNumOrStr,
    talusDir: z.enum(['ext', 'int']).optional(),
    beton: z.enum(['coule', 'prefa']).optional(),
    alphaConst: z.boolean().optional(),
    alphaConstVal: OptNumOrStr,
    charges: z.array(ChargeRowSchema).max(50),
  })
  .strict();
export type TerzaghiInput = z.infer<typeof TerzaghiInputSchema>;

// ---------------------------------------------------------------------------
// Sortie : WHITELIST stricte des resultats affichables (aucun intermediaire)
// ---------------------------------------------------------------------------

/**
 * Resultat de portance pour un etat-limite donne, charge centree verticale
 * (capacite de reference). On expose la resistance et la contrainte resistante,
 * pas les facteurs (kp, ple, De...).
 */
const RefCapStateSchema = z
  .object({
    etat: z.enum(['ELU_F', 'ELU_A', 'ELS_C']),
    /** Coefficient partiel de resistance (affiche, derive de l'etat). */
    gRv: z.number().finite(),
    /** Resistance verticale de calcul R_v;d (kN, ou kN/ml en filante). */
    Rvd: z.number().finite(),
    /** Contrainte resistante de calcul q_Rv;d = R_v;d / A (kPa). */
    qRvd: z.number().finite(),
  })
  .strict();

/**
 * Verdict + grandeurs finales pour un cas de charge saisi. NaN possible
 * (domaine non couvert) : le contrat l'exclut via SafeNumber (finite). On rend
 * donc OPTIONNELS les champs qui peuvent ne pas etre calcules (cas invalide,
 * etat sans glissement/tassement), et le moteur ne fournit que les pertinents.
 */
const CaseResultSchema = z
  .object({
    /** Index du cas dans la saisie (stable). */
    idx: z.number().finite(),
    etat: z.enum(['ELU_F', 'ELU_A', 'ELS_C', 'ELS_F', 'ELS_QP']),
    /** Cas rejete a la saisie (Fz<=0, A'=0...) : message borne, sans valeur interne. */
    invalide: z.boolean(),

    // --- Portance (si calculee) ---
    /** Resistance totale de calcul R_tot (kN ou kN/ml). */
    Rtot: z.number().finite().optional(),
    /** Contrainte resistante de calcul (kPa). */
    qRvd: z.number().finite().optional(),
    /** Taux de mobilisation Fz / R_tot (–). */
    taux: z.number().finite().optional(),
    /** Portance verifiee ? */
    portanceOk: z.boolean().optional(),

    // --- Glissement (ELU avec effort horizontal) ---
    /** Resistance au glissement R_h;d (kN ou kN/ml). */
    Rhd: z.number().finite().optional(),
    /** Taux de mobilisation horizontale H / R_h;d (–). */
    tauxH: z.number().finite().optional(),
    /** Glissement verifie ? (null si non requis / pas d'effort H). */
    glissementOk: z.boolean().optional(),

    // --- Excentrement (tab. 5.5, verification client-safe) ---
    // Grandeur PUBLIQUE (derivee des efforts saisis M/Fz et de la geometrie B/L,
    // affichee dans l'onglet Verifications du moteur d'origine) — PAS un intermediaire
    // de methode. Sans ces champs, l'excentrement etait STRIPPE et ne pesait plus dans
    // le verdict (faux PASS, MAJEUR-1). Absents = excentrement NON REQUIS (ELU accidentel).
    /** Taux de surface comprimee exc = (1 - 2e_B/B)·(1 - 2e_L/L) (–), valeur affichee. */
    exc: z.number().finite().optional(),
    /** Limite reglementaire d'excentrement (–), tab. 5.5. */
    excLim: z.number().finite().optional(),
    /** Libelle de la limite (« 1/15 », « 1/2 », « 2/3 »…) pour l'affichage « ≥ … ». */
    excLimLib: z.string().max(16).optional(),
    /** Excentrement verifie ? (absent = non requis, ex. ELU accidentel). */
    excOk: z.boolean().optional(),

    // --- Portance complementaire c–φ, annexe F (option « Portance analytique c–φ ») ---
    // Bloc ASSAINI : uniquement des grandeurs de RESULTAT (verdict + resistances/taux),
    // JAMAIS les facteurs de portance Nq/Nc/Ng/sq/sc/bq… qui restent SERVEUR (DoD §8).
    // Projete UNIQUEMENT en methode in situ (pressio/penetro) avec l'option cochee ; en
    // labo, c–φ est la portance PRINCIPALE, deja portee par Rtot/qRvd/taux/portanceOk.
    cphi: z
      .object({
        /** Portance c–φ verifiee ? */
        ok: z.boolean().optional(),
        /** Taux de mobilisation V_d / R_v;d;F (–). */
        taux: z.number().finite().optional(),
        /** Contrainte resistante de calcul c–φ q_Rv;d;F (kPa). */
        qRvd: z.number().finite().optional(),
        /** Resistance totale de calcul c–φ R_v;d;F (kN ou kN/ml). */
        Rtot: z.number().finite().optional(),
        /** Message normatif borne si la portance c–φ est incalculable (domaine). */
        err: z.string().max(300).optional(),
      })
      .strict()
      .optional(),

    // --- Tassement (ELS) ---
    /** Tassement total (m) — methode Menard (pressio). */
    tassement: z.number().finite().optional(),
    /** Tassement de Schmertmann (m) — penetro. */
    tassementSchmertmann: z.number().finite().optional(),
    /** Tassement oedometrique Sanglerat (m) — penetro. */
    tassementOed: z.number().finite().optional(),
    /** Tassement elastique (m) — labo c–φ. */
    tassementElastique: z.number().finite().optional(),
    /** Deplacement vertical sous la charge (m), via raideur Kv. */
    deplacementVertical: z.number().finite().optional(),
  })
  .strict();

/**
 * Sortie client-safe du moteur terzaghi. Contient l'erreur de saisie globale
 * (message borne), les avertissements normatifs (textes deja produits par le
 * moteur, sans valeur interne sensible), la capacite de reference par etat, et
 * le verdict par cas de charge.
 *
 * NB sur `warnings`/`erreur` (canal TEXTE LIBRE) — DoD §8, MAJEUR-1 :
 * Le moteur produit, en interne, des warnings qui PEUVENT interpoler la VALEUR
 * d'un intermediaire CONFIDENTIEL (ex. « q_ce = 1,23 MPa faible... », « p_le* =
 * 0,15 MPa... »). `ple`/`qce` etant des intermediaires interdits d'exposition,
 * leur valeur ne doit pas plus fuir par le texte que par une cle structuree. La
 * whitelist (cles) ne couvre PAS ce canal : c'est pourquoi la projection
 * (index.ts: redactConfidentialWarnings) REDACTE la valeur accolee a une
 * etiquette confidentielle AVANT exposition, en gardant le SENS du warning
 * (etiquette, seuil normatif constant, citation NF P94-261). Les nombres NON
 * confidentiels (profondeurs de sondage en m, geometrie) sont preserves. Bornes
 * en longueur pour eviter tout deversement.
 *
 * (Question « ple* / qce sont-ils client-safe ? » = decision science +
 * titulaire ; par defaut on NE les expose pas, coherent avec FUITES_INTERDITES.)
 */
export const TerzaghiOutputSchema = z
  .object({
    /** Erreur de saisie globale (calcul non lance). Chaine bornee, sans valeur interne. */
    erreur: z.string().max(500).nullable(),
    /** Avertissements normatifs (libelles NF P94-261). */
    warnings: z.array(z.string().max(500)).max(50),
    /** Regime d'encastrement classifie (annexe C), si determinable. */
    regime: z.enum(['superficielle', 'semi-profonde']).optional(),
    /** Capacite portante de reference (charge centree verticale), par etat-limite. */
    capaciteReference: z
      .object({
        ok: z.boolean(),
        /** Aire de la fondation A (m², ou largeur en filante). */
        A: z.number().finite(),
        /** Surcharge laterale R0 = A·q0 (kN). */
        R0: z.number().finite(),
        states: z.array(RefCapStateSchema).max(3),
      })
      .strict()
      .optional(),
    /** Verdict par cas de charge saisi. */
    cas: z.array(CaseResultSchema).max(50),
  })
  .strict();
export type TerzaghiOutput = z.infer<typeof TerzaghiOutputSchema>;

// ---------------------------------------------------------------------------
// Le contrat (verifie anti-passthrough a la construction)
// ---------------------------------------------------------------------------

/** Identifiant logique = cle de registre (cf. packages/engines/registry). */
export const TERZAGHI_ENGINE_ID = 'fondation-superficielle';

export const terzaghiContract = defineEngineContract({
  id: TERZAGHI_ENGINE_ID,
  inputSchema: TerzaghiInputSchema,
  outputSchema: TerzaghiOutputSchema,
});
