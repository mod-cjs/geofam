/**
 * Module AXISYMETRIQUE (plaque annulaire / radier circulaire sur sol multicouche
 * elastique, §2.4.1 de GEOPLAQUE, `solveAxi`) — point d'entree PUR & client-safe.
 *
 * Chaine : entree validee -> moteur d'origine (computeAxi) -> PROJECTION du resultat brut
 * `R` sur la sortie whitelistee (contract.ts : DIAGNOSTICS GLOBAUX uniquement) ->
 * enveloppe de resultat (meta + output). Aucun DOM, aucune horloge, aucun hasard.
 *
 * Importe UNIQUEMENT par apps/api (recalcul serveur). Le front ne voit que les TYPES du
 * contrat via @roadsen/shared, jamais ce module (garde-fou ESLint + controle de bundle
 * CI, DoD §8).
 *
 * --- ANTI-FUITE (DoD §8) ---
 * On CONSTRUIT champ a champ un objet propre ne portant QUE les diagnostics globaux
 * (tassements centre/bord/max/min, moments radial/tangentiel max, reaction sol max,
 * charge totale, cote d'assise) ; les CHAMPS NODAUX radiaux (`r`/`w`/`p`/`Mr`/`Mt`) et
 * la discretisation (`nn`/`EI`/`D`/`sumReact`) sont ECARTES ici, puis re-strippes par
 * projectEngineOutput a travers le schema `.strict()` (defense en profondeur).
 *
 * --- DIVERGENCE ASSUMEE vs radier (fail-closed) ---
 * Le contrat axi n'a PAS de champ `erreur`/`warnings` (sortie = scalaires purs). Une
 * garde/science levee (matrice singuliere) ne peut donc PAS etre encodee dans `output`
 * sans produire un objet de ZEROS « ok:true » scellable en PV (l'anti-patron que les
 * contrats denoncent). On renvoie alors une enveloppe `{ ok:false }` (SafeEngineError
 * borne, aucun intermediaire) : RIEN n'est persiste (cf. calc-results.service). La garde
 * « aucune couche » est deja couverte par le contrat (layers.min(1) => 400) ; seule une
 * singularite numerique rare emprunte ce chemin.
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
  AxiInputSchema,
  AxiOutputSchema,
  AXI_CONTRACT,
  type AxiInput,
  type AxiOutput,
} from './contract.js';
import { computeAxi } from './engine.js';

export {
  AxiInputSchema,
  AxiOutputSchema,
  AXI_CONTRACT,
  type AxiInput,
  type AxiOutput,
};
export { AXI_CONFIDENTIAL_MARKER } from './engine.js';
export { AXI_FIXTURES, type AxiFixture } from './test-fixtures.js';

/** Identifiant logique = cle de registre (= AXI_CONTRACT.id). */
export const AXI_ENGINE_ID = 'axi-plaque';

/** Garde booleen : valeur numerique finie utilisable. */
function fin(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** Resolution de la meta de version (depuis le registre). */
function resolveMeta(): {
  engineId: typeof AXI_ENGINE_ID;
  engineVersion: EngineVersion;
  engineSourceHash?: EngineSourceHash;
} {
  const entry = findEngine(AXI_ENGINE_ID);
  if (!entry) {
    throw new Error(`Moteur "${AXI_ENGINE_ID}" absent du registre des versions.`);
  }
  return {
    engineId: AXI_ENGINE_ID,
    engineVersion: entry.version as EngineVersion,
    engineSourceHash: entry.sha256 as EngineSourceHash,
  };
}

/**
 * Calcul axisymetrique client-safe : valide l'entree, recalcule cote serveur, projette
 * la sortie sur la whitelist (diagnostics globaux scalaires), renvoie l'enveloppe
 * { ok, meta, output }. Sur garde/science levee (`R.err`), renvoie `{ ok:false }` avec un
 * SafeEngineError borne (aucun intermediaire) — RIEN n'est scelle (fail-closed).
 */
export function runAxi(rawInput: unknown): EngineResultEnvelope<AxiOutput> {
  const input: AxiInput = AxiInputSchema.parse(rawInput);
  const R = computeAxi({ layers: input.layers }, input.o) as Record<string, unknown>;
  const meta = resolveMeta();

  if (typeof R.err === 'string') {
    // Pas de champ erreur/warnings au contrat -> enveloppe d'echec (aucun zero scellable).
    return { ok: false, meta, error: toSafeEngineError(R.err) };
  }

  // Construction champ a champ : UNIQUEMENT les diagnostics globaux (aucun tableau nodal).
  const shaped = {
    wc: fin(R.wc) ? R.wc : 0,
    wEdge: fin(R.wEdge) ? R.wEdge : 0,
    wMax: fin(R.wMax) ? R.wMax : 0,
    wMin: fin(R.wMin) ? R.wMin : 0,
    mrMax: fin(R.mrMax) ? R.mrMax : 0,
    mtMax: fin(R.mtMax) ? R.mtMax : 0,
    pMax: fin(R.pMax) ? R.pMax : 0,
    totalLoad: fin(R.totalLoad) ? R.totalLoad : 0,
    z0: fin(R.z0) ? R.z0 : 0,
  };
  const output = projectEngineOutput(AxiOutputSchema, shaped);
  return { ok: true, meta, output };
}

void AXI_CONTRACT; // garde l'import du contrat (verifie anti-passthrough au chargement)
