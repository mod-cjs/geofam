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
 * charge totale, tassement differentiel `diff`, resultante `sumReact`, cote d'assise) ;
 * les CHAMPS NODAUX radiaux (`r`/`w`/`p`/`Mr`/`Mt`) et la discretisation (`nn`/`EI`/`D`)
 * restent ECARTES ici, puis re-strippes par projectEngineOutput a travers le schema
 * `.strict()` (defense en profondeur). `diff`/`sumReact` sont des BILANS GLOBAUX affiches
 * par l'outil client (ADR 0014), pas de la methode.
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

export { AxiInputSchema, AxiOutputSchema, AXI_CONTRACT, type AxiInput, type AxiOutput };
export { AXI_CONFIDENTIAL_MARKER } from './engine.js';
export { AXI_FIXTURES, type AxiFixture } from './test-fixtures.js';

/** Identifiant logique = cle de registre (= AXI_CONTRACT.id). */
export const AXI_ENGINE_ID = 'axi-plaque';

/** Garde booleen : valeur numerique finie utilisable. */
function fin(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** Garde : tableau numerique dense ou typed array (les champs nodaux sont des Float64Array). */
function isNumArr(a: unknown): a is ArrayLike<number> {
  return Array.isArray(a) || ArrayBuffer.isView(a);
}

/** Nombre de points d'affichage FIXE des profils radiaux (DECOUPLE du maillage annulaire). */
const PROFILE_POINTS = 97;

/**
 * RE-ECHANTILLONNE un champ nodal radial (`values` aligne sur les rayons `xs`) en un PROFIL
 * de `PROFILE_POINTS` points REGULIERS (interpolation lineaire). On lit les tableaux nodaux
 * EN INTERNE mais on N'EXPOSE QUE le profil : le RESULTAT (l'allure radiale), jamais la
 * discretisation. `undefined` si donnees insuffisantes / etendue nulle.
 */
export function resampleProfile(
  xs: unknown,
  values: unknown,
  label: string,
  unit: string,
): { x: number[]; v: number[]; unit: string; label: string } | undefined {
  if (!isNumArr(xs) || !isNumArr(values)) return undefined;
  const m = Math.min(xs.length, values.length);
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < m; i++) {
    const x = xs[i];
    const v = values[i];
    if (x !== undefined && v !== undefined && fin(x) && fin(v)) pairs.push([x, v]);
  }
  if (pairs.length < 2) return undefined;
  pairs.sort((a, b) => a[0] - b[0]);
  const x0 = pairs[0]![0];
  const x1 = pairs[pairs.length - 1]![0];
  if (!(x1 > x0)) return undefined;
  const X: number[] = new Array(PROFILE_POINTS);
  const V: number[] = new Array(PROFILE_POINTS);
  let j = 0;
  for (let k = 0; k < PROFILE_POINTS; k++) {
    const xk = x0 + ((x1 - x0) * k) / (PROFILE_POINTS - 1);
    while (j < pairs.length - 2 && pairs[j + 1]![0] < xk) j++;
    const [xa, va] = pairs[j]!;
    const [xb, vb] = pairs[j + 1]!;
    const t = xb > xa ? Math.min(1, Math.max(0, (xk - xa) / (xb - xa))) : 0;
    X[k] = xk;
    V[k] = va + t * (vb - va);
  }
  return { x: X, v: V, unit, label };
}

/**
 * Profils radiaux (deflexion/momentR/momentT/reaction) — libelles repris du trace `axiPlot`
 * du client. On lit R.r/R.w/R.Mr/R.Mt/R.p EN INTERNE ; on n'expose que les profils.
 */
function buildProfils(R: Record<string, unknown>): Record<string, unknown> | undefined {
  const specs: ReadonlyArray<readonly [string, unknown, string, string]> = [
    ['deflexion', R.w, 'tassement w', 'mm'],
    ['momentR', R.Mr, 'moment M_r', 'kN·m/m'],
    ['momentT', R.Mt, 'moment M_t', 'kN·m/m'],
    ['reaction', R.p, 'réaction p', 'kPa'],
  ];
  const profils: Record<string, unknown> = {};
  for (const [key, field, label, unit] of specs) {
    const prof = resampleProfile(R.r, field, label, unit);
    if (prof) profils[key] = prof;
  }
  return Object.keys(profils).length > 0 ? profils : undefined;
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
  const wMax = fin(R.wMax) ? R.wMax : 0;
  const wMin = fin(R.wMin) ? R.wMin : 0;
  const profils = buildProfils(R);
  const shaped = {
    wc: fin(R.wc) ? R.wc : 0,
    wEdge: fin(R.wEdge) ? R.wEdge : 0,
    wMax,
    wMin,
    // Tassement differentiel (grandeur derivee benigne) — recalcule ici, ADR 0014.
    diff: wMax - wMin,
    mrMax: fin(R.mrMax) ? R.mrMax : 0,
    mtMax: fin(R.mtMax) ? R.mtMax : 0,
    pMax: fin(R.pMax) ? R.pMax : 0,
    totalLoad: fin(R.totalLoad) ? R.totalLoad : 0,
    // Resultante de reaction Σ (bilan global d'equilibre) — EXPOSEE, ADR 0014.
    sumReact: fin(R.sumReact) ? R.sumReact : 0,
    z0: fin(R.z0) ? R.z0 : 0,
    // Profils radiaux re-echantillonnes (deflexion/momentR/momentT/reaction) — le RESULTAT.
    ...(profils ? { profils } : {}),
  };
  const output = projectEngineOutput(AxiOutputSchema, shaped);
  return { ok: true, meta, output };
}

void AXI_CONTRACT; // garde l'import du contrat (verifie anti-passthrough au chargement)
