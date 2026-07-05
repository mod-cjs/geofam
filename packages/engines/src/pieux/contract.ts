/**
 * CONTRAT I/O du moteur PIEUX — fondations profondes (NF P 94-262, EC7) (#48, #56).
 *
 * Defini avec `defineEngineContract` de @roadsen/shared : entree bornee (sert aussi
 * de forme persistee) + sortie client-safe en WHITELIST STRICTE. Les deux schemas
 * sont verifies anti-passthrough a la construction (cf. engine-io.ts).
 *
 * --- ENTREE ---
 * L'etat complet d'un calcul de pieu, tel que `compute()` du HTML le lisait dans le
 * DOM / la globale `state` / `curPile()`. Contrairement au HTML qui lit des CHAMPS
 * DE SAISIE, on declare ici des NOMBRES finis bornes / des enumerations fermees.
 *   - `geom`     : geometrie de section (circ/carre/rect/quelconque + dimensions) ;
 *   - `g_z0`/`g_D` : profondeurs de tete et de base (m) ;
 *   - `cat`      : numero de categorie de pieu (1..20, Tableau A.1 NF P 94-262) ;
 *   - `meth`     : methode de portance — 'pmt' (pressiometrique) / 'cpt'
 *     (penetrometrique) / 'cphi' (c-φ) ;
 *   - `da`       : approche de calcul EC7 — 'da1' / 'da2' (NA France) / 'da3' ;
 *   - `sens`     : 'comp' (compression) / 'trac' (traction) ;
 *   - `essais`   : 'oui'/'non' (essais de chargement — plafond traction §4.3.3) ;
 *   - `c_G`/`c_Q`: charges caracteristiques permanente / variable (kN) ;
 *   - `o_nappe`  : profondeur de la nappe (m) ;
 *   - `o_nprofil`/`o_surf`/`o_redis` : nombre de profils de sol, surface investiguee
 *     (m²), redistribution par structure rigide ('oui'/'non') — facteurs xi ;
 *   - `grp`      : effet de groupe { grp_n, grp_m, grp_s } (files, pieux/file, entraxe) ;
 *   - `coeffs`   : coefficients partiels EDITABLES (NA francaise DA2 + fluage) — memes
 *     defauts que le HTML ; injectes pour fidelite ;
 *   - `layers`   : profil de couches [{ soil, th, pl, em, qc, c, phi, gamma }] ;
 *   - `cpt`      : penetrogramme q_c(z) { step, pts:[{z,qc}] } (methode CPT).
 *
 * --- POURQUOI une sortie reduite (anti-fuite, DoD §8) ---
 * Le calcul produit, en interne (objet `R`), une foule d'intermediaires CONFIDENTIELS
 * qui CONSTITUENT la methode NF P 94-262 :
 *   - le terme de pointe brut `qb`, la pression limite nette equivalente `ple`, la
 *     resistance de pointe equivalente `qce`, les FACTEURS DE PORTANCE `kfac`/`kmax`
 *     (kp/kc des Tableaux F.4.2.1/G.4.2.1) et la hauteur d'encastrement equivalente
 *     `Def`/`debR` ;
 *   - le DETAIL par couche du frottement `fric` (qs, dRs, qsm, degradation) — qui
 *     revele les courbes de frottement et les coefficients α des annexes F/G ;
 *   - la chaine `qbDetail` (qui interpole ple/qce/kp/kc), le detail `qceDetail`, la
 *     COURBE de mobilisation du tassement (`settle.pts`), les facteurs de
 *     correlation `xi3`/`xi4`, le coefficient de modele `grd`, les facteurs partiels
 *     par combinaison (`checks[].Rbf/Rsf/comb`).
 * Exposer cet objet reviendrait a publier la methode par ses intermediaires. On ne
 * whiteliste donc QUE les grandeurs de RESULTAT de dimensionnement, celles qui vont
 * au PV : resistances caracteristiques Rb;k/Rs;k/Rc;k, resistance de calcul ELU
 * gouvernante Rc;d (ou Rt;d), charges de fluage ELS (Rc;cr;k et ses valeurs de
 * calcul caracteristique/quasi-permanente), sollicitations de calcul (Fd ELU/ELS),
 * verdict de verification (allOk + taux gouvernant), tassement ELS, et la
 * geometrie/identite du pieu (B, D, categorie, methode, sens).
 *
 * Tout le reste reste SERVEUR. `projectEngineOutput` re-parse la sortie a travers ce
 * schema et STRIPPE tout champ non whiteliste, a tout niveau (cf. index.ts).
 *
 * AUCUN symbole de calcul ici : pur Zod/TS, mais ce fichier appartient a
 * @roadsen/engines (importe par l'API seule, jamais le front).
 */
import { defineEngineContract } from '@roadsen/shared';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Entree : etat complet d'un calcul de pieu (nombres finis bornes / enums)
// ---------------------------------------------------------------------------

/** Natures de sol couvertes par les tables NF P 94-262. */
const SoilEnum = z.enum(['argile', 'sable', 'craie', 'marne', 'roche']);

/** Geometrie de section du pieu. */
const GeomSchema = z
  .object({
    /** Type de section : circulaire / carree / rectangulaire / quelconque (B_eq). */
    section: z.enum(['circ', 'carre', 'rect', 'quel']),
    /** Diametre/cote B (m) — circ/carre/rect. 0 -> defaut moteur 0,6. */
    g_B: z.number().finite().min(0).max(10).optional(),
    /** Largeur b (m) — section rectangulaire. 0 -> defaut B. */
    g_b2: z.number().finite().min(0).max(10).optional(),
    /** Aire de pointe Ap (m²) — section quelconque. */
    g_Ap: z.number().finite().min(0).max(100).optional(),
    /** Perimetre du fut P (m) — section quelconque. */
    g_P: z.number().finite().min(0).max(100).optional(),
  })
  .strict();

/** Une couche de sol du profil. */
const LayerSchema = z
  .object({
    soil: SoilEnum,
    /** Epaisseur de la couche (m). */
    th: z.number().finite().min(0).max(200),
    /** Pression limite nette pl* (MPa) — methode pressiometrique. */
    pl: z.number().finite().min(0).max(100).optional(),
    /** Module pressiometrique EM (MPa) — tassement. */
    em: z.number().finite().min(0).max(100000).optional(),
    /** Resistance de pointe qc (MPa) — methode penetrometrique. */
    qc: z.number().finite().min(0).max(200).optional(),
    /** Cohesion c (kPa) — methode c-φ. */
    c: z.number().finite().min(0).max(100000).optional(),
    /** Angle de frottement φ (deg) — methode c-φ. */
    phi: z.number().finite().min(0).max(89).optional(),
    /** Poids volumique γ (kN/m³). */
    gamma: z.number().finite().min(0).max(40).optional(),
  })
  .strict();

/** Un point du penetrogramme q_c(z). */
const CptPointSchema = z
  .object({
    z: z.number().finite().min(0).max(500),
    qc: z.number().finite().min(0).max(200),
  })
  .strict();

/** Penetrogramme q_c(z) (methode CPT). */
const CptSchema = z
  .object({
    step: z.number().finite().min(0.01).max(10),
    pts: z.array(CptPointSchema).max(2000),
  })
  .strict();

/** Effet de groupe (§4.3.2). */
const GroupSchema = z
  .object({
    /** Nombre de files n. */
    grp_n: z.number().finite().min(1).max(10000),
    /** Pieux par file m. */
    grp_m: z.number().finite().min(1).max(10000),
    /** Entraxe S (m) ; 0 = isole. */
    grp_s: z.number().finite().min(0).max(1000),
  })
  .strict();

/**
 * Coefficients partiels EDITABLES (NA francaise DA2 + fluage 14.2.2). Defauts
 * identiques au HTML (champs `value=` des inputs). On les declare en entree pour
 * rester FIDELE au comportement d'origine ; l'appelant peut conserver les defauts.
 */
const CoeffsSchema = z
  .object({
    /** γG defavorable (DA2 NA). Defaut 1,35. */
    k_gG: z.number().finite().min(0).max(10),
    /** γQ defavorable (DA2 NA). Defaut 1,50. */
    k_gQ: z.number().finite().min(0).max(10),
    /** γb pointe (DA2 NA, R2). Defaut 1,10. */
    k_gb: z.number().finite().min(0.1).max(10),
    /** γs frottement (DA2 NA, R2). Defaut 1,10. */
    k_gs: z.number().finite().min(0.1).max(10),
    /** γs;t traction (DA2 NA, R2). Defaut 1,15. */
    k_gst: z.number().finite().min(0.1).max(10),
    /** ψ₂ quasi-permanent. Defaut 0,3. */
    k_psi2: z.number().finite().min(0).max(2),
    /** Coef Rb;k pour fluage, pieu avec refoulement (battu). Defaut 0,70. */
    cr_b_b: z.number().finite().min(0).max(2),
    /** Coef Rs;k pour fluage, pieu avec refoulement. Defaut 0,70. */
    cr_b_s: z.number().finite().min(0).max(2),
    /** Coef Rb;k pour fluage, pieu fore. Defaut 0,50. */
    cr_f_b: z.number().finite().min(0).max(2),
    /** Coef Rs;k pour fluage, pieu fore. Defaut 0,70. */
    cr_f_s: z.number().finite().min(0).max(2),
    /** γ fluage caracteristique compression. Defaut 0,90. */
    cr_car: z.number().finite().min(0.1).max(10),
    /** γ fluage quasi-permanent compression. Defaut 1,10. */
    cr_qp: z.number().finite().min(0.1).max(10),
    /** γs;cr fluage caracteristique traction. Defaut 1,10. */
    cr_car_t: z.number().finite().min(0.1).max(10),
    /** γs;cr fluage quasi-permanent traction. Defaut 1,50. */
    cr_qp_t: z.number().finite().min(0.1).max(10),
  })
  .strict();

/** Coefficients par DEFAUT (identiques aux `value=` du HTML d'origine). Type via
 * `CoeffsSchema` (et non `PieuxInput['coeffs']`) pour eviter une reference de type
 * circulaire : l'InputSchema normalise `coeffs` vers cette constante (.transform). */
export const PIEUX_DEFAULT_COEFFS: z.infer<typeof CoeffsSchema> = {
  k_gG: 1.35,
  k_gQ: 1.5,
  k_gb: 1.1,
  k_gs: 1.1,
  k_gst: 1.15,
  k_psi2: 0.3,
  cr_b_b: 0.7,
  cr_b_s: 0.7,
  cr_f_b: 0.5,
  cr_f_s: 0.7,
  cr_car: 0.9,
  cr_qp: 1.1,
  cr_car_t: 1.1,
  cr_qp_t: 1.5,
};

/**
 * FROTTEMENT NEGATIF (downdrag) — groupe d'entree OPTIONNEL (#94). Absent => le
 * frottement negatif n'est PAS calcule (les 3 sorties Gsn/Nmax/pointNeutre valent
 * null). Bornes fideles aux champs `fn_*` du HTML d'origine. Aucun defaut cache :
 * les prefills `fnFromProject` du HTML sont du CONFORT UI (pas de la science) ; le
 * contrat exige des nombres explicites (determinisme + pilotage HTML a l'identique).
 */
const FrottementNegatifSchema = z
  .object({
    /** Mode : 'auto' (tassement libre du sol) ou 'impose' (zone F.N. bornee zt-zb). */
    mode: z.enum(['auto', 'impose']),
    /** Charge structurelle en tete Q (kN) — separee de c_G (le HTML la preremplit). */
    fn_Q: z.number().finite().min(0).max(1e9),
    /** Terme K·tanδ du frottement negatif (Combarieu) — 0,30 refoule / 0,20 fore. */
    fn_ktd: z.number().finite().min(0).max(5),
    /** Tassement libre du sol en surface s₀ (mm) — mode auto. */
    fn_s0: z.number().finite().min(0).max(5000),
    /** Profondeur de sol compressible H_c (m) — mode auto. */
    fn_hc: z.number().finite().min(0).max(500),
    /** Haut de la zone de F.N. imposee (m) — mode impose. */
    fn_zt: z.number().finite().min(0).max(500),
    /** Bas de la zone de F.N. imposee (m) — mode impose. */
    fn_zb: z.number().finite().min(0).max(500),
  })
  .strict();

/**
 * VERIFICATION STRUCTURALE DU BETON (NF P 94-262 §4.4) — groupe d'entree OPTIONNEL
 * (#95). Absent => la verification structurale n'est PAS calculee (les sorties
 * beton* valent null). Reproduit les 3 entrees que `betonCheck()` du HTML lisait :
 *   - `b_fck` : resistance caracteristique du beton f_ck (MPa) ; le HTML applique
 *     `num('b_fck') || 25` (champ vide ou 0 => 25 MPa) — d'ou l'optionnalite ;
 *   - `arm`   : section « armé » (α_cc = 1,0) ou « nonarme » (α_cc = 0,8) ;
 *   - `k3`    : contrôles d'intégrité — « 1.0 » (courants) ou « 1.2 » (renforcés).
 * NB : les VALEURS numeriques associees (α_cc, k3, k1, k2, C_max, f_ck*) sont des
 * FACTEURS DE CALAGE de la methode — ils restent SERVEUR (jamais exposes, cf. index.ts).
 */
const BetonSchema = z
  .object({
    /** Resistance caracteristique du beton f_ck (MPa). Vide/0 => 25 (defaut moteur). */
    b_fck: z.number().finite().min(0).max(200).optional(),
    /** Section : 'arme' (α_cc = 1,0) / 'nonarme' (α_cc = 0,8). */
    arm: z.enum(['arme', 'nonarme']),
    /** Contrôles d'intégrité : '1.0' (courants) / '1.2' (renforcés) -> facteur k₃. */
    k3: z.enum(['1.0', '1.2']),
  })
  .strict();

/**
 * Entree complete du moteur pieux (un calcul de portance). Bornee. Voir l'en-tete
 * pour le sens et les unites.
 */
export const PieuxInputSchema = z
  .object({
    /** Libelle de projet (metadonnee d'affichage, hors calcul). */
    projet: z.string().max(200).optional(),
    /** Libelle du pieu (metadonnee d'affichage, hors calcul). */
    pieu: z.string().max(200).optional(),
    geom: GeomSchema,
    /** Profondeur de tete z₀ (m). */
    g_z0: z.number().finite().min(0).max(500),
    /** Profondeur de base D (m). */
    g_D: z.number().finite().min(0).max(500),
    /** Categorie de pieu (1..20, Tableau A.1). */
    cat: z.number().int().min(1).max(20),
    /** Methode de portance. */
    meth: z.enum(['pmt', 'cpt', 'cphi']),
    /** Approche de calcul EC7. */
    da: z.enum(['da1', 'da2', 'da3']),
    /** Sens de sollicitation. */
    sens: z.enum(['comp', 'trac']),
    /** Essais de chargement disponibles. */
    essais: z.enum(['oui', 'non']),
    /** Charge permanente caracteristique G (kN). */
    c_G: z.number().finite().min(0).max(1e9),
    /** Charge variable caracteristique Q (kN). */
    c_Q: z.number().finite().min(0).max(1e9),
    /** Profondeur de la nappe (m). */
    o_nappe: z.number().finite().min(0).max(500),
    /** Nombre de profils de sol N (facteurs xi). */
    o_nprofil: z.number().finite().min(1).max(10000),
    /** Surface investiguee S (m²) (facteurs xi). */
    o_surf: z.number().finite().min(0).max(1e9),
    /** Redistribution par structure rigide. */
    o_redis: z.enum(['oui', 'non']),
    grp: GroupSchema,
    // SECURITE (audit adverse) : les coefficients partiels EC7 sont AUTORITATIFS
    // SERVEUR. On REJETTE (400) toute valeur non normative des l'ENTREE (.refine, seul
    // effet tolere par le contrat ; .transform est interdit). Consequence : l'input
    // PROJETE/PERSISTE/SCELLE ne peut contenir que les coeffs normatifs = ceux qui ont
    // calcule (invariant « scelle = calcule » restaure ; un PV ne peut plus afficher des
    // coeffs client qui n'ont pas produit le resultat). Rejet EXPLICITE (fail-closed) au
    // lieu d'un override silencieux. Reactiver des facteurs par projet = feature gouvernee
    // (expert + STARFIRE) avec disclosure au PV.
    coeffs: CoeffsSchema.refine(
      (c) =>
        (Object.keys(PIEUX_DEFAULT_COEFFS) as Array<keyof typeof PIEUX_DEFAULT_COEFFS>).every(
          (k) => c[k] === PIEUX_DEFAULT_COEFFS[k],
        ),
      { message: 'coefficients partiels non normatifs : autoritatifs serveur (valeurs reglementaires imposees)' },
    ),
    /** Profil de couches (>= 1). */
    layers: z.array(LayerSchema).min(1).max(100),
    /** Penetrogramme q_c(z) ; vide -> genere depuis les qc de couches (methode CPT). */
    cpt: CptSchema,
    /** Frottement negatif (downdrag) — groupe optionnel ; absent => non calcule. */
    frottementNegatif: FrottementNegatifSchema.optional(),
    /** Verification structurale du beton (§4.4) — groupe optionnel ; absent => non calculee. */
    beton: BetonSchema.optional(),
  })
  .strict();
export type PieuxInput = z.infer<typeof PieuxInputSchema>;

// ---------------------------------------------------------------------------
// Sortie : WHITELIST stricte des resultats de dimensionnement (aucun intermediaire)
// ---------------------------------------------------------------------------

/** Une verification (combinaison) exposee : libelle + sollicitation + resistance + taux. */
const CheckSchema = z
  .object({
    /** Libelle de la combinaison (ex. « ELU portance — DA2 », « ELS caractéristique »). */
    nom: z.string().max(120),
    /** Sollicitation de calcul Fd (kN). */
    Fd: z.number().finite(),
    /** Resistance de calcul Rd (kN). */
    Rd: z.number().finite(),
    /** Taux de travail Fd/Rd (sans dimension). */
    taux: z.number().finite(),
    /** Verification satisfaite (Fd <= Rd). */
    ok: z.boolean(),
  })
  .strict();

/**
 * Sortie client-safe du moteur pieux. Les grandeurs FINALES de dimensionnement +
 * le verdict de verification. Aucun terme de pointe brut, aucun facteur de portance,
 * aucun detail de frottement par couche, aucune courbe de mobilisation, aucun
 * facteur partiel intermediaire.
 */
export const PieuxOutputSchema = z
  .object({
    /** Erreur de calcul (garde du moteur / science levee) : message borne. */
    erreur: z.string().max(500).nullable(),
    /** Avertissements (redactes des valeurs confidentielles). */
    warnings: z.array(z.string().max(500)).max(50),
    /** Diametre/cote equivalent B (m). */
    B: z.number().finite(),
    /** Profondeur de base D (m). */
    D: z.number().finite(),
    /** Categorie de pieu (1..20). */
    categorie: z.number().int(),
    /** Methode de portance retenue ('pmt'/'cpt'/'cphi'). */
    methode: z.string().max(8),
    /** Sens de sollicitation ('comp'/'trac'). */
    sens: z.string().max(8),
    /** Resistance de pointe caracteristique Rb;k (kN). */
    RbK: z.number().finite(),
    /** Resistance de frottement caracteristique Rs;k (kN). */
    RsK: z.number().finite(),
    /** Resistance caracteristique totale Rc;k (kN). */
    RcK: z.number().finite(),
    /** Resistance de calcul ELU gouvernante Rc;d (ou Rt;d en traction) (kN). */
    RcD: z.number().finite(),
    /** Charge de fluage caracteristique Rc;cr;k (kN). */
    RcrK: z.number().finite(),
    /** Resistance de fluage de calcul, ELS caracteristique (kN). */
    RcrCar: z.number().finite(),
    /** Resistance de fluage de calcul, ELS quasi-permanent (kN). */
    RcrQp: z.number().finite(),
    /** Sollicitation de calcul ELU gouvernante Fd (kN). */
    FduELU: z.number().finite(),
    /** Sollicitation ELS caracteristique G + Q (kN). */
    FdCar: z.number().finite(),
    /** Sollicitation ELS quasi-permanent G + ψ₂·Q (kN). */
    FdQp: z.number().finite(),
    /** Verifications par combinaison (ELU + ELS). */
    verifications: z.array(CheckSchema).max(20),
    /** Toutes les verifications satisfaites. */
    allOk: z.boolean(),
    /** Taux de travail gouvernant (max Fd/Rd). */
    tauxGouvernant: z.number().finite(),
    /** Tassement ELS estime sous charge caracteristique (mm). null si non calculable. */
    tassementELS: z.number().finite().nullable(),
    // --- FROTTEMENT NEGATIF (downdrag, #94) — null si non demande / garde du moteur ---
    /** Charge de frottement negatif G_sn (kN) = max(0, Nmax − Q) — resultat livrable. */
    Gsn: z.number().finite().nullable(),
    /** Effort axial maximal au point neutre N_max (kN) = Q + G_sn — sollicitation a verifier. */
    Nmax: z.number().finite().nullable(),
    /** Cote du point neutre z_N (m) — position (deplacement relatif sol-pieu nul). */
    pointNeutre: z.number().finite().nullable(),
    // --- VERIFICATION STRUCTURALE DU BETON (§4.4, #95) — null si non demandee ---
    // On expose UNIQUEMENT le RESULTAT de la verification. Les facteurs de calage de
    // la methode (Cmax, k1, k2, fckStar, acc, k3, gc) NE sortent JAMAIS (SERVEUR, DoD §8).
    /** Verification structurale applicable : false si traction / categorie non couverte (na),
     *  true si calculee, null si non demandee. */
    betonApplicable: z.boolean().nullable(),
    /** Verification ELU du beton satisfaite (σ_ELU ≤ f_cd). null si na / non demandee. */
    betonOkELU: z.boolean().nullable(),
    /** Verification ELS du beton satisfaite (σ_ELS ≤ limite ELS). null si na / non demandee. */
    betonOkELS: z.boolean().nullable(),
    /** Taux de travail ELU du beton σ_ELU/f_cd (sans dimension). null si na / non demandee. */
    betonTauxELU: z.number().finite().nullable(),
    /** Taux de travail ELS du beton (sans dimension). null si na / non demandee. */
    betonTauxELS: z.number().finite().nullable(),
    /** Resistance de calcul du beton f_cd (MPa, EC2) — resultat de dimensionnement. null si na / non demandee. */
    betonFcd: z.number().finite().nullable(),
  })
  .strict();
export type PieuxOutput = z.infer<typeof PieuxOutputSchema>;

// ---------------------------------------------------------------------------
// Le contrat (verifie anti-passthrough a la construction)
// ---------------------------------------------------------------------------

/** Identifiant logique = cle de registre (cf. packages/engines/registry). */
export const PIEUX_ENGINE_ID = 'fondation-profonde-pieux';

export const pieuxContract = defineEngineContract({
  id: PIEUX_ENGINE_ID,
  inputSchema: PieuxInputSchema,
  outputSchema: PieuxOutputSchema,
});
