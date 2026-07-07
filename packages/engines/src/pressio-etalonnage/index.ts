/**
 * Module ETALONNAGE PRESSIOMETRIQUE (sonde dans l'air, `calcEtalonnage`) — point
 * d'entree PUR & client-safe.
 *
 * Chaine : entree validee -> moteur d'origine (computeEtalonnage) -> PROJECTION du
 * resultat brut `e` sur la sortie whitelistee (contract.ts : COEFFICIENTS + VERDICTS
 * uniquement) -> enveloppe de resultat (meta + output). Aucun DOM, aucune horloge,
 * aucun hasard.
 *
 * Importe UNIQUEMENT par apps/api (recalcul serveur). Le front ne voit que les TYPES du
 * contrat via @roadsen/shared, jamais ce module (garde-fou ESLint + controle de bundle
 * CI, DoD §8). Meme patron que axi/index.ts (sortie = scalaires, pas de canal texte).
 *
 * --- ANTI-FUITE (DoD §8) ---
 * On CONSTRUIT champ a champ un objet propre ne portant QUE Vs / Pe / a / R² / RMS ;
 * les intermediaires de regression (`pts`, `residuals`, `V_pe`, `Vs_reel`) sont ECARTES
 * ici (non lus), puis re-strippes par projectEngineOutput a travers le schema `.strict()`
 * (defense en profondeur — un champ interdit qui aurait survecu FAIT LEVER).
 *
 * --- DIVERGENCE ASSUMEE vs radier (fail-closed) ---
 * Le contrat n'a PAS de champ `erreur`/`warnings` (sortie = scalaires purs). Une garde du
 * moteur (< 3 points) ne peut donc PAS etre encodee dans `output` sans produire un objet
 * de ZEROS « ok:true » scellable en PV (anti-patron). On renvoie alors une enveloppe
 * `{ ok:false }` (SafeEngineError borne) : RIEN n'est persiste. Au contrat, `runX` REJETTE
 * deja les entrees < 3 points (rows.min(3) => ZodError) ; seul un appel direct au moteur
 * (test) emprunte le chemin `R.err`.
 */
import {
  projectEngineOutput,
  toSafeEngineError,
  type EngineResultEnvelope,
  type EngineVersion,
  type EngineSourceHash,
} from '@roadsen/shared';

import { findEngine } from '../registry/registry.js';

import {
  PressioEtalonnageInputSchema,
  PressioEtalonnageOutputSchema,
  pressioEtalonnageContract,
  PRESSIO_ETALONNAGE_ENGINE_ID,
  type PressioEtalonnageInput,
  type PressioEtalonnageOutput,
} from './contract.js';
import { computeEtalonnage } from './engine.js';

export {
  PressioEtalonnageInputSchema,
  PressioEtalonnageOutputSchema,
  pressioEtalonnageContract,
  PRESSIO_ETALONNAGE_ENGINE_ID,
  type PressioEtalonnageInput,
  type PressioEtalonnageOutput,
};
export { PRESSIO_ETALONNAGE_CONFIDENTIAL_MARKER } from './engine.js';
export {
  PRESSIO_ETALONNAGE_FIXTURES,
  type PressioEtalonnageFixture,
} from './test-fixtures.js';

/** Garde booleen : valeur numerique finie utilisable. */
function fin(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** Resolution de la meta de version (depuis le registre). */
function resolveMeta(): {
  engineId: typeof PRESSIO_ETALONNAGE_ENGINE_ID;
  engineVersion: EngineVersion;
  engineSourceHash?: EngineSourceHash;
} {
  const entry = findEngine(PRESSIO_ETALONNAGE_ENGINE_ID);
  if (!entry) {
    throw new Error(
      `Moteur "${PRESSIO_ETALONNAGE_ENGINE_ID}" absent du registre des versions.`,
    );
  }
  return {
    engineId: PRESSIO_ETALONNAGE_ENGINE_ID,
    engineVersion: entry.version as EngineVersion,
    engineSourceHash: entry.sha256 as EngineSourceHash,
  };
}

/**
 * Calcul d'etalonnage client-safe : valide l'entree, recalcule cote serveur, projette la
 * sortie sur la whitelist (coefficients + verdicts), renvoie l'enveloppe { ok, meta,
 * output }. Sur garde du moteur (`R.err`), renvoie `{ ok:false }` avec un SafeEngineError
 * borne (aucun intermediaire) — RIEN n'est scelle (fail-closed).
 */
export function runPressioEtalonnage(
  rawInput: unknown,
): EngineResultEnvelope<PressioEtalonnageOutput> {
  const input: PressioEtalonnageInput =
    PressioEtalonnageInputSchema.parse(rawInput);
  const R = computeEtalonnage(input) as Record<string, unknown>;
  const meta = resolveMeta();

  if (typeof R.err === 'string') {
    return { ok: false, meta, error: toSafeEngineError(R.err) };
  }

  // Construction champ a champ : UNIQUEMENT coefficients + verdicts (aucun intermediaire).
  const shaped = {
    Vs: fin(R.Vs) ? R.Vs : 0,
    Pe: fin(R.Pe) ? R.Pe : 0,
    a: fin(R.a) ? R.a : 0,
    R2: fin(R.R2) ? R.R2 : 0,
    rms: fin(R.rmsError) ? R.rmsError : 0,
  };
  const output = projectEngineOutput(PressioEtalonnageOutputSchema, shaped);
  return { ok: true, meta, output };
}

void pressioEtalonnageContract; // garde l'import du contrat (verifie anti-passthrough au chargement)
