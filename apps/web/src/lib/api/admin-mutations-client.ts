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

// ---------------------------------------------------------------------------
// Vague 2 — comptes globaux, rattacher abo, transfert OWNER, ajouter membre
// ---------------------------------------------------------------------------

/** Ajoute un membre EXISTANT (par userId) à une org. */
export async function clientAddMember(
  orgId: string,
  data: { userId: string; role: 'ADMIN' | 'ENGINEER' | 'TECHNICIAN' | 'VIEWER' },
  idempotencyKey: string,
): Promise<AdminOrgDetail> {
  return adminMutate<AdminOrgDetail>(
    `/admin/orgs/${encodeURIComponent(orgId)}/members`,
    { method: 'POST', body: JSON.stringify(data) },
    idempotencyKey,
  );
}

/** Transfère l'OWNER d'une org vers un membre actif existant. */
export async function clientTransferOwner(
  orgId: string,
  data: { newOwnerUserId: string },
  idempotencyKey: string,
): Promise<AdminOrgDetail> {
  return adminMutate<AdminOrgDetail>(
    `/admin/orgs/${encodeURIComponent(orgId)}/owner`,
    { method: 'PATCH', body: JSON.stringify(data) },
    idempotencyKey,
  );
}

/** Rattache un abonnement à une org existante SANS abo (409 si un abo actif existe). */
export async function clientAttachSubscription(
  orgId: string,
  data: { pack: 'ROUTES' | 'FONDATIONS' | 'COMPLETE'; entitlements: string[]; quota: number; dateDebut: string; dateFin: string },
  idempotencyKey: string,
): Promise<AdminOrgDetail> {
  return adminMutate<AdminOrgDetail>(
    `/admin/orgs/${encodeURIComponent(orgId)}/subscription`,
    { method: 'POST', body: JSON.stringify(data) },
    idempotencyKey,
  );
}

/** Désactive (active=false) ou réactive (active=true) un compte GLOBAL. */
export async function clientSetUserActive(
  userId: string,
  active: boolean,
  idempotencyKey: string,
): Promise<{ userId: string; active: boolean }> {
  return adminMutate<{ userId: string; active: boolean }>(
    `/admin/users/${encodeURIComponent(userId)}/active`,
    { method: 'PATCH', body: JSON.stringify({ active }) },
    idempotencyKey,
  );
}

/** Reset admin du mot de passe d'un compte (le nouveau mdp ne transite que dans cette requête). */
export async function clientResetPassword(
  userId: string,
  data: { newPassword: string; motif?: string },
  idempotencyKey: string,
): Promise<{ userId: string }> {
  return adminMutate<{ userId: string }>(
    `/admin/users/${encodeURIComponent(userId)}/reset-password`,
    { method: 'POST', body: JSON.stringify(data) },
    idempotencyKey,
  );
}

/**
 * Édite l'IDENTITÉ d'un compte GLOBAL (email + nom) — PATCH /admin/users/:id.
 * 409 (R0012) si l'email est déjà porté par un AUTRE compte.
 */
export async function clientUpdateUserIdentity(
  userId: string,
  data: { email: string; fullName: string },
  idempotencyKey: string,
): Promise<{ userId: string }> {
  return adminMutate<{ userId: string }>(
    `/admin/users/${encodeURIComponent(userId)}`,
    { method: 'PATCH', body: JSON.stringify(data) },
    idempotencyKey,
  );
}

export type PlatformRoleValue = 'SUPERADMIN' | 'SUPPORT' | null;

/**
 * Attribue / retire le rôle PLATEFORME (SUPERADMIN | SUPPORT | null) — PATCH
 * /admin/users/:id/platform-role. 409 (R0013) si retrait du dernier SUPERADMIN
 * actif ; 400 (R0014) si auto-rétrogradation.
 */
export async function clientSetPlatformRole(
  userId: string,
  data: { role: PlatformRoleValue },
  idempotencyKey: string,
): Promise<{ userId: string; platformRole: PlatformRoleValue }> {
  return adminMutate<{ userId: string; platformRole: PlatformRoleValue }>(
    `/admin/users/${encodeURIComponent(userId)}/platform-role`,
    { method: 'PATCH', body: JSON.stringify(data) },
    idempotencyKey,
  );
}
