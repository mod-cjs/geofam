/**
 * Module CALIBRAGE PRESSIOMETRIQUE (forage indeformable, `calcCalibrage`) — point
 * d'entree PUR & client-safe.
 *
 * Chaine : entree validee -> moteur d'origine (computeCalibrage) -> PROJECTION du
 * resultat brut `e` sur la sortie whitelistee (contract.ts : COEFFICIENT metier +
 * VERDICTS uniquement) -> enveloppe de resultat (meta + output). Aucun DOM, aucune
 * horloge, aucun hasard.
 *
 * Importe UNIQUEMENT par apps/api (recalcul serveur). Le front ne voit que les TYPES du
 * contrat via @roadsen/shared, jamais ce module (garde-fou ESLint + controle de bundle
 * CI, DoD §8). Meme patron que axi/index.ts (sortie = scalaires, pas de canal texte).
 *
 * --- ANTI-FUITE (DoD §8) ---
 * On CONSTRUIT champ a champ un objet propre ne portant QUE a / R² / RMS ; les
 * intermediaires de regression (`pts`, `residuals`, coefficients polynomiaux
 * `c0`/`c1`/`c2`) sont ECARTES ici (non lus), puis re-strippes par projectEngineOutput
 * a travers le schema `.strict()` (defense en profondeur — un champ interdit qui aurait
 * survecu FAIT LEVER). Les coefficients c0/c1/c2 (courbe de calibrage = methode) ne
 * doivent JAMAIS sortir.
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
  PressioCalibrageInputSchema,
  PressioCalibrageOutputSchema,
  pressioCalibrageContract,
  PRESSIO_CALIBRAGE_ENGINE_ID,
  type PressioCalibrageInput,
  type PressioCalibrageOutput,
} from './contract.js';
import { computeCalibrage } from './engine.js';

export {
  PressioCalibrageInputSchema,
  PressioCalibrageOutputSchema,
  pressioCalibrageContract,
  PRESSIO_CALIBRAGE_ENGINE_ID,
  type PressioCalibrageInput,
  type PressioCalibrageOutput,
};
export { PRESSIO_CALIBRAGE_CONFIDENTIAL_MARKER } from './engine.js';
export {
  PRESSIO_CALIBRAGE_FIXTURES,
  type PressioCalibrageFixture,
} from './test-fixtures.js';

/** Garde booleen : valeur numerique finie utilisable. */
function fin(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** Resolution de la meta de version (depuis le registre). */
function resolveMeta(): {
  engineId: typeof PRESSIO_CALIBRAGE_ENGINE_ID;
  engineVersion: EngineVersion;
  engineSourceHash?: EngineSourceHash;
} {
  const entry = findEngine(PRESSIO_CALIBRAGE_ENGINE_ID);
  if (!entry) {
    throw new Error(
      `Moteur "${PRESSIO_CALIBRAGE_ENGINE_ID}" absent du registre des versions.`,
    );
  }
  return {
    engineId: PRESSIO_CALIBRAGE_ENGINE_ID,
    engineVersion: entry.version as EngineVersion,
    engineSourceHash: entry.sha256 as EngineSourceHash,
  };
}

/**
 * Calcul de calibrage client-safe : valide l'entree, recalcule cote serveur, projette la
 * sortie sur la whitelist (coefficient metier + verdicts), renvoie l'enveloppe { ok, meta,
 * output }. Sur garde du moteur (`R.err`), renvoie `{ ok:false }` avec un SafeEngineError
 * borne (aucun intermediaire) — RIEN n'est scelle (fail-closed).
 */
export function runPressioCalibrage(
  rawInput: unknown,
): EngineResultEnvelope<PressioCalibrageOutput> {
  const input: PressioCalibrageInput =
    PressioCalibrageInputSchema.parse(rawInput);
  const R = computeCalibrage(input) as Record<string, unknown>;
  const meta = resolveMeta();

  if (typeof R.err === 'string') {
    return { ok: false, meta, error: toSafeEngineError(R.err) };
  }

  // Construction champ a champ : UNIQUEMENT coefficient metier + verdicts (aucun c0/c1/c2).
  const shaped = {
    a: fin(R.a_calib) ? R.a_calib : 0,
    R2: fin(R.R2) ? R.R2 : 0,
    rms: fin(R.rms) ? R.rms : 0,
  };
  const output = projectEngineOutput(PressioCalibrageOutputSchema, shaped);
  return { ok: true, meta, output };
}

void pressioCalibrageContract; // garde l'import du contrat (verifie anti-passthrough au chargement)
