/**
 * CONTRAT I/O du moteur burmister — Chaussees, methode rationnelle / AGEROUTE
 * Senegal 2015 (#46, #56).
 *
 * Defini avec `defineEngineContract` de @roadsen/shared : entree bornee (sert
 * aussi de forme persistee) + sortie client-safe en WHITELIST STRICTE. Les deux
 * schemas sont verifies anti-passthrough a la construction (cf. engine-io.ts).
 *
 * --- ENTREE ---
 * L'etat complet d'une structure de chaussee : couches (materiau/E/ν/h),
 * plateforme support (PSC), trafic, charge (jumelage), et — explicitement — le
 * REFERENTIEL MATERIAUX AGEROUTE injecte en parametre (le HTML le code en dur
 * dans `const M` ; cote module on l'accepte en entree, defaut = AGEROUTE_MATERIALS).
 * Contrairement a terzaghi, le moteur burmister attend des NOMBRES (le HTML lit
 * des champs de saisie deja convertis en `+value`) : on declare des nombres finis
 * bornes, pas d'unions chaine.
 *
 * --- POURQUOI une sortie tres reduite (anti-fuite, DoD §8) ---
 * Le calcul produit, en interne (objet `_D`), une foule d'intermediaires
 * CONFIDENTIELS : tenseur de contraintes brut a chaque interface (sz/sr/sth/
 * srT/sthT via le propagateur 4×4), contraintes σ aux interfaces critiques
 * (s0/sd2/bz), et les COEFFICIENTS de CALAGE des lois de fatigue (kr, ks, kc,
 * Sh, b, ε₆/σ₆, kθ...). Exposer cet objet reviendrait a publier la methode par
 * ses intermediaires. On ne whiteliste donc QUE des grandeurs de RESULTAT
 * destinees a l'affichage / au PV :
 *   - le verdict global et par critere (PASS / fatigue / orniarage) ;
 *   - les grandeurs de dimensionnement FINALES : deformation/contrainte
 *     sollicitante vs ADMISSIBLE (ε_t/ε_t,adm ; ε_z/ε_z,adm), qui SONT le
 *     resultat d'ingenierie (analogues a Rtot/taux de terzaghi) ;
 *   - la classe de trafic (NE), la famille de structure, les epaisseurs.
 *
 * Tout le reste (contraintes brutes, coefficients de fatigue, ABCD du
 * propagateur) reste SERVEUR. `projectEngineOutput` re-parse la sortie a travers
 * ce schema et STRIPPE tout champ non whiteliste, a tout niveau (cf. index.ts).
 *
 * AUCUN symbole de calcul ici : pur Zod/TS, mais ce fichier appartient a
 * @roadsen/engines (importe par l'API seule, jamais le front).
 */
import { defineEngineContract } from '@roadsen/shared';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Entree : etat complet de la structure (nombres finis bornes)
// ---------------------------------------------------------------------------

/** Module d'Young borne (MPa) — du quasi-incompressible au beton. */
const Modulus = z.number().finite().min(1).max(60000);
/** Coefficient de Poisson borne. */
const Poisson = z.number().finite().min(0.1).max(0.5);
/** Epaisseur de couche bornee (m). */
const Thickness = z.number().finite().min(0.001).max(2);

/**
 * Une couche de la structure. `mat` est la CLE dans le referentiel materiaux ;
 * E/ν peuvent surcharger les valeurs du referentiel (le HTML autorise l'edition
 * de E/ν par couche apres choix du materiau).
 */
const LayerSchema = z
  .object({
    /** Cle materiau (ex. "BBSG1", "GB3", "GL1"...) — bornee. */
    mat: z.string().min(1).max(32),
    E: Modulus,
    nu: Poisson,
    h: Thickness,
  })
  .strict();

/** Plateforme support de chaussee (PSC) : classe + module + Poisson. */
const SubgradeSchema = z
  .object({
    /** Libelle de classe (PF1..PF4, custom...) — affichage, hors calcul. */
    cls: z.string().max(16).optional(),
    E: Modulus,
    nu: Poisson,
  })
  .strict();

/** Donnees de trafic (cumul poids lourds). */
const TrafficSchema = z
  .object({
    /** TMJA poids lourds par sens (PL/j/sens). */
    T: z.number().finite().min(0).max(1e6),
    /** Coefficient d'agressivite moyen (CAM). */
    C: z.number().finite().min(0).max(100),
    /** Duree de service (ans). */
    N: z.number().finite().min(1).max(100),
    /** Taux de croissance annuel (%). */
    tau: z.number().finite().min(-50).max(50),
    /** Coefficient directionnel f_dir. */
    dir: z.number().finite().min(0).max(2),
    /** Coefficient de repartition transversale f_tv. */
    tv: z.number().finite().min(0).max(2),
  })
  .strict();

/**
 * Charge de reference (jumelage). `r`/`sh`/`ks` valent 'auto' (calcul AGEROUTE)
 * ou un nombre (override manuel) — exactement comme le HTML (`cp.r='auto'`...).
 */
const AutoOrNum = z.union([z.literal('auto'), z.number().finite()]);
const LoadSchema = z
  .object({
    /** Pression de contact (MPa). */
    p: z.number().finite().min(0.01).max(5),
    /** Rayon de la surface chargee (m). */
    a: z.number().finite().min(0.01).max(1),
    /** Entraxe du jumelage (m). */
    d: z.number().finite().min(0).max(2),
    /** Risque effectif : 'auto' (Tab. 70) ou % impose. */
    r: AutoOrNum.optional(),
    /** Sh (cm) : 'auto' (Tab. VI.2.4) ou impose. */
    sh: AutoOrNum.optional(),
    /** ks : 'auto' (couche sous-jacente) ou impose. */
    ks: AutoOrNum.optional(),
  })
  .strict();

/**
 * Une entree du referentiel materiaux : les proprietes lues par le moteur. En
 * `.strict()` (le garde-fou anti-passthrough du contrat impose des conteneurs
 * FERMES — pas de record/catchall/passthrough : une cle inconnue serait une
 * porte de fuite). Les champs d'affichage du HTML (n, c, s) sont declares pour
 * que le referentiel d'usine passe tel quel.
 */
const MaterialSchema = z
  .object({
    n: z.string().max(120).optional(),
    E: Modulus,
    E10: z.number().finite().min(1).max(60000).optional(),
    nu: Poisson,
    bit: z.number().optional(),
    rig: z.number().optional(),
    e6: z.number().finite().min(0).max(1000).optional(),
    s6: z.number().finite().min(0).max(20).optional(),
    b: z.number().finite().min(1).max(50).optional(),
    kc: z.number().finite().min(0).max(5).optional(),
    sn: z.number().finite().min(0).max(5).optional(),
    Sh: z.number().finite().min(0).max(10).optional(),
    kd: z.number().finite().min(0).max(5).optional(),
    c: z.string().max(16).optional(),
    s: z.string().max(16).optional(),
  })
  .strict();

/**
 * Referentiel materiaux AGEROUTE injecte (#46, critere 1 : pas de codage en dur
 * cote calcul). Modelise en OBJET A CLES FERMEES (les 20 codes AGEROUTE 2015),
 * chaque entree optionnelle : l'appelant fournit tout ou partie du referentiel.
 * OPTIONNEL globalement : en son absence le module utilise AGEROUTE_MATERIALS
 * (defaut/fixture, identique a la table d'usine du HTML).
 *
 * Pourquoi un objet a cles fixes et NON un z.record : le garde-fou
 * anti-passthrough (engine-io.ts) REJETTE les conteneurs ouverts (ZodRecord) —
 * une cle inconnue est une fuite potentielle. On enumere donc le jeu de codes
 * AGEROUTE (espace de cles ferme, whitelist-safe). Un nouveau materiau du client
 * = avenant au referentiel + ajout de sa cle ici (tracable), pas une porte ouverte.
 */
const MaterialsSchema = z
  .object({
    BBSG1: MaterialSchema.optional(),
    BBSG2: MaterialSchema.optional(),
    BBTM: MaterialSchema.optional(),
    BBM: MaterialSchema.optional(),
    GB2: MaterialSchema.optional(),
    GB3: MaterialSchema.optional(),
    EME2: MaterialSchema.optional(),
    GL1: MaterialSchema.optional(),
    GL2: MaterialSchema.optional(),
    GLli: MaterialSchema.optional(),
    GLa: MaterialSchema.optional(),
    GLc1: MaterialSchema.optional(),
    GLc2: MaterialSchema.optional(),
    GNT1: MaterialSchema.optional(),
    GNT2: MaterialSchema.optional(),
    GC3: MaterialSchema.optional(),
    SC2: MaterialSchema.optional(),
    BQc: MaterialSchema.optional(),
    BC5: MaterialSchema.optional(),
    BC2: MaterialSchema.optional(),
  })
  .strict();

/**
 * Entree complete du moteur burmister. Bornee. Le referentiel materiaux est
 * optionnel (defaut interne) mais explicitement modelise.
 */
export const BurmisterInputSchema = z
  .object({
    /** Libelle de projet (metadonnee d'affichage, hors calcul). */
    projet: z.string().max(200).optional(),
    layers: z.array(LayerSchema).min(1).max(20),
    subgrade: SubgradeSchema,
    traffic: TrafficSchema,
    load: LoadSchema,
    /** Referentiel materiaux (injecte) ; defaut = AGEROUTE_MATERIALS. */
    materials: MaterialsSchema.optional(),
  })
  .strict();
export type BurmisterInput = z.infer<typeof BurmisterInputSchema>;

// ---------------------------------------------------------------------------
// Sortie : WHITELIST stricte des resultats affichables (aucun intermediaire)
// ---------------------------------------------------------------------------

/**
 * Critere de fatigue (couche liee) : deformation/contrainte sollicitante vs
 * admissible + verdict. `rigide` distingue le critere bitumineux (ε_t, μdef) du
 * critere MTLH/beton (σ_t, MPa). On expose les valeurs FINALES, jamais les
 * coefficients de calage (kr/ks/kc/Sh/b/ε₆).
 */
const FatigueSchema = z
  .object({
    /** true = critere MTLH/beton (σ_t, MPa) ; false = bitumineux (ε_t, μdef). */
    rigide: z.boolean(),
    /** Valeur sollicitante (ε_t en μdef ou σ_t en MPa). */
    valeur: z.number().finite().nullable(),
    /** Valeur admissible (meme unite). */
    admissible: z.number().finite().nullable(),
    /** Critere de fatigue verifie ? */
    ok: z.boolean(),
    /** Critere requis par la famille de structure ? (informatif sinon). */
    requis: z.boolean(),
  })
  .strict();

/**
 * Critere d'orniarage / deformation permanente du sol support (ε_z au sommet PSC).
 */
const OrnierageSchema = z
  .object({
    /** ε_z sollicitant (μdef). */
    valeur: z.number().finite(),
    /** ε_z admissible (μdef, catalogue AGEROUTE p.124). */
    admissible: z.number().finite(),
    /** Critere verifie ? */
    ok: z.boolean(),
  })
  .strict();

/**
 * Sortie client-safe du moteur burmister. Le verdict de dimensionnement + les
 * grandeurs FINALES de chaque critere. Aucune contrainte brute, aucun coefficient
 * de fatigue, aucun intermediaire de propagateur.
 */
export const BurmisterOutputSchema = z
  .object({
    /** Erreur de calcul (science levee) : message borne, sans intermediaire. */
    erreur: z.string().max(500).nullable(),
    /** Avertissements (redactes des valeurs confidentielles). */
    warnings: z.array(z.string().max(500)).max(50),
    /** Verdict global : tous les criteres requis sont verifies. */
    conforme: z.boolean(),
    /** Trafic cumule NE (essieux equivalents). */
    NE: z.number().finite(),
    /** Famille de structure (LCPC §4.2-4.5) — libelle. */
    famille: z.string().max(80),
    /** Epaisseur du paquet lie (m). */
    epaisseurLiee: z.number().finite(),
    /** Epaisseur totale des couches (m). */
    epaisseurTotale: z.number().finite(),
    /** Critere de fatigue (couche liee), si applicable. */
    fatigue: FatigueSchema.optional(),
    /** Critere d'orniarage (sol support). */
    ornierage: OrnierageSchema,
  })
  .strict();
export type BurmisterOutput = z.infer<typeof BurmisterOutputSchema>;

// ---------------------------------------------------------------------------
// Le contrat (verifie anti-passthrough a la construction)
// ---------------------------------------------------------------------------

/** Identifiant logique = cle de registre (cf. packages/engines/registry). */
export const BURMISTER_ENGINE_ID = 'chaussee-burmister';

export const burmisterContract = defineEngineContract({
  id: BURMISTER_ENGINE_ID,
  inputSchema: BurmisterInputSchema,
  outputSchema: BurmisterOutputSchema,
});
