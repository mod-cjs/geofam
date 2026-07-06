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
 * plateforme support (PSC), trafic, charge (jumelage). Contrairement a terzaghi,
 * le moteur burmister attend des NOMBRES (le HTML lit des champs de saisie deja
 * convertis en `+value`) : on declare des nombres finis bornes, pas d'unions chaine.
 *
 * --- CALIBRATION VERROUILLEE (integrite PV — faille fermee) ---
 * Le REFERENTIEL MATERIAUX AGEROUTE (coefficients de calage des lois de fatigue :
 * e6/σ6, b, kc, sn, Sh, kd, E10, et les drapeaux bit/rig) N'EST PAS accepte en
 * entree. Il est FIGE cote moteur a la table de REFERENCE `AGEROUTE_MATERIALS`
 * (θ=34 °C). Motif : l'entree valide sert aussi de forme PERSISTEE et SCELLEE dans
 * le PV ; une requete forgee portant `materials:{...}` aurait pu substituer une
 * calibration de fatigue puis la faire sceller SOUS l'identite methode STARFIRE.
 * Le schema etant `.strict()`, toute entree portant une cle `materials` est
 * desormais REJETEE (400, fail-closed). Les couches portent deja E/ν/h (saisis) ;
 * aucune propriete de calage n'a donc a transiter par l'entree client.
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
// Famille de structure : ALLOWLIST fail-closed (FUITE #1 / issue #81, DoD §8)
// ---------------------------------------------------------------------------

/**
 * Libelles de FAMILLE de structure client-safe (categories LCPC-SETRA §4.2-4.5,
 * PUBLIQUES). Le moteur emet une chaine ENRICHIE d'un DISCRIMINANT CALCULE — ex.
 * « mixte (§4.4, K=0.62) », « semi-rigide (§4.3, K=0.34<0,5) » — ou le ratio de
 * rigidite Kmix (= h_lie_bit / h_lie_total) est un INTERMEDIAIRE de methode
 * CONFIDENTIEL. Le `§4.x` est public ; le K chiffre ne l'est pas.
 *
 * On NE laisse traverser au client (affichage + PV scelle) QUE le libelle de
 * famille NU, SANS le suffixe `(§x.y, K=...)`. Tout ce qui n'est pas reconnu
 * retombe sur un GENERIQUE. La sortie ne contient jamais « § », « K= » ni decimale.
 *
 * ORDRE : prefixes les PLUS LONGS d'abord (« souple à faible trafic » AVANT
 * « souple ») — le premier prefixe correspondant gagne (sinon collision de prefixe).
 */
export const FAMILLES_STRUCTURE = [
  'bitumineuse épaisse',
  'souple à faible trafic',
  'souple',
  'semi-rigide',
  'mixte',
  'inverse',
  'granulaire',
] as const;

/** Libelle retenu pour toute chaine brute NON reconnue (fail-closed). */
export const FAMILLE_GENERIQUE = 'structure non catégorisée';

/**
 * Ensemble FERME des libelles autorises en SORTIE : les 7 familles NUES + le
 * generique + la chaine VIDE (cas d'erreur de calcul, aucune famille). Sert de
 * garde-fou `refine` sur le schema de sortie (defense en profondeur).
 */
export const FAMILLES_AUTORISEES: ReadonlySet<string> = new Set<string>([
  ...FAMILLES_STRUCTURE,
  FAMILLE_GENERIQUE,
  '',
]);

/**
 * Nettoie la chaine BRUTE de famille du moteur en un libelle d'ALLOWLIST NU (sans
 * discriminant calcule). FAIL-CLOSED : entree non-chaine, vide ou non reconnue →
 * generique. Ne renvoie JAMAIS la chaine brute (jamais « § », « K= » ni decimale).
 */
export function sanitizeFamille(raw: unknown): string {
  if (typeof raw !== 'string') return FAMILLE_GENERIQUE;
  const s = raw.trim().toLowerCase();
  if (s === '') return FAMILLE_GENERIQUE;
  for (const fam of FAMILLES_STRUCTURE) {
    if (s.startsWith(fam.toLowerCase())) return fam;
  }
  return FAMILLE_GENERIQUE;
}

// ---------------------------------------------------------------------------
// Mode d'interface entre couches traitees (Tab. 68 AGEROUTE) : ALLOWLIST
// ---------------------------------------------------------------------------

/**
 * Modes d'interface PUBLICS (Tableau 68 AGEROUTE 2015) : « collée »,
 * « semi-collée » (demi-somme collé/glissant), « glissante ». Ce sont des
 * hypotheses NORMATIVES publiques (pas un intermediaire de calage). On les
 * WHITELISTE tout de meme (fail-closed) : le moteur emet une chaine libre
 * (`modeI`) ; toute valeur non reconnue retombe sur un GENERIQUE, jamais la
 * chaine brute.
 */
export const MODES_INTERFACE = ['collée', 'semi-collée', 'glissante'] as const;

/** Libelle retenu pour tout mode brut NON reconnu (fail-closed). */
export const MODE_INTERFACE_GENERIQUE = 'non spécifié';

/** Ensemble FERME des modes autorises en SORTIE (allowlist + generique). */
export const MODES_INTERFACE_AUTORISES: ReadonlySet<string> = new Set<string>([
  ...MODES_INTERFACE,
  MODE_INTERFACE_GENERIQUE,
]);

/**
 * Nettoie le mode d'interface BRUT du moteur en un libelle d'ALLOWLIST.
 * FAIL-CLOSED : entree non-chaine ou non reconnue → generique.
 */
export function sanitizeModeInterface(raw: unknown): string {
  if (typeof raw !== 'string') return MODE_INTERFACE_GENERIQUE;
  const s = raw.trim().toLowerCase();
  for (const m of MODES_INTERFACE) {
    if (s === m.toLowerCase()) return m;
  }
  return MODE_INTERFACE_GENERIQUE;
}

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
// SECURITE (audit adverse) : r/sh/ks sont imposables par le client ('auto' ou valeur)
// et pilotent la deformation ADMISSIBLE de fatigue -> le VERDICT `conforme`. La branche
// numerique DOIT etre BORNEE a une plage physique LCPC saine : sans borne, `ks=1000`
// gonflait l'admissible x1000 -> faux PASS scelle au PV.
// - `ks` = coefficient de DISCONTINUITE : facteur de REDUCTION, physiquement <= 1
//   (ksLCPC(E) ne renvoie jamais > 1). Plafonne a 1,0 (le challenge a montre que ks=2
//   laissait encore x2 l'admissible = faux PASS marginal).
// - `sh` (cm) : ecart-type de construction. sh=0 annule le terme de dispersion (sens NON
//   SUR) -> plancher 0,5 cm (borne physique prudente).
// - `r` (risque %) : borne 0,001-50 (au-dela = non physique). r=50 -> reduction de
//   risque nulle (borne haute assumee).
// Plages exactes (sh plancher, r haut) a CONFIRMER par l'expert (STARFIRE) + disclosure PV.
const AutoOrRisk = z.union([z.literal('auto'), z.number().finite().min(0.001).max(50)]);
const AutoOrSh = z.union([z.literal('auto'), z.number().finite().min(0.5).max(20)]);
const AutoOrKs = z.union([z.literal('auto'), z.number().finite().min(0.1).max(1)]);
const LoadSchema = z
  .object({
    /** Pression de contact (MPa). */
    p: z.number().finite().min(0.01).max(5),
    /** Rayon de la surface chargee (m). */
    a: z.number().finite().min(0.01).max(1),
    /** Entraxe du jumelage (m). */
    d: z.number().finite().min(0).max(2),
    /** Risque effectif : 'auto' (Tab. 70) ou % impose (borne 0,001-50 %). */
    r: AutoOrRisk.optional(),
    /** Sh (cm) : 'auto' (Tab. VI.2.4) ou impose (borne 0,5-20 cm). */
    sh: AutoOrSh.optional(),
    /** ks : 'auto' (couche sous-jacente) ou impose (borne 0,1-1 ; facteur de reduction <=1). */
    ks: AutoOrKs.optional(),
  })
  .strict();

/**
 * Entree complete du moteur burmister. Bornee.
 *
 * PAS de champ `materials` : le referentiel/la calibration de fatigue est FIGE
 * cote moteur a `AGEROUTE_MATERIALS` (reference θ=34 °C), jamais fourni par le
 * client (cf. en-tete « CALIBRATION VERROUILLEE »). Le schema etant `.strict()`,
 * une entree portant `materials` (ou tout autre coefficient de calage e6/kc/b/…)
 * est REJETEE (400) — aucune science substituee ne peut atteindre le calcul ni
 * etre scellee dans le PV. Les couches portent E/ν/h (les seules grandeurs
 * elastiques saisies) ; les coefficients de calage ne transitent jamais par l'entree.
 */
export const BurmisterInputSchema = z
  .object({
    /** Libelle de projet (metadonnee d'affichage, hors calcul). */
    projet: z.string().max(200).optional(),
    layers: z.array(LayerSchema).min(1).max(20),
    subgrade: SubgradeSchema,
    traffic: TrafficSchema,
    load: LoadSchema,
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
 * Critere de fatigue SECONDAIRE rattache a UNE couche : valeur sollicitante vs
 * admissible + verdict + n° de couche (1-based). Sert aux structures MIXTES
 * (phase 2, §4.4.1 — ε_t µdef) et INVERSES (§4.5 — σ_t MPa). `null` quand la
 * structure n'est PAS concernee (souple / bitumineuse / granulaire). §8 : ne
 * porte QUE des grandeurs sollicitantes/admissibles + un n° de couche (jamais de
 * coordonnee nodale/maillage ni de coefficient de calage).
 */
const CritereCoucheSchema = z
  .object({
    /** Valeur sollicitante (ε_t en µdef pour la phase 2 mixte ; σ_t en MPa pour l'inverse). */
    valeur: z.number().finite(),
    /** Valeur admissible (meme unite). */
    admissible: z.number().finite(),
    /** Critere verifie ? (valeur <= admissible). */
    ok: z.boolean(),
    /** N° de couche concernee (1-based, ordre de la structure haut->bas). */
    couche: z.number().int().min(1),
  })
  .strict();

/**
 * σ_t a la base d'UNE couche traitee (MTLH/beton), avec le MODE d'interface
 * (Tab. 68 AGEROUTE : collée / semi-collée / glissante). §8 : on n'expose que le
 * σ_t sollicitant FINAL + l'admissible + le verdict + le mode + le n° de couche —
 * jamais les composantes collée/glissante intermediaires (stC/stG restent serveur).
 */
const CoucheTraiteeSchema = z
  .object({
    /** N° de couche (1-based). */
    couche: z.number().int().min(1),
    /** Mode d'interface (allowlist Tab. 68 ; fail-closed). */
    mode: z.string().max(40).refine((v) => MODES_INTERFACE_AUTORISES.has(v), {
      message: 'mode d’interface hors allowlist (fail-closed)',
    }),
    /** σ_t sollicitant a la base de la couche (MPa). */
    valeur: z.number().finite(),
    /** σ_t admissible (MPa). */
    admissible: z.number().finite(),
    /** Critere verifie ? (valeur <= admissible). */
    ok: z.boolean(),
  })
  .strict();

/**
 * ε_z au sommet d'UNE couche granulaire non liee (§4.1.2) : detail par couche du
 * critere d'orniérage. §8 : ε_z sollicitant + admissible (= ε_z,adm global) +
 * verdict + n° de couche ; aucune coordonnee de maillage.
 */
const CoucheGranulaireSchema = z
  .object({
    /** N° de couche (1-based). */
    couche: z.number().int().min(1),
    /** ε_z sollicitant au sommet de la couche granulaire (µdef). */
    valeur: z.number().finite(),
    /** ε_z admissible (µdef, catalogue AGEROUTE — meme seuil qu'orniérage). */
    admissible: z.number().finite(),
    /** ε_z <= ε_z,adm ? */
    ok: z.boolean(),
  })
  .strict();

/**
 * Sortie client-safe du moteur burmister. Le verdict de dimensionnement + les
 * grandeurs FINALES de chaque critere. Aucune contrainte brute, aucun coefficient
 * de fatigue, aucun intermediaire de propagateur.
 */
/**
 * DETAILS DE CALCUL — intermediaires de la METHODE PUBLIEE (rescope §8
 * « methode transparente », decision titulaire). On expose les grandeurs
 * calculees de la methode Burmister/LCPC (contraintes sigma, deformations
 * epsilon intermediaires, modules ponderes) ; on n'expose JAMAIS les
 * coefficients de CALAGE proprietaires (e6, b, kc, kr, ks, Sh, ktheta, delta),
 * qui restent serveur. Objet FACULTATIF (absent en cas d'erreur de calcul).
 */
const DetailsSchema = z
  .object({
    E1_pond: z.number().finite(),
    nu1_pond: z.number().finite(),
    E_psc: z.number().finite(),
    nu_psc: z.number().finite(),
    risque_pct: z.number().finite(),
    sigmaZ_r0: z.number().finite().nullable(),
    sigmaR_r0: z.number().finite().nullable(),
    sigmaZ_d2: z.number().finite().nullable(),
    sigmaR_d2: z.number().finite().nullable(),
    epsilonT_r0: z.number().finite().nullable(),
    epsilonT_d2: z.number().finite().nullable(),
    epsilonT: z.number().finite().nullable(),
    epsilonT_adm: z.number().finite().nullable(),
    epsilonZ_axe: z.number().finite().nullable(),
    epsilonZ_mid: z.number().finite().nullable(),
    epsilonZ: z.number().finite(),
    epsilonZ_adm: z.number().finite(),
  })
  .strict();

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
    /**
     * Famille de structure (LCPC §4.2-4.5) — libelle NU d'allowlist (jamais le
     * discriminant Kmix calcule). Nettoye a la projection (sanitizeFamille) ; le
     * `refine` REJETTE tout libelle hors allowlist — fail-closed, defense en
     * profondeur : une chaine porteuse de « § »/« K= » ne peut pas etre projetee
     * silencieusement (elle fait echouer le parse). Cf. FUITE #1 / issue #81.
     */
    famille: z
      .string()
      .max(80)
      .refine((v) => FAMILLES_AUTORISEES.has(v), {
        message:
          'famille hors allowlist (fail-closed) : suffixe §/discriminant K interdit en sortie',
      }),
    /** Epaisseur du paquet lie (m). */
    epaisseurLiee: z.number().finite(),
    /** Epaisseur totale des couches (m). */
    epaisseurTotale: z.number().finite(),
    /** Critere de fatigue (couche liee), si applicable. */
    fatigue: FatigueSchema.optional(),
    /** Critere d'orniarage (sol support). */
    ornierage: OrnierageSchema,
    /**
     * Critere SECONDAIRE phase 2 des structures MIXTES (§4.4.1) : ε_t (µdef) a la
     * base bitumineuse avec MTLH fissure (E/5) + interface glissante. `null` si la
     * structure n'est pas concernee ; omis sur le chemin d'erreur.
     */
    fatiguePhase2: CritereCoucheSchema.nullable().optional(),
    /**
     * Critere SECONDAIRE des structures INVERSES (§4.5) : σ_t (MPa) a la base du
     * segment MTLH profond. `null` si la structure n'est pas concernee ; omis sur
     * le chemin d'erreur.
     */
    fatigueInverse: CritereCoucheSchema.nullable().optional(),
    /**
     * σ_t par couche traitee + mode d'interface (Tab. 68). Tableau VIDE si aucune
     * couche traitee ; omis sur le chemin d'erreur.
     */
    couchesTraitees: z.array(CoucheTraiteeSchema).max(20).optional(),
    /**
     * Detail ε_z par couche granulaire non liee (§4.1.2). Tableau VIDE si aucune
     * couche granulaire ; omis sur le chemin d'erreur.
     */
    couchesGranulaires: z.array(CoucheGranulaireSchema).max(20).optional(),
    /** Details de calcul — intermediaires de methode PUBLICS (cf. DetailsSchema). */
    details: DetailsSchema.optional(),
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
