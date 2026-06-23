/**
 * Comparateur "golden" generique pour les moteurs ROADSEN.
 *
 * Objectif : comparer une SORTIE de moteur (recalcul serveur, module TS extrait)
 * a une REFERENCE figee (cas-test STARFIRE, valeur affichee par le HTML d origine),
 * champ a champ, avec une tolerance numerique PARAMETRABLE et DOCUMENTEE.
 *
 * Regles de conception (cf. methode QA ROADSEN) :
 *   - Un ecart hors tolerance est un DEFAUT, pas un arrondi a ignorer.
 *   - Anti auto-reference : on REFUSE de comparer un objet a lui-meme (=== ),
 *     sinon le test "passe" en ne verifiant rien (faux-vert).
 *   - La tolerance est explicite : par defaut on exige l egalite stricte ;
 *     on n autorise un ecart QUE si l appelant fournit une tolerance.
 *   - Pas de dependance moteur ici : pur utilitaire, importable cote serveur
 *     (apps/api) comme dans les packages. AUCUN symbole moteur.
 *
 * Ce module ne fait PAS d assertion lui-meme (pas d import de framework de test) :
 * il renvoie un rapport structure. Les helpers d assertion (Vitest) vivent a cote
 * dans `golden.assert.ts` pour rester decouples du runner.
 */

/**
 * Seuil par defaut de bascule rel->abs pres de zero.
 *
 * Pourquoi : une tolerance RELATIVE devient inoperante quand |expected| tend vers 0
 * (rel * |expected| -> 0, donc on retombe de facto sur l egalite stricte, ce qui
 * rejette des ecarts numeriquement insignifiants autour de zero). Quand |expected|
 * passe SOUS ce seuil, on n applique plus la borne relative ; seule la borne absolue
 * (si fournie) peut accepter l ecart. Ce comportement est explicite et documente :
 * il n ouvre AUCUNE tolerance qui ne soit deja declaree par l appelant (si aucune
 * borne `abs` n est fournie pres de zero, l egalite stricte reste exigee).
 *
 * Surchargeable par champ via `NumericTolerance.nearZero`.
 */
export const DEFAULT_NEAR_ZERO = 1e-12;

/**
 * Tolerance numerique pour un champ.
 *
 * Modes :
 *   - `exact: true`      : egalite stricte exigee, AUCUNE tolerance (meme si abs/rel fournis).
 *   - `abs` et/ou `rel`  : ecart accepte si |delta| <= abs OU |delta| <= rel*|expected|.
 *   - aucun des trois    : egalite stricte par defaut (comportement le plus strict).
 *
 * La borne RELATIVE est neutralisee quand |expected| < nearZero (cf. DEFAULT_NEAR_ZERO) :
 * pres de zero, seule la borne `abs` peut accepter un ecart.
 */
export interface NumericTolerance {
  /** Egalite stricte exigee : ignore abs/rel. Pour un champ qui ne doit JAMAIS varier. */
  exact?: boolean;
  /** Ecart absolu maximal autorise : |actual - expected| <= abs. */
  abs?: number;
  /** Ecart relatif maximal autorise : |actual - expected| <= rel * |expected| (neutralise pres de zero). */
  rel?: number;
  /** Seuil de bascule rel->abs pres de zero (defaut DEFAULT_NEAR_ZERO). */
  nearZero?: number;
}

export interface GoldenCompareOptions {
  /**
   * Tolerance par defaut appliquee a TOUT champ numerique.
   * Defaut : egalite stricte (aucune tolerance). Un moteur deterministe et
   * correctement transcrit doit, en principe, viser l egalite ; on ouvre une
   * tolerance la ou la science l exige (cf. ecart admissible convenu STARFIRE).
   */
  defaultTolerance?: NumericTolerance;
  /** Tolerance specifique par chemin de champ (ex. "deflexion", "tassement.total"). */
  toleranceByPath?: Record<string, NumericTolerance>;
  /**
   * Si true, ignore UNIQUEMENT les cles EN TROP dans `actual` (presentes cote
   * actual, absentes cote expected). Une cle ATTENDUE (dans expected) mais
   * absente d `actual` reste TOUJOURS une difference — sinon un moteur qui cesse
   * d ecrire un champ attendu passerait (faux-vert).
   * Defaut false : toute cle manquante OU supplementaire est une difference.
   */
  allowExtraKeys?: boolean;
}

export interface GoldenDiff {
  /** Chemin du champ ("a.b.c", "tab[2].x"). */
  path: string;
  expected: unknown;
  actual: unknown;
  /** Raison lisible de l ecart. */
  reason: string;
}

export interface GoldenResult {
  equal: boolean;
  diffs: GoldenDiff[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function withinTolerance(
  actual: number,
  expected: number,
  tol: NumericTolerance | undefined,
): boolean {
  // Semantique NaN : NaN est une valeur de sortie LEGITIME pour certains moteurs
  // (ex. domaine de validite depasse). On la traite donc comme une valeur a part
  // entiere ATTENDUE, pas comme une erreur en soi :
  //   - expected NaN & actual NaN  -> MATCH (la reference attendait bien un NaN).
  //   - expected NaN & actual fini -> ecart (on attendait NaN, on a un nombre).
  //   - expected fini & actual NaN -> DEFAUT (NaN inattendu : aucune tolerance ne
  //     le rattrape — c est le cas dangereux qu on ne doit JAMAIS masquer).
  const expNaN = Number.isNaN(expected);
  const actNaN = Number.isNaN(actual);
  if (expNaN || actNaN) {
    return expNaN && actNaN;
  }

  if (actual === expected) return true; // couvre aussi +0/-0 et l egalite exacte
  // Mode exact : aucune tolerance, meme si abs/rel sont par ailleurs fournis.
  if (tol?.exact) return false;
  if (!tol || (tol.abs === undefined && tol.rel === undefined)) {
    return false; // egalite stricte exigee (defaut le plus strict)
  }

  const delta = Math.abs(actual - expected);
  if (tol.abs !== undefined && delta <= tol.abs) return true;

  // Borne relative : neutralisee pres de zero (sinon rel*|expected| -> 0 et la
  // borne ne sert plus a rien). En zone near-zero, seule `abs` peut accepter.
  if (tol.rel !== undefined) {
    const nearZero = tol.nearZero ?? DEFAULT_NEAR_ZERO;
    if (Math.abs(expected) >= nearZero && delta <= tol.rel * Math.abs(expected)) {
      return true;
    }
  }
  return false;
}

function resolveTolerance(
  path: string,
  opts: GoldenCompareOptions,
): NumericTolerance | undefined {
  return opts.toleranceByPath?.[path] ?? opts.defaultTolerance;
}

function compareNode(
  expected: unknown,
  actual: unknown,
  path: string,
  opts: GoldenCompareOptions,
  diffs: GoldenDiff[],
): void {
  if (typeof expected === 'number' && typeof actual === 'number') {
    const tol = resolveTolerance(path, opts);
    if (!withinTolerance(actual, expected, tol)) {
      let reason: string;
      if (Number.isNaN(expected) && !Number.isNaN(actual)) {
        reason = 'NaN attendu mais valeur finie obtenue';
      } else if (!Number.isNaN(expected) && Number.isNaN(actual)) {
        reason = 'NaN inattendu (valeur finie attendue) — jamais tolere';
      } else if (tol?.exact) {
        reason = 'egalite exacte exigee (mode exact)';
      } else if (tol && (tol.abs !== undefined || tol.rel !== undefined)) {
        reason = `ecart numerique hors tolerance (abs=${tol.abs ?? '-'}, rel=${tol.rel ?? '-'})`;
      } else {
        reason = 'valeurs numeriques differentes (egalite stricte exigee)';
      }
      diffs.push({ path, expected, actual, reason });
    }
    return;
  }

  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      diffs.push({
        path,
        expected: `array(len=${expected.length})`,
        actual: `array(len=${actual.length})`,
        reason: 'longueurs de tableau differentes',
      });
    }
    const n = Math.max(expected.length, actual.length);
    for (let i = 0; i < n; i++) {
      compareNode(expected[i], actual[i], `${path}[${i}]`, opts, diffs);
    }
    return;
  }

  if (isPlainObject(expected) && isPlainObject(actual)) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const k of keys) {
      const childPath = path ? `${path}.${k}` : k;
      const inExpected = k in expected;
      const inActual = k in actual;
      if (inExpected !== inActual) {
        // allowExtraKeys n ignore QUE les cles EN TROP dans actual (presentes
        // cote actual, absentes cote expected). Une cle ATTENDUE (dans expected)
        // mais MANQUANTE dans actual reste TOUJOURS une difference : un moteur qui
        // cesse d ecrire un champ attendu doit faire echouer le cas (anti faux-vert).
        if (opts.allowExtraKeys && inActual && !inExpected) continue;
        diffs.push({
          path: childPath,
          expected: inExpected ? expected[k] : '(absent)',
          actual: inActual ? actual[k] : '(absent)',
          reason: inExpected
            ? 'cle attendue manquante dans actual'
            : 'cle supplementaire dans actual',
        });
        continue;
      }
      compareNode(expected[k], actual[k], childPath, opts, diffs);
    }
    return;
  }

  // Types primitifs restants (string, boolean, null, undefined) ou types mixtes.
  if (expected !== actual) {
    diffs.push({
      path,
      expected,
      actual,
      reason: 'valeurs differentes',
    });
  }
}

/**
 * Compare une sortie `actual` a une reference `expected`.
 *
 * @throws si `expected` et `actual` sont la MEME reference d objet.
 *
 * PORTEE de cette garde (honnete) : elle n attrape que le cas ou l on passe
 * LITTERALEMENT le meme objet des deux cotes (`compareGolden(x, x)`). Sur le
 * chemin runGoldenCase elle ne tire quasiment JAMAIS : le runner construit
 * `actual` via `run(inputs)`, un objet distinct de `expected`, meme si les deux
 * proviennent du module teste. La vraie defense contre l auto-reference au niveau
 * runner est la PROVENANCE (assertProvenanceIsExternal) — elle-meme declarative
 * et falsifiable. Ne pas considerer cette garde d identite comme suffisante.
 */
export function compareGolden(
  expected: unknown,
  actual: unknown,
  opts: GoldenCompareOptions = {},
): GoldenResult {
  if (
    expected !== null &&
    actual !== null &&
    typeof expected === 'object' &&
    expected === actual
  ) {
    throw new Error(
      'compareGolden: `expected` et `actual` sont la MEME reference. ' +
        'Un test qui compare une valeur a elle-meme ne verifie rien (faux-vert). ' +
        'Fournis une reference figee independante de la sortie calculee.',
    );
  }
  const diffs: GoldenDiff[] = [];
  compareNode(expected, actual, '', opts, diffs);
  return { equal: diffs.length === 0, diffs };
}

/** Formatte les ecarts pour un message d echec lisible. */
export function formatGoldenDiffs(diffs: GoldenDiff[]): string {
  if (diffs.length === 0) return '(aucun ecart)';
  return diffs
    .map(
      (d) =>
        `  - ${d.path || '(racine)'} : attendu=${JSON.stringify(d.expected)} ` +
        `obtenu=${JSON.stringify(d.actual)} [${d.reason}]`,
    )
    .join('\n');
}
