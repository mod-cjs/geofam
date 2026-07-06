/**
 * Module RADIER TRIANGULAIRE (DKT) sur sol multicouche elastique (variante mailleur
 * triangulaire de GEOPLAQUE, `solveTriRaft`) — point d'entree PUR & client-safe.
 *
 * Chaine : entree validee -> moteur d'origine (computeTriRaft) -> PROJECTION du resultat
 * brut `R` sur la sortie whitelistee (contract.ts : DIAGNOSTICS GLOBAUX uniquement) ->
 * enveloppe de resultat (meta + output). Aucun DOM, aucune horloge, aucun hasard.
 *
 * Importe UNIQUEMENT par apps/api (recalcul serveur). Le front ne voit que les TYPES du
 * contrat via @roadsen/shared, jamais ce module (garde-fou ESLint + controle de bundle
 * CI, DoD §8). Meme patron que radier/index.ts.
 *
 * --- ANTI-FUITE (DoD §8) ---
 * On CONSTRUIT champ a champ un objet propre ne portant QUE les diagnostics globaux
 * (tassements en mm, reaction sol max, bilans charge/reaction, nb de plaques, cote
 * d'assise) ; les CHAMPS NODAUX (`w`/`p`) et surtout la TOPOLOGIE DE MAILLAGE (`P` =
 * coordonnees des nœuds, `tris` = connectivite, `N`/`nt` = densite du maillage) sont
 * ECARTES ici, puis re-strippes par projectEngineOutput a travers le schema `.strict()`.
 *
 * --- DIVERGENCE SCIENTIFIQUE (a documenter cote UI) ---
 * Ce solveur IGNORE les charges `on:'soil'` (pas de tassement champ-libre) et les moments
 * Mx/My (effort vertical Fz seul), contrairement au radier ACM (solveModel). L'etat est
 * conserve pour fidelite de portage, mais l'UI doit signaler que ces composantes ne sont
 * PAS prises en compte par ce mode.
 */
import {
  projectEngineOutput,
  type EngineResultEnvelope,
  type EngineVersion,
  type EngineSourceHash,
} from '@roadsen/shared';

import { findEngine } from '../registry/registry.js';

import {
  TRI_RAFT_ENGINE_ID,
  TriRaftInputSchema,
  TriRaftOutputSchema,
  triRaftContract,
  type TriRaftInput,
  type TriRaftOutput,
} from './contract.js';
import { computeTriRaft } from './engine.js';

export {
  TRI_RAFT_ENGINE_ID,
  TriRaftInputSchema,
  TriRaftOutputSchema,
  triRaftContract,
  type TriRaftInput,
  type TriRaftOutput,
};
export { TRI_RAFT_CONFIDENTIAL_MARKER } from './engine.js';
export { TRI_RAFT_FIXTURES, type TriRaftFixture } from './test-fixtures.js';

/** Garde booleen : valeur numerique finie utilisable. */
function fin(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * ALLOWLIST des etiquettes dont la valeur `= <nombre>` est BENIGNE (jamais redactee) —
 * FAIL-CLOSED (inconnu => masque). Diagnostics exposes + libelles geometriques/de saisie.
 * Les intermediaires EF (champs nodaux, coordonnees de nœuds) ne sont PAS listes.
 * NB : le moteur ne pose AUCUN champ `warn` -> `warnings` structurellement vide ; la
 * redaction est une defense en profondeur.
 */
const BENIGN_VALUE_LABELS: ReadonlySet<string> = new Set([
  // Diagnostics exposes au PV.
  'wmax',
  'wmin',
  'diff',
  'reactionmax',
  'totalload',
  'sumreact',
  'nraft',
  'z0',
  // Geometrie / saisie legitime.
  'target',
  'e',
  'nu',
  'q',
  'x',
  'y',
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
 * dans l'ALLOWLIST benigne. Inconnu => masque.
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
  reactionMax: 0,
  totalLoad: 0,
  sumReact: 0,
  nRaft: 0,
  z0: 0,
} as const;

/**
 * Re-FORME le resultat brut `R` en la SORTIE whitelistee : VALEURS de DIAGNOSTIC GLOBAL
 * uniquement. On CONSTRUIT un objet propre champ a champ (jamais de copie brute) : les
 * champs NODAUX (`w`/`p`) et la TOPOLOGIE (`P`/`tris`/`N`/`nt`) sont ECARTES ici (non
 * lus). `diff` est recalcule (wMax - wMin) ; `reactionMax` = `pMax` (renomme).
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
    reactionMax: fin(R.pMax) ? R.pMax : 0,
    totalLoad: fin(R.totalLoad) ? R.totalLoad : 0,
    sumReact: fin(R.sumReact) ? R.sumReact : 0,
    nRaft: fin(R.nRaft) ? R.nRaft : 0,
    z0: fin(R.z0) ? R.z0 : 0,
  };
}

/** Resolution de la meta de version (depuis le registre). */
function resolveMeta(): {
  engineId: typeof TRI_RAFT_ENGINE_ID;
  engineVersion: EngineVersion;
  engineSourceHash?: EngineSourceHash;
} {
  const entry = findEngine(TRI_RAFT_ENGINE_ID);
  if (!entry) {
    throw new Error(`Moteur "${TRI_RAFT_ENGINE_ID}" absent du registre des versions.`);
  }
  return {
    engineId: TRI_RAFT_ENGINE_ID,
    engineVersion: entry.version as EngineVersion,
    engineSourceHash: entry.sha256 as EngineSourceHash,
  };
}

/**
 * Calcul radier triangulaire client-safe : valide l'entree, recalcule cote serveur,
 * projette la sortie sur la whitelist (diagnostics globaux), renvoie l'enveloppe
 * { ok, meta, output }.
 */
export function runTriRaft(rawInput: unknown): EngineResultEnvelope<TriRaftOutput> {
  const input: TriRaftInput = TriRaftInputSchema.parse(rawInput);
  const rawResult = computeTriRaft(input, input.opts) as Record<string, unknown>;
  const shaped = shapeOutput(rawResult);
  const output = projectEngineOutput(TriRaftOutputSchema, shaped);
  return { ok: true, meta: resolveMeta(), output };
}

void triRaftContract; // garde l'import du contrat (verifie anti-passthrough au chargement)
