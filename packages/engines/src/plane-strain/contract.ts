/**
 * CONTRAT I/O du moteur DEFORMATIONS PLANES / POUTRE (coupe 2D, tranche unitaire)
 * sur sol multicouche elastique (variante « bande » de GEOPLAQUE, `solvePlaneStrain`).
 *
 * Defini avec `defineEngineContract` de @roadsen/shared : entree bornee (sert aussi de
 * forme persistee) + sortie client-safe en WHITELIST STRICTE. Les deux schemas sont
 * verifies anti-passthrough a la construction (cf. engine-io.ts).
 *
 * --- ENTREE ---
 * L'etat de sol + les options de calcul, tels que `solvePlaneStrain(o)` du HTML les
 * lisait dans la globale `state.layers` et les champs de saisie. Pas de piege d'unite :
 * tout en metres + module E en MPa (unites internes du moteur).
 *   - `layers` : couches de sol [{ zBase (m, negatif vers le bas), E (MPa), nu }] ;
 *   - `opts`   : { Bw (largeur de la bande, m), e (epaisseur de la poutre, m),
 *     E (module de la poutre, MPa), nu, foundD (profondeur d'assise, m, opt.),
 *     ne (nb d'elements, 6..400, opt.), q (charge repartie, kPa, opt.),
 *     loads: [{ x (m), P (kN/ml) }] (charges lineiques, opt.), decol (bool, opt.) }.
 * Contrairement au HTML qui lit des CHAMPS DE SAISIE, on declare ici des NOMBRES
 * finis bornes (fail-closed).
 *
 * --- POURQUOI une sortie reduite (anti-fuite, DoD §8) ---
 * Le calcul produit, en interne (objet `R`), TOUTE la solution ELEMENTS FINIS, qui
 * CONSTITUE la methode :
 *   - les CHAMPS NODAUX : `X[]` (abscisses de nœuds), deplacements `w[]`, reactions
 *     `p[]`, moments `M[]`, efforts tranchants `V[]` ;
 *   - la TOPOLOGIE : `nn` (nb de nœuds), `dx` (pas), `iters` (iterations de contact).
 * Exposer ces tableaux par nœud reviendrait a publier le solveur EF (maillage +
 * champ complet). On ne whiteliste donc QUE les VALEURS de DIAGNOSTIC d'ingenierie
 * destinees au PV : tassements extremes, moments extremes, reaction maximale de sol,
 * charge totale, resultante de reaction, profondeur d'assise retenue, nombre de nœuds
 * decolles, ET la rigidite de flexion `D = EI` (forme fermee des entrees E/e/ν, affichee
 * en permanence par l'outil client — ADR 0014 ; a distinguer du pas `dx` qui reste SERVEUR).
 *
 * ⚠️ NOTE UNITÉS (piège du solveur — même décision que le radier, cf. mémoire
 * roadsen-radier-units). La sortie NUMÉRIQUE des tassements (wMax/wMin/diff) est en
 * **mm** (piège d'unité E-en-MPa × charges-en-kN × géométrie-en-m). On NE reproduit
 * PAS le ×1000 d'AFFICHAGE de l'outil d'origine GEOPLAQUE_V10 (sur-rapport).
 * Confirmation STARFIRE/expert en attente pour figer l'unité sur un PV opposable.
 *
 * `projectEngineOutput` re-parse la sortie a travers ce schema et STRIPPE tout champ
 * non whiteliste, a tout niveau.
 *
 * AUCUN symbole de calcul ici : pur Zod/TS, mais ce fichier appartient a
 * @roadsen/engines (importe par l'API seule, jamais le front).
 */
import { defineEngineContract } from '@roadsen/shared';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Entree : sol + options (nombres finis bornes)
// ---------------------------------------------------------------------------

/** Une couche de sol. zBase = cote de la base (m, negative vers le bas). */
const LayerSchema = z
  .object({
    name: z.string().max(80).optional(),
    zBase: z.number().finite().min(-1e4).max(1e4),
    E: z.number().finite().min(0.001).max(1e6),
    nu: z.number().finite().min(0).max(0.499),
  })
  .strict();

/** Charge lineique ponctuelle sur la coupe : intensite P (kN/ml) au point x (m). */
const LineLoadSchema = z
  .object({
    x: z.number().finite().min(-1e4).max(1e4),
    P: z.number().finite().min(-1e9).max(1e9),
  })
  .strict();

/** Options de calcul de la coupe en deformations planes. */
const OptsSchema = z
  .object({
    /** Largeur de la bande / poutre Bw (m). */
    Bw: z.number().finite().min(0.01).max(1e4),
    /** Epaisseur de la poutre e (m). */
    e: z.number().finite().min(0.001).max(100),
    /** Module d'Young de la poutre E (MPa). */
    E: z.number().finite().min(0.001).max(1e6),
    /** Coefficient de Poisson nu de la poutre. */
    nu: z.number().finite().min(0).max(0.499),
    /** Profondeur d'assise D (m, >=0) ; le moteur applique un garde-fou. */
    foundD: z.number().finite().min(0).max(1e4).optional(),
    /** Nombre d'elements ne ; le moteur borne a [6, 400]. */
    ne: z.number().finite().min(1).max(1e4).optional(),
    /** Charge repartie q (kPa). */
    q: z.number().finite().min(-1e9).max(1e9).optional(),
    /** Charges lineiques ponctuelles [{ x, P }]. */
    loads: z.array(LineLoadSchema).max(2000).optional(),
    /** Decollement (contact unilateral). */
    decol: z.boolean().optional(),
  })
  .strict();

/**
 * Entree complete du moteur : sol + options. Bornee. Au moins une couche, et au moins
 * une charge non nulle (repartie q ou lineique P) — sinon champ de tassement nul,
 * scellable en PV sur un formulaire quasi vide (fail-closed).
 */
export const PlaneStrainInputSchema = z
  .object({
    /** Libelle de projet (metadonnee d'affichage, hors calcul). */
    projet: z.string().max(200).optional(),
    layers: z.array(LayerSchema).min(1).max(50),
    opts: OptsSchema,
  })
  .strict()
  .refine((m) => (m.opts.q ?? 0) !== 0 || (m.opts.loads ?? []).some((l) => l.P !== 0), {
    message:
      'Aucune charge appliquee : la coupe doit comporter au moins une charge non nulle (repartie q ou lineique P).',
  });
export type PlaneStrainInput = z.infer<typeof PlaneStrainInputSchema>;

// ---------------------------------------------------------------------------
// Sortie : WHITELIST stricte des DIAGNOSTICS (aucun champ nodal / maillage)
// ---------------------------------------------------------------------------

/**
 * PROFIL D'UN CHAMP le long de la coupe — RE-ECHANTILLONNE sur un nombre FIXE de points
 * (97) DECOUPLE du pas de maillage `dx` reel (interpolation lineaire sur les nœuds). Montre
 * le RESULTAT (l'allure du champ), PAS la DISCRETISATION : `x` est une abscisse d'affichage
 * reguliere, `v` la valeur interpolee. Meme logique design-sur que la heatmap radier
 * (decision titulaire 14/07, ADR 0014). `unit`/`label` repris du trace de l'outil client.
 */
const ProfileSchema = z
  .object({
    x: z.array(z.number().finite()).min(2).max(97),
    v: z.array(z.number().finite()).min(2).max(97),
    unit: z.string().max(20),
    label: z.string().max(60),
  })
  .strict();

/**
 * Profils de champs exposes (chacun optionnel) — cles NOMMEES (fail-closed §8) : `deflexion`
 * (w), `moment` (M), `reaction` (p). Chaque profil est re-echantillonne (97 points fixes,
 * decouple de `dx`) : aucun tableau nodal brut ni le pas de maillage ne franchit ici.
 */
const PlaneStrainProfilsSchema = z
  .object({
    deflexion: ProfileSchema.optional(),
    moment: ProfileSchema.optional(),
    reaction: ProfileSchema.optional(),
  })
  .strict();

/**
 * Sortie client-safe : DIAGNOSTICS d'ingenierie uniquement. Aucun champ nodal
 * (X/w/p/M/V), aucune topologie (nn/dx/iters). `EI` (rigidite D) et les `profils`
 * re-echantillonnes sont des RESULTATS exposes (ADR 0014), pas la methode.
 */
export const PlaneStrainOutputSchema = z
  .object({
    /** Erreur de calcul (garde du moteur / science levee) : message borne. */
    erreur: z.string().max(500).nullable(),
    /** Avertissements. */
    warnings: z.array(z.string().max(500)).max(50),
    /** Tassement maximal wMax (mm — cf. note unites). */
    wMax: z.number().finite(),
    /** Tassement minimal wMin (mm). */
    wMin: z.number().finite(),
    /** Tassement differentiel (wMax - wMin) (mm). */
    diff: z.number().finite(),
    /** Moment flechissant maximal (positif). */
    mMax: z.number().finite(),
    /** Moment flechissant minimal (negatif). */
    mMin: z.number().finite(),
    /** Reaction de sol maximale (kPa). */
    pMax: z.number().finite(),
    /** Charge verticale totale appliquee. */
    totalLoad: z.number().finite(),
    /** Resultante de la reaction de sol integree. */
    sumReact: z.number().finite(),
    /** Profondeur d'assise effectivement retenue (m). */
    z0: z.number().finite(),
    /** Nombre de nœuds decolles (contact unilateral). */
    decolN: z.number().int(),
    /**
     * Rigidite de flexion de la poutre D = E·e³/12(1−ν²) (kN·m) — EXPOSEE (ADR 0014) :
     * l'outil client l'affiche EN PERMANENCE (« Rigidite D (E·e³/12(1−ν²)) »). C'est une
     * forme fermee des SEULES entrees publiques (E, e, ν), PAS un intermediaire de
     * maillage : sa divulgation ne revele rien de la methode EF (a distinguer du champ
     * nodal / du pas `dx` qui, eux, restent SERVEUR).
     */
    EI: z.number().finite(),
    /**
     * Profils de champs le long de la coupe (deflexion/moment/reaction), re-echantillonnes
     * sur 97 points fixes decouples du pas `dx` — le RESULTAT, pas la discretisation.
     */
    profils: PlaneStrainProfilsSchema.optional(),
  })
  .strict();
export type PlaneStrainOutput = z.infer<typeof PlaneStrainOutputSchema>;

// ---------------------------------------------------------------------------
// Le contrat (verifie anti-passthrough a la construction)
// ---------------------------------------------------------------------------

/** Identifiant logique = future cle de registre (cablee par l'orchestrateur). */
export const PLANE_STRAIN_ENGINE_ID = 'plane-strain';

export const planeStrainContract = defineEngineContract({
  id: PLANE_STRAIN_ENGINE_ID,
  inputSchema: PlaneStrainInputSchema,
  outputSchema: PlaneStrainOutputSchema,
});
