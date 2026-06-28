/**
 * Client HTTP ROADSEN — vrai backend.
 *
 * Activé uniquement quand NEXT_PUBLIC_API_BASE_URL est posée.
 * Absent de ce chemin → couche mock conservée (client.ts bascule).
 *
 * Fonctionnalités :
 *  - Auth : POST /auth/login, POST /auth/refresh, GET /auth/me
 *  - X-Org-Id : dérivé depuis les claims JWT (ADR 0010) — jamais valeur cliente brute
 *  - Refresh transparent sur 401 access-token expiré
 *  - Gestion 402 (EXPIRED|QUOTA) et 403 (MODULE_NOT_IN_PACK) : erreurs typées
 *  - Mapping Prisma → types front via adapters.ts
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 */

import {
  adaptLoginResponse,
  adaptEntitlements,
  adaptProject,
  adaptProjects,
  adaptCalcResult,
  adaptCalcResults,
  adaptOfficialPv,
  adaptOfficialPvs,
  type PrismaCalcResult,
  type PrismaOfficialPv,
  type PrismaProject,
  type BackendLoginResponse,
  type BackendEntitlements,
} from './adapters';
import type {
  LoginRequest,
  LoginResponse,
  EntitlementsResponse,
  Project,
  CreateProjectRequest,
  CalcResult,
  CalcRequest,
  OfficialPv,
  EmitPvRequest,
  VerifyPvResponse,
  ApiError,
  OrgClaim,
  AccessClaims,
} from './types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE =
  (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_API_BASE_URL : undefined) ??
  '';

const ACCESS_TOKEN_KEY = 'roadsen_access_token';
const REFRESH_TOKEN_KEY = 'roadsen_refresh_token';
const USER_KEY = 'roadsen_user';
const ORGS_KEY = 'roadsen_orgs';

// ---------------------------------------------------------------------------
// Stockage des tokens
//
// Double stockage : sessionStorage (pour l'en-tête Authorization côté client)
// + cookie JS-readable (pour le middleware Edge qui ne peut pas lire sessionStorage).
//
// Nom du cookie : `roadsen_access_token` — identique à la clé sessionStorage.
// max-age=900 s (15 min) aligne sur la TTL type d'un access token.
// SameSite=Strict limite l'exposition CSRF.
//
// DETTE : avant mise en production, passer en cookie httpOnly via un Route Handler
// proxy (l'en-tête Authorization serait alors injecté côté serveur, éliminant
// toute exposition JS du token). Documenté dans ADR 0010.
// ---------------------------------------------------------------------------

const TOKEN_COOKIE_NAME = ACCESS_TOKEN_KEY; // 'roadsen_access_token'

function setTokenCookie(token: string): void {
  if (typeof document === 'undefined') return;
  // JWT ne contient que des caractères base64url + points — pas besoin d'encodage URL.
  document.cookie = `${TOKEN_COOKIE_NAME}=${token}; path=/; SameSite=Strict; max-age=900`;
}

function clearTokenCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${TOKEN_COOKIE_NAME}=; path=/; SameSite=Strict; max-age=0`;
}

function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

function storeTokens(accessToken: string, refreshToken: string): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  // Poser aussi le cookie pour le middleware Edge (mode réel).
  setTokenCookie(accessToken);
}

function clearTokens(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(ORGS_KEY);
  // Effacer le cookie middleware.
  clearTokenCookie();
}

// ---------------------------------------------------------------------------
// Décodage JWT claims (sans vérification de signature — côté client = display only)
// La vérification de signature est faite côté serveur sur chaque appel.
// ---------------------------------------------------------------------------

export function decodeJwtPayload(token: string): AccessClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    // atob fonctionne en navigateur ; Buffer en Node (tests)
    const decoded =
      typeof atob === 'function'
        ? atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
        : Buffer.from(payload, 'base64').toString('utf8');
    return JSON.parse(decoded) as AccessClaims;
  } catch {
    return null;
  }
}

/** Dérive l'orgId depuis le JWT en utilisant l'orgSlug de l'URL. */
export function deriveOrgId(token: string, orgSlug: string): string | null {
  const claims = decodeJwtPayload(token);
  if (!claims?.orgs) return null;
  const org = claims.orgs.find((o: OrgClaim) => o.slug === orgSlug);
  return org?.id ?? null;
}

// ---------------------------------------------------------------------------
// Cache des entitlements — invalidé sur 402/403 et après calcul/PV réussi
// ---------------------------------------------------------------------------

const _entCache = new Map<string, { data: EntitlementsResponse; ts: number }>();
const ENT_TTL_MS = 60_000; // 1 minute

function invalidateEntCache(orgId?: string): void {
  if (orgId) {
    _entCache.delete(orgId);
  } else {
    _entCache.clear();
  }
}

// ---------------------------------------------------------------------------
// Fetch de base avec refresh transparent
// ---------------------------------------------------------------------------

let _refreshing: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      clearTokens();
      return null;
    }
    const data = (await res.json()) as { accessToken: string; refreshToken: string };
    storeTokens(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch {
    clearTokens();
    return null;
  }
}

interface FetchOptions extends RequestInit {
  orgId?: string;
  /** Si true, ne pas retenter sur 401 (évite la boucle infinie) */
  _isRetry?: boolean;
}

async function apiFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const { orgId, _isRetry, ...fetchOpts } = opts;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOpts.headers as Record<string, string> | undefined),
  };

  const token = getAccessToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (orgId) {
    headers['X-Org-Id'] = orgId;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...fetchOpts,
    headers,
  });

  // Refresh transparent sur 401 (access token expiré — pas sur 401 d'identifiants)
  if (res.status === 401 && !_isRetry) {
    if (!_refreshing) {
      _refreshing = doRefresh().finally(() => {
        _refreshing = null;
      });
    }
    const newToken = await _refreshing;
    if (newToken) {
      // Retenter avec le nouveau token
      return apiFetch<T>(path, { ...opts, _isRetry: true });
    }
    // Refresh échoué — erreur 401 remontée
    clearTokens();
  }

  if (!res.ok) {
    let errorBody: Partial<ApiError> = {};
    try {
      errorBody = (await res.json()) as Partial<ApiError>;
    } catch {
      /* corps non JSON */
    }

    const reason = errorBody.reason ?? 'SERVER_ERROR';

    // Invalider le cache entitlements sur 402/403 (quota, expiration, module)
    if (res.status === 402 || res.status === 403) {
      invalidateEntCache(orgId);
    }

    const err: ApiError = {
      statusCode: res.status,
      reason: reason as ApiError['reason'],
      message: errorBody.message ?? `Erreur ${res.status}`,
    };
    throw err;
  }

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------

export async function httpLogin(req: LoginRequest): Promise<LoginResponse> {
  const raw = await apiFetch<BackendLoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(req),
  });
  const adapted = adaptLoginResponse(raw);
  storeTokens(adapted.accessToken, raw.refreshToken);
  // Stocker user et orgs (décodés du JWT)
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(USER_KEY, JSON.stringify(adapted.user));
    const claims = decodeJwtPayload(adapted.accessToken);
    if (claims?.orgs) {
      sessionStorage.setItem(ORGS_KEY, JSON.stringify(claims.orgs));
    }
  }
  return adapted;
}

export async function httpLogout(): Promise<void> {
  try {
    await apiFetch<void>('/auth/logout', { method: 'POST' });
  } catch {
    /* best-effort */
  } finally {
    clearTokens();
    invalidateEntCache();
  }
}

export function httpGetStoredToken(): string | null {
  return getAccessToken();
}

export function httpGetStoredUser(): { id: string; email: string; name: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as { id: string; email: string; name: string }) : null;
  } catch {
    return null;
  }
}

export function httpGetStoredOrgs(): OrgClaim[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(ORGS_KEY);
    return raw ? (JSON.parse(raw) as OrgClaim[]) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// ENTITLEMENTS
// ---------------------------------------------------------------------------

export async function httpGetEntitlements(orgId: string): Promise<EntitlementsResponse> {
  const cached = _entCache.get(orgId);
  if (cached && Date.now() - cached.ts < ENT_TTL_MS) {
    return cached.data;
  }
  const raw = await apiFetch<BackendEntitlements>('/me/entitlements', { orgId });
  const adapted = adaptEntitlements(raw);
  _entCache.set(orgId, { data: adapted, ts: Date.now() });
  return adapted;
}

// ---------------------------------------------------------------------------
// PROJECTS
// ---------------------------------------------------------------------------

export async function httpListProjects(orgId: string): Promise<Project[]> {
  const raws = await apiFetch<PrismaProject[]>('/projects', { orgId });
  return adaptProjects(raws);
}

export async function httpCreateProject(
  orgId: string,
  req: CreateProjectRequest,
): Promise<Project> {
  const raw = await apiFetch<PrismaProject>('/projects', {
    method: 'POST',
    body: JSON.stringify(req),
    orgId,
  });
  return adaptProject(raw);
}

export async function httpGetProject(orgId: string, projectId: string): Promise<Project> {
  const raw = await apiFetch<PrismaProject>(`/projects/${projectId}`, { orgId });
  return adaptProject(raw);
}

// ---------------------------------------------------------------------------
// CALCULS
// ---------------------------------------------------------------------------

export async function httpListCalcResults(
  orgId: string,
  projectId: string,
): Promise<CalcResult[]> {
  const raws = await apiFetch<PrismaCalcResult[]>(`/projects/${projectId}/calc-results`, {
    orgId,
  });
  return adaptCalcResults(raws);
}

export async function httpGetCalcResult(
  orgId: string,
  projectId: string,
  calcId: string,
): Promise<CalcResult> {
  const raw = await apiFetch<PrismaCalcResult>(
    `/projects/${projectId}/calc-results/${calcId}`,
    { orgId },
  );
  return adaptCalcResult(raw);
}

export async function httpRunCalc(
  orgId: string,
  projectId: string,
  req: CalcRequest,
): Promise<CalcResult> {
  const raw = await apiFetch<PrismaCalcResult>(
    `/projects/${projectId}/calc/${req.engineId}`,
    {
      method: 'POST',
      // Le backend valide le body avec un schéma Zod strict contre l'input moteur à la racine.
      // Toute clé inconnue (ex. { label, params }) → rejet 400 "Entrée hors-contrat moteur".
      body: JSON.stringify(req.params),
      orgId,
    },
  );
  // Invalider le cache entitlements : un calcul consomme du quota
  invalidateEntCache(orgId);
  return adaptCalcResult(raw);
}

// ---------------------------------------------------------------------------
// PV
// ---------------------------------------------------------------------------

export async function httpListPvs(
  orgId: string,
  projectId: string,
): Promise<OfficialPv[]> {
  const raws = await apiFetch<PrismaOfficialPv[]>(`/projects/${projectId}/pvs`, {
    orgId,
  });
  return adaptOfficialPvs(raws);
}

export async function httpGetPv(
  orgId: string,
  projectId: string,
  pvId: string,
): Promise<OfficialPv> {
  const raw = await apiFetch<PrismaOfficialPv>(`/projects/${projectId}/pvs/${pvId}`, {
    orgId,
  });
  return adaptOfficialPv(raw);
}

export async function httpEmitPv(
  orgId: string,
  projectId: string,
  req: EmitPvRequest,
): Promise<OfficialPv> {
  const raw = await apiFetch<PrismaOfficialPv>(
    `/projects/${projectId}/calc-results/${req.calcResultId}/pv`,
    {
      method: 'POST',
      body: JSON.stringify({ note: req.note }),
      orgId,
    },
  );
  // Invalider le cache entitlements : un PV peut consommer du quota
  invalidateEntCache(orgId);
  return adaptOfficialPv(raw);
}

export async function httpVerifyPv(
  orgId: string,
  projectId: string,
  pvId: string,
): Promise<VerifyPvResponse> {
  // Il n'existe pas de route /pvs/:id/verify.
  // La vérification d'intégrité = lire GET /projects/:projectId/pvs/:pvId
  // et exploiter le champ `sealValid` renvoyé par le backend.
  const raw = await apiFetch<PrismaOfficialPv>(
    `/projects/${projectId}/pvs/${pvId}`,
    { orgId },
  );
  return {
    pvId: raw.pv.id,
    intact: raw.sealValid ?? false,
    verifiedAt: new Date().toISOString(),
  };
}

export async function httpDownloadPvPdf(
  orgId: string,
  projectId: string,
  pvId: string,
): Promise<Blob> {
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (orgId) headers['X-Org-Id'] = orgId;

  const res = await fetch(`${API_BASE}/projects/${projectId}/pvs/${pvId}/pdf`, {
    headers,
  });
  if (!res.ok) {
    throw {
      statusCode: res.status,
      reason: 'SERVER_ERROR',
      message: `Erreur téléchargement PDF (${res.status})`,
    } satisfies ApiError;
  }
  return res.blob();
}
