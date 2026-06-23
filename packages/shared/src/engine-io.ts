/**
 * Contrat d'I/O des moteurs de calcul ROADSEN (couche CONTRAT, server <-> client).
 *
 * Ce module definit la FORME des entrees/sorties echangees entre `apps/web`
 * (front, client leger) et `apps/api` (qui seul execute `@roadsen/engines`).
 * Il ne contient AUCUNE logique de calcul ni le moindre symbole moteur :
 * c est purement du Zod/TS, importable par le front ET le back.
 *
 * --- Pourquoi une WHITELIST stricte de sortie (DoD 8) ---
 * Les moteurs produisent, en interne, quantite d intermediaires de calcul
 * (coefficients, contraintes par couche, facteurs partiels, etc.). Exposer un
 * objet moteur BRUT au client reviendrait a publier la formule par ses
 * intermediaires => fuite de propriete intellectuelle confidentielle.
 *
 * Regle non negociable : un resultat expose au client ne contient QUE des
 * champs EXPLICITEMENT autorises par un schema de sortie declare. On n expose
 * JAMAIS un objet moteur en pass-through. Le mecanisme `projectEngineOutput`
 * ci-dessous re-parse la sortie a travers le schema declare et STRIPPE tout
 * champ non whiteliste, a tout niveau d imbrication.
 *
 * Choix Zod important : les schemas de CONTENU (sortie, entree) sont en mode
 * STRIP (defaut de `z.object()`) — un champ inconnu est SILENCIEUSEMENT retire,
 * pas rejete : une fuite ne doit pas se transformer en 500. On reserve
 * `.strict()` (rejet des cles en trop) aux objets que NOTRE code construit
 * lui-meme (enveloppe, meta, detail d erreur), jamais a la sortie brute moteur.
 *
 * Le meme principe borne (a) le detail d erreur expose/persiste et (b) les
 * entrees persistees : une exception moteur ne doit jamais dumper d intermediaires.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// 1. Identite & versionnement de moteur
// ---------------------------------------------------------------------------

/**
 * Identifiant logique d un moteur (cle de registre). Borne : kebab/lower,
 * pas de champ libre. Ex. "chaussee-burmister", "fondation-superficielle".
 */
export const EngineIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/, 'identifiant moteur invalide (kebab-case minuscule)');
export type EngineId = z.infer<typeof EngineIdSchema>;

/**
 * Version FIGEE d un moteur (registre des versions). Un PV doit pouvoir etre
 * recalcule avec la version exacte qui l a produit. Format semver simple.
 */
export const EngineVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'version moteur invalide (attendu MAJEUR.MINEUR.CORRECTIF)');
export type EngineVersion = z.infer<typeof EngineVersionSchema>;

// ---------------------------------------------------------------------------
// 2. Valeurs autorisees & garde-fou anti-passthrough
// ---------------------------------------------------------------------------

/**
 * Types de valeur AUTORISES dans une sortie/entree client-safe : scalaires
 * finis et bornes simples. On EXCLUT volontairement tout conteneur ouvert
 * (`z.record`, `z.any`, `z.unknown`, `.passthrough()`, `.catchall()`) car ce
 * serait une porte de sortie ou des intermediaires de calcul pourraient fuir.
 *
 * Un nombre DOIT etre fini (ni NaN ni Infinity) : un intermediaire degenere
 * ne doit pas s exposer tel quel.
 */
export const SafeNumberSchema = z.number().finite();
export const SafeStringSchema = z.string().max(512);
export const SafeBooleanSchema = z.boolean();

/**
 * Feuilles SURES (aucune cle a fuir, valeurs scalaires/litteraux). Liste
 * EXPLICITE : tout ce qui n y figure pas est rejete par defaut.
 */
const FEUILLES_SURES = new Set<string>([
  'ZodNumber',
  'ZodString',
  'ZodBoolean',
  'ZodLiteral',
  'ZodEnum',
  'ZodNativeEnum',
  'ZodNull',
  'ZodDate',
]);

/**
 * Garde-fou de CONCEPTION — VRAIE LISTE BLANCHE, fail-CLOSED.
 *
 * Zod strippe les cles inconnues d un `z.object()`, mais SEULEMENT si tous les
 * niveaux sont des types fermes (pas de conteneur ouvert). Cette fonction
 * inspecte un schema declare et N ACCEPTE QUE des types EXPLICITEMENT surs ;
 * elle REJETTE tout le reste — y compris un `typeName` inconnu ou `undefined`
 * (defense contre une divergence de version Zod ou un type non prevu). Le
 * defaut DOIT etre le rejet : on prefere casser a la definition plutot que de
 * laisser fuiter un intermediaire de calcul en production (DoD 8).
 *
 * Elle est appelee par `defineEngineContract`. Tout schema non conforme leve
 * a la DEFINITION (echec rapide, jamais en production).
 *
 * @param sens 'output' (le plus strict) ou 'input'. Sur la SORTIE, on interdit
 *   aussi les effets `transform`/`preprocess` (ZodEffects) qui pourraient
 *   re-injecter l objet brut APRES le strip ; seul `refinement` est tolere.
 */
export function assertWhitelistSafe(
  schema: z.ZodTypeAny,
  path = '(racine)',
  sens: 'output' | 'input' = 'output',
): void {
  const def = schema._def as { typeName?: string };
  const t = def.typeName;

  // --- Defaut = rejet : aucun typeName -> fail-closed ---
  if (typeof t !== 'string') {
    throw new Error(
      `Contrat moteur non sur en ${path} : schema sans typeName reconnaissable ` +
        '(fail-closed). Seuls des types Zod surs explicites sont autorises.',
    );
  }

  // --- Feuilles surs ---
  if (FEUILLES_SURES.has(t)) return;

  // --- Wrappers transparents : on deballe (via _def.innerType) et on continue.
  //     NB : ZodDefault n a PAS de .unwrap() (c est .removeDefault()) ; on passe
  //     donc uniformement par _def.innerType, sur pour les trois. ---
  if (t === 'ZodOptional' || t === 'ZodNullable') {
    assertWhitelistSafe((def as { innerType: z.ZodTypeAny }).innerType, path, sens);
    return;
  }
  if (t === 'ZodDefault') {
    // Sur une SORTIE, .default() injecterait une valeur NON calculee par le
    // moteur cote client (valeur du contrat, pas un intermediaire : ce n est pas
    // une fuite IP, mais une sortie trompeuse). Interdit sur output ; tolere sur
    // input (valeur d entree par defaut legitime), apres deballage du coeur.
    if (sens === 'output') {
      throw new Error(
        `Contrat moteur non sur en ${path} : .default() interdit sur une SORTIE ` +
          '(injecterait une valeur non calculee par le moteur). Declare le champ ' +
          'explicitement.',
      );
    }
    assertWhitelistSafe((def as { innerType: z.ZodTypeAny }).innerType, path, sens);
    return;
  }
  if (t === 'ZodReadonly') {
    assertWhitelistSafe((def as { innerType: z.ZodTypeAny }).innerType, path, sens);
    return;
  }
  if (t === 'ZodBranded') {
    assertWhitelistSafe((def as { type: z.ZodTypeAny }).type, path, sens);
    return;
  }

  // --- ZodEffects : refinement OK ; transform/preprocess INTERDITS sur output ---
  if (t === 'ZodEffects') {
    const effect = (def as { effect: { type: string } }).effect;
    if (effect.type !== 'refinement') {
      // transform/preprocess s appliquent APRES (ou AVANT) le parse et peuvent
      // re-injecter des champs non whitelistes -> fuite. On refuse.
      throw new Error(
        `Contrat moteur non sur en ${path} : effet "${effect.type}" interdit ` +
          '(seul .refine/.superRefine est tolere ; .transform/.preprocess ' +
          'peuvent re-injecter des intermediaires apres le strip).',
      );
    }
    assertWhitelistSafe((def as { schema: z.ZodTypeAny }).schema, path, sens);
    return;
  }

  // --- Conteneurs fermes (a traverser) ---
  if (t === 'ZodObject') {
    const objDef = def as unknown as {
      shape: () => Record<string, z.ZodTypeAny>;
      unknownKeys?: 'strip' | 'strict' | 'passthrough';
      catchall?: z.ZodTypeAny;
    };
    // `passthrough()` laisserait fuiter les cles inconnues : interdit.
    if (objDef.unknownKeys === 'passthrough') {
      throw new Error(
        `Contrat moteur non sur en ${path} : objet en .passthrough() ` +
          '(cles inconnues conservees => fuite). Retire le passthrough.',
      );
    }
    // `catchall()` (hors ZodNever, le defaut) est aussi une porte ouverte.
    const catchall = objDef.catchall as { _def?: { typeName?: string } } | undefined;
    if (catchall && catchall._def && catchall._def.typeName !== 'ZodNever') {
      throw new Error(
        `Contrat moteur non sur en ${path} : objet avec .catchall() ouvert ` +
          '(cles inconnues typees => fuite). Retire le catchall.',
      );
    }
    const shape = objDef.shape();
    for (const [key, child] of Object.entries(shape)) {
      assertWhitelistSafe(child, `${path}.${key}`, sens);
    }
    return;
  }

  if (t === 'ZodArray') {
    assertWhitelistSafe((def as { type: z.ZodTypeAny }).type, `${path}[]`, sens);
    return;
  }

  if (t === 'ZodTuple') {
    const tupleDef = def as { items: z.ZodTypeAny[]; rest: z.ZodTypeAny | null };
    // `.rest()` = positions non declarees apres les items fixes -> fuite.
    if (tupleDef.rest != null) {
      throw new Error(
        `Contrat moteur non sur en ${path} : tuple avec .rest() ` +
          '(positions non declarees => fuite). Declare des positions fixes.',
      );
    }
    tupleDef.items.forEach((item, i) => assertWhitelistSafe(item, `${path}[${i}]`, sens));
    return;
  }

  if (t === 'ZodUnion' || t === 'ZodDiscriminatedUnion') {
    const options = (def as { options: z.ZodTypeAny[] }).options;
    options.forEach((opt, i) => assertWhitelistSafe(opt, `${path}|${i}`, sens));
    return;
  }

  if (t === 'ZodIntersection') {
    // Les DEUX membres doivent etre surs : un membre record/map sera rejete.
    const interDef = def as { left: z.ZodTypeAny; right: z.ZodTypeAny };
    assertWhitelistSafe(interDef.left, `${path}&gauche`, sens);
    assertWhitelistSafe(interDef.right, `${path}&droite`, sens);
    return;
  }

  // --- Tout le reste : REJET explicite (fail-closed) ---
  // Couvre notamment ZodRecord, ZodMap, ZodSet, ZodAny, ZodUnknown,
  // ZodFunction, ZodPromise, ZodLazy, ZodPipeline, ZodCatch, et tout
  // typeName non reconnu (divergence de version Zod, type futur, etc.).
  throw new Error(
    `Contrat moteur non sur en ${path} : type "${t}" non autorise (fail-closed). ` +
      'Seuls les types Zod surs explicitement listes sont admis ' +
      '(conteneurs ouverts, fonctions, lazy, pipe, catch... sont des fuites potentielles).',
  );
}

// ---------------------------------------------------------------------------
// 3. Detail d'erreur SUR (expose + persiste)
// ---------------------------------------------------------------------------

/**
 * Codes d erreur moteur exposables. Enumeration FERMEE : une exception ne se
 * traduit qu en l un de ces codes — jamais en message libre porteur
 * d intermediaires (valeurs internes, contraintes par couche, etc.).
 */
export const EngineErrorCodeSchema = z.enum([
  'INPUT_INVALIDE', // entrees hors domaine / non conformes au schema d entree
  'NON_CONVERGENCE', // un calcul iteratif n a pas converge
  'DOMAINE_NON_COUVERT', // configuration hors du domaine du moteur
  'ERREUR_INTERNE', // garde-fou : toute exception inattendue, sans detail interne
]);
export type EngineErrorCode = z.infer<typeof EngineErrorCodeSchema>;

/**
 * Libelles d affichage DERIVES du code (enum fermee). Le texte montre au client
 * vient EXCLUSIVEMENT de cette table — JAMAIS d un `message` libre porteur
 * d intermediaires. Fermer ce canal de texte est la condition pour qu aucune
 * valeur interne ne sorte ni ne soit persistee (MAJEUR-4).
 */
export const ENGINE_ERROR_LIBELLES: Readonly<Record<EngineErrorCode, string>> = {
  INPUT_INVALIDE: 'Donnees d entree invalides.',
  NON_CONVERGENCE: 'Le calcul n a pas converge.',
  DOMAINE_NON_COUVERT: 'Configuration hors du domaine du moteur.',
  ERREUR_INTERNE: 'Erreur interne du moteur.',
};

/** Libelle d affichage sur, derive du seul code. */
export function libelleErreurMoteur(code: EngineErrorCode): string {
  return ENGINE_ERROR_LIBELLES[code];
}

/**
 * Forme d un nom de champ d entree fautif : un IDENTIFIANT borne, jamais du
 * texte libre. Empeche d y glisser des valeurs internes (« sigma=12.3 »...).
 */
export const ChampFautifSchema = z
  .string()
  .max(64)
  .regex(/^[a-zA-Z][a-zA-Z0-9_.]*$/, 'champ fautif : identifiant attendu');

/**
 * Detail d erreur SUR, expose au client ET persiste tel quel. Borne et SANS
 * AUCUN canal de texte libre :
 *   - `code`  : enumeration fermee (le libelle d affichage en derive cote API) ;
 *   - `champ` : nom du champ d entree fautif (optionnel), restreint a un
 *               IDENTIFIANT (`ChampFautifSchema`) — pas de texte libre.
 * Plus de `message`, `details`, `stack`, `contexte` : aucune porte a fuite.
 */
export const SafeEngineErrorSchema = z
  .object({
    code: EngineErrorCodeSchema,
    champ: ChampFautifSchema.optional(),
  })
  .strict();
export type SafeEngineError = z.infer<typeof SafeEngineErrorSchema>;

/**
 * Reduit un detail d erreur potentiellement "riche" (issu d un catch moteur,
 * avec stack/valeurs internes/message libre) a la forme SURE. On CONSTRUIT un
 * objet propre a partir des seuls champs whitelistes : ni `message` ni aucun
 * champ libre n est repris. Un code inconnu retombe sur ERREUR_INTERNE ; un
 * `champ` qui n est pas un identifiant propre est ECARTE (defense en profondeur).
 *
 * @param raw objet d erreur arbitraire (NON fiable).
 */
export function toSafeEngineError(raw: unknown): SafeEngineError {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const codeParse = EngineErrorCodeSchema.safeParse(src.code);
  const champParse = ChampFautifSchema.safeParse(src.champ);

  // On CONSTRUIT (jamais de copie brute) : aucun champ non whiteliste ne survit,
  // et `.strict()` garantit qu une cle en trop ne pourrait pas s y glisser.
  return SafeEngineErrorSchema.parse({
    code: codeParse.success ? codeParse.data : 'ERREUR_INTERNE',
    ...(champParse.success ? { champ: champParse.data } : {}),
  });
}

// ---------------------------------------------------------------------------
// 4. Enveloppe de resultat moteur (discriminee succes / echec)
// ---------------------------------------------------------------------------

/**
 * En-tete commun a toute reponse moteur : identite + version FIGEE du moteur
 * ayant produit le resultat (tracabilite PV, recalcul reproductible).
 */
export const EngineResultMetaSchema = z
  .object({
    engineId: EngineIdSchema,
    engineVersion: EngineVersionSchema,
  })
  .strict();
export type EngineResultMeta = z.infer<typeof EngineResultMetaSchema>;

/**
 * Fabrique l enveloppe de resultat d un moteur a partir de son schema de SORTIE
 * client-safe. Le resultat est une union discriminee par `ok` :
 *   - succes : { ok: true, meta, output }   (output valide par `outputSchema`)
 *   - echec  : { ok: false, meta, error }   (error = SafeEngineError)
 *
 * `outputSchema` est verifie sur (anti-passthrough) a la construction.
 */
export function defineEngineResult<TOutput extends z.ZodTypeAny>(outputSchema: TOutput) {
  assertWhitelistSafe(outputSchema, 'output', 'output');
  return z.discriminatedUnion('ok', [
    z
      .object({
        ok: z.literal(true),
        meta: EngineResultMetaSchema,
        output: outputSchema,
      })
      .strict(),
    z
      .object({
        ok: z.literal(false),
        meta: EngineResultMetaSchema,
        error: SafeEngineErrorSchema,
      })
      .strict(),
  ]);
}

// ---------------------------------------------------------------------------
// 5. Definition d'un moteur (entree + sortie) & projection sure
// ---------------------------------------------------------------------------

/**
 * Definition de contrat d un moteur : un schema d ENTREE (valide + borne, sert
 * aussi de forme persistee) et un schema de SORTIE client-safe (whitelist).
 * Les deux sont verifies anti-passthrough a la construction.
 */
export interface EngineContract<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
> {
  readonly id: EngineId;
  readonly inputSchema: TInput;
  readonly outputSchema: TOutput;
  /** Enveloppe de resultat (union succes/echec) derivee de `outputSchema`. */
  readonly resultSchema: z.ZodType<EngineResultEnvelope<z.infer<TOutput>>>;
}

/** Forme de l enveloppe (utile au typage cote appelant). */
export type EngineResultEnvelope<TOutput> =
  | { ok: true; meta: EngineResultMeta; output: TOutput }
  | { ok: false; meta: EngineResultMeta; error: SafeEngineError };

/**
 * Declare un contrat de moteur. `inputSchema` ET `outputSchema` doivent etre
 * surs (whitelist) ; ils sont verifies ici, a la definition.
 *
 * NB : l entree sert AUSSI de forme persistee. On la veut donc bornee et sans
 * champ libre — d ou la meme verification anti-passthrough que la sortie.
 */
export function defineEngineContract<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
>(args: {
  id: string;
  inputSchema: TInput;
  outputSchema: TOutput;
}): EngineContract<TInput, TOutput> {
  const id = EngineIdSchema.parse(args.id);
  assertWhitelistSafe(args.inputSchema, 'input', 'input');
  assertWhitelistSafe(args.outputSchema, 'output', 'output');
  const resultSchema = defineEngineResult(args.outputSchema) as unknown as z.ZodType<
    EngineResultEnvelope<z.infer<TOutput>>
  >;
  return {
    id,
    inputSchema: args.inputSchema,
    outputSchema: args.outputSchema,
    resultSchema,
  };
}

/**
 * PROJECTION SURE : prend une sortie moteur BRUTE (potentiellement porteuse
 * d intermediaires) et la re-parse a travers le schema de sortie declare. Zod
 * STRIPPE tout champ non whiteliste, a tout niveau. C est le point de passage
 * oblige avant d exposer/persister une sortie moteur.
 *
 * @throws si la sortie brute ne satisfait meme pas les champs whitelistes
 *   (ex. champ requis manquant) — un defaut d integration, pas une fuite.
 */
export function projectEngineOutput<TOutput extends z.ZodTypeAny>(
  outputSchema: TOutput,
  raw: unknown,
): z.infer<TOutput> {
  return outputSchema.parse(raw) as z.infer<TOutput>;
}

/**
 * PROJECTION SURE des entrees persistees : meme principe que la sortie. On ne
 * persiste QUE les champs declares dans `inputSchema` — pas de copie brute des
 * entrees recues (qui pourrait charrier des champs parasites).
 */
export function projectEngineInput<TInput extends z.ZodTypeAny>(
  inputSchema: TInput,
  raw: unknown,
): z.infer<TInput> {
  return inputSchema.parse(raw) as z.infer<TInput>;
}
