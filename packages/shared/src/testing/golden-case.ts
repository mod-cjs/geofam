/**
 * Lecteur de cas-test "golden" generique ROADSEN.
 *
 * Un CAS-TEST decrit une verification d equivalence : pour des ENTREES donnees,
 * un moteur doit produire des SORTIES ATTENDUES, a une TOLERANCE pres, par champ.
 * La reference (les sorties attendues) vient d une PROVENANCE externe et fiable
 * (kit STARFIRE, valeur affichee par le HTML d origine) — JAMAIS du module TS
 * qu on est justement en train de tester (sinon le test se compare a lui-meme :
 * faux-vert structurel).
 *
 * Ce module :
 *   - definit la FORME d un cas (schema Zod, coherent avec le reste du repo) ;
 *   - charge/valide une LISTE de cas depuis des objets en memoire (un futur loader
 *     JSON disque se branchera sur le meme schema) ;
 *   - impose `provenance` sur chaque cas ;
 *   - REFUSE (throw) un cas dont la provenance designe le module sous test
 *     (anti auto-reference renforcee, au-dela de l identite d objet de golden.ts).
 *
 * AUCUN symbole moteur ici : pur outillage de test, importable cote serveur/test.
 */
import { z } from 'zod';

/**
 * Schema d une tolerance par champ (miroir de NumericTolerance de golden.ts).
 * Defini en Zod pour valider la forme d un cas charge depuis l exterieur (JSON).
 * `passthrough` interdit : une cle inconnue dans une tolerance est probablement
 * une faute de frappe (`absolute` au lieu de `abs`) qui ouvrirait un faux-vert.
 */
export const NumericToleranceSchema = z
  .object({
    exact: z.boolean().optional(),
    abs: z.number().nonnegative().optional(),
    rel: z.number().nonnegative().optional(),
    nearZero: z.number().positive().optional(),
  })
  .strict();

/**
 * Schema d un cas-test golden generique.
 *
 * Generique sur les types d entrees/sorties au niveau TS ; au runtime, entrees et
 * sorties attendues sont des structures arbitraires (record/array/primitive) que
 * le comparateur golden parcourt champ a champ.
 */
export const GoldenCaseSchema = z
  .object({
    /** Identifiant lisible du cas (unicite verifiee au chargement de la liste). */
    id: z.string().min(1, 'id de cas requis'),
    /** Description optionnelle (contexte metier du cas). */
    description: z.string().optional(),
    /**
     * PROVENANCE de la reference — OBLIGATOIRE et non vide.
     * D ou vient la valeur attendue ? Ex. 'STARFIRE-kit-v1', 'HTML-origine'.
     * JAMAIS le module TS recalcule (verifie a part par assertProvenanceIsExternal).
     */
    provenance: z.string().min(1, 'provenance requise (origine de la reference)'),
    /** Entrees fournies au moteur. */
    inputs: z.unknown(),
    /** Sorties attendues (la reference figee). */
    expected: z.unknown(),
    /** Tolerance par defaut appliquee a tout champ numerique du cas. */
    defaultTolerance: NumericToleranceSchema.optional(),
    /** Tolerance specifique par chemin de champ (ex. 'tassement.total'). */
    toleranceByPath: z.record(NumericToleranceSchema).optional(),
    /** Nom du profil de tolerance applique (ex. 'FEM') — purement documentaire. */
    toleranceProfile: z.string().optional(),
  })
  .strict();

export type GoldenCase = z.infer<typeof GoldenCaseSchema>;

/**
 * Options de chargement d une liste de cas.
 */
export interface LoadGoldenCasesOptions {
  /**
   * Identifiant(s) du module SOUS TEST. Tout cas dont la `provenance` correspond
   * a l un de ces identifiants (insensible a la casse, comparaison exacte sur la
   * chaine normalisee) est REFUSE : sa reference serait le code teste lui-meme.
   * Recommande : passer le nom du module/moteur teste pour fermer le faux-vert.
   */
  moduleUnderTest?: string | string[];
}

/** Normalise une provenance/identifiant pour la comparaison anti-auto-reference. */
function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Verifie qu une provenance ne designe PAS le module sous test.
 *
 * PORTEE HONNETE — la provenance est une chaine DECLARATIVE, donc FALSIFIABLE :
 * rien n empeche d ecrire `provenance: 'STARFIRE-kit-v1'` sur une reference
 * fabriquee a la main. Cette garde ne PROUVE pas l externalite ; elle attrape
 * seulement l erreur grossiere ou l on pointe explicitement le module recalcule.
 * La vraie source de verite reste le kit STARFIRE signe, valide par un humain
 * (controle hors-harnais). Ne pas survendre cette barriere.
 *
 * @throws si la provenance correspond (apres normalisation) a un identifiant de
 *   module sous test.
 */
export function assertProvenanceIsExternal(
  provenance: string,
  moduleUnderTest: string | string[] | undefined,
): void {
  if (moduleUnderTest === undefined) return;
  const targets = (Array.isArray(moduleUnderTest) ? moduleUnderTest : [moduleUnderTest])
    .map(normalize)
    .filter((t) => t.length > 0);
  if (targets.includes(normalize(provenance))) {
    throw new Error(
      `Cas-test refuse : la provenance "${provenance}" designe le module SOUS TEST. ` +
        'Une reference qui vient du code teste ne prouve rien (faux-vert). ' +
        'La reference doit provenir d une source externe (kit STARFIRE, HTML d origine).',
    );
  }
}

/**
 * Compte les feuilles numeriques (number, NaN inclus) d une valeur arbitraire.
 * NaN compte : c est une valeur de sortie comparable LEGITIME (cf. golden.ts).
 */
function countNumericLeaves(value: unknown): number {
  if (typeof value === 'number') return 1;
  if (Array.isArray(value)) {
    return value.reduce<number>((acc, v) => acc + countNumericLeaves(v), 0);
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).reduce<number>(
      (acc, v) => acc + countNumericLeaves(v),
      0,
    );
  }
  return 0;
}

/**
 * Verifie que `expected` prouve effectivement QUELQUE CHOSE.
 *
 * Pendant de l anti-auto-reference : un `expected` vide (null/undefined, objet
 * sans cle, tableau vide) — ou sans aucune feuille numerique — ne verifie aucun
 * calcul. Avec `allowExtraKeys:true`, comparer un `expected` vide a n importe
 * quelle sortie donne `equal=true` : faux-vert total. On REFUSE ce cas.
 *
 * @throws si `expected` est vide ou ne contient aucune valeur numerique comparable.
 */
export function assertExpectedIsComparable(expected: unknown, caseId?: string): void {
  const label = caseId ? `Cas-test "${caseId}"` : 'Cas-test';
  if (expected === null || expected === undefined) {
    throw new Error(
      `${label} refuse : "expected" est ${String(expected)} — un cas sans sortie ` +
        'attendue ne verifie rien (faux-vert).',
    );
  }
  if (Array.isArray(expected) && expected.length === 0) {
    throw new Error(
      `${label} refuse : "expected" est un tableau vide — aucun champ a comparer.`,
    );
  }
  if (
    typeof expected === 'object' &&
    !Array.isArray(expected) &&
    Object.keys(expected as Record<string, unknown>).length === 0
  ) {
    throw new Error(
      `${label} refuse : "expected" est un objet sans cle — aucun champ a comparer.`,
    );
  }
  if (countNumericLeaves(expected) === 0) {
    throw new Error(
      `${label} refuse : "expected" ne contient aucune valeur numerique comparable ` +
        '(un cas golden doit prouver au moins une grandeur calculee).',
    );
  }
}

/**
 * Charge et valide une liste de cas-tests golden depuis des objets en memoire.
 *
 * Garanties :
 *   - chaque cas respecte le schema (provenance obligatoire et non vide) ;
 *   - chaque `expected` est non vide et contient >=1 valeur numerique comparable ;
 *   - les `id` sont uniques (un doublon masquerait un cas) ;
 *   - aucune provenance ne designe le module sous test (anti auto-reference).
 *
 * @throws si un cas est invalide, si `expected` est vide, si un id est duplique,
 *   ou si une provenance designe le module sous test.
 */
export function loadGoldenCases(
  raw: unknown,
  opts: LoadGoldenCasesOptions = {},
): GoldenCase[] {
  const cases = z.array(GoldenCaseSchema).parse(raw);

  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) {
      throw new Error(`Cas-test duplique : id "${c.id}" apparait plusieurs fois.`);
    }
    seen.add(c.id);
    assertExpectedIsComparable(c.expected, c.id);
    assertProvenanceIsExternal(c.provenance, opts.moduleUnderTest);
  }
  return cases;
}
