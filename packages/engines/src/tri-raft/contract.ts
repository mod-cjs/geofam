/**
 * CONTRAT I/O du moteur RADIER TRIANGULAIRE (DKT) sur sol multicouche elastique (EF).
 *
 * Defini avec `defineEngineContract` de @roadsen/shared : entree bornee (sert aussi de
 * forme persistee) + sortie client-safe en WHITELIST STRICTE. Les deux schemas sont
 * verifies anti-passthrough a la construction (cf. engine-io.ts).
 *
 * --- ENTREE ---
 * L'etat de modele + les options de calcul, tels que `solveTriRaft(o)` du HTML les
 * lisait dans la globale `state` et les champs de saisie de l'onglet « maillage
 * triangulaire » (`tri-target`, `tri-e`, `tri-E`, `tri-nu`, `tri-q`, `opt-exc-d`).
 *   - `rafts`      : plaques [{ pts:[{x,y}], E?, nu?, e? }] — le materiau est OPTIONNEL
 *     par plaque ; a defaut on retombe sur `opts.E`/`opts.nu`/`opts.e` (repli
 *     `rf.E||o.E`, `rf.nu!=null?rf.nu:o.nu`, `rf.e||o.e` — VERBATIM du HTML) ;
 *   - `pointLoads` : charges ponctuelles [{ x, y, Fz (kN) }] (effort VERTICAL seul :
 *     ce solveur ignore les moments Mx/My, a la difference de solveModel) ;
 *   - `lineLoads`  : charges lineiques [{ x1,y1,x2,y2, q (kN/ml) }] ;
 *   - `areaLoads`  : charges surfaciques [{ x1,y1,x2,y2, q (kPa), on:'raft'|'soil' }].
 *     ⚠️ Les charges `on:'soil'` sont IGNOREES par ce solveur (pas de tassement
 *     champ-libre ici, contrairement a solveModel) — conserve pour fidelite d'etat ;
 *   - `layers`     : couches de sol [{ zBase (m, negatif vers le bas), E, nu }] ;
 *   - `opts`       : { target (aire cible du triangle, m²), e (ep. plaque, m), E, nu,
 *     q (charge repartie, kPa), foundD (profondeur d'assise D, m) }.
 * NB : ce solveur n'utilise NI pointSprings/lineSprings, NI decollement/plastification/
 * Winkler/champ libre/pendage de solveModel (radier rectangulaire ACM). Fail-closed.
 *
 * --- UNITES (piège du solveur — même décision que le radier ACM) ---
 * On adopte la MEME convention que `radier-plaque` : plaque et sol en `E` MPa, geometrie
 * en m, charges en kN/kPa/(kN/ml). La sortie NUMERIQUE du solveur est alors en **mm**
 * (tassements w/wMax/wMin/diff) — piège E-en-MPa × charges-en-kN × géométrie-en-m. On NE
 * reprend PAS le ×1000 d'AFFICHAGE de l'outil d'origine (le handler `tri-run` fait
 * `wMax*1000` a l'affichage seulement). Pour l'EQUIVALENCE-PORTAGE, ce choix est neutre :
 * module et HTML recoivent des entrees identiques et produisent le meme `R` brut. La
 * convention n'entre que dans la PROJECTION client-safe. (cf. memoire roadsen-radier-units.)
 *
 * --- POURQUOI une sortie reduite (anti-fuite, DoD §8) ---
 * L'objet `R` interne contient TOUTE la solution EF, qui CONSTITUE la methode :
 *   - CHAMPS NODAUX : `w[]`, `p[]` ;
 *   - TOPOLOGIE DE MAILLAGE : `P[]` (coordonnees des nœuds triangulaires), `tris[]`
 *     (connectivite), `N`, `nt` (comptes de nœuds/triangles = densite de maillage).
 * Exposer ces tableaux/comptes publierait le mailleur triangulaire + le champ complet.
 * On ne whiteliste donc QUE les VALEURS de DIAGNOSTIC destinees au PV : tassement
 * max/min/differentiel, reaction sol max, bilan charge/reaction, nombre de plaques,
 * cote d'assise. Les localisations de nœuds ne sont JAMAIS exposees (fail-closed, cf.
 * decision radier MAJEUR-1).
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

/**
 * Une plaque (radier) : polygone + materiau OPTIONNEL (repli sur les defauts d'`opts`).
 * On borne le materiau quand il est fourni ; l'absence declenche le repli VERBATIM du
 * moteur (`rf.E||o.E`, etc.).
 */
const RaftSchema = z
  .object({
    /** Sommets du contour (>= 3). */
    pts: z.array(PtSchema).min(3).max(200),
    /** Module d'Young de la plaque E (MPa) — optionnel (repli opts.E). */
    E: z.number().finite().min(0.001).max(1e6).optional(),
    /** Coefficient de Poisson nu — optionnel (repli opts.nu). */
    nu: z.number().finite().min(0).max(0.499).optional(),
    /** Epaisseur e (m) — optionnel (repli opts.e). */
    e: z.number().finite().min(0.001).max(100).optional(),
  })
  .strict();

/** Charge ponctuelle (kN). Ce solveur n'exploite que l'effort vertical Fz. */
const PointLoadSchema = z
  .object({
    x: z.number().finite().min(-1e4).max(1e4),
    y: z.number().finite().min(-1e4).max(1e4),
    Fz: z.number().finite().min(-1e9).max(1e9),
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

/** Charge surfacique (kPa) sur la plaque ('raft') ou le sol ('soil', ignoree ici). */
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

/** Une couche de sol. zBase = cote de la base (m, negative vers le bas). */
const LayerSchema = z
  .object({
    name: z.string().max(80).optional(),
    zBase: z.number().finite().min(-1e4).max(1e4),
    E: z.number().finite().min(0.001).max(1e6),
    nu: z.number().finite().min(0).max(0.499),
  })
  .strict();

/** Options de calcul du solveur triangulaire. */
const OptsSchema = z
  .object({
    /** Aire cible du triangle (m²) : critere d'arret du raffinement 1->4. */
    target: z.number().finite().min(0.001).max(1e6),
    /** Epaisseur de plaque par defaut e (m). */
    e: z.number().finite().min(0.001).max(100),
    /** Module d'Young par defaut E (MPa). */
    E: z.number().finite().min(0.001).max(1e6),
    /** Coefficient de Poisson par defaut nu. */
    nu: z.number().finite().min(0).max(0.499),
    /** Charge repartie uniforme sur la plaque q (kPa) ; 0 = aucune. */
    q: z.number().finite().min(-1e9).max(1e9).optional(),
    /** Profondeur de fondation / cote d'assise D (m, >=0). */
    foundD: z.number().finite().min(0).max(1e4).optional(),
  })
  .strict();

/**
 * Entree complete du moteur radier triangulaire : modele + options. Bornee. Voir
 * l'en-tete pour le sens et les unites. Au moins une plaque, au moins une couche.
 * Contrairement au radier ACM, ce solveur produit un champ nul (mais fini/valide) en
 * l'absence de charge — la garde « au moins une charge » est appliquee ICI (fail-closed)
 * pour ne pas sceller un PV de zeros sur un formulaire quasi vide.
 */
export const TriRaftInputSchema = z
  .object({
    /** Libelle de projet (metadonnee d'affichage, hors calcul). */
    projet: z.string().max(200).optional(),
    rafts: z.array(RaftSchema).min(1).max(50),
    pointLoads: z.array(PointLoadSchema).max(2000).optional().default([]),
    lineLoads: z.array(LineLoadSchema).max(2000).optional().default([]),
    areaLoads: z.array(AreaLoadSchema).max(2000).optional().default([]),
    layers: z.array(LayerSchema).min(1).max(50),
    opts: OptsSchema,
  })
  .strict()
  .refine(
    (m) =>
      (m.opts.q ?? 0) !== 0 ||
      m.pointLoads.some((l) => l.Fz !== 0) ||
      m.lineLoads.some((l) => l.q !== 0) ||
      m.areaLoads.some((l) => l.on !== 'soil' && l.q !== 0),
    {
      message:
        'Aucune charge appliquee : le modele doit comporter au moins une charge non nulle (repartie q, ponctuelle Fz, lineique, ou surfacique sur la plaque).',
    },
  );
export type TriRaftInput = z.infer<typeof TriRaftInputSchema>;

// ---------------------------------------------------------------------------
// Sortie : WHITELIST stricte des DIAGNOSTICS (aucun champ nodal / maillage)
// ---------------------------------------------------------------------------

/**
 * Sortie client-safe du moteur radier triangulaire : DIAGNOSTICS d'ingenierie
 * uniquement. Aucun champ nodal (w/p), aucune topologie de maillage (P/tris/N/nt).
 *
 * ⚠️ NOTE UNITES : `wMax`/`wMin`/`diff` sont numeriquement en **mm** (cf. en-tete —
 * meme piege que le radier ACM). L'affichage/PV les rend SANS ×1000.
 */
/**
 * HEATMAP D'AFFICHAGE — grille FIXE ≤48×48 RE-ECHANTILLONNEE depuis le champ de deflexion
 * (aux nœuds du MAILLAGE TRIANGULAIRE), DECOUPLEE de ce maillage (IDW + masque contour).
 * Expose le MOTIF de deflexion (le RESULTAT), JAMAIS les coordonnees des nœuds `P`, la
 * connectivite `tris`, ni la densite `N`/`nt` (la METHODE — rendu triangule EXCLU, cf.
 * decision design-sur 04/07 + titulaire 14/07). Meme forme que la heatmap radier ACM.
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

export const TriRaftOutputSchema = z
  .object({
    /** Erreur de calcul (garde du moteur / science levee) : message borne. */
    erreur: z.string().max(500).nullable(),
    /** Avertissements (redactes des valeurs confidentielles). */
    warnings: z.array(z.string().max(500)).max(50),
    /** Tassement maximal wMax (mm). */
    wMax: z.number().finite(),
    /** Tassement minimal wMin (mm). */
    wMin: z.number().finite(),
    /** Tassement differentiel total (wMax - wMin) (mm). */
    diff: z.number().finite(),
    /** Reaction du sol maximale (kPa). */
    reactionMax: z.number().finite(),
    /** Charge verticale totale appliquee ΣFz (kN). */
    totalLoad: z.number().finite(),
    /** Reaction du sol integree Σp·A (kN) — doit equilibrer totalLoad. */
    sumReact: z.number().finite(),
    /** Nombre de plaques modelisees. */
    nRaft: z.number().int(),
    /** Cote d'assise D effective (m). */
    z0: z.number().finite(),
    /**
     * Champ de deflexion RE-ECHANTILLONNE pour affichage (grille ≤48×48 decouplee du
     * maillage triangulaire) — le MOTIF, jamais le rendu triangule ni la topologie
     * (decision titulaire 14/07, ADR 0014).
     */
    champDeflexion: HeatmapSchema.optional(),
  })
  .strict();
export type TriRaftOutput = z.infer<typeof TriRaftOutputSchema>;

// ---------------------------------------------------------------------------
// Le contrat (verifie anti-passthrough a la construction)
// ---------------------------------------------------------------------------

/** Identifiant logique du solveur triangulaire (distinct de 'radier-plaque' ACM). */
export const TRI_RAFT_ENGINE_ID = 'radier-tri';

export const triRaftContract = defineEngineContract({
  id: TRI_RAFT_ENGINE_ID,
  inputSchema: TriRaftInputSchema,
  outputSchema: TriRaftOutputSchema,
});
