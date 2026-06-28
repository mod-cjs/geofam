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
  label: string;
  domain: string;
  status: string;
  /** Paramètres d'entrée du calcul */
  input: unknown;
  /** Résultat du moteur */
  output: unknown | null;
  pvId?: string | null;
  createdAt: string;
  updatedAt: string;
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

export function adaptCalcResult(raw: PrismaCalcResult): CalcResult {
  return {
    id: raw.id,
    projectId: raw.projectId,
    orgId: raw.orgId,
    engineId: raw.engineId,
    label: raw.label,
    domain: raw.domain as ProjectDomain,
    status: raw.status as CalcStatus,
    // Le backend nomme le champ "input", le front "params"
    params: (raw.input ?? {}) as Record<string, unknown>,
    output: raw.output ?? null,
    pvId: raw.pvId ?? undefined,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
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
