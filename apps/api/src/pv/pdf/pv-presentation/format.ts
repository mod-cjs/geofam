import type { NumberFormat } from './types';

/**
 * HELPERS DE FORMAT (#71) — AFFICHAGE SEUL. Le scellement n'est JAMAIS touché :
 * scale (m->cm), arrondi par grandeur, notation, séparateur, virgule FR ne
 * s'appliquent qu'au rendu. La valeur scellée et le content_hash restent ceux de
 * la canonique brute.
 */

/** Résout un chemin pointé (« fatigue.valeur ») dans la donnée. undefined si absent. */
export function resolvePath(root: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = root;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Point décimal -> virgule (séparateur d'usage FR/Sénégal). */
export function frDecimal(s: string): string {
  return s.replace('.', ',');
}

/**
 * INTÉRIM (cf. #63-C) : nettoie le bruit binaire IEEE-754 à l'affichage SANS
 * toucher au scellement. Le format INGÉNIERIE par grandeur (précision métier) est
 * défini par l'expert STARFIRE — voir ticket [STARFIRE — format d'affichage
 * ingénierie, n° à venir]. Ne PAS confondre avec un arrondi métier. Utilisé par
 * le FALLBACK (table clé-valeur) et comme défaut quand aucun format par grandeur.
 */
export function stripBinaryNoise(n: number): string {
  if (!Number.isFinite(n)) return frDecimal(String(n));
  if (Number.isInteger(n)) return frDecimal(String(n));
  return frDecimal(String(parseFloat(n.toPrecision(12))));
}

/** Insère un séparateur de milliers (espace fine U+202F) dans la partie entière. */
function thousandsSep(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Notation scientifique « 1,47×10⁶ » (2 chiffres après la virgule sur la mantisse). */
function scientific(n: number): string {
  if (n === 0) return '0';
  const exp = Math.floor(Math.log10(Math.abs(n)));
  const mantisse = n / Math.pow(10, exp);
  const m = frDecimal(String(parseFloat(mantisse.toFixed(2))));
  return `${m}×10${toSuperscript(exp)}`;
}

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '-': '⁻',
};
function toSuperscript(n: number): string {
  return String(n)
    .split('')
    .map((c) => SUPERSCRIPT[c] ?? c)
    .join('');
}

/**
 * Formate une VALEUR pour l'affichage selon un NumberFormat (par grandeur). Gère
 * scale (m->cm), decimals, scientific/thousands, virgule FR. Renvoie { value, unit }
 * pour que le renderer place l'unité dans sa colonne dédiée.
 *
 * Chaînes/booléens : rendus tels quels (booléens via picto en amont, pas ici).
 */
export function formatValue(
  raw: unknown,
  fmt?: NumberFormat,
): { value: string; unit: string } {
  const unit = fmt?.unit ?? '';
  if (raw === null || raw === undefined) return { value: '—', unit: '' };
  if (typeof raw === 'string') return { value: raw, unit };
  if (typeof raw === 'boolean') return { value: raw ? 'oui' : 'non', unit };
  if (typeof raw === 'bigint') return { value: String(raw), unit };
  // FAIL-CLOSED (M-3, DoD §8) : un champ MAPPÉ qui résout vers un NON-SCALAIRE
  // (objet/tableau) ne doit JAMAIS imprimer son JSON brut (sous-champs
  // potentiellement confidentiels). On rend un marqueur NEUTRE. Un modèle correct
  // ne mappe que des feuilles scalaires -> ce cas signale une erreur de mapping
  // (à corriger au dev), pas une donnée à déverser.
  if (typeof raw !== 'number') return { value: '(structuré)', unit: '' };

  let n = raw;
  if (fmt?.scale != null) n = n * fmt.scale; // AFFICHAGE SEUL (ex. m->cm)

  if (fmt?.scientific) return { value: scientific(n), unit };

  let s: string;
  if (fmt?.decimals != null) {
    // arrondi d'AFFICHAGE à N décimales (par grandeur), puis nettoyage de queue.
    s = String(parseFloat(n.toFixed(fmt.decimals)));
  } else {
    s = String(parseFloat(n.toPrecision(12))); // défaut = noise-strip intérim
  }

  if (fmt?.thousands) {
    const [intPart, frac] = s.split('.');
    s = frac ? `${thousandsSep(intPart)}.${frac}` : thousandsSep(intPart);
  }
  return { value: frDecimal(s), unit };
}

/**
 * TAUX DE TRAVAIL = valeur / admissible (en %). Enrichissement TRIVIAL autorisé
 * (DoD §8) : pas un champ moteur ajouté, juste un ratio de deux champs scellés.
 * Renvoie null si l'un des deux est absent/non fini ou si admissible = 0.
 */
export function workRate(value: unknown, admissible: unknown): number | null {
  if (typeof value !== 'number' || typeof admissible !== 'number') return null;
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(admissible) ||
    admissible === 0
  )
    return null;
  return (value / admissible) * 100;
}
