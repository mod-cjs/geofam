/**
 * Adaptateurs — mapping ligne Prisma (backend) vers types front ROADSEN.
 *
 * Le backend renvoie les lignes brutes Prisma : `input`/`output`/`engineId`/`status`…
 * Ces fonctions normalisent vers les types front (CalcResult, OfficialPv, etc.)
 * sans aucune logique de calcul côté client.
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 */

import type {
  CalcResult,
  CalcStatus,
  CalcOutputRow,
  NormalizedCalcOutput,
  OfficialPv,
  EntitlementsResponse,
  Project,
  ProjectDomain,
  LoginResponse,
} from './types';

// ---------------------------------------------------------------------------
// Formes Prisma brutes (telles qu'envoyées par le backend)
// ---------------------------------------------------------------------------

export interface PrismaCalcResult {
  id: string;
  projectId: string;
  orgId: string;
  engineId: string;
  /**
   * ⚠️ Forme RÉELLE du backend `GET /projects/:id/calc-results` :
   * `status`/`label`/`domain`/`updatedAt` NE sont PAS renvoyés (clés réelles :
   * userId, engineVersion, engineSourceHash, input, output, createdAt). On les
   * déclare optionnels et on DÉRIVE ce qui manque (cf. adaptCalcResult), tout en
   * restant compatible avec les fixtures de test qui les fournissent encore.
   */
  label?: string;
  domain?: string;
  status?: string;
  userId?: string;
  engineVersion?: string;
  engineSourceHash?: string;
  /** Paramètres d'entrée du calcul */
  input: unknown;
  /** Résultat du moteur */
  output: unknown | null;
  pvId?: string | null;
  createdAt: string;
  updatedAt?: string;
}

/** Forme RÉELLE du backend : tout est imbriqué sous `pv`, + `sealValid` au top-level. */
export interface PrismaOfficialPv {
  pv: {
    id: string;
    orgId: string;
    calcResultId: string;
    projectId: string;
    pvNumber: string;
    userId: string;
    projectName: string;
    engineId: string;
    engineVersion: string;
    engineSourceHash: string;
    inputCanonical: string; // JSON canonique des entrées
    output: unknown;
    scienceStatus: string;
    verdict: string;
    contentHash: string;
    hmac: string; // sceau HMAC complet (serveur)
    sealedAt: string;
  };
  sealValid?: boolean;
}

export interface PrismaProject {
  id: string;
  orgId: string;
  name: string;
  description?: string | null;
  domain: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface BackendLoginResponse {
  accessToken: string;
  refreshToken: string;
  // Le backend /auth/login réel ne renvoie PAS de `user` (id = claim `sub` du JWT,
  // email/name via /auth/me). Optionnel pour ne pas casser l'adaptation.
  user?: {
    id: string;
    email: string;
    name: string;
  };
}

export interface BackendEntitlements {
  orgId: string;
  pack: string;
  modules: string[];
  expiresAt: string;
  expired: boolean;
  quota: {
    limit: number;
    used: number;
    remaining: number;
  };
  serverTime: string;
}

// ---------------------------------------------------------------------------
// CalcResult — input/output Prisma → params/output front
// ---------------------------------------------------------------------------

const CALC_STATUSES: readonly CalcStatus[] = ['DRAFT', 'PENDING', 'DONE', 'ERROR'];

function isCalcStatus(v: unknown): v is CalcStatus {
  return typeof v === 'string' && (CALC_STATUSES as readonly string[]).includes(v);
}

/**
 * Statut DÉRIVÉ de la sortie (le backend ne renvoie pas de champ `status`) :
 *  - sortie présente sans `erreur`   ⇒ DONE  (la science a abouti)
 *  - sortie présente avec `erreur≠null` ⇒ ERROR (science levée, message borné)
 *  - pas de sortie ⇒ statut backend s'il est fourni & valide, sinon neutre PENDING
 */
function deriveCalcStatus(raw: PrismaCalcResult): CalcStatus {
  const out = raw.output;
  if (out != null && typeof out === 'object') {
    const erreur = (out as { erreur?: unknown }).erreur;
    return erreur != null ? 'ERROR' : 'DONE';
  }
  if (isCalcStatus(raw.status)) return raw.status;
  return 'PENDING';
}

/** engineId (forme canonique OU courte) → domaine de projet. Fallback prudent. */
const ENGINE_TO_DOMAIN: Record<string, ProjectDomain> = {
  'chaussee-burmister': 'CH',
  burmister: 'CH',
  terzaghi: 'FD',
  casagrande: 'FD',
  geoplaque: 'FD',
  pressiometre: 'LB',
  fastlab: 'LB',
};

function deriveDomain(raw: PrismaCalcResult): ProjectDomain {
  if (raw.domain === 'CH' || raw.domain === 'FD' || raw.domain === 'LB') return raw.domain;
  return ENGINE_TO_DOMAIN[raw.engineId] ?? 'CH';
}

/** Nombre fini, sinon null (garde-fou anti-NaN à l'affichage). */
function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function pushRow(
  rows: CalcOutputRow[],
  label: string,
  value: unknown,
  unit: string,
  status?: 'ok' | 'fail',
): void {
  const n = finiteOrNull(value);
  if (n === null) return; // valeur absente/null/NaN → ligne omise (jamais de "NaN" affiché)
  rows.push(status ? { label, value: n, unit, status } : { label, value: n, unit });
}

/**
 * CONTRAT client-safe du moteur chaussee-burmister.
 *
 * Construit les lignes affichables UNIQUEMENT à partir des champs whitelistés
 * par `BurmisterOutputSchema` (engines), qui sont déjà strippés côté serveur de
 * tout intermédiaire confidentiel (tenseur de contraintes, coefficients de
 * calage kr/ks/kc/Sh/b/ε₆, ABCD du propagateur). Défense en profondeur : même si
 * un champ confidentiel survivait au strip serveur, il N'apparaîtrait PAS ici car
 * on ne lit que des clés NOMMÉES (fail-closed — pas de copie d'objet brut).
 *
 * Inclus (grandeurs de RÉSULTAT d'ingénierie) : NE, épaisseurs, déformation/
 * contrainte sollicitante vs admissible (fatigue + orniérage) + verdict/critère.
 * Exclus : `famille` (libellé citant une §méthode — fail-closed, non rendu par le
 * panneau ; réouverture = décision explicite), `warnings`/`erreur` (texte libre,
 * canal séparé), `conforme` (porté par le verdict, pas une ligne numérique).
 */
function buildBurmisterRows(o: Record<string, unknown>): CalcOutputRow[] {
  const rows: CalcOutputRow[] = [];

  pushRow(rows, 'Trafic cumulé (NE)', o.NE, 'essieux éq.');
  pushRow(rows, 'Épaisseur totale', o.epaisseurTotale, 'm');
  pushRow(rows, 'Épaisseur de couches liées', o.epaisseurLiee, 'm');

  const f = o.fatigue;
  if (f != null && typeof f === 'object') {
    const fa = f as { rigide?: unknown; valeur?: unknown; admissible?: unknown; ok?: unknown };
    const rigide = fa.rigide === true;
    const unit = rigide ? 'MPa' : 'μdef';
    const fok: 'ok' | 'fail' = fa.ok === true ? 'ok' : 'fail';
    pushRow(
      rows,
      rigide ? 'Contrainte sollicitante σ_t' : 'Déformation sollicitante ε_t',
      fa.valeur,
      unit,
      fok,
    );
    pushRow(
      rows,
      rigide ? 'Contrainte admissible σ_t,adm' : 'Déformation admissible ε_t,adm',
      fa.admissible,
      unit,
    );
  }

  const orn = o.ornierage;
  if (orn != null && typeof orn === 'object') {
    const oa = orn as { valeur?: unknown; admissible?: unknown; ok?: unknown };
    const ok: 'ok' | 'fail' = oa.ok === true ? 'ok' : 'fail';
    pushRow(rows, 'Déformation ε_z sollicitante (PSC)', oa.valeur, 'μdef', ok);
    pushRow(rows, 'Déformation ε_z admissible', oa.admissible, 'μdef');
  }

  return rows;
}

/**
 * Re-whiteliste un tableau de lignes : ne garde QUE `{label, value, unit, status?}`
 * par ligne, jamais de spread du brut. Toute ligne incomplète/non finie est écartée.
 */
function sanitizeRows(rows: unknown): CalcOutputRow[] {
  if (!Array.isArray(rows)) return [];
  const out: CalcOutputRow[] = [];
  for (const r of rows) {
    if (r == null || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const value = finiteOrNull(o.value);
    if (value === null || typeof o.label !== 'string' || typeof o.unit !== 'string') continue;
    const status = o.status === 'ok' || o.status === 'fail' ? o.status : undefined;
    out.push(status ? { label: o.label, value, unit: o.unit, status } : { label: o.label, value, unit: o.unit });
  }
  return out;
}

/**
 * Normalise la sortie moteur vers la forme attendue par l'UI ({verdict, rows}).
 *
 * STRICTEMENT FAIL-CLOSED (DoD §8) — ne renvoie JAMAIS l'objet brut : la sortie
 * moteur peut contenir des intermédiaires/méthode/coefficients/warnings
 * confidentiels, et tous les moteurs (terzaghi/casagrande/geoplaque/pressiometre/
 * fastlab) sont sélectionnables.
 *  - null / non-objet                         → null
 *  - sortie BRUTE burmister (`conforme:boolean`) → {verdict, rows} whitelistées
 *  - sortie déjà normalisée (`verdict:string` + `rows:[]`) → re-whitelistée via
 *    `sanitizeRows` (re-projetée, jamais copiée telle quelle)
 *  - moteur NON reconnu                        → null (AUCUNE donnée brute exposée)
 *
 * SUIVI Phase 1 : les moteurs fondations/labo afficheront « résultat non
 * affichable » tant qu'un builder whitelisté dédié (`buildTerzaghiRows`…) n'existe
 * pas — comportement correct (mieux vaut rien afficher que fuiter la science).
 */
function normalizeOutput(output: unknown): NormalizedCalcOutput | null {
  if (output == null || typeof output !== 'object') return null;
  const o = output as Record<string, unknown>;
  if (typeof o.conforme === 'boolean') {
    return { verdict: o.conforme === true ? 'PASS' : 'FAIL', rows: buildBurmisterRows(o) };
  }
  if (typeof o.verdict === 'string' && Array.isArray(o.rows)) {
    return { verdict: o.verdict === 'PASS' ? 'PASS' : 'FAIL', rows: sanitizeRows(o.rows) };
  }
  // Moteur non reconnu : fail-closed, aucune sortie brute ne traverse vers le navigateur.
  return null;
}

export function adaptCalcResult(raw: PrismaCalcResult): CalcResult {
  return {
    id: raw.id,
    projectId: raw.projectId,
    orgId: raw.orgId,
    engineId: raw.engineId,
    // Le backend réel ne renvoie pas de `label` : repli sur l'engineId.
    label: raw.label ?? raw.engineId,
    domain: deriveDomain(raw),
    // Le backend réel ne renvoie pas de `status` : on le DÉRIVE de la sortie.
    status: deriveCalcStatus(raw),
    // Le backend nomme le champ "input", le front "params"
    params: (raw.input ?? {}) as Record<string, unknown>,
    // Sortie normalisée client-safe ({verdict, rows}) — fail-closed.
    output: normalizeOutput(raw.output),
    pvId: raw.pvId ?? undefined,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt ?? raw.createdAt,
  };
}

export function adaptCalcResults(raws: PrismaCalcResult[]): CalcResult[] {
  return raws.map(adaptCalcResult);
}

// ---------------------------------------------------------------------------
// OfficialPv — backend { pv, sealHash, sealValid } → type front
// ---------------------------------------------------------------------------

export function adaptOfficialPv(raw: PrismaOfficialPv): OfficialPv {
  const p = raw.pv;
  let params: Record<string, unknown> = {};
  try {
    params = JSON.parse(p.inputCanonical ?? '{}') as Record<string, unknown>;
  } catch {
    /* inputCanonical illisible : params vide, jamais de crash */
  }
  return {
    id: p.id,
    number: p.pvNumber,
    orgId: p.orgId,
    projectId: p.projectId,
    calcResultId: p.calcResultId,
    engineId: p.engineId,
    // 8 premiers caractères du HMAC (jamais le sceau complet côté navigateur)
    hmacTruncated: (p.hmac ?? '').slice(0, 8),
    sealedAt: p.sealedAt,
    sealedBy: p.userId,
    pdfUrl: undefined,
    params,
    output: p.output ?? null,
  };
}

export function adaptOfficialPvs(raws: PrismaOfficialPv[]): OfficialPv[] {
  return raws.map(adaptOfficialPv);
}

// ---------------------------------------------------------------------------
// Project — normalisation du domain
// ---------------------------------------------------------------------------

export function adaptProject(raw: PrismaProject): Project {
  return {
    id: raw.id,
    orgId: raw.orgId,
    name: raw.name,
    description: raw.description ?? undefined,
    domain: raw.domain as ProjectDomain,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    createdBy: raw.createdBy,
  };
}

export function adaptProjects(raws: PrismaProject[]): Project[] {
  return raws.map(adaptProject);
}

// ---------------------------------------------------------------------------
// Login — re-export direct (même forme)
// ---------------------------------------------------------------------------

export function adaptLoginResponse(raw: BackendLoginResponse): LoginResponse {
  // ⚠️ Le backend ne renvoie pas de `user` : lire `raw.user.*` sans garde levait une
  // exception → storeTokens jamais atteint → cookie jamais posé → login bloqué (rebond
  // /login). On dérive l'id depuis le claim `sub` du JWT ; email/name via /auth/me ensuite.
  let userId = '';
  try {
    const part = raw.accessToken.split('.')[1] ?? '';
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    userId = ((JSON.parse(json) as { sub?: string })?.sub ?? '') as string;
  } catch {
    /* token illisible : id vide, le login passe quand même */
  }
  return {
    accessToken: raw.accessToken,
    refreshToken: raw.refreshToken,
    user: raw.user ?? { id: userId, email: '', name: '' },
  };
}

// ---------------------------------------------------------------------------
// Entitlements — re-export direct (même forme ADR 0011)
// ---------------------------------------------------------------------------

export function adaptEntitlements(raw: BackendEntitlements): EntitlementsResponse {
  return {
    orgId: raw.orgId,
    pack: raw.pack as EntitlementsResponse['pack'],
    modules: raw.modules,
    expiresAt: raw.expiresAt,
    expired: raw.expired,
    quota: {
      limit: raw.quota.limit,
      used: raw.quota.used,
      remaining: raw.quota.remaining,
    },
    serverTime: raw.serverTime,
  };
}
