/**
 * CONTRAT I/O du moteur AXISYMETRIQUE (plaque annulaire / radier circulaire sur sol
 * multicouche elastique, §2.4.1 de GEOPLAQUE).
 *
 * Defini avec `defineEngineContract` de @roadsen/shared : entree bornee (sert aussi de
 * forme persistee) + sortie client-safe en WHITELIST STRICTE. Les deux schemas sont
 * verifies anti-passthrough a la construction.
 *
 * --- ENTREE ---
 * L'etat de sol (couches) + les parametres du dallage circulaire, tels que le handler
 * `#ax-run` du HTML les lisait (champs de saisie + globale `state.layers`).
 *   - `layers` : couches de sol [{ zBase (m, negatif vers le bas), E (MPa), nu }] ;
 *   - `o`      : parametres :
 *       - `R`  : rayon du dallage (m) ;
 *       - `e`  : epaisseur (m) ;
 *       - `E`  : module d'Young du beton (MPa) ;
 *       - `nu` : Poisson du beton ;
 *       - `q`  : charge repartie (kPa) ;
 *       - `Pc` : charge centrale ponctuelle (kN) ;
 *       - `ne` : nombre d'elements annulaires (le moteur borne a [6, 300]) ;
 *       - `foundD` : profondeur d'assise D (m, >=0).
 *
 * --- UNITES (meme decision que le radier — TRANCHÉ, cf. mémoire roadsen-radier-units) ---
 * On declare E en MPa cote contrat (comme radier : beton ~32000 MPa, sol ~8..50 MPa). Le
 * champ HTML « E beton (kPa) » (valeur 3e7) et les couches HTML stockees en kPa (E:2e4 =>
 * affichees /1000 en MPa) sont une convention INTERNE de l'outil d'origine ; on adopte la
 * MEME convention que le radier a la frontiere du contrat. Le solveur retourne `wc`/`wEdge`/
 * `wMax`/`wMin` dans la MEME convention numerique que le radier (effet d'echelle
 * E-MPa × charges-kN × geometrie-m => ordre de grandeur des mm ; `Mr`/`Mt` ~ kN·m/m ;
 * `pMax` ~ kPa). On NE reproduit PAS le `×1000` d'AFFICHAGE du HTML (`R.wc*1000` dans le
 * handler `#ax-run` / `axiPlot`) : c'est un facteur de RENDU, hors solveur. Unite
 * definitive a figer avec STARFIRE pour un PV opposable.
 *
 * --- POURQUOI une sortie reduite (anti-fuite, DoD §8) ---
 * Le calcul produit, en interne (objet `R`), TOUTE la solution EF axisymetrique, qui
 * CONSTITUE la methode :
 *   - CHAMPS NODAUX radiaux : `r[]` (abscisses des nœuds), tassement `w[]`, reaction
 *     `p[]`, moments radial `Mr[]` / tangentiel `Mt[]` ;
 *   - discretisation `nn`, matrices internes.
 * Exposer ces tableaux par nœud reviendrait a publier le solveur EF (maillage annulaire +
 * champ complet). On ne whiteliste donc QUE les VALEURS de DIAGNOSTIC d'ingenierie
 * (scalaires) destinees au PV : tassements centre/bord/max/min, moments radial et
 * tangentiel max, reaction de sol max, charge totale, cote d'assise, ET (ADR 0014) le
 * tassement DIFFERENTIEL `diff` (wMax−wMin) et la RESULTANTE de reaction `sumReact` — deux
 * grandeurs GLOBALES que l'outil client affiche (« Tassement differentiel », « Charge /
 * reaction Σ »). Le tableau `r[]` (pas de maillage radial), `nn`, la rigidite `EI`/`D`
 * restent ECARTES (fail-closed) : ce sont la methode EF, pas des diagnostics.
 *
 * AUCUN symbole de calcul ici : pur Zod/TS, mais ce fichier appartient a @roadsen/engines
 * (importe par l'API seule, jamais le front).
 */
import { defineEngineContract } from '@roadsen/shared';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Entree : couches de sol + parametres du dallage circulaire (bornes / enums)
// ---------------------------------------------------------------------------

/** Une couche de sol. zBase = cote de la base (m, negative vers le bas). E en MPa. */
const LayerSchema = z
  .object({
    name: z.string().max(80).optional(),
    zBase: z.number().finite().min(-1e4).max(1e4),
    E: z.number().finite().min(0.001).max(1e6),
    nu: z.number().finite().min(0).max(0.499),
  })
  .strict();

/** Parametres du dallage circulaire + chargement. */
const AxiOptsSchema = z
  .object({
    /** Rayon du dallage (m). */
    R: z.number().finite().min(0.01).max(1e4),
    /** Epaisseur (m). */
    e: z.number().finite().min(0.001).max(100),
    /** Module d'Young du beton E (MPa). */
    E: z.number().finite().min(0.001).max(1e6),
    /** Poisson du beton. */
    nu: z.number().finite().min(0).max(0.499),
    /** Charge repartie q (kPa). */
    q: z.number().finite().min(-1e9).max(1e9).optional().default(0),
    /** Charge centrale ponctuelle Pc (kN). */
    Pc: z.number().finite().min(-1e9).max(1e9).optional().default(0),
    /** Nombre d'elements annulaires (le moteur borne a [6, 300]). */
    ne: z.number().int().min(1).max(1e4).optional().default(50),
    /** Profondeur d'assise D (m, >=0). */
    foundD: z.number().finite().min(0).max(1e4).optional().default(0),
  })
  .strict();

/**
 * Entree complete du moteur axisymetrique : sol + parametres. Bornee. Au moins une
 * couche ; FAIL-CLOSED : au moins une charge (q ou Pc) non nulle (le handler HTML rejette
 * `q===0 && Pc===0` — sans quoi un modele sans charge produit un champ nul « valide »
 * scellable en PV).
 */
export const AxiInputSchema = z
  .object({
    /** Libelle de projet (metadonnee d'affichage, hors calcul). */
    projet: z.string().max(200).optional(),
    layers: z.array(LayerSchema).min(1).max(50),
    o: AxiOptsSchema,
  })
  .strict()
  .refine((m) => m.o.q !== 0 || m.o.Pc !== 0, {
    message:
      'Aucune charge appliquee : renseigne une charge repartie q (kPa) ou centrale Pc (kN) non nulle.',
  });
export type AxiInput = z.infer<typeof AxiInputSchema>;

// ---------------------------------------------------------------------------
// Sortie : WHITELIST stricte des DIAGNOSTICS (aucun champ nodal / maillage radial)
// ---------------------------------------------------------------------------

/**
 * Sortie client-safe : DIAGNOSTICS d'ingenierie uniquement (scalaires). Aucun champ nodal
 * (`r`/`w`/`p`/`Mr`/`Mt`), aucune discretisation (`nn`), aucune matrice interne.
 * Voir la NOTE UNITÉS dans l'en-tete (mm/‰ effectifs — pas de `×1000` d'affichage).
 */
/**
 * PROFIL RADIAL d'un champ — RE-ECHANTILLONNE sur un nombre FIXE de points (97) DECOUPLE
 * du maillage annulaire reel (interpolation lineaire en fonction du rayon `r`). Montre le
 * RESULTAT (l'allure radiale), PAS la DISCRETISATION. Meme logique design-sur que la
 * heatmap radier (decision titulaire 14/07, ADR 0014). `unit`/`label` repris du trace
 * `axiPlot` du client.
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
 * Profils radiaux exposes (chacun optionnel) — cles NOMMEES (fail-closed §8) : `deflexion`
 * (w), `momentR` (Mr), `momentT` (Mt), `reaction` (p). Chacun re-echantillonne (97 points
 * fixes) : aucun tableau nodal radial `r[]` brut ne franchit ici.
 */
const AxiProfilsSchema = z
  .object({
    deflexion: ProfileSchema.optional(),
    momentR: ProfileSchema.optional(),
    momentT: ProfileSchema.optional(),
    reaction: ProfileSchema.optional(),
  })
  .strict();

export const AxiOutputSchema = z
  .object({
    /** Tassement au centre (r=0). */
    wc: z.number().finite(),
    /** Tassement au bord (r=R). */
    wEdge: z.number().finite(),
    /** Tassement maximal. */
    wMax: z.number().finite(),
    /** Tassement minimal. */
    wMin: z.number().finite(),
    /** Tassement differentiel (wMax − wMin) — grandeur derivee benigne, affichee par le client. */
    diff: z.number().finite(),
    /** Moment radial maximal (en valeur absolue) — kN·m/m. */
    mrMax: z.number().finite(),
    /** Moment tangentiel maximal (en valeur absolue) — kN·m/m. */
    mtMax: z.number().finite(),
    /** Reaction de sol maximale — kPa. */
    pMax: z.number().finite(),
    /** Charge totale appliquee (q·πR² + Pc) — kN. */
    totalLoad: z.number().finite(),
    /**
     * Resultante de la reaction de sol integree Σ (kN) — EXPOSEE (ADR 0014). Le perimetre
     * « non tranche » de l'ancien en-tete est ici TRANCHE : l'outil client l'affiche
     * (« Charge / reaction Σ » du handler `#ax-run`), c'est un BILAN GLOBAL (equilibre
     * ≈ totalLoad), aucun champ nodal -> exposable.
     */
    sumReact: z.number().finite(),
    /** Cote d'assise retenue D (m) — garde du moteur si assise proche du substratum. */
    z0: z.number().finite(),
    /**
     * Profils radiaux de champs (deflexion/momentR/momentT/reaction), re-echantillonnes sur
     * 97 points fixes en fonction du rayon — le RESULTAT, pas la discretisation annulaire.
     */
    profils: AxiProfilsSchema.optional(),
  })
  .strict();
export type AxiOutput = z.infer<typeof AxiOutputSchema>;

/** Contrat de moteur (entree bornee + sortie whitelistee), verifie anti-passthrough. */
export const AXI_CONTRACT = defineEngineContract({
  id: 'axi-plaque',
  inputSchema: AxiInputSchema,
  outputSchema: AxiOutputSchema,
});
