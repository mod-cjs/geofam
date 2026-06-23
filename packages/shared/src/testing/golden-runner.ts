/**
 * Execution d un cas-test golden : entrees -> moteur -> comparaison champ a champ.
 *
 * Relie les trois briques :
 *   - le CAS (forme + provenance + tolerances) — golden-case.ts ;
 *   - le PROFIL de tolerance optionnel (ex. FEM) — tolerance-profiles.ts ;
 *   - le COMPARATEUR champ a champ (anti-auto-reference, NaN, near-zero) — golden.ts.
 *
 * Principe anti faux-vert (critere 3) : on compare la valeur CALCULEE renvoyee par
 * le moteur (structure numerique brute), JAMAIS une chaine affichee/arrondie. Le
 * runner ne formate rien avant comparaison ; tout arrondi d affichage doit rester
 * hors de ce chemin.
 *
 * AUCUN symbole moteur : le moteur est injecte par l appelant (fonction `run`).
 */
import {
  assertExpectedIsComparable,
  assertProvenanceIsExternal,
  type GoldenCase,
} from './golden-case.js';
import {
  compareGolden,
  type GoldenCompareOptions,
  type GoldenResult,
  type NumericTolerance,
} from './golden.js';
import { TOLERANCE_PROFILES, type ToleranceProfile } from './tolerance-profiles.js';

export interface RunGoldenCaseOptions {
  /**
   * Profil de tolerance a appliquer (par nom enregistre dans TOLERANCE_PROFILES,
   * ou objet ToleranceProfile direct). Le profil fournit les tolerances de base ;
   * les tolerances du CAS le surchargent (plus specifique gagne).
   */
  profile?: string | ToleranceProfile;
}

function resolveProfile(
  profile: string | ToleranceProfile | undefined,
): ToleranceProfile | undefined {
  if (profile === undefined) return undefined;
  if (typeof profile === 'string') {
    const found = TOLERANCE_PROFILES[profile];
    if (!found) {
      throw new Error(
        `Profil de tolerance inconnu : "${profile}". ` +
          `Profils disponibles : ${Object.keys(TOLERANCE_PROFILES).join(', ')}.`,
      );
    }
    return found;
  }
  return profile;
}

/**
 * Construit les options de comparaison effectives en fusionnant profil + cas.
 * Precedence : tolerance du CAS (par chemin puis par defaut) > profil.
 */
export function buildCompareOptions(
  testCase: Pick<GoldenCase, 'defaultTolerance' | 'toleranceByPath'>,
  profile: ToleranceProfile | undefined,
): GoldenCompareOptions {
  // La forme des tolerances du CAS est validee par Zod (NumericToleranceSchema) :
  // elle est structurellement identique a NumericTolerance. Le cast ne contourne
  // pas la validation — il reconcilie l inference Zod (`T | undefined`) avec le
  // type maison sous `exactOptionalPropertyTypes` (cf. pattern engine-io `as z.infer`).
  const opts: GoldenCompareOptions = {
    toleranceByPath: {
      ...(profile?.toleranceByPath ?? {}),
      ...((testCase.toleranceByPath ?? {}) as Record<string, NumericTolerance>),
    },
  };
  // exactOptionalPropertyTypes : ne poser la cle que si une valeur existe.
  const defaultTolerance =
    (testCase.defaultTolerance as NumericTolerance | undefined) ??
    profile?.defaultTolerance;
  if (defaultTolerance !== undefined) {
    opts.defaultTolerance = defaultTolerance;
  }
  return opts;
}

/**
 * Execute un cas golden : appelle le moteur sur `inputs`, compare la sortie brute
 * a `expected` selon (profil + tolerances du cas).
 *
 * `moduleUnderTest` est OBLIGATOIRE (pas dans les options) : un appelant qui l
 * oublie echoue a la compilation. Cela garantit que la garde anti-auto-reference
 * (provenance != module teste) tire TOUJOURS sur le chemin runner — au lieu d
 * etre inerte quand l option est omise. Rappel : la provenance reste DECLARATIVE
 * et falsifiable (cf. assertProvenanceIsExternal) ; cette garde attrape l erreur
 * grossiere, elle ne remplace pas la validation humaine du kit STARFIRE.
 *
 * @param testCase         cas-test deja valide (forme + provenance + expected non vide).
 * @param moduleUnderTest  identifiant(s) du module/moteur sous test (REQUIS).
 * @param run              fonction moteur : entrees -> sortie CALCULEE (valeur brute).
 * @param opts             profil de tolerance.
 * @throws si la provenance du cas designe le module sous test (anti auto-reference),
 *   ou si `expected` est vide / sans valeur numerique comparable.
 */
export function runGoldenCase(
  testCase: GoldenCase,
  moduleUnderTest: string | string[],
  run: (inputs: unknown) => unknown,
  opts: RunGoldenCaseOptions = {},
): GoldenResult {
  // Defense en profondeur : meme si loadGoldenCases l a verifie, on re-bloque ici
  // (un cas peut etre construit a la main sans passer par le loader).
  assertExpectedIsComparable(testCase.expected, testCase.id);
  assertProvenanceIsExternal(testCase.provenance, moduleUnderTest);

  const profile = resolveProfile(opts.profile ?? testCase.toleranceProfile);
  const compareOpts = buildCompareOptions(testCase, profile);

  const actual = run(testCase.inputs);
  // compareGolden(expected, actual) : l ordre place la REFERENCE en premier.
  return compareGolden(testCase.expected, actual, compareOpts);
}
