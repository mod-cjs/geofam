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
 *   - `coeffs`   : coefficients partiels AUTORITATIFS SERVEUR (NA francaise DA2 + fluage) —
 *     valeurs reglementaires imposees ; toute valeur non normative est REJETEE (400) ;
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
 * Coefficients partiels AUTORITATIFS SERVEUR (NA francaise DA2 + fluage 14.2.2). Valeurs
 * reglementaires figees (identiques au HTML). Ils pilotent un VERDICT scelle au PV : le
 * schema REJETTE (400) toute valeur non strictement egale a PIEUX_DEFAULT_COEFFS (refine
 * ci-dessous) -> aucun coeff favorable falsifie ne peut entrer. NON editables par le client.
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

/** Coefficients NORMATIFS imposes (identiques aux `value=` du HTML d'origine). Type via
 * `CoeffsSchema` (et non `PieuxInput['coeffs']`) pour eviter une reference de type
 * circulaire. L'InputSchema REJETTE (via .refine) tout `coeffs` != cette constante — il
 * ne les normalise PAS silencieusement (pas de .transform : interdit par le contrat). */
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
        (
          Object.keys(PIEUX_DEFAULT_COEFFS) as Array<keyof typeof PIEUX_DEFAULT_COEFFS>
        ).every((k) => c[k] === PIEUX_DEFAULT_COEFFS[k]),
      {
        message:
          'coefficients partiels non normatifs : autoritatifs serveur (valeurs reglementaires imposees)',
      },
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

// ---------------------------------------------------------------------------
// AFFICHAGE DETAILLE (display-only) — RECLASSIFICATION §8 (directive titulaire
// « tolerance 0 : tout ce que l'outil client affiche doit s'afficher », avis
// expert A / rapport casagrande).
// ---------------------------------------------------------------------------
//
// --- POURQUOI ces champs sortent DESORMAIS (rupture avec l'ancien regime) ---
// L'ancien contrat gardait SERVEUR les intermediaires de la methode NF P 94-262
// (Rb/Rs bruts, p*le/qce equivalents, facteurs de portance kp/kc appliques et max,
// hauteur d'encastrement equivalente Def, facteurs de correlation xi3/xi4, coef de
// modele gammaR;d1, effet de groupe Ce, detail de frottement par couche, courbes de
// portance/tassement/frottement negatif). La directive titulaire (memoire
// « details-transparents-rescope-s8 ») tranche : le CONFIDENTIEL est le CODE moteur
// (les formules/abaques/l'ordre de calcul), PAS les VALEURS que l'outil client
// affiche deja a l'ecran. On expose donc ces VALEURS, en display-only :
//   - elles n'ont AUCUNE autorite : le verdict scelle au PV reste pilote par les
//     grandeurs de dimensionnement (RbK/RsK/RcK/RcD/fluages) et les coefficients
//     partiels AUTORITATIFS serveur (coeffs.refine == PIEUX_DEFAULT_COEFFS) ;
//   - ce sont des SORTIES : elles ne re-rentrent jamais dans le calcul (aucun champ
//     d'entree ajoute ; l'InputSchema reste .strict()).
//
// --- CE QUI RESTE SERVEUR (le CODE, pas les valeurs) ---
// Les abaques/tables (KP_MAX/KC_MAX/ALPHA_*/PMT_CURVE/QSMAX), l'ordre des sommations,
// les objets de solveur bruts (qceDetail : clipped/mean0/cap/raw ; settle : rigidites
// t-z ktau/kq/EM ; downdrag : KtanD/Hc/s0/wTip et le profil HAUTE RESOLUTION), le
// terme de pointe nu `qb`, la chaine `qbDetail`, les facteurs partiels par combinaison
// (Rbf/Rsf/comb). Ces champs ne figurent PAS dans la whitelist et sont re-strippes.

/** Une ligne de la courbe de portance en profondeur (capacites par etat-limite a la
 *  profondeur D). Formes/cles dictees par le clone (`courbePortance.rows`). kN. */
const PortanceRowSchema = z
  .object({
    /** Profondeur de base D (m). */
    D: z.number().finite(),
    /** Capacite ELU fondamentales (kN). */
    elufond: z.number().finite(),
    /** Capacite ELU accidentelles (kN). */
    eluacc: z.number().finite(),
    /** Capacite ELS caracteristiques (kN). */
    elscar: z.number().finite(),
    /** Capacite ELS quasi-permanentes (kN). */
    elsqp: z.number().finite(),
  })
  .strict();

/** Courbe de portance en profondeur — SERIE DE POINTS RE-ECHANTILLONNEE cote serveur
 *  (grille D fixe DECOUPLEE de la resolution interne du balayage, patron radier/geoplaque). */
const CourbePortanceSchema = z
  .object({
    rows: z.array(PortanceRowSchema).max(200),
  })
  .strict();

/** Un point de la courbe charge-tassement (effort F en kN, tassement s en mm). */
const TassementPointSchema = z
  .object({
    F: z.number().finite(),
    s: z.number().finite(),
  })
  .strict();

/** Courbe charge-tassement — SERIE DE POINTS RE-ECHANTILLONNEE cote serveur (nombre de
 *  points fixe, DECOUPLE de la discretisation t-z interne). */
const CourbeTassementSchema = z
  .object({
    pts: z.array(TassementPointSchema).max(200),
    /** Effort maximal de la courbe (kN) — borne d'affichage. */
    Fmax: z.number().finite(),
  })
  .strict();

/** Un point d'un profil de frottement negatif en profondeur. Cles dictees par le clone
 *  (`profilsDowndrag.prof`). z/w/g en m, f/qsP/qsN en kPa, N en kN. */
const DowndragProfilePointSchema = z
  .object({
    /** Cote z (m). */
    z: z.number().finite(),
    /** Tassement du pieu w (m). */
    w: z.number().finite(),
    /** Tassement libre du sol g (m). */
    g: z.number().finite(),
    /** Frottement axial mobilise f (kPa, signe). */
    f: z.number().finite(),
    /** Frottement positif limite qsP (kPa). */
    qsP: z.number().finite(),
    /** Frottement negatif qsN (kPa, signe). */
    qsN: z.number().finite(),
    /** Effort axial N (kN). */
    N: z.number().finite(),
  })
  .strict();

/** Profils de frottement negatif en profondeur — SERIE DE POINTS RE-ECHANTILLONNEE cote
 *  serveur (grille z fixe DECOUPLEE de la segmentation de marche interne). */
const ProfilsDowndragSchema = z
  .object({
    /** Tassement en tete du pieu (mm) — repere d'affichage. */
    wHead: z.number().finite(),
    prof: z.array(DowndragProfilePointSchema).max(200),
  })
  .strict();

/** Une ligne du tableau de frottement lateral par couche (affiche par l'outil). */
const FricRowSchema = z
  .object({
    /** Nature de sol de la couche. */
    soil: SoilEnum,
    /** Cote haute de la couche dans l'emprise du pieu (m). */
    top: z.number().finite(),
    /** Cote basse de la couche dans l'emprise du pieu (m). */
    bot: z.number().finite(),
    /** Epaisseur mobilisee dz (m). */
    dz: z.number().finite(),
    /** Frottement unitaire qs applique (kPa). */
    qs: z.number().finite(),
    /** Contribution au frottement total dRs (kN). */
    dRs: z.number().finite(),
    /** Frottement unitaire plafond qsmax (kPa) ; null si non couvert par la norme. */
    qsm: z.number().finite().nullable(),
    /** Longueur d'ancrage reduite (couche degradee proche de la pointe). */
    deg: z.boolean(),
  })
  .strict();

/**
 * Sortie client-safe du moteur pieux. Les grandeurs FINALES de dimensionnement +
 * le verdict de verification, PLUS les valeurs d'AFFICHAGE detaillees (display-only,
 * cf. bloc ci-dessus) reproduisant le panneau Resultats et les figures de l'outil.
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
    // --- AFFICHAGE DETAILLE (display-only, RECLASSIFICATION §8) ---
    // Valeurs affichees par le panneau Resultats de l'outil client. AUCUNE autorite
    // (le verdict/PV ne les consomme pas ; ce sont des sorties, pas des entrees).
    // null = non calculable pour ce jeu (ex. ple null hors methode pressiometrique).
    /** Resistance de pointe BRUTE Rb (kN). */
    Rb: z.number().finite().nullable(),
    /** Resistance de frottement BRUTE Rs (kN). */
    Rs: z.number().finite().nullable(),
    /** Pression limite nette equivalente p*le (MPa). null hors methode pressiometrique. */
    ple: z.number().finite().nullable(),
    /** Resistance de pointe equivalente q_ce (MPa). null hors methode penetrometrique. */
    qce: z.number().finite().nullable(),
    // RESERVE EXPERT (avis A) : les tables kp/kc (Tableaux F.4.2.1/G.4.2.1) sont
    // PRESUMEES reproduire la norme verbatim, A CONFIRMER par STARFIRE. On expose ici
    // la VALEUR APPLIQUEE (kfac) et son PLAFOND (kmax) — mode A. Bascule en mode B
    // (masquer kmax, ne garder que kfac) = one-liner : passer `kmax` a `null` dans la
    // projection (index.ts, shapeOutput) — aucun autre changement.
    /** Facteur de portance APPLIQUE kp (pmt) / kc (cpt) / Nq (c-φ) — sans dimension. */
    kfac: z.number().finite().nullable(),
    /** Plafond du facteur de portance kp,max / kc,max. null en c-φ (pas de plafond tabule). */
    kmax: z.number().finite().nullable(),
    /** Hauteur d'encastrement equivalente D_ef (m). */
    Def: z.number().finite().nullable(),
    /** Rapport d'encastrement D_ef/B (sans dimension). */
    debR: z.number().finite().nullable(),
    /** Facteur de correlation ξ₃ (nombre de profils / surface investiguee). */
    xi3: z.number().finite().nullable(),
    /** Facteur de correlation ξ₄. */
    xi4: z.number().finite().nullable(),
    /** Coefficient de modele γ_R;d1 (annexe D). */
    gammaRd1: z.number().finite().nullable(),
    /** Coefficient d'effet de groupe C_e applique sur Rs (§4.3.2). */
    Ce: z.number().finite().nullable(),
    /** Tableau de frottement lateral par couche (comme l'onglet Resultats). null si vide. */
    fric: z.array(FricRowSchema).max(100).nullable(),
    /** Courbe de portance en profondeur (serie re-echantillonnee). null si non traçable. */
    courbePortance: CourbePortanceSchema.nullable(),
    /** Courbe charge-tassement (serie re-echantillonnee). null si non calculable. */
    courbeTassement: CourbeTassementSchema.nullable(),
    /** Profils de frottement negatif en profondeur (serie re-echantillonnee). null si non demande. */
    profilsDowndrag: ProfilsDowndragSchema.nullable(),
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
