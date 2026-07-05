/**
 * Couche API admin — lecture SERVEUR uniquement.
 *
 * Utilisable UNIQUEMENT dans des Server Components (layout, pages).
 * Lit le token depuis le cookie JS-readable `roadsen_access_token` via
 * `next/headers`. Ne jamais importer ce module dans un Client Component
 * (il utilise `next/headers` qui n'est disponible qu'en contexte serveur).
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 */

import { cookies } from 'next/headers';

const TOKEN_COOKIE = 'roadsen_access_token';

// ---------------------------------------------------------------------------
// Types frontend (shapes des réponses backend — cf. admin-orgs.service.ts
// et admin-users.service.ts). Redéfinis ici : pas d'import du code NestJS.
// ---------------------------------------------------------------------------

export type OrgStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

export interface OrgSubscriptionSummary {
  pack: string;
  quota: number;
  consommation: number;
  remaining: number;
  dateFin: string; // ISO
  expired: boolean;
}

export interface AdminOrgIdentity {
  id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  createdAt: string; // ISO
}

export interface AdminOrgListItem extends AdminOrgIdentity {
  nbMembres: number;
  subscription: OrgSubscriptionSummary | null;
}

export interface OrgMemberView {
  userId: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  calcCount: number;
}

export interface OrgUsage {
  quota: number | null;
  consommation: number | null;
  remaining: number | null;
  monthStart: string;
  byKind: { CALC: number; PV: number };
  byMember: { userId: string; count: number }[];
}

export interface AdminOrgDetail {
  org: AdminOrgIdentity;
  members: OrgMemberView[];
  subscription: OrgSubscriptionSummary | null;
  usage: OrgUsage;
}

export interface AdminUserView {
  userId: string;
  email: string;
  fullName: string;
  platformRole: string | null;
  isActive: boolean;
  nbOrgs: number;
}

/** Ligne du journal d'audit — GET /admin/orgs/:orgId/audit. */
export interface AuditEntryView {
  id: string;
  actorUserId: string;
  action: string;
  targetOrgId: string | null;
  targetUserId: string | null;
  payload: unknown;
  createdAt: string; // ISO
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_BASE =
  (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_API_BASE_URL : undefined) ?? '';

/**
 * Fetch admin authentifié côté serveur. Renvoie null si pas de token, si
 * le backend renvoie une erreur, ou si le réseau est indisponible.
 * Erreurs 401/403 signifient que la garde layout.tsx doit rediriger — ici
 * on laisse remonter null et le layout redirige.
 */
async function adminGet<T>(path: string): Promise<T | null> {
  let token: string | null = null;
  try {
    const cookieStore = await cookies();
    token = cookieStore.get(TOKEN_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
  if (!token) return null;

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      // Pas de cache statique : données live back-office.
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Vérifie le role PLATEFORME de l'utilisateur courant. Null si non authentifié. */
export async function adminGetMe(): Promise<{ platformRole: string | null } | null> {
  return adminGet<{ platformRole: string | null }>('/admin/me');
}

/**
 * Liste paginée des organisations (identité + résumé abo).
 * `q` : filtre optionnel. `limit`/`offset` : pagination.
 */
export async function adminListOrgs(args?: {
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<AdminOrgListItem[]> {
  const params = new URLSearchParams();
  if (args?.q) params.set('q', args.q);
  if (args?.limit !== undefined) params.set('limit', String(args.limit));
  if (args?.offset !== undefined) params.set('offset', String(args.offset));
  const qs = params.size > 0 ? `?${params.toString()}` : '';
  const data = await adminGet<AdminOrgListItem[]>(`/admin/orgs${qs}`);
  return data ?? [];
}

/** Détail composite d'une organisation. Null si introuvable ou erreur. */
export async function adminGetOrg(orgId: string): Promise<AdminOrgDetail | null> {
  return adminGet<AdminOrgDetail>(`/admin/orgs/${encodeURIComponent(orgId)}`);
}

/** Usage du mois courant d'une organisation. Null si introuvable. */
export async function adminGetOrgUsage(orgId: string): Promise<OrgUsage | null> {
  return adminGet<OrgUsage>(`/admin/orgs/${encodeURIComponent(orgId)}/usage`);
}

/** Liste des membres d'une organisation. */
export async function adminListOrgMembers(orgId: string): Promise<OrgMemberView[]> {
  const data = await adminGet<OrgMemberView[]>(
    `/admin/orgs/${encodeURIComponent(orgId)}/members`,
  );
  return data ?? [];
}

/** Recherche d'utilisateurs par email/nom. */
export async function adminSearchUsers(args?: {
  q?: string;
  limit?: number;
}): Promise<AdminUserView[]> {
  const params = new URLSearchParams();
  if (args?.q) params.set('q', args.q);
  if (args?.limit !== undefined) params.set('limit', String(args.limit));
  const qs = params.size > 0 ? `?${params.toString()}` : '';
  const data = await adminGet<AdminUserView[]>(`/admin/users${qs}`);
  return data ?? [];
}
