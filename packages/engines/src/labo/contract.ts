/**
 * CONTRAT I/O du moteur FASTLAB — essais de labo & classification GTR (NF P 11-300)
 * (#49-53, #56).
 *
 * Defini avec `defineEngineContract` de @roadsen/shared : entree bornee + sortie
 * client-safe en WHITELIST STRICTE. Les deux schemas sont verifies anti-passthrough a
 * la construction (cf. engine-io.ts).
 *
 * --- ENTREE : miroir de `readForm()` du HTML ---
 * Le HTML lit ses ~100 champs via `num('id')` (un champ par mesure de labo) et
 * `readForm()` (FASTLAB7.html) SERIALISE TOUT champ `.save` non vide. On declare donc
 * ici, en `.strict()` (PAS de catchall — le contrat #56 le refuse, cf. engine-io.ts) :
 *   - les TOGGLES de mode typés (enums fermes) ;
 *   - `m_geo` (famille geologique) et `cfg` (seuils GTR surchargeables) ;
 *   - les CHAMPS DE MESURE par leur id (familles indexees + statiques, bornes) ;
 *   - l'IDENTIFICATION d'echantillon (m_ref/m_chantier/m_client/… : METADONNEES PV,
 *     inertes au calcul mais serialisees par readForm donc LEGITIMES) en chaines
 *     bornees ;
 *   - les ids `.save` annexes (gr_fond, la_charge, su_type, Micro-Deval campagne
 *     mc_cls / mc_ch / mc_rot) en valeur bornee.
 * Un readForm() COMPLET (incluant l'identification, ex. la DEMO) doit donc PASSER ; un
 * id INCONNU reste rejete (fail-closed). NB ARCHITECTURE : l'identification est de la
 * metadonnee PV, pas un intrant de calcul ; pour le PILOTE on l'accepte dans le contrat
 * (forme persistee), elle pourra migrer vers une enveloppe separee au cablage PV.
 *
 * --- PIEGES UNITE (transcrits verbatim cote moteur) ---
 * w en % (wcalc) ; wL/wP arrondis entier ; Dmax seuil 50mm fam C ; seuils Atterberg.
 * Aucune re-division a la lecture (num lit la valeur telle quelle).
 *
 * --- SORTIE : tout client-safe (resultat de labo = livrable), mais whiteliste ---
 * Les resultats d'essais (granulo, Atterberg, VBS, Proctor, CBR, oedo, triaxial...) et
 * la CLASSE GTR sont le LIVRABLE de l'essai, PAS une methode confidentielle (contrai-
 * rement aux moteurs de dimensionnement). On expose donc l'ensemble des grandeurs de
 * `D` + la classification. La whitelist `.strict()` reste en place (cohérence + anti-
 * fuite future), mais ici elle borne la FORME, pas un secret.
 *
 * AUCUN symbole de calcul ici : pur Zod/TS, importe par l'API seule.
 */
import { defineEngineContract } from '@roadsen/shared';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Entree : toggles typés + identification + champs de mesure ENUMERES (.strict())
// ---------------------------------------------------------------------------

/** Une valeur de champ de mesure : string courte (saisie) ou nombre fini borne. */
const FieldValueSchema = z.union([
  z.string().max(40),
  z.number().finite().min(-1e12).max(1e12),
  z.boolean(), // cases a cocher (pl_np, cfg_routeD via cfg)
]);

/** Seuils GTR surchargeables (tous optionnels — defauts moteur sinon). */
const CfgSchema = z
  .object({
    routeD: z.boolean().optional(),
    A_fines: z.number().finite().min(0).max(100).optional(),
    A_ip: z.array(z.number().finite()).length(3).optional(),
    A_vbs: z.array(z.number().finite()).length(3).optional(),
    B_p2: z.number().finite().min(0).max(100).optional(),
    B_fines: z.number().finite().min(0).max(100).optional(),
    B_vbs01: z.number().finite().min(0).max(100).optional(),
    B_vbs56: z.number().finite().min(0).max(100).optional(),
    C_dmax: z.number().finite().min(0).max(1000).optional(),
    D_fines: z.number().finite().min(0).max(100).optional(),
    D_vbs: z.number().finite().min(0).max(100).optional(),
    st: z.array(z.number().finite()).length(4).optional(),
    FR: z.number().finite().optional(),
    DG: z.number().finite().optional(),
  })
  .strict()
  .optional();

/**
 * CHAMPS DE MESURE : enumeres EXPLICITEMENT (le contrat exige .strict() — pas de
 * catchall, sinon une cle inconnue pourrait etre persistee). On GENERE les familles
 * indexees (memes ids que les `cell('id'+i)` du HTML) + les ids statiques, en un objet
 * de cles toutes `FieldValueSchema.optional()`. Tout id que le moteur ne lit pas est
 * inerte ; un id ABSENT de cette liste est REJETE par .strict() (fail-closed).
 */
const SIEVE_IDS = [
  '100',
  '80',
  '63',
  '50',
  '40',
  '31_5',
  '20',
  '16',
  '10',
  '8',
  '6_3',
  '5',
  '4',
  '2',
  '1',
  '0_5',
  '0_2',
  '0_08',
];
const SZ_IDS = ['8', '5', '2', '0_63', '0_2'];

function measurementShape(): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  const opt = () => FieldValueSchema.optional();
  const fam = (prefixes: string[], lo: number, hi: number) => {
    for (const pre of prefixes) for (let i = lo; i <= hi; i++) shape[pre + i] = opt();
  };
  // Familles indexees (cf. cell('id'+i) du HTML).
  fam(['w_t', 'w_h', 'w_s'], 1, 3);
  for (const s of SIEVE_IDS) shape['gr_' + s] = opt();
  fam(['ll_x', 'll_t', 'll_h', 'll_s'], 1, 5);
  fam(['pl_t', 'pl_h', 'pl_s'], 1, 2);
  fam(['pr_mh', 'pr_t', 'pr_h', 'pr_s'], 1, 7);
  fam(['oe_s', 'oe_dh'], 1, 12);
  fam(['rs2_m0_', 'rs2_m1_', 'rs2_mx_', 'rs2_m3_'], 1, 3);
  fam(['tu_s3_', 'tu_df_'], 1, 3);
  fam(['tc_s3_', 'tc_s1_'], 1, 3);
  fam(['es_h1_', 'es_h2_'], 1, 2);
  fam(['md_M', 'md_m'], 1, 2);
  for (const s of SZ_IDS) shape['sz_' + s] = opt();
  fam(['ci_N', 'ci_P', 'ci_R', 'ci_rho', 'ci_w', 'ci_nat'], 1, 4);
  fam(['cb_tot', 'cb_moule', 'cb_vol', 'cb_w', 'cb_H0', 'cb_gonf', 'cb_wimm'], 0, 2);
  for (let m = 0; m <= 2; m++)
    for (let i = 0; i <= 9; i++) shape['cb_pen_' + m + '_' + i] = opt();
  // Micro-Deval CAMPAGNE (mdeMode='camp') : pertes mc_A/mc_B (numerique) + libelles de
  // colonne mc_cls/mc_ch/mc_rot (saisie .save serialisee par readForm — MAJEUR 1 #49-53).
  fam(['mc_A', 'mc_B', 'mc_cls', 'mc_ch', 'mc_rot'], 0, 3);
  // Ids statiques (cf. num('id') statiques du HTML).
  const STATIC = [
    'gr_M',
    'v_conc',
    'v_prise1',
    'v_frac1',
    'v_w1',
    'v_V1',
    'v_prise2',
    'v_frac2',
    'v_w2',
    'v_V2',
    'v_manual',
    'rs_T',
    'rs_rL',
    'pr_d',
    'pr_hh',
    'pr_mould',
    'cb_ydmax',
    'cb_wopt',
    'cb_cible',
    'cb_s25',
    'cb_s5',
    'cb_K',
    'ci_dim',
    'ci_Ra',
    'ci_Ri',
    'ci_rs',
    'd_L',
    'd_W',
    'd_H',
    'd_m',
    'd_d',
    'd_Lc',
    'd_mc',
    'd_w',
    'di_m',
    'di_mf',
    'di_mc',
    'di_mg',
    'di_rfl',
    'di_rp',
    'dd_m',
    'dd_mf',
    'dd_mc',
    'dd_m1',
    'dd_m2',
    'dd_rfl',
    'dd_rp',
    'oe_H0',
    'oe_D',
    'oe_md',
    'oe_rs',
    'oe_e0',
    'uc_d',
    'uc_h',
    'uc_f',
    'uc_dl',
    'pe_V',
    'pe_L',
    'pe_A',
    'pe_dh',
    'pe_t',
    'pe_a',
    'pe_Lv',
    'pe_Av',
    'pe_tv',
    'pe_h1',
    'pe_h2',
    'la_M',
    'la_m',
    'la_ti',
    'la_pi',
    'la_nb',
    'mde_pi',
    'mde_charge',
    'mde_eau',
    'mde_tours',
    'mde_ti',
    'mde_present',
    'ra_M1',
    'ra_M2',
    'ra_M3',
    'ra_M4',
    'ra_rw',
    'su_ba',
    'su_M',
    'su_f',
    'sz_M',
    // Ids `.save` annexes serialises par readForm (MAJEUR 1 #49-53).
    'gr_fond',
    'la_charge',
    'su_type',
  ];
  for (const id of STATIC) shape[id] = opt();
  return shape;
}

/**
 * Entree complete du moteur FASTLAB. Toggles de mode typés (enums fermes) + champs de
 * mesure enumeres (`.strict()`, fail-closed). Tout est optionnel : un echantillon ne
 * remplit que les essais realises ; le minimum pour classer est la granulometrie
 * (passant 80 µm) + VBS ou Ip.
 */
export const LaboInputSchema = z
  .object({
    /** Famille geologique (libelle) — declenche la note famille R rocheux. */
    m_geo: z.string().max(80).optional(),
    // --- IDENTIFICATION d'echantillon (readForm les serialise ; METADONNEES PV, inertes
    //     au calcul mais legitimes — MAJEUR 1 #49-53). Chaines bornees, fail-closed. ---
    m_ref: z.string().max(120).optional(),
    m_chantier: z.string().max(120).optional(),
    m_client: z.string().max(120).optional(),
    m_dossier: z.string().max(120).optional(),
    m_pk: z.string().max(80).optional(),
    m_prof: z.string().max(80).optional(),
    m_date: z.string().max(40).optional(),
    m_dessai: z.string().max(40).optional(),
    m_op: z.string().max(120).optional(),
    m_ing: z.string().max(120).optional(),
    m_labo: z.string().max(120).optional(),
    m_nature: z.string().max(200).optional(),
    m_obs: z.string().max(1000).optional(),
    /** Seuils GTR surchargeables. */
    cfg: CfgSchema,
    // --- Toggles de mode (enums fermes ; defauts moteur si absents) ---
    forcedState: z.enum(['', 'ts', 's', 'm', 'h', 'th']).optional(),
    permMode: z.enum(['const', 'var']).optional(),
    laVar: z.enum(['std', 'rb', 'alt']).optional(),
    mdeVar: z.enum(['std', 'rb', 'alt']).optional(),
    mdeWet: z.enum(['h', 's']).optional(),
    mdeMode: z.enum(['norme', 'camp']).optional(),
    prType: z.enum(['n', 'm45', 'm15']).optional(),
    rsMethod: z.enum(['A', 'B']).optional(),
    cbType: z.enum(['cbr', 'ipi']).optional(),
    ciMethod: z.enum(['box', 'ring']).optional(),
    densMethod: z.enum(['lin', 'imm', 'dep']).optional(),
    densShape: z.enum(['prism', 'cyl']).optional(),
    /** Forme de l'eprouvette de cisaillement (boite) / liquide pycnometre. */
    ci_shape: z.enum(['sq', 'circ']).optional(),
    rs_liq: z.enum(['water', 'other']).optional(),
    mde_class: z.string().max(20).optional(),
    pl_np: z.union([z.boolean(), z.string().max(8)]).optional(),
    ...measurementShape(),
  })
  .strict();
/**
 * Type d'entree. Les ids de mesure sont generes a l'execution (`measurementShape`),
 * donc `z.infer` ne les voit pas statiquement : on ETEND le type infere d'une signature
 * d'index pour les champs de mesure (string|nombre|booleen), ce qui reflete fidelement
 * la validation runtime (le schema .strict() reste la barriere reelle). Les toggles
 * typés (enums) restent prioritaires via le type infere.
 */
type LaboInferred = z.infer<typeof LaboInputSchema>;
export type LaboInput = LaboInferred & {
  /** Champs de mesure par id (valeur de saisie) + cfg/objets toleres par la signature. */
  [field: string]:
    | string
    | number
    | boolean
    | undefined
    | Record<string, unknown>
    | unknown[];
};

// ---------------------------------------------------------------------------
// Sortie : resultats de labo + classification GTR (tout client-safe)
// ---------------------------------------------------------------------------

/** Nombre fini OU null (la plupart des resultats sont null si l'essai n'est pas saisi). */
const NumOrNull = z.number().finite().nullable();

/** Classification GTR. */
const ClassSchema = z
  .object({
    /** Famille GTR (A/B/C/D ou null). */
    fam: z.string().max(4).nullable(),
    /** Sous-classe (ex. A2, B5) ou null. */
    code: z.string().max(8).nullable(),
    /** Classe complete avec etat hydrique (ex. « A2 h ») ou null. */
    full: z.string().max(16).nullable(),
    /** Libelle descriptif de la sous-classe. */
    desc: z.string().max(200),
    /** Chemin de decision (libelles) — client-safe, affiche via allowlist. */
    path: z.array(z.string().max(300)).max(20),
    /**
     * `caveats` = contenu de `classify().warn` TEL QUE le client l'affiche dans l'encart
     * « Points a verifier » (recalc L.1552), VERBATIM — y compris la ligne C1/C2
     * (« Distinction C1/C2 : heuristique provisoire… »). Decision titulaire 14/07
     * (« reprendre comme le client ») : ce sont des CAVEATS NORMATIFS d'explication du
     * classement (aucune valeur confidentielle), donc client-safe et exposes. (Auparavant
     * volontairement masques ; la regle « zero ecart » les rend affichables.)
     */
    caveats: z.array(z.string().max(300)).max(20),
    /** Etat hydrique retenu (ts/s/m/h/th) ou null. */
    etat: z.string().max(4).nullable(),
    /** L'etat hydrique s'applique-t-il a cette famille ? */
    stApplies: z.boolean(),
    /** Note famille R (rocheux), liste de libelles, ou null. */
    rNote: z.array(z.string().max(200)).max(10).nullable(),
  })
  .strict();

// ---------------------------------------------------------------------------
// DETAIL D'AFFICHAGE (par ligne / series de courbe / alertes normatives)
// ---------------------------------------------------------------------------
/**
 * `detail` = tout ce que l'outil client AFFICHE EN PLUS des agregats : colonnes calculees
 * par ligne (w % par prise, refus/passant cumules par tamis, ρd par point Proctor…), les
 * SERIES des courbes (granulo, Proctor, droite de liquidite) et les alertes normatives par
 * feuille. TOUT est client-safe (le module labo est integralement le LIVRABLE, ADR 0014) :
 * on l'expose NOMINATIVEMENT, en `.strict()` fail-closed (une cle inconnue est rejetee).
 * Chaque sous-objet reflete le miroir DOM d'un kernel (cf. engine.ts DET.*).
 *
 * PORTEE COMPLETE (#56 + detail complet) : les 20 essais sont wires au detail par ligne —
 * teneur en eau, granulometrie, Atterberg, VBS, Proctor, ρs, CBR multi-energies, cisaillement
 * direct, masse volumique apparente, œdometre, UCS, triaxial UU, triaxial CU/CD, equivalent de
 * sable, Los Angeles, fragmentation SZ, micro-Deval (norme + campagne), ρ & absorption des
 * granulats, sulfates. Chaque sous-objet = miroir DOM du kernel (colonnes par ligne + series
 * de courbe + alertes normatives). `.strict()` empeche toute cle non declaree (fail-closed).
 */
/** Couple (x, y) d'une serie de courbe (fini des deux cotes). */
const Point2 = z.tuple([z.number().finite(), z.number().finite()]);

const DetailSchema = z
  .object({
    /** Teneur en eau : w % par prise (3), moyenne, nb de prises valides. */
    w: z
      .object({
        rows: z.array(NumOrNull).max(3),
        moy: NumOrNull,
        n: z.number().int().min(0).max(3),
      })
      .strict()
      .optional(),
    /** Granulometrie : refus cumule + passant cumule par tamis + serie de la courbe. */
    gran: z
      .object({
        rows: z
          .array(
            z
              .object({
                s: z.number().finite(),
                cum: NumOrNull,
                pass: NumOrNull,
              })
              .strict(),
          )
          .max(20),
        pts: z.array(Point2).max(20),
      })
      .strict()
      .optional(),
    /** Atterberg : w par point (5 liquidite + 2 plasticite), pente, validite + encart. */
    att: z
      .object({
        llw: z.array(NumOrNull).max(5),
        plw: z.array(NumOrNull).max(2),
        pente: NumOrNull,
        wLraw: NumOrNull,
        points: z.number().int().min(0).max(5),
        valide: z.boolean(),
        warns: z.array(z.string().max(200)).max(10),
        nature: z.string().max(60).nullable(),
        raw: z.array(Point2).max(5),
      })
      .strict()
      .optional(),
    /** VBS : M1 / Mb / VBS 0/5 / VBS du sol par essai + moyenne/retenue + alerte V≤10. */
    vbs: z
      .object({
        rows: z
          .array(
            z
              .object({
                M1: NumOrNull,
                Mb: NumOrNull,
                v05: NumOrNull,
                vs: NumOrNull,
              })
              .strict(),
          )
          .max(2),
        moy: NumOrNull,
        retenue: NumOrNull,
        essais: z.number().int().min(0).max(2),
        manual: NumOrNull,
        lowV: z.boolean(),
      })
      .strict()
      .optional(),
    /** Proctor : ρd/w par point (7), parabole d'ajustement, volume, controle d'energie. */
    proctor: z
      .object({
        V: NumOrNull,
        rows: z.array(z.object({ w: NumOrNull, rd: NumOrNull }).strict()).max(7),
        fit: z
          .object({
            a: z.number().finite(),
            b: z.number().finite(),
            c: z.number().finite(),
          })
          .strict()
          .nullable(),
        wopn: NumOrNull,
        rdmax: NumOrNull,
        points: z.number().int().min(0).max(7),
        energy: z
          .object({
            E: z.number().finite(),
            cible: z.number().finite(),
            ok: z.boolean(),
          })
          .strict()
          .nullable(),
        horsTableau: z.boolean(),
      })
      .strict()
      .optional(),
    /** ρs (pycnometre) : md/ρs par determination (3) + ρw(T)/ρL/moyenne + concordance ≤0,03. */
    rhos: z
      .object({
        rows: z.array(z.object({ md: NumOrNull, rs: NumOrNull }).strict()).max(3),
        rwT: NumOrNull,
        rLeff: NumOrNull,
        mean: NumOrNull,
        spread: NumOrNull,
        ok: z.boolean().nullable(),
        essais: z.number().int().min(0).max(3),
      })
      .strict()
      .optional(),
    /** CBR multi-energies : par moule (net/ρh/ρd/compacite/gonflement/CBR 2,5-5-maxi) +
     *  droite CBR-compacite + series de poinconnement (canvas). */
    cbr: z
      .object({
        rows: z
          .array(
            z
              .object({
                coups: NumOrNull,
                net: NumOrNull,
                dh: NumOrNull,
                ds: NumOrNull,
                comp: NumOrNull,
                gp: NumOrNull,
                c25: NumOrNull,
                c5: NumOrNull,
                maxi: NumOrNull,
              })
              .strict(),
          )
          .max(3),
        ydCBR: NumOrNull,
        icbr: NumOrNull,
        cible: NumOrNull,
        cbType: z.string().max(8).nullable(),
        gonfl: NumOrNull,
        moules: z.number().int().min(0).max(3),
        varPts: z.array(Point2).max(3),
        reg: z
          .object({ a: z.number().finite(), b: z.number().finite() })
          .strict()
          .nullable(),
        pen: z.array(z.array(Point2).max(10)).max(3),
      })
      .strict()
      .optional(),
    /** Cisaillement direct : σ′v/τpic/τres + ρd/e/SR par eprouvette (4) + droites + R². */
    cisail: z
      .object({
        rows: z
          .array(
            z
              .object({
                sv: NumOrNull,
                tp: NumOrNull,
                tr: NumOrNull,
                rd: NumOrNull,
                e: NumOrNull,
                sr: NumOrNull,
              })
              .strict(),
          )
          .max(4),
        c: NumOrNull,
        phi: NumOrNull,
        phiR: NumOrNull,
        cR: NumOrNull,
        r2: NumOrNull,
        eprouvettes: z.number().int().min(0).max(4),
        A_cm2: NumOrNull,
        ptsP: z.array(Point2).max(4),
        ptsR: z.array(Point2).max(4),
        regP: z
          .object({ a: z.number().finite(), b: z.number().finite() })
          .strict()
          .nullable(),
        regR: z
          .object({ a: z.number().finite(), b: z.number().finite() })
          .strict()
          .nullable(),
      })
      .strict()
      .optional(),
    /** Masse volumique apparente : volume/ρ/ρd + w utilisee + note V<50 cm³. */
    dens: z
      .object({
        Vcm3: NumOrNull,
        rho: NumOrNull,
        rhod: NumOrNull,
        w: NumOrNull,
        petitV: z.boolean(),
      })
      .strict()
      .optional(),
    /** Oedometre : Hf/ε_v/e par palier (12) + e₀/ρd/Hs/A + Cc/Cs + serie e-log(σ'). */
    oedo: z
      .object({
        paliers: z
          .array(z.object({ Hf: NumOrNull, ev: NumOrNull, e: NumOrNull }).strict())
          .max(12),
        e0: NumOrNull,
        rd: NumOrNull,
        Hs: NumOrNull,
        A: NumOrNull,
        Cc: NumOrNull,
        Cs: NumOrNull,
        points: z.number().int().min(0).max(12),
        curvePts: z.array(Point2).max(12),
      })
      .strict()
      .optional(),
    /** Compression simple (UCS) : qu + cu = qu/2. */
    ucs: z.object({ qu: NumOrNull, cu: NumOrNull }).strict().optional(),
    /** Triaxial UU : σ1/cu par eprouvette (3) + cu moyen. */
    triuu: z
      .object({
        rows: z.array(z.object({ s1: NumOrNull, cu: NumOrNull }).strict()).max(3),
        cu_uu: NumOrNull,
        eprouvettes: z.number().int().min(0).max(3),
      })
      .strict()
      .optional(),
    /** Triaxial CU/CD : s/t (centre/rayon de Mohr) par eprouvette (3) + c′/φ′. */
    tricu: z
      .object({
        rows: z.array(z.object({ s: NumOrNull, t: NumOrNull }).strict()).max(3),
        c: NumOrNull,
        phi: NumOrNull,
        eprouvettes: z.number().int().min(0).max(3),
      })
      .strict()
      .optional(),
    /** Equivalent de sable : SE par essai (2) + SE moyen. */
    es: z
      .object({
        rows: z.array(z.object({ se: NumOrNull }).strict()).max(2),
        es: NumOrNull,
        essais: z.number().int().min(0).max(2),
      })
      .strict()
      .optional(),
    /** Los Angeles : LA + prise M + conformite granulaire. */
    la: z
      .object({
        la: NumOrNull,
        M: NumOrNull,
        label: z.string().max(8).nullable(),
        conformite: z.string().max(80).nullable(),
      })
      .strict()
      .optional(),
    /** Fragmentation SZ : refus/passant par tamis (5) + Σ passant + SZ. */
    sz: z
      .object({
        rows: z
          .array(
            z.object({ s: z.number().finite(), ref: NumOrNull, pas: NumOrNull }).strict(),
          )
          .max(5),
        sumPass: NumOrNull,
        sz: NumOrNull,
      })
      .strict()
      .optional(),
    /** Micro-Deval : mode norme (coefficient par eprouvette + conformite) OU campagne
     *  (4 pertes + CMDS/CMDE/CMD). Champs optionnels selon le mode (discrimine par `mode`). */
    mde: z
      .object({
        mode: z.enum(['norme', 'camp']),
        rows: z
          .array(z.object({ cc: NumOrNull }).strict())
          .max(2)
          .optional(),
        mde: NumOrNull,
        essais: z.number().int().min(0).max(2).optional(),
        label: z.string().max(12).nullable().optional(),
        conformite: z.string().max(120).nullable().optional(),
        pertes: z.array(NumOrNull).max(4).optional(),
        cmds: NumOrNull.optional(),
        cmde: NumOrNull.optional(),
        cmd: NumOrNull.optional(),
      })
      .strict()
      .optional(),
    /** Masse volumique & absorption des granulats : ρa/ρrd/ρssd + WA24. */
    rho: z
      .object({
        ra: NumOrNull,
        rrd: NumOrNull,
        rssd: NumOrNull,
        wa: NumOrNull,
      })
      .strict()
      .optional(),
    /** Sulfates : SO₃ + SO₄ = SO₃·1,2. */
    sulf: z.object({ so3: NumOrNull, so4: NumOrNull }).strict().optional(),
  })
  .strict();

/**
 * Sortie client-safe FASTLAB : l'ensemble des resultats d'essais (le `D` projete) + la
 * classification GTR. Tous les resultats numeriques sont nullable (null = essai non
 * saisi).
 */
export const LaboOutputSchema = z
  .object({
    /** Erreur de calcul (science levee) : message borne. */
    erreur: z.string().max(500).nullable(),
    /** Avertissements (redactes des valeurs confidentielles — defense en profondeur). */
    warnings: z.array(z.string().max(500)).max(50),
    // --- Resultats d'essais (D projete) ---
    /** Teneur en eau naturelle wn (%). */
    wn: NumOrNull,
    /** Dmax (mm). */
    dmax: NumOrNull,
    /** Passant a 80 µm (%). */
    p80: NumOrNull,
    /** Passant a 2 mm (%). */
    p2: NumOrNull,
    /** Coefficient d'uniformite Cu. */
    Cu: NumOrNull,
    /** Coefficient de courbure Cc (granulo). */
    Cc: NumOrNull,
    /** Module de finesse. */
    mf: NumOrNull,
    /** Qualificatif du sable (module de finesse). */
    mfq: z.string().max(20).nullable(),
    /** Limite de liquidite wL (%, arrondi entier). */
    wl: NumOrNull,
    /** Limite de plasticite wP (%, arrondi entier). */
    wp: NumOrNull,
    /** Indice de plasticite Ip. */
    ip: NumOrNull,
    /** Indice de consistance Ic. */
    ic: NumOrNull,
    /** Valeur de bleu VBS. */
    vbs: NumOrNull,
    /** Masse volumique des grains ρs (Mg/m³). */
    rhos: NumOrNull,
    /** Teneur en eau a l'optimum Proctor wOPN (%). */
    wopn: NumOrNull,
    /** Masse volumique seche maximale ρd max (t/m³). */
    rdmax: NumOrNull,
    /** Indice CBR / IPI. */
    cbr: NumOrNull,
    /** Type CBR retenu (cbr/ipi). */
    cbrType: z.string().max(8).nullable(),
    /** Gonflement (%). */
    gonfl: NumOrNull,
    /** Masse volumique apparente (Mg/m³). */
    rho_app: NumOrNull,
    /** Masse volumique seche apparente (Mg/m³). */
    rhod_app: NumOrNull,
    /** Equivalent de sable (%). */
    es: NumOrNull,
    /** Los Angeles. */
    la: NumOrNull,
    /** Fragmentation SZ (%). */
    sz: NumOrNull,
    /** Micro-Deval. */
    mde: NumOrNull,
    /** Absorption d'eau WA24 (%). */
    wa: NumOrNull,
    /** Teneur en sulfates SO₃ (%). */
    so3: NumOrNull,
    /** Resistance a la compression simple qu (MPa). */
    qu: NumOrNull,
    /** Cohesion cisaillement c′ (kPa). */
    c_cis: NumOrNull,
    /** Angle de frottement cisaillement φ′ (°). */
    phi_cis: NumOrNull,
    /** Angle de frottement residuel cisaillement φ′R (°). */
    phiR_cis: NumOrNull,
    /** Cohesion triaxial c′ (kPa). */
    c: NumOrNull,
    /** Angle de frottement triaxial φ′ (°). */
    phi: NumOrNull,
    /** Cohesion non drainee UU cu (kPa). */
    cu_uu: NumOrNull,
    /** Indice des vides initial e₀ (oedo). */
    e0_oedo: NumOrNull,
    /** Indice de compression Cc (oedo). */
    Cc_oedo: NumOrNull,
    /** Indice de gonflement Cs (oedo). */
    Cs_oedo: NumOrNull,
    /** Permeabilite k (cm/s). */
    k: NumOrNull,
    /**
     * Nature vis-a-vis de la LIGNE A (diagramme de plasticite) — readout « Nature » de
     * l'onglet Atterberg (calcAtt L.1058), AFFICHE par le client. Derive verbatim de wL
     * et Ip : Ip > 0,73·(wL−20) -> « Argile (au-dessus ligne A) », sinon « Limon / sol
     * organique (sous ligne A) ». null si wL ou Ip absent (parite `if(ip!=null&&wL!=null)`).
     */
    natureLigneA: z.string().max(60).nullable(),
    // --- Classification GTR ---
    classe: ClassSchema,
    /**
     * DETAIL d'affichage (colonnes par ligne / series de courbe / alertes normatives) —
     * ce que l'outil client AFFICHE en plus des agregats. `null` en cas d'erreur de calcul.
     */
    detail: DetailSchema.nullable(),
  })
  .strict();
export type LaboOutput = z.infer<typeof LaboOutputSchema>;

// ---------------------------------------------------------------------------
// Le contrat (verifie anti-passthrough a la construction)
// ---------------------------------------------------------------------------

/** Identifiant logique = cle de registre (cf. packages/engines/registry). */
export const LABO_ENGINE_ID = 'labo-classification-gtr';

export const laboContract = defineEngineContract({
  id: LABO_ENGINE_ID,
  inputSchema: LaboInputSchema,
  outputSchema: LaboOutputSchema,
});
