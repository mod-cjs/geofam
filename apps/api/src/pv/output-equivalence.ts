/**
 * Équivalence de sorties moteur pour la garde d'altération à l'émission du PV.
 *
 * POURQUOI PAS une égalité canonique stricte : Prisma perd de la précision à
 * l'écriture JSONB des doubles à 17 chiffres significatifs (constaté e2e :
 * NE recalculé 1467314.8218242952 vs stocké 1467314.821824295 — le round-trip
 * pg direct est exact, la perte vient du sérialiseur Prisma). Une comparaison
 * stricte refuse alors d'émettre un PV sur un calcul PARFAITEMENT légitime.
 *
 * La tolérance relative 1e-12 est : (a) largement au-dessus du bruit de
 * sérialisation (~1e-16) ; (b) mille fois plus stricte que la tolérance
 * d'équivalence golden (1e-9) ; (c) sans effet sur la détection d'altération
 * réelle (changer une valeur métier produit des écarts relatifs énormes).
 * Structure (clés, longueurs), textes et booléens restent comparés EXACTEMENT.
 */
export const OUTPUT_EQUIVALENCE_REL_TOL = 1e-12;

export function outputsEquivalent(
  a: unknown,
  b: unknown,
  relTol: number = OUTPUT_EQUIVALENCE_REL_TOL,
): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
    if (a === b) return true;
    const scale = Math.max(Math.abs(a), Math.abs(b));
    return scale > 0 && Math.abs(a - b) / scale <= relTol;
  }
  if (
    a === null ||
    b === null ||
    typeof a !== 'object' ||
    typeof b !== 'object'
  ) {
    // Types scalaires différents ou valeurs non-objets : égalité stricte only.
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return (
      a.length === bb.length &&
      a.every((v, i) => outputsEquivalent(v, bb[i], relTol))
    );
  }
  // Clés `undefined` ignorées : elles disparaissent au JSON (parité round-trip).
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra)
    .filter((k) => ra[k] !== undefined)
    .sort();
  const kb = Object.keys(rb)
    .filter((k) => rb[k] !== undefined)
    .sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => outputsEquivalent(ra[k], rb[k], relTol));
}
