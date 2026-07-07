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

/**
 * Détail d'abonnement (GET /admin/orgs/:id) : résumé + LISTE RÉELLE des
 * entitlements (colonne subscriptions.entitlements). Miroir de
 * OrgSubscriptionDetail côté backend (admin-orgs.service.ts). Le modal
 * Modules DOIT s'initialiser depuis `entitlements`, jamais depuis le pack
 * (bug corrigé : re-approximer depuis PACK_ENTITLEMENTS écrasait les vrais
 * entitlements à l'enregistrement).
 */
export interface OrgSubscriptionDetail extends OrgSubscriptionSummary {
  entitlements: string[];
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
  calculsMois: number; // aligné sur le backend (members.service.ts) — évite une colonne vide
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
  // DÉTAIL (avec entitlements RÉELS), pas le résumé : le modal Modules en a besoin.
  subscription: OrgSubscriptionDetail | null;
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

/** Ligne du journal d'audit — GET /admin/orgs/:orgId/audit (+ /admin/audit, global). */
export interface AuditEntryView {
  id: string;
  actorUserId: string;
  action: string;
  targetOrgId: string | null;
  targetUserId: string | null;
  payload: unknown;
  createdAt: string; // ISO
}

/** Tableau de bord plateforme — GET /admin/stats (cf. admin-stats.service.ts). */
export interface PlatformStats {
  orgs: { active: number; suspended: number; archived: number };
  usersTotal: number;
  membershipsActive: number;
  pvTotal: number;
  quota: { allouTotal: number; consommeTotal: number };
  abonnements: {
    expirant30j: number;
    expires: number;
    orgsSansAbo: number;
    orgsQuota90pct: number;
  };
}

/** Famille de filtre — GET /admin/subscriptions?filter=. */
export type SubscriptionFilter = 'expired' | 'expiring' | 'noquota' | 'nosub' | 'withsub';

/** Tri whitelisté — GET /admin/orgs?sort= et /admin/subscriptions?sort=. */
export type AdminOrgSort = 'name' | 'createdAt' | 'quota' | 'expiration';

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
 * Liste paginée des organisations (identité + résumé abo), filtre/tri/pagination
 * FAITS EN SQL cote backend (admin_list_orgs enrichi, 0014) — jamais de filtre
 * client-side (cause de la pagination faussee corrigee, cf. /admin/orgs).
 */
export async function adminListOrgs(args?: {
  q?: string;
  limit?: number;
  offset?: number;
  status?: OrgStatus;
  sort?: AdminOrgSort;
}): Promise<AdminOrgListItem[]> {
  const params = new URLSearchParams();
  if (args?.q) params.set('q', args.q);
  if (args?.limit !== undefined) params.set('limit', String(args.limit));
  if (args?.offset !== undefined) params.set('offset', String(args.offset));
  if (args?.status) params.set('status', args.status);
  if (args?.sort) params.set('sort', args.sort);
  const qs = params.size > 0 ? `?${params.toString()}` : '';
  const data = await adminGet<AdminOrgListItem[]>(`/admin/orgs${qs}`);
  return data ?? [];
}

/** Tableau de bord plateforme (agrégats cross-tenant). Null si erreur/réseau KO. */
export async function adminGetStats(): Promise<PlatformStats | null> {
  return adminGet<PlatformStats>('/admin/stats');
}

/**
 * Journal d'audit GLOBAL (toutes orgs) — GET /admin/audit. Filtres SQL bornés
 * (action, actor, from/to ISO) ; limit plafonné à 100 côté backend.
 */
export async function adminListGlobalAudit(args?: {
  action?: string;
  actor?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<AuditEntryView[]> {
  const params = new URLSearchParams();
  if (args?.action) params.set('action', args.action);
  if (args?.actor) params.set('actor', args.actor);
  if (args?.from) params.set('from', args.from);
  if (args?.to) params.set('to', args.to);
  if (args?.limit !== undefined) params.set('limit', String(args.limit));
  if (args?.offset !== undefined) params.set('offset', String(args.offset));
  const qs = params.size > 0 ? `?${params.toString()}` : '';
  const data = await adminGet<AuditEntryView[]>(`/admin/audit${qs}`);
  return data ?? [];
}

/** Supervision PV cross-tenant (métadonnées) — GET /admin/pvs. */
export interface AdminPvListItem {
  pvId: string;
  pvNumber: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  projectName: string;
  engineId: string;
  engineVersion: string;
  scienceStatus: string;
  verdict: string;
  sealedAt: string;
}

export async function adminListPvs(args?: {
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<AdminPvListItem[]> {
  const params = new URLSearchParams();
  if (args?.q) params.set('q', args.q);
  if (args?.limit !== undefined) params.set('limit', String(args.limit));
  if (args?.offset !== undefined) params.set('offset', String(args.offset));
  const qs = params.size > 0 ? `?${params.toString()}` : '';
  const data = await adminGet<AdminPvListItem[]>(`/admin/pvs${qs}`);
  return data ?? [];
}

/**
 * Console d'abonnements (vue money-centrée) — GET /admin/subscriptions. Même
 * forme d'item que listOrgs (org + résumé d'abo), filtrée sur une famille money.
 */
export async function adminListSubscriptions(args?: {
  filter?: SubscriptionFilter;
  sort?: AdminOrgSort;
  limit?: number;
  offset?: number;
}): Promise<AdminOrgListItem[]> {
  const params = new URLSearchParams();
  if (args?.filter) params.set('filter', args.filter);
  if (args?.sort) params.set('sort', args.sort);
  if (args?.limit !== undefined) params.set('limit', String(args.limit));
  if (args?.offset !== undefined) params.set('offset', String(args.offset));
  const qs = params.size > 0 ? `?${params.toString()}` : '';
  const data = await adminGet<AdminOrgListItem[]>(`/admin/subscriptions${qs}`);
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

/** Fiche détaillée d'un utilisateur — GET /admin/users/:id. */
export interface AdminUserOrgView {
  orgId: string;
  orgName: string;
  orgSlug: string;
  orgStatus: string;
  role: string;
  active: boolean;
}
export interface AdminUserDetailView {
  userId: string;
  email: string;
  fullName: string;
  platformRole: string | null;
  isActive: boolean;
  orgs: AdminUserOrgView[];
}

export async function adminGetUser(userId: string): Promise<AdminUserDetailView | null> {
  return adminGet<AdminUserDetailView>(`/admin/users/${encodeURIComponent(userId)}`);
}
