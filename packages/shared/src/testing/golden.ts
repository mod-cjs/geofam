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

/** Tolerance numerique pour un champ. Au moins un des deux bornes doit etre fournie. */
export interface NumericTolerance {
  /** Ecart absolu maximal autorise : |actual - expected| <= abs. */
  abs?: number;
  /** Ecart relatif maximal autorise : |actual - expected| <= rel * |expected|. */
  rel?: number;
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
   * Si true, autorise des cles presentes d un cote et absentes de l autre.
   * Defaut false : toute cle manquante/supplementaire est une difference.
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
  if (Number.isNaN(actual) || Number.isNaN(expected)) {
    // NaN n est jamais "egal" : un NaN inattendu est un defaut, pas une tolerance.
    return false;
  }
  if (actual === expected) return true;
  if (!tol || (tol.abs === undefined && tol.rel === undefined)) {
    return false; // egalite stricte exigee
  }
  const delta = Math.abs(actual - expected);
  if (tol.abs !== undefined && delta <= tol.abs) return true;
  if (tol.rel !== undefined && delta <= tol.rel * Math.abs(expected)) return true;
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
      diffs.push({
        path,
        expected,
        actual,
        reason: tol
          ? `ecart numerique hors tolerance (abs=${tol.abs ?? '-'}, rel=${tol.rel ?? '-'})`
          : 'valeurs numeriques differentes (egalite stricte exigee)',
      });
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
        if (opts.allowExtraKeys) continue;
        diffs.push({
          path: childPath,
          expected: inExpected ? expected[k] : '(absent)',
          actual: inActual ? actual[k] : '(absent)',
          reason: inExpected
            ? 'cle manquante dans actual'
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
 * @throws si `expected` et `actual` sont la MEME reference d objet (anti
 *   auto-reference : comparer un objet a lui-meme masquerait un test creux).
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
