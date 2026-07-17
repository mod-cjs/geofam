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
 * DETAIL PAS-A-PAS terzaghi — grandeurs intermediaires PUBLIQUES (ADR 0015 §Excision,
 * avis expert reco A du 16/07). Toutes normatives/textbook (NF P 94-261 annexes D/F/J/H ;
 * Ménard, Giroud, Schmertmann, Sanglerat) et deja affichees par l'outil desktop du client
 * a ses licencies. Exposees comme VALEURS D'AFFICHAGE (le CODE moteur reste serveur, DoD §8).
 * Allowlist NOMINATIVE fail-closed (.strict()) : aucun champ hors liste ne traverse.
 *
 * Sous-objet tassement de Ménard (methode pressiometrique, annexe H) : modules pondérés
 * E_c/E_d, coefficients rhéologiques α et de forme λ, decomposition s_c + s_d = s_f.
 */
const TassMenardSchema = z
  .object({
    /** Module pressiometrique de consolidation E_c (MPa). */
    Ec: z.number().finite().optional(),
    /** Module pressiometrique deviatorique E_d (MPa). */
    Ed: z.number().finite().optional(),
    /** Coefficient rhéologique de consolidation α_c (–). */
    alc: z.number().finite().optional(),
    /** Coefficient rhéologique deviatorique α_d (–). */
    ald: z.number().finite().optional(),
    /** Coefficient de forme λ_c (–). */
    lc: z.number().finite().optional(),
    /** Coefficient de forme λ_d (–). */
    ld: z.number().finite().optional(),
    /** Libellé de forme (« carré », « L/B = … »…). */
    lamLib: z.string().max(40).optional(),
    /** Libellé du mode de renormalisation E_d (formule H.2.1.2.x). */
    mode: z.string().max(80).optional(),
    /** Accroissement net de contrainte Δq (kPa). */
    dq: z.number().finite().optional(),
    /** Tassement de consolidation s_c (m). */
    sc: z.number().finite().optional(),
    /** Tassement deviatorique s_d (m). */
    sd: z.number().finite().optional(),
    /** Tassement total s_f = s_c + s_d (m). */
    sf: z.number().finite().optional(),
  })
  .strict();

/** Sous-objet tassement elastique (annexe J.3.1, Giroud) — methode c–φ labo. */
const TassElastSchema = z
  .object({
    /** Coefficient de tassement c_f (Giroud). */
    cf: z.number().finite().optional(),
    /** Libellé de forme du coefficient c_f. */
    cfLib: z.string().max(40).optional(),
    /** Module d'Young E (MPa). */
    E: z.number().finite().optional(),
    /** Coefficient de Poisson ν (–). */
    nu: z.number().finite().optional(),
    /** Accroissement net Δq (kPa). */
    dq: z.number().finite().optional(),
    /** Tassement elastique s (m). */
    s: z.number().finite().optional(),
    /** Message normatif borne si incalculable. */
    err: z.string().max(300).optional(),
  })
  .strict();

/** Sous-objet tassement de Schmertmann (§6.2 / annexe I) — methode penetrometrique. */
const TassSchmSchema = z
  .object({
    /** Facteur d'encastrement C_1 (–). */
    C1: z.number().finite().optional(),
    /** Facteur de fluage C_2 (–). */
    C2: z.number().finite().optional(),
    /** Facteur de forme C_3 (–). */
    C3: z.number().finite().optional(),
    /** Facteur d'influence pic I_z;pic (–). */
    Izp: z.number().finite().optional(),
    /** Facteur module E = Efac·q_c (–). */
    Efac: z.number().finite().optional(),
    /** Module minimal sur la zone (MPa). */
    Emin: z.number().finite().optional(),
    /** Module maximal sur la zone (MPa). */
    Emax: z.number().finite().optional(),
    /** Profondeur d'integration en nombre de B (z_I / B). */
    zfac: z.number().finite().optional(),
    /** Profondeur d'integration z_I (m). */
    zI: z.number().finite().optional(),
    /** Tassement s (m). */
    s: z.number().finite().optional(),
    /** Message normatif borne si incalculable. */
    err: z.string().max(300).optional(),
  })
  .strict();

/** Sous-objet tassement oedometrique (variante Sanglerat J.4.1) — methode penetrometrique. */
const TassOedSchema = z
  .object({
    /** Coefficient α de Sanglerat (M = α·q_c). */
    alphaSang: z.number().finite().optional(),
    /** Module oedometrique minimal (MPa). */
    Mmin: z.number().finite().optional(),
    /** Module oedometrique maximal (MPa). */
    Mmax: z.number().finite().optional(),
    /** Libellé de la zone d'influence. */
    zlbl: z.string().max(60).optional(),
    /** Profondeur de la zone (m). */
    depth: z.number().finite().optional(),
    /** Tassement s (m). */
    s: z.number().finite().optional(),
    /** Message normatif borne si incalculable. */
    err: z.string().max(300).optional(),
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

    // --- Grandeurs de DEMANDE affichees (clone UI, ADR 0014/0015) ---
    // Ces valeurs sont AFFICHEES par l'outil client dans chaque carte de verdict
    // (« V_d ≤ R_v;d », « q_ref ≤ q_Rv;d », « H_d ≤ R_h;d ») et dans la synthese.
    // Elles sont cote DEMANDE : q_ref = V_d / A' et H_d = √(F_x²+F_y²) se
    // re-derivent des efforts SAISIS par l'utilisateur et de la geometrie via la
    // regle de Meyerhof (surface effective) — aucune divulgation de la METHODE de
    // portance confidentielle (k_p/k_c/q_ce/p_le*/D_e/N_q/N_c/N_γ restent SERVEUR).
    /** Contrainte de reference appliquee q_ref = V_d / A' (kPa). */
    qref: z.number().finite().optional(),
    /** Charge horizontale resultante de calcul H_d = √(F_x²+F_y²) (kN ou kN/ml). */
    Hd: z.number().finite().optional(),

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

    // --- DETAIL PAS-A-PAS (ADR 0015 reco A) — grandeurs d'affichage du deroule ---
    // Geometrie effective (Meyerhof) : re-derivable des efforts SAISIS (M/F_z) et de la
    // geometrie B/L — meme rationale que qref/Hd (surface effective A'), pas la METHODE.
    /** Aire d'appui A (m², ou largeur en filante). */
    A: z.number().finite().optional(),
    /** Surface comprimee de Meyerhof A' (m²). */
    Ap: z.number().finite().optional(),
    /** Excentrement transversal e_B (m). */
    eB: z.number().finite().optional(),
    /** Excentrement longitudinal e_L (m). */
    eL: z.number().finite().optional(),
    /** Largeur effective B' (m). */
    Bp: z.number().finite().optional(),
    /** Longueur effective L' (m). */
    Lp: z.number().finite().optional(),
    /** Angle d'inclinaison de la charge δ_d (°). */
    delta: z.number().finite().optional(),
    // Coefficients de portance / reduction (annexes D/E) — table publiee, reco A.
    /** Hauteur de moyenne h_r (m). */
    hr: z.number().finite().optional(),
    /** h_r reduite par excentrement fort ? */
    hrRed: z.boolean().optional(),
    /** Pression nette equivalente p_le* (pressio) / q_ce (penetro) (MPa). */
    ple: z.number().finite().optional(),
    /** Hauteur d'encastrement equivalente D_e (m). */
    De: z.number().finite().optional(),
    /** Rapport D_e/B (–). */
    DeB: z.number().finite().optional(),
    /** Abscisse de courbe x = min(D_e/B, 2) (–). */
    kpx: z.number().finite().optional(),
    /** Facteur de portance base filante k_f (–). */
    kf: z.number().finite().optional(),
    /** Facteur de portance base carree k_c (–). */
    kc: z.number().finite().optional(),
    /** Facteur de portance k_p (–). */
    kp: z.number().finite().optional(),
    /**
     * Coefficients de la courbe k_p base filante [a, b, c, d] (table publiee annexe D,
     * reco A). VALEURS D'AFFICHAGE de la formule substituee (curveStr) — pas la table
     * complete (une seule categorie, celle du calcul). Bornes : 4 nombres finis.
     */
    coefCourbeF: z.array(z.number().finite()).length(4).optional(),
    /** Coefficients de la courbe k_p base carree [a, b, c, d] (table publiee annexe D). */
    coefCourbeC: z.array(z.number().finite()).length(4).optional(),
    /** Coefficient d'inclinaison i_δ (–). */
    idel: z.number().finite().optional(),
    /** Coefficient de talus i_β (–). */
    ibet: z.number().finite().optional(),
    /** Coefficient combine i_δβ (–). */
    idb: z.number().finite().optional(),
    /** Resistance nette du sol q_net (kPa). */
    qnet: z.number().finite().optional(),
    /** Surcharge laterale R_0 = A·q_0 (kN ou kN/ml). */
    R0: z.number().finite().optional(),
    /** Coefficient partiel de resistance γ_R;v (–). */
    gRv: z.number().finite().optional(),
    /** Coefficient de modele γ_R;d;v (–). */
    gRdv: z.number().finite().optional(),
    // Glissement (ELU) — angle d'interface + coefficients partiels (textbook).
    /** Angle de frottement d'interface δ_a (°). */
    da: z.number().finite().optional(),
    /** Coefficient partiel γ_R;h (–). */
    gRh: z.number().finite().optional(),
    /** Coefficient de modele γ_R;d;h (–). */
    gRdh: z.number().finite().optional(),
    /** Libellé du mode de glissement (drainé / non drainé). */
    glisMode: z.string().max(120).optional(),
    // Tassements — sous-objets detailles (un seul present selon la methode).
    /** Tassement de Ménard detaillé (pressio). */
    tass: TassMenardSchema.optional(),
    /** Tassement elastique detaillé (labo c–φ). */
    elast: TassElastSchema.optional(),
    /** Tassement de Schmertmann detaillé (penetro). */
    schm: TassSchmSchema.optional(),
    /** Tassement oedometrique detaillé (penetro). */
    oed: TassOedSchema.optional(),
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
    /**
     * Contraintes au niveau de la base — grandeurs d'OVERBURDEN elementaires
     * AFFICHEES par la note de calcul (§2 « Contraintes au niveau de la base ») :
     * u (pression interstitielle), q_0 = γ_ap·D (totale, apres travaux), σ'_v0 =
     * γ_av·D − u (effective, avant travaux). Textbook (hydrostatique + poids des
     * terres) : ne revele AUCUNE methode de portance confidentielle.
     */
    contraintesBase: z
      .object({
        /** Pression interstitielle a la base u (kPa). */
        u: z.number().finite(),
        /** Contrainte verticale totale apres travaux q_0 = γ_ap·D (kPa). */
        q0: z.number().finite(),
        /** Contrainte verticale effective avant travaux σ'_v0 (kPa). */
        sv0: z.number().finite(),
      })
      .strict()
      .optional(),
    /** Capacite portante de reference (charge centree verticale), par etat-limite. */
    capaciteReference: z
      .object({
        ok: z.boolean(),
        /** Aire de la fondation A (m², ou largeur en filante). */
        A: z.number().finite(),
        /** Surcharge laterale R0 = A·q0 (kN). */
        R0: z.number().finite(),
        states: z.array(RefCapStateSchema).max(3),
        // --- DETAIL PAS-A-PAS refCap (charge centree) — memes grandeurs publiques ---
        /** Methode de dimensionnement (« pressiométrique »/« pénétrométrique »/« c–φ »). */
        method: z.string().max(40).optional(),
        /** Resultats par ml (semelle filante) ? */
        perML: z.boolean().optional(),
        /** Contrainte totale q_0 (kPa). */
        q0: z.number().finite().optional(),
        /** Hauteur de moyenne h_r (m). */
        hr: z.number().finite().optional(),
        /** Pression nette equivalente p_le* / q_ce (MPa). */
        ple: z.number().finite().optional(),
        /** Hauteur d'encastrement equivalente D_e (m). */
        De: z.number().finite().optional(),
        /** Rapport D_e/B (–). */
        DeB: z.number().finite().optional(),
        /** Abscisse de courbe x (–). */
        kpx: z.number().finite().optional(),
        /** Facteur base filante k_f (–). */
        kf: z.number().finite().optional(),
        /** Facteur base carree k_c (–). */
        kc: z.number().finite().optional(),
        /** Facteur de portance k_p (–). */
        kp: z.number().finite().optional(),
        /** Coefficients courbe filante [a,b,c,d] (table publiee annexe D). */
        coefCourbeF: z.array(z.number().finite()).length(4).optional(),
        /** Coefficients courbe carree [a,b,c,d] (table publiee annexe D). */
        coefCourbeC: z.array(z.number().finite()).length(4).optional(),
        /** Coefficient de talus i_β (–). */
        ib: z.number().finite().optional(),
        /** Resistance nette q_net (kPa). */
        qnet: z.number().finite().optional(),
        /** Coefficient de modele γ_R;d;v (–). */
        gRdv: z.number().finite().optional(),
        /** Contrainte de reference retenue pour le tassement q_Tass (kPa). */
        qTass: z.number().finite().optional(),
        /** Tassement de Ménard detaillé (pressio). */
        tass: TassMenardSchema.optional(),
        /** Tassement elastique detaillé (labo c–φ). */
        elast: TassElastSchema.optional(),
        /** Tassement de Schmertmann detaillé (penetro). */
        schm: TassSchmSchema.optional(),
        /** Tassement oedometrique detaillé (penetro). */
        oed: TassOedSchema.optional(),
      })
      .strict()
      .optional(),
    /**
     * Raideurs equivalentes du sol support (annexe J.3 / Gazetas) — K_v/K_h/K_θ (reco A).
     * Grandeurs de dimensionnement affichees par le deroule ; le CODE (ratios) reste serveur.
     */
    raideurs: z
      .object({
        /** Raideur verticale K_v (MN/m ou MN/m/ml). */
        Kv: z.number().finite(),
        /** Raideur horizontale selon B, K_h;B (MN/m). */
        KhB: z.number().finite().optional(),
        /** Raideur horizontale selon L, K_h;L (MN/m). */
        KhL: z.number().finite().optional(),
        /** Raideur de rotation selon B, K_θ;B (MN·m/rd). */
        KtB: z.number().finite().optional(),
        /** Raideur de rotation selon L, K_θ;L (MN·m/rd). */
        KtL: z.number().finite().optional(),
        /** Libellé de la methode (« Ménard, §7.2.1 »…). */
        methodLib: z.string().max(60).optional(),
        /** Raideurs par ml (semelle filante) ? */
        perML: z.boolean().optional(),
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
