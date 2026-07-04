/**
 * CONTRAT I/O du moteur RADIER / PLAQUE sur sol multicouche elastique (EF) (#54, #56).
 *
 * Defini avec `defineEngineContract` de @roadsen/shared : entree bornee (sert aussi de
 * forme persistee) + sortie client-safe en WHITELIST STRICTE. Les deux schemas sont
 * verifies anti-passthrough a la construction (cf. engine-io.ts).
 *
 * --- ENTREE ---
 * L'etat de modele + les options de calcul, tels que `solveModel(opts)` du HTML les
 * lisait dans la globale `state` et les champs de saisie (via `doSolve`). Pas de
 * piege d'unite : tout en metres + module E en MPa (unites internes du moteur).
 *   - `rafts`        : plaques [{ pts:[{x,y}], E (MPa), nu, e (m) }] ;
 *   - `pointLoads`   : charges ponctuelles [{ x, y, Fz (kN), Mx, My }] ;
 *   - `lineLoads`    : charges lineiques [{ x1,y1,x2,y2, q (kN/ml) }] ;
 *   - `areaLoads`    : charges surfaciques [{ x1,y1,x2,y2, q (kPa), on:'raft'|'soil' }] ;
 *   - `pointSprings` : ressorts ponctuels [{ x, y, k (kN/m) }] ;
 *   - `lineSprings`  : ressorts lineiques [{ x1,y1,x2,y2, k (kN/m par m) }] ;
 *   - `layers`       : couches de sol [{ zBase (m, negatif vers le bas), E (MPa), nu }] ;
 *   - `opts`         : options (mesh (m), decol, qLim (kPa), excavation sigV0/kRec/
 *     foundD, Winkler kWink/winkDecol/pLimWink, champ libre ffG0/ffGx/ffGy, pendage
 *     dipX/dipY).
 * Contrairement au HTML qui lit des CHAMPS DE SAISIE, on declare ici des NOMBRES
 * finis bornes / enumerations fermees (fail-closed).
 *
 * --- POURQUOI une sortie reduite (anti-fuite, DoD §8) ---
 * Le calcul produit, en interne (objet `R`), TOUTE la solution ELEMENTS FINIS, qui
 * CONSTITUE la methode :
 *   - les CHAMPS NODAUX : deplacements `w[]`, reactions `p[]`, moments `Mx[]/My[]/
 *     Mxy[]`, rotations `tx[]/ty[]`, pente `slope[]`, coefficient de reaction local
 *     `kr[]`, etat de contact `active[]` ;
 *   - la TOPOLOGIE DE MAILLAGE : `nodeX[]/nodeY[]`, `blocks` (grilles par plaque, pas,
 *     mapping de DDL `loc`), `N`/`iters` ;
 *   - les sommes/details de ressorts, champ libre, etc.
 * Exposer ces tableaux par nœud reviendrait a publier le solveur EF (geometrie de
 * maillage + champ complet). On ne whiteliste donc QUE les VALEURS de DIAGNOSTIC
 * d'ingenierie (objet `diag`) destinees au PV : tassement max/min, tassement
 * differentiel, pente max, inclinaison de plaque (tilt), distorsion angulaire
 * gouvernante (betaGov) intra- et inter-plaques, tassement differentiel inter-plaques,
 * nombre de plaques. Ce sont les grandeurs que le BE lit pour juger l'aptitude au service.
 *
 * --- COORDONNEES : DECISION FAIL-CLOSED (corrige MAJEUR-1 du challenge #54) ---
 * Les LOCALISATIONS `*At` (wMaxAt / wMinAt / slopeMaxAt / tiltAt / betaGovAt /
 * betaIntraAt) NE sont PAS de la geometrie saisie : ce sont des COORDONNEES DE NŒUDS
 * DE MAILLAGE (`{nodeX[i], nodeY[i]}`) ou des CENTROIDES derives du maillage (tiltAt =
 * centre de plaque, betaGovAt inter = moyenne Sx/S1 sur les nœuds retenus). Elles se
 * « snappent » sur la grille : en faisant varier `mesh` sur plusieurs runs, on
 * reconstruirait le PAS DE MAILLAGE = la METHODE EF. Elles relevent donc de la
 * categorie « topologie de maillage » et sont ECARTEES (fail-closed, defaut
 * confidentialite). On n'expose QUE les VALEURS scalaires des diagnostics, JAMAIS leur
 * localisation derivee du maillage. Une re-exposition future de localisations
 * QUANTIFIEES (arrondies a une resolution sure, decorrelee du pas) serait une decision
 * EXPLICITE titulaire + expert, hors perimetre #54.
 *
 * SEULE EXCEPTION exposable : `worstLoadPair.p1/p2` = coordonnees de POINTS DE CHARGE.
 * VERIFIE dans engine.ts (`pls = state.pointLoads.map(p => ({x: p.x, y: p.y, ...}))`,
 * puis `p1:{x:pls[i].x,...}`) : ce sont les coordonnees SAISIES par l'utilisateur,
 * reprises VERBATIM de l'entree — PAS snappees sur un nœud (`wAtXY` n'interpole que la
 * VALEUR de tassement `s`, pas la position). Echo d'une entree connue de l'appelant :
 * client-safe. Les `ki`/`kj` (indices 1-based de charges) identifient deja la paire.
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
// Entree : etat de modele + options (nombres finis bornes / enums)
// ---------------------------------------------------------------------------

/** Un sommet de polygone de plaque (m). */
const PtSchema = z
  .object({
    x: z.number().finite().min(-1e4).max(1e4),
    y: z.number().finite().min(-1e4).max(1e4),
  })
  .strict();

/** Une plaque (radier) : polygone + materiau. */
const RaftSchema = z
  .object({
    /** Sommets du contour (>= 3). */
    pts: z.array(PtSchema).min(3).max(200),
    /** Module d'Young de la plaque E (MPa). */
    E: z.number().finite().min(0.001).max(1e6),
    /** Coefficient de Poisson nu. */
    nu: z.number().finite().min(0).max(0.499),
    /** Epaisseur e (m). */
    e: z.number().finite().min(0.001).max(100),
  })
  .strict()
  // SECURITE/INTEGRITE (audit adverse) : rejette un contour DEGENERE (aire shoelace
  // quasi nulle) — sommets alignes OU polygone auto-intersectant (bowtie). Sans ce
  // garde-fou, un tel contour produisait un resultat vide silencieux (wMax=0, sans
  // erreur), scellable dans un PV comme un calcul valide.
  .refine(
    (raft) => {
      const p = raft.pts;
      let a = 0;
      for (let i = 0; i < p.length; i++) {
        const pi = p[i];
        const pj = p[(i + 1) % p.length];
        if (!pi || !pj) return false;
        a += pi.x * pj.y - pj.x * pi.y;
      }
      return Math.abs(a) / 2 > 1e-6;
    },
    { message: 'polygone de plaque degenere (aire quasi nulle : sommets alignes ou contour auto-intersectant)' },
  );

/** Charge ponctuelle (kN + moments kN·m). */
const PointLoadSchema = z
  .object({
    x: z.number().finite().min(-1e4).max(1e4),
    y: z.number().finite().min(-1e4).max(1e4),
    Fz: z.number().finite().min(-1e9).max(1e9),
    Mx: z.number().finite().min(-1e9).max(1e9).optional(),
    My: z.number().finite().min(-1e9).max(1e9).optional(),
  })
  .strict();

/** Charge lineique (kN/ml). */
const LineLoadSchema = z
  .object({
    x1: z.number().finite().min(-1e4).max(1e4),
    y1: z.number().finite().min(-1e4).max(1e4),
    x2: z.number().finite().min(-1e4).max(1e4),
    y2: z.number().finite().min(-1e4).max(1e4),
    q: z.number().finite().min(-1e9).max(1e9),
  })
  .strict();

/** Charge surfacique (kPa) appliquee sur la plaque ('raft') ou le sol ('soil'). */
const AreaLoadSchema = z
  .object({
    x1: z.number().finite().min(-1e4).max(1e4),
    y1: z.number().finite().min(-1e4).max(1e4),
    x2: z.number().finite().min(-1e4).max(1e4),
    y2: z.number().finite().min(-1e4).max(1e4),
    q: z.number().finite().min(-1e9).max(1e9),
    on: z.enum(['raft', 'soil']),
  })
  .strict();

/** Ressort ponctuel (kN/m). */
const PointSpringSchema = z
  .object({
    x: z.number().finite().min(-1e4).max(1e4),
    y: z.number().finite().min(-1e4).max(1e4),
    k: z.number().finite().min(0).max(1e12),
  })
  .strict();

/** Ressort lineique (kN/m par m). */
const LineSpringSchema = z
  .object({
    x1: z.number().finite().min(-1e4).max(1e4),
    y1: z.number().finite().min(-1e4).max(1e4),
    x2: z.number().finite().min(-1e4).max(1e4),
    y2: z.number().finite().min(-1e4).max(1e4),
    k: z.number().finite().min(0).max(1e12),
  })
  .strict();

/** Une couche de sol. zBase = cote de la base (m, negative vers le bas). */
const LayerSchema = z
  .object({
    name: z.string().max(80).optional(),
    zBase: z.number().finite().min(-1e4).max(1e4),
    E: z.number().finite().min(0.001).max(1e6),
    nu: z.number().finite().min(0).max(0.499),
  })
  .strict();

/** Options de calcul (toutes optionnelles : defauts moteur = 0/false). */
const OptsSchema = z
  .object({
    /** Pas de maillage (m) ; le moteur impose un plancher a 0,3 m. */
    mesh: z.number().finite().min(0.01).max(100),
    /** Decollement (contact unilateral). */
    decol: z.boolean().optional(),
    /** Seuil de plastification de l'interface qLim (kPa) ; 0 = desactive. */
    qLim: z.number().finite().min(0).max(1e9).optional(),
    /** Contrainte initiale σv0 (kPa) — recompression fond de fouille. */
    sigV0: z.number().finite().min(0).max(1e9).optional(),
    /** Rapport de recompression k = Eur/E0 (>1 active). */
    kRec: z.number().finite().min(0).max(1e6).optional(),
    /** Profondeur de fondation D (m, >=0). */
    foundD: z.number().finite().min(0).max(1e4).optional(),
    /** Module de reaction de Winkler additionnel (kN/m³). */
    kWink: z.number().finite().min(0).max(1e12).optional(),
    /** Winkler en compression seule (decollement surfacique). */
    winkDecol: z.boolean().optional(),
    /** Plastification du Winkler pLimWink (kPa). */
    pLimWink: z.number().finite().min(0).max(1e9).optional(),
    /** Champ libre : tassement impose g0 (mm). */
    ffG0: z.number().finite().min(-1e6).max(1e6).optional(),
    /** Champ libre : gradient en x (mm/m). */
    ffGx: z.number().finite().min(-1e6).max(1e6).optional(),
    /** Champ libre : gradient en y (mm/m). */
    ffGy: z.number().finite().min(-1e6).max(1e6).optional(),
    /** Pendage des interfaces en x (m/m). */
    dipX: z.number().finite().min(-10).max(10).optional(),
    /** Pendage des interfaces en y (m/m). */
    dipY: z.number().finite().min(-10).max(10).optional(),
  })
  .strict();

/**
 * Entree complete du moteur radier : modele + options. Bornee. Voir l'en-tete pour
 * le sens et les unites. Au moins une plaque, au moins une couche, et le moteur
 * exige au moins un chargement effectif (sinon resultat nul / garde).
 */
export const RadierInputSchema = z
  .object({
    /** Libelle de projet (metadonnee d'affichage, hors calcul). */
    projet: z.string().max(200).optional(),
    rafts: z.array(RaftSchema).min(1).max(50),
    pointLoads: z.array(PointLoadSchema).max(2000).optional().default([]),
    lineLoads: z.array(LineLoadSchema).max(2000).optional().default([]),
    areaLoads: z.array(AreaLoadSchema).max(2000).optional().default([]),
    pointSprings: z.array(PointSpringSchema).max(2000).optional().default([]),
    lineSprings: z.array(LineSpringSchema).max(2000).optional().default([]),
    layers: z.array(LayerSchema).min(1).max(50),
    opts: OptsSchema,
  })
  .strict();
export type RadierInput = z.infer<typeof RadierInputSchema>;

// ---------------------------------------------------------------------------
// Sortie : WHITELIST stricte des DIAGNOSTICS (aucun champ nodal / maillage)
// ---------------------------------------------------------------------------

/** Point (x,y) de LOCALISATION d'un resultat (geometrie saisie, pas un nœud de maillage). */
const LocSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict()
  .nullable();

/** Pire distorsion entre deux charges voisines (coords = saisie utilisateur). */
const WorstPairSchema = z
  .object({
    /** Distorsion angulaire beta = ds/L (sans dimension). */
    beta: z.number().finite(),
    /** Tassement differentiel entre les deux charges (m). */
    ds: z.number().finite(),
    /** Distance entre les deux charges (m). */
    L: z.number().finite(),
    /** Indices (1-based) des deux charges concernees. */
    ki: z.number().int(),
    kj: z.number().int(),
    /** Coordonnees des deux charges (saisie utilisateur). */
    p1: LocSchema,
    p2: LocSchema,
  })
  .strict()
  .nullable();

/**
 * Sortie client-safe du moteur radier : DIAGNOSTICS d'ingenierie uniquement. Aucun
 * champ nodal (w/p/M/...), aucune topologie de maillage (blocks/nodeX/nodeY), aucun
 * coefficient de reaction local kr.
 *
 * ⚠️ NOTE UNITÉS (piège du solveur — TRANCHÉ, décision titulaire 01/07/2026).
 * Les annotations (m) / (rad) ci-dessous décrivent l'unité SI VISÉE. Mais la sortie
 * NUMÉRIQUE du solveur est en réalité en **mm** (tassements) et en **‰** (distorsions /
 * pentes / inclinaisons) — piège d'unité E-en-MPa × charges-en-kN × géométrie-en-m.
 * L'affichage (front buildRadierRows + PV buildRadierBody) rend donc mm/‰ SANS conversion
 * (physiquement juste : wMax=6,25 → 6,25 mm ; 6,25 m serait absurde). Preuve : physique +
 * solveModel de référence identique au bit + cohérence inter-cas. NE PAS reprendre le
 * ×1000 de l'outil d'origine GEOPLAQUE_V10 (sur-rapport). Confirmation STARFIRE/expert en
 * attente pour figer l'unité sur un PV opposable (cf. mémoire roadsen-radier-units).
 */
/**
 * HEATMAP D'AFFICHAGE — grille FIXE ~48×48 DECOUPLEE du maillage EF (re-echantillonnage
 * du champ de deflexion par ponderation inverse-distance lissee). Expose le MOTIF de
 * deflexion (le RESULTAT), JAMAIS les valeurs nodales brutes, les indices de nœuds, ni
 * la topologie du maillage (la METHODE). Decision STARFIRE + expert (rescope §8
 * « methode transparente »). Cles DISTINCTES (vals/cols/rows) pour ne pas collisionner
 * avec les noms nodaux interdits (w/nodeX/nodeY/nx/blocks).
 */
const HeatmapSchema = z
  .object({
    x0: z.number().finite(),
    y0: z.number().finite(),
    x1: z.number().finite(),
    y1: z.number().finite(),
    cols: z.number().int().min(2).max(64),
    rows: z.number().int().min(2).max(64),
    vals: z.array(z.number().finite().nullable()).max(4096),
    vMin: z.number().finite(),
    vMax: z.number().finite(),
  })
  .strict();

export const RadierOutputSchema = z
  .object({
    /** Erreur de calcul (garde du moteur / science levee) : message borne. */
    erreur: z.string().max(500).nullable(),
    /** Avertissements (redactes des valeurs confidentielles). */
    warnings: z.array(z.string().max(500)).max(50),
    /** Tassement maximal wMax (m). */
    wMax: z.number().finite(),
    /** Tassement minimal wMin (m). */
    wMin: z.number().finite(),
    /** Tassement differentiel total (wMax - wMin) (m). */
    diff: z.number().finite(),
    /** Pente locale maximale (rad). */
    slopeMax: z.number().finite(),
    /** Inclinaison de plaque maximale (rotation rigide, rad). */
    tiltMax: z.number().finite(),
    /** Distorsion angulaire intra-plaque maximale (rad). */
    betaIntra: z.number().finite(),
    /** Distorsion angulaire inter-plaques maximale (rad). */
    betaInter: z.number().finite(),
    /** Tassement differentiel inter-plaques maximal (m). */
    interDiff: z.number().finite(),
    /** Distorsion angulaire GOUVERNANTE (max intra/inter) (rad). */
    betaGov: z.number().finite(),
    /** Nombre de plaques modelisees. */
    nRafts: z.number().int(),
    /** Pire distorsion entre charges voisines (null si < 2 charges ponctuelles). */
    worstLoadPair: WorstPairSchema,
    /** Champ de deflexion RE-ECHANTILLONNE pour affichage (grille decouplee du maillage). */
    champDeflexion: HeatmapSchema.optional(),
  })
  .strict();
export type RadierOutput = z.infer<typeof RadierOutputSchema>;

// ---------------------------------------------------------------------------
// Le contrat (verifie anti-passthrough a la construction)
// ---------------------------------------------------------------------------

/** Identifiant logique = cle de registre (cf. packages/engines/registry). */
export const RADIER_ENGINE_ID = 'radier-plaque';

export const radierContract = defineEngineContract({
  id: RADIER_ENGINE_ID,
  inputSchema: RadierInputSchema,
  outputSchema: RadierOutputSchema,
});
