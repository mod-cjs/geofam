/**
 * Scanner de NON-DETERMINISME (temoin moteurs ROADSEN).
 *
 * Les moteurs (@roadsen/engines) DOIVENT etre purs et deterministes :
 * memes entrees -> memes sorties, sans effet de bord, sans dependance a
 * l horloge, au hasard, a l environnement. C est la condition pour que les
 * golden tests (equivalence module<->HTML et client<->serveur) aient un sens.
 *
 * Ce module est un utilitaire PUR (lit le systeme de fichiers, ne fait pas
 * d assertion) : il scanne le code SOURCE d un repertoire et signale toute
 * source connue de non-determinisme. Il ne fait AUCUN import du code moteur
 * (donc aucun risque de confidentialite) et fonctionne meme si le repertoire
 * est vide (cas socle : aucun moteur encore extrait).
 *
 * Limites assumees (honnetete d ingenieur) : un scan textuel attrape les
 * sources EVIDENTES et frequentes ; il n est pas une preuve formelle de purete.
 * Il complete (ne remplace pas) les golden tests qui, eux, prouvent l egalite
 * des sorties sur les cas-tests.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface ForbiddenPattern {
  /** Identifiant court. */
  id: string;
  /** Regex appliquee ligne par ligne. */
  regex: RegExp;
  /** Pourquoi c est non-deterministe. */
  why: string;
}

/**
 * Sources de non-determinisme interdites dans le code moteur.
 * Note : on cible les APPELS (avec `(`) pour limiter les faux positifs sur les
 * simples mentions en commentaire de type ou en chaine.
 */
export const DEFAULT_FORBIDDEN: ForbiddenPattern[] = [
  {
    id: 'Date.now',
    regex: /\bDate\.now\s*\(/,
    why: 'horloge systeme : sortie variable dans le temps',
  },
  {
    id: 'Math.random',
    regex: /\bMath\.random\s*\(/,
    why: 'aleatoire : sortie non reproductible',
  },
  {
    id: 'new-Date-now',
    // `new Date()` sans argument = horloge courante. `new Date(2020, ...)` est ok.
    regex: /\bnew\s+Date\s*\(\s*\)/,
    why: 'horloge systeme (new Date() sans argument fige)',
  },
  {
    id: 'performance.now',
    regex: /\bperformance\s*\.\s*now\s*\(/,
    why: 'horloge haute resolution : variable',
  },
  {
    id: 'process.hrtime',
    regex: /\bprocess\s*\.\s*hrtime\b/,
    why: 'horloge systeme',
  },
  {
    id: 'crypto.randomUUID',
    regex: /\brandomUUID\s*\(|\brandomBytes\s*\(/,
    why: 'aleatoire cryptographique : non reproductible',
  },
  {
    id: 'env-access',
    regex: /\bprocess\s*\.\s*env\b/,
    why: 'depend de l environnement d execution (non pur)',
  },
  {
    // MINEUR-2 : l ordre d enumeration de `for..in` n est pas garanti STABLE
    // entre moteurs JS / plateformes pour toutes les formes de cles. Le test
    // « x100 meme process » ne prouve PAS l ordre inter-plateforme ; ce scan
    // statique le complete. Si une iteration ordonnee est requise, utiliser
    // `for..of` sur un tableau trie ou `Object.keys().sort()`. Echappable par
    // `determinism-allow` si l ordre est PROUVE indifferent.
    id: 'for-in',
    regex: /\bfor\s*\(\s*(?:const|let|var)?\s*[A-Za-z_$][\w$]*\s+in\b/,
    why: 'ordre d enumeration for..in non garanti stable inter-plateforme',
  },
];

/** Commentaire d echappement explicite, a poser sur la ligne incriminee. */
export const DETERMINISM_ALLOW_MARKER = 'determinism-allow';

export interface DeterminismHit {
  file: string;
  line: number;
  patternId: string;
  why: string;
  text: string;
}

export interface DeterminismScanOptions {
  patterns?: ForbiddenPattern[];
  /** Extensions de fichiers a scanner. */
  extensions?: string[];
  /** Fichiers/segments ignores (ex. tests, marqueur). */
  ignore?: (relPath: string) => boolean;
}

function walk(dir: string, exts: string[], ignore: (p: string) => boolean): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // repertoire absent -> rien a scanner (socle vide)
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === 'coverage') continue;
      out = out.concat(walk(full, exts, ignore));
    } else if (exts.some((e) => name.endsWith(e))) {
      if (!ignore(full)) out.push(full);
    }
  }
  return out;
}

/**
 * Scanne `rootDir` (recursif) et retourne toutes les occurrences de patterns
 * non-deterministes NON echappees par le marqueur `determinism-allow`.
 */
export function scanForNonDeterminism(
  rootDir: string,
  options: DeterminismScanOptions = {},
): DeterminismHit[] {
  const patterns = options.patterns ?? DEFAULT_FORBIDDEN;
  const exts = options.extensions ?? ['.ts', '.tsx'];
  const ignore =
    options.ignore ??
    ((p: string) =>
      /\.(test|spec)\.ts$/.test(p) || p.endsWith('marker.ts') || p.endsWith('.d.ts'));

  const hits: DeterminismHit[] = [];
  for (const file of walk(rootDir, exts, ignore)) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i] ?? '';
      if (raw.includes(DETERMINISM_ALLOW_MARKER)) continue; // echappement explicite, justifie
      for (const pat of patterns) {
        if (pat.regex.test(raw)) {
          hits.push({
            file,
            line: i + 1,
            patternId: pat.id,
            why: pat.why,
            text: raw.trim(),
          });
        }
      }
    }
  }
  return hits;
}

/** Formatte les occurrences pour un message d echec lisible. */
export function formatDeterminismHits(hits: DeterminismHit[]): string {
  return hits
    .map((h) => `  - ${h.file}:${h.line} [${h.patternId}] ${h.why}\n      > ${h.text}`)
    .join('\n');
}
