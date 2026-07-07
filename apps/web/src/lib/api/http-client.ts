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
 *  - Refresh PROACTIF : timer planifié ~60 s avant l'expiration du JWT (#1)
 *  - Gestion 402 (EXPIRED|QUOTA) et 403 (MODULE_NOT_IN_PACK) : erreurs typées
 *  - Mapping Prisma → types front via adapters.ts
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 */

import {
  adaptLoginResponse,
  adaptUserProfile,
  adaptEntitlements,
  adaptProject,
  adaptProjects,
  adaptCalcResult,
  adaptCalcResults,
  adaptPersistedCalcResult,
  adaptOfficialPv,
  adaptOfficialPvs,
  type PrismaCalcResult,
  type PrismaOfficialPv,
  type PrismaOfficialPvFlat,
  type PrismaProject,
  type BackendLoginResponse,
  type BackendEntitlements,
  type BackendPersistedCalcResult,
  type BackendUserProfile,
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
// max-age : aligné sur le `exp` réel du JWT (pas une valeur codée en dur — #1).
// SameSite=Strict limite l'exposition CSRF.
//
// DETTE : avant mise en production, passer en cookie httpOnly via un Route Handler
// proxy (l'en-tête Authorization serait alors injecté côté serveur, éliminant
// toute exposition JS du token). Documenté dans ADR 0010.
// ---------------------------------------------------------------------------

const TOKEN_COOKIE_NAME = ACCESS_TOKEN_KEY; // 'roadsen_access_token'

function setTokenCookie(token: string, maxAge = 900): void {
  if (typeof document === 'undefined') return;
  // JWT ne contient que des caractères base64url + points — pas besoin d'encodage URL.
  document.cookie = `${TOKEN_COOKIE_NAME}=${token}; path=/; SameSite=Strict; max-age=${maxAge}`;
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

// ---------------------------------------------------------------------------
// Refresh proactif — timer (#1)
//
// Après chaque storeTokens, on planifie un refresh ~60 s avant l'exp du JWT.
// Si le refresh réussit, storeTokens est appelé à nouveau → le prochain timer
// est automatiquement reprogrammé (pas de boucle explicite).
// Si le refresh échoue, le timer s'arrête et le flux 401 transparent prend le relais.
// ---------------------------------------------------------------------------

let _proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function cancelProactiveRefresh(): void {
  if (_proactiveRefreshTimer !== null) {
    clearTimeout(_proactiveRefreshTimer);
    _proactiveRefreshTimer = null;
  }
}

function scheduleProactiveRefresh(accessToken: string): void {
  cancelProactiveRefresh();

  const claims = decodeJwtPayload(accessToken);
  if (!claims?.exp) return;

  const nowSec = Math.floor(Date.now() / 1000);
  const delaySec = claims.exp - nowSec - 60; // 60 s avant expiration

  // Trop court pour être utile (< 5 s) : laisser le flux 401 gérer.
  if (delaySec < 5) return;

  // MINEUR-2 — Clamp à 2 147 483 s (~24,8 j) : setTimeout prend un int32 en ms.
  // Un JWT avec exp très lointain (tests : 9999999999) dépasserait 2^31-1 ms et
  // déclencherait immédiatement (overflow). On clampe plutôt que de sauter.
  const delayMs = Math.min(delaySec * 1000, 2_147_483_000);

  _proactiveRefreshTimer = setTimeout(() => {
    _proactiveRefreshTimer = null;
    // Si un refresh est déjà en cours (401 transparent), on le laisse finir.
    if (_refreshing) {
      void _refreshing;
      return;
    }
    // Démarrer le refresh proactif ; doRefresh → storeTokens → reprogramme le suivant.
    _refreshing = doRefresh().finally(() => {
      _refreshing = null;
    });
  }, delayMs);
}

function storeTokens(accessToken: string, refreshToken: string): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);

  // #18 — Re-dériver et stocker les orgs depuis le nouveau token (après refresh inclus)
  const claims = decodeJwtPayload(accessToken);
  if (claims?.orgs) {
    sessionStorage.setItem(ORGS_KEY, JSON.stringify(claims.orgs));
  }

  // #1 — max-age du cookie aligné sur exp réel du JWT (pas un 900 codé en dur)
  const nowSec = Math.floor(Date.now() / 1000);
  const maxAge = claims?.exp ? Math.max(0, claims.exp - nowSec) : 900;
  setTokenCookie(accessToken, maxAge);

  // #1 — Planifier le refresh proactif ~60 s avant expiration
  scheduleProactiveRefresh(accessToken);
}

function clearTokens(): void {
  if (typeof window === 'undefined') return;
  // Annuler le timer proactif avant de vider la session
  cancelProactiveRefresh();
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
  // storeTokens gère maintenant : orgs JWT (#18) + cookie max-age réel (#1) + timer proactif (#1)
  storeTokens(adapted.accessToken, raw.refreshToken);

  // #9 — Récupérer le profil complet via GET /auth/me et stocker name/email réels.
  // Sidebar/Topbar/page Compte lisent user.name et user.email depuis USER_KEY.
  if (typeof window !== 'undefined') {
    try {
      const profile = await apiFetch<BackendUserProfile>('/auth/me');
      sessionStorage.setItem(USER_KEY, JSON.stringify(adaptUserProfile(profile)));
    } catch {
      // /auth/me indisponible : stocker le user dérivé du JWT (email/name vides,
      // seront mis à jour au prochain login ou rechargement).
      sessionStorage.setItem(USER_KEY, JSON.stringify(adapted.user));
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

/**
 * PATCH /projects/:id — renomme le projet (PERSISTE côté serveur).
 * Le backend renvoie le projet Prisma à jour ; on l'adapte en Project front.
 */
export async function httpRenameProject(
  orgId: string,
  projectId: string,
  name: string,
): Promise<Project> {
  const raw = await apiFetch<PrismaProject>(`/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
    orgId,
  });
  return adaptProject(raw);
}

/**
 * DELETE /projects/:id — soft-delete (archivage). Les calc-results et PV
 * scellés du projet sont préservés côté serveur ; le projet disparaît
 * simplement des listes/lectures tenant (GET /projects l'exclut).
 */
export async function httpDeleteProject(orgId: string, projectId: string): Promise<Project> {
  const raw = await apiFetch<PrismaProject>(`/projects/${projectId}`, {
    method: 'DELETE',
    orgId,
  });
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
  // #2 — Le backend renvoie PersistedCalcResult (pas PrismaCalcResult) :
  // { calcResultId, ok, meta: { engineId, ... }, output }
  // On utilise adaptPersistedCalcResult (contexte orgId/projectId/params fourni ici).
  const raw = await apiFetch<BackendPersistedCalcResult>(
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
  return adaptPersistedCalcResult(raw, {
    orgId,
    projectId,
    params: req.params as Record<string, unknown>,
  });
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
  // #4 — Le backend renvoie OfficialPv Prisma DIRECT (forme plate), pas { pv, sealValid }.
  // Les routes GET /pvs et GET /pvs/:id renvoient la forme imbriquée { pv, sealValid }.
  const raw = await apiFetch<PrismaOfficialPvFlat>(
    `/projects/${projectId}/calc-results/${req.calcResultId}/pv`,
    {
      method: 'POST',
      body: JSON.stringify({ note: req.note }),
      orgId,
    },
  );
  // Invalider le cache entitlements : un PV peut consommer du quota
  invalidateEntCache(orgId);
  return adaptOfficialPv(raw as unknown as PrismaOfficialPv);
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
    // 409 = sceau cassé (ConflictException backend, cf. pv.service.ts pdfForView) —
    // le corps JSON porte un message clair ; on le propage plutôt qu'un générique.
    let message = `Erreur téléchargement PDF (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      /* corps non JSON */
    }
    throw {
      statusCode: res.status,
      reason: 'SERVER_ERROR',
      message,
    } satisfies ApiError;
  }
  return res.blob();
}
