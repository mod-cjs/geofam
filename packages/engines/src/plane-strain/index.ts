/**
 * Module DEFORMATIONS PLANES / POUTRE (coupe 2D, tranche unitaire) sur sol multicouche
 * elastique (variante « bande » de GEOPLAQUE, `solvePlaneStrain`) — point d'entree PUR
 * & client-safe.
 *
 * Chaine : entree validee -> moteur d'origine (computePlaneStrain) -> PROJECTION du
 * resultat brut `R` sur la sortie whitelistee (contract.ts : DIAGNOSTICS GLOBAUX
 * uniquement) -> enveloppe de resultat (meta + output). Aucun DOM, aucune horloge,
 * aucun hasard.
 *
 * Importe UNIQUEMENT par apps/api (recalcul serveur). Le front ne voit que les TYPES du
 * contrat via @roadsen/shared, jamais ce module (garde-fou ESLint + controle de bundle
 * CI, DoD §8). Meme patron que radier/index.ts.
 *
 * --- ANTI-FUITE (DoD §8) ---
 * On CONSTRUIT champ a champ un objet propre ne portant QUE les diagnostics globaux
 * (tassements en mm, moments/reactions, bilans, cote d'assise, nb de nœuds decolles) ;
 * TOUS les champs NODAUX (`X`/`w`/`p`/`M`/`V`) et la TOPOLOGIE (`nn`/`dx`/`EI`/`iters`)
 * sont ECARTES ici, puis re-strippes par projectEngineOutput a travers le schema
 * `.strict()` (defense en profondeur — un champ interdit qui aurait survecu FAIT LEVER).
 */
import {
  projectEngineOutput,
  type EngineResultEnvelope,
  type EngineVersion,
  type EngineSourceHash,
} from '@roadsen/shared';

import { findEngine } from '../registry/registry.js';

import {
  PLANE_STRAIN_ENGINE_ID,
  PlaneStrainInputSchema,
  PlaneStrainOutputSchema,
  planeStrainContract,
  type PlaneStrainInput,
  type PlaneStrainOutput,
} from './contract.js';
import { computePlaneStrain } from './engine.js';

export {
  PLANE_STRAIN_ENGINE_ID,
  PlaneStrainInputSchema,
  PlaneStrainOutputSchema,
  planeStrainContract,
  type PlaneStrainInput,
  type PlaneStrainOutput,
};
export { PLANE_STRAIN_CONFIDENTIAL_MARKER } from './engine.js';
export { PLANE_STRAIN_FIXTURES, type PlaneStrainFixture } from './test-fixtures.js';

/** Garde booleen : valeur numerique finie utilisable. */
function fin(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * ALLOWLIST des etiquettes dont la valeur `= <nombre>` est BENIGNE (jamais redactee) —
 * FAIL-CLOSED (patron #48/#54 : inconnu => masque). Ne contient QUE les diagnostics
 * DEJA exposes + des libelles geometriques/de saisie legitimes. Les intermediaires EF
 * (champs nodaux, rigidite EI, pas dx) ne sont PAS listes -> masques par defaut.
 *
 * NB : le moteur plane-strain ne POSE AUCUN champ `warn` dans son `R` -> `warnings`
 * ressort STRUCTURELLEMENT VIDE en fonctionnement normal. Cette redaction est une
 * defense en profondeur pour une evolution future, pas le correctif d'une fuite averee.
 */
const BENIGN_VALUE_LABELS: ReadonlySet<string> = new Set([
  // Diagnostics exposes au PV.
  'wmax',
  'wmin',
  'diff',
  'mmax',
  'mmin',
  'pmax',
  'totalload',
  'sumreact',
  'z0',
  'decoln',
  // Geometrie / saisie legitime (non confidentielle).
  'bw',
  'e',
  'nu',
  'ne',
  'q',
  'x',
  'p',
  'd',
  'foundd',
]);

/** Normalise une etiquette : minuscules + retrait des indices/apostrophes/separateurs. */
function normalizeLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ₐ|ₑ|ₒ|ₓ|ₕ|ₖ|ₗ|ₘ|ₙ|ₚ|ₛ|ₜ/g, (m) => {
      const map: Record<string, string> = {
        ['ₐ']: 'a',
        ['ₑ']: 'e',
        ['ₒ']: 'o',
        ['ₓ']: 'x',
        ['ₕ']: 'h',
        ['ₖ']: 'k',
        ['ₗ']: 'l',
        ['ₘ']: 'm',
        ['ₙ']: 'n',
        ['ₚ']: 'p',
        ['ₛ']: 's',
        ['ₜ']: 't',
      };
      return map[m] ?? '';
    })
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Redacte FAIL-CLOSED toute valeur `<token> = <nombre> [unite]` dont le token n'est PAS
 * dans l'ALLOWLIST benigne. Inconnu => masque. Tolere l'espace fin insecable FR.
 */
export function redactConfidentialWarning(text: string): string {
  const TOKEN = "([A-Za-z0-9\\u2090-\\u209c'\\u2019,/*_\\[\\]]+)";
  const valued = new RegExp(
    TOKEN + '\\s*=\\s*(-?[0-9][0-9.,e \\u202f\\s+-]*(?:MPa|kPa|kN|MN|mm|cm|m|rad)?)',
    'g',
  );
  return text.replace(valued, (whole, token: string) => {
    const norm = normalizeLabel(token);
    if (norm !== '' && BENIGN_VALUE_LABELS.has(norm)) {
      return whole;
    }
    return `${token} (valeur confidentielle masquee)`;
  });
}

/** Applique la redaction a TOUS les warnings (point de passage oblige). */
export function redactConfidentialWarnings(warnings: readonly string[]): string[] {
  return warnings.map((w) => redactConfidentialWarning(w));
}

/** Sortie vide (tous diagnostics a zero) — cas d'erreur de garde du moteur. */
const EMPTY_OUTPUT = {
  wMax: 0,
  wMin: 0,
  diff: 0,
  mMax: 0,
  mMin: 0,
  pMax: 0,
  totalLoad: 0,
  sumReact: 0,
  z0: 0,
  decolN: 0,
} as const;

/**
 * Re-FORME le resultat brut `R` en la SORTIE whitelistee : VALEURS de DIAGNOSTIC GLOBAL
 * uniquement. On CONSTRUIT un objet propre champ a champ (jamais de copie brute) : tous
 * les champs NODAUX (`X`/`w`/`p`/`M`/`V`) et la TOPOLOGIE (`nn`/`dx`/`EI`/`iters`) sont
 * ECARTES ici (non lus). `diff` est recalcule (wMax - wMin) — grandeur derivee benigne.
 */
function shapeOutput(R: Record<string, unknown>): unknown {
  if (typeof R.err === 'string') {
    return { erreur: redactConfidentialWarning(R.err), warnings: [], ...EMPTY_OUTPUT };
  }
  const warnings = redactConfidentialWarnings(
    Array.isArray(R.warn) ? R.warn.filter((w): w is string => typeof w === 'string') : [],
  );
  const wMax = fin(R.wMax) ? R.wMax : 0;
  const wMin = fin(R.wMin) ? R.wMin : 0;
  return {
    erreur: null,
    warnings,
    wMax,
    wMin,
    diff: wMax - wMin,
    mMax: fin(R.mMax) ? R.mMax : 0,
    mMin: fin(R.mMin) ? R.mMin : 0,
    pMax: fin(R.pMax) ? R.pMax : 0,
    totalLoad: fin(R.totalLoad) ? R.totalLoad : 0,
    sumReact: fin(R.sumReact) ? R.sumReact : 0,
    z0: fin(R.z0) ? R.z0 : 0,
    decolN: fin(R.decolN) ? R.decolN : 0,
  };
}

/** Resolution de la meta de version (depuis le registre). */
function resolveMeta(): {
  engineId: typeof PLANE_STRAIN_ENGINE_ID;
  engineVersion: EngineVersion;
  engineSourceHash?: EngineSourceHash;
} {
  const entry = findEngine(PLANE_STRAIN_ENGINE_ID);
  if (!entry) {
    throw new Error(
      `Moteur "${PLANE_STRAIN_ENGINE_ID}" absent du registre des versions.`,
    );
  }
  return {
    engineId: PLANE_STRAIN_ENGINE_ID,
    engineVersion: entry.version as EngineVersion,
    engineSourceHash: entry.sha256 as EngineSourceHash,
  };
}

/**
 * Calcul deformations planes client-safe : valide l'entree, recalcule cote serveur,
 * projette la sortie sur la whitelist (diagnostics globaux), renvoie l'enveloppe
 * { ok, meta, output }.
 */
export function runPlaneStrain(
  rawInput: unknown,
): EngineResultEnvelope<PlaneStrainOutput> {
  const input: PlaneStrainInput = PlaneStrainInputSchema.parse(rawInput);
  const rawResult = computePlaneStrain(input, input.opts) as Record<string, unknown>;
  const shaped = shapeOutput(rawResult);
  const output = projectEngineOutput(PlaneStrainOutputSchema, shaped);
  return { ok: true, meta: resolveMeta(), output };
}

void planeStrainContract; // garde l'import du contrat (verifie anti-passthrough au chargement)
