/**
 * Couche API admin — mutations CLIENT.
 *
 * Utilisée uniquement dans les Client Components (wizard onboarding).
 * Lit le token depuis sessionStorage (même patron que http-client.ts).
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 */

import type { AdminUserView } from './admin-server';

const API_BASE =
  (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_API_BASE_URL : undefined) ?? '';

const ACCESS_TOKEN_KEY = 'roadsen_access_token';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

interface FetchError {
  statusCode: number;
  message: string;
}

async function adminFetch<T>(
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });

  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) msg = body.message;
    } catch {
      /* corps non JSON */
    }
    const err: FetchError = { statusCode: res.status, message: msg };
    throw err;
  }

  if (res.status === 201 || res.status === 200) {
    return res.json() as Promise<T>;
  }
  return undefined as unknown as T;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Recherche d'utilisateurs (pour l'étape 1 du wizard — autocomplete). */
export async function clientSearchUsers(q: string): Promise<AdminUserView[]> {
  const params = new URLSearchParams({ q, limit: '10' });
  return adminFetch<AdminUserView[]>(`/admin/users?${params.toString()}`);
}

/** Crée un utilisateur (étape 1 du wizard — création inline). */
export async function clientCreateUser(data: {
  email: string;
  password: string;
  fullName: string;
}): Promise<{ userId: string }> {
  return adminFetch<{ userId: string }>('/admin/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export interface CreateOrgPayload {
  name: string;
  slug: string;
  ownerUserId: string;
  subscription?: {
    pack: string;
    quota: number;
    entitlements: string[];
    dateDebut: string;
    dateFin: string;
  };
}

/** Crée une organisation avec son OWNER et son abonnement (atomique, wizard final). */
export async function clientCreateOrg(
  data: CreateOrgPayload,
): Promise<{ orgId: string }> {
  return adminFetch<{ orgId: string }>('/admin/orgs', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
