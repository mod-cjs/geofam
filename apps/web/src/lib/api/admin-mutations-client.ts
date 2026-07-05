/**
 * Couche API admin — mutations Lot 2 (money-adjacent) — CLIENT uniquement.
 *
 * Patron : même que admin-client.ts (token sessionStorage, fetch direct).
 * Idempotence : l'appelant DOIT fournir un `idempotencyKey` stable (généré une seule
 * fois à l'ouverture de la modal d'intention, cf. cadrage-backoffice.md §2.3).
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 */

import type { AdminOrgDetail, AuditEntryView } from './admin-server';

const API_BASE =
  (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_API_BASE_URL : undefined) ?? '';

const ACCESS_TOKEN_KEY = 'roadsen_access_token';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

export interface MutationError {
  statusCode: number;
  message: string;
}

async function adminMutate<T>(
  path: string,
  opts: RequestInit = {},
  idempotencyKey?: string,
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });

  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (Array.isArray(body.message)) msg = body.message.join(', ');
      else if (body.message) msg = body.message;
    } catch {
      /* corps non JSON */
    }
    const err: MutationError = { statusCode: res.status, message: msg };
    throw err;
  }

  // 200 ou 201 — corps JSON attendu
  const text = await res.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

// ---------------------------------------------------------------------------
// Utilitaire : clé d'idempotence stable par intention
// ---------------------------------------------------------------------------

/**
 * Résoud la clé d'idempotence pour une intention de mutation.
 * - Si la modal est fermée (isOpen=false) → null (pas de clé active).
 * - Si une clé existe déjà (même intention) → la réutiliser (stabilité anti-double-crédit).
 * - Sinon → en générer une nouvelle.
 *
 * Exportée pour les tests (logique pure, sans hook React).
 */
export function resolveIntentionKey(
  isOpen: boolean,
  currentKey: string | null,
): string | null {
  if (!isOpen) return null;
  if (currentKey) return currentKey;
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Mutations abonnement
// ---------------------------------------------------------------------------

export async function clientTopUp(
  orgId: string,
  data: { delta: number; motif: string },
  idempotencyKey: string,
): Promise<AdminOrgDetail> {
  return adminMutate<AdminOrgDetail>(
    `/admin/orgs/${encodeURIComponent(orgId)}/subscription/topup`,
    { method: 'POST', body: JSON.stringify(data) },
    idempotencyKey,
  );
}

export async function clientRenew(
  orgId: string,
  data: { dateDebut: string; dateFin: string },
  idempotencyKey: string,
): Promise<AdminOrgDetail> {
  return adminMutate<AdminOrgDetail>(
    `/admin/orgs/${encodeURIComponent(orgId)}/subscription/renew`,
    { method: 'POST', body: JSON.stringify(data) },
    idempotencyKey,
  );
}

export async function clientSetEntitlements(
  orgId: string,
  data: { pack: string; entitlements: string[] },
  idempotencyKey: string,
): Promise<AdminOrgDetail> {
  return adminMutate<AdminOrgDetail>(
    `/admin/orgs/${encodeURIComponent(orgId)}/subscription/entitlements`,
    { method: 'PATCH', body: JSON.stringify(data) },
    idempotencyKey,
  );
}

// ---------------------------------------------------------------------------
// Mutations membres
// ---------------------------------------------------------------------------

export async function clientSetMemberRole(
  orgId: string,
  userId: string,
  data: { role: string },
  idempotencyKey: string,
): Promise<AdminOrgDetail> {
  return adminMutate<AdminOrgDetail>(
    `/admin/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}/role`,
    { method: 'PATCH', body: JSON.stringify(data) },
    idempotencyKey,
  );
}

export async function clientRemoveMember(
  orgId: string,
  userId: string,
  idempotencyKey: string,
): Promise<AdminOrgDetail> {
  return adminMutate<AdminOrgDetail>(
    `/admin/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
    idempotencyKey,
  );
}

/** Suspend (isActive=false) ou réactive (isActive=true) un membre. */
export async function clientSetMemberActive(
  orgId: string,
  userId: string,
  isActive: boolean,
): Promise<{ userId: string; isActive: boolean }> {
  return adminMutate<{ userId: string; isActive: boolean }>(
    `/admin/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
    { method: 'PATCH', body: JSON.stringify({ isActive }) },
  );
}

// ---------------------------------------------------------------------------
// Statut d'org
// ---------------------------------------------------------------------------

export async function clientSetOrgStatus(
  orgId: string,
  data: { status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' },
  idempotencyKey: string,
): Promise<AdminOrgDetail> {
  return adminMutate<AdminOrgDetail>(
    `/admin/orgs/${encodeURIComponent(orgId)}/status`,
    { method: 'PATCH', body: JSON.stringify(data) },
    idempotencyKey,
  );
}

// ---------------------------------------------------------------------------
// Journal d'audit
// ---------------------------------------------------------------------------

export async function clientListAudit(
  orgId: string,
  args?: { limit?: number; offset?: number },
): Promise<AuditEntryView[]> {
  const params = new URLSearchParams();
  if (args?.limit !== undefined) params.set('limit', String(args.limit));
  if (args?.offset !== undefined) params.set('offset', String(args.offset));
  const qs = params.size > 0 ? `?${params.toString()}` : '';
  return adminMutate<AuditEntryView[]>(
    `/admin/orgs/${encodeURIComponent(orgId)}/audit${qs}`,
    { method: 'GET' },
  );
}
