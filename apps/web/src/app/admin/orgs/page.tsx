/**
 * /admin/orgs — inventaire des organisations.
 *
 * Server Component : fetch des données avec le token cookie, puis rendu.
 * Filtre statut + tri sont désormais faits EN SQL côté backend (admin_list_orgs
 * enrichi, 0014, params status/sort) — plus de filtre client-side sur une seule
 * page (l'ancien filtre en mémoire cachait les orgs au-delà de `limit`). La
 * partie interactive (recherche, filtre, tri, pagination) est déléguée à
 * OrgListClient qui met à jour les URL query params → le Server Component se
 * re-déclenche.
 */

import type { AdminOrgSort, OrgStatus } from '@/lib/api/admin-server';
import { adminListOrgs } from '@/lib/api/admin-server';
import { OrgListClient } from '@/components/admin/OrgListClient';

interface SearchParams {
  q?: string;
  status?: string;
  sort?: string;
  limit?: string;
  offset?: string;
}

interface OrgsPageProps {
  searchParams: Promise<SearchParams>;
}

export const metadata = { title: 'Organisations — Back-office' };

const VALID_STATUSES: OrgStatus[] = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'];
const VALID_SORTS: AdminOrgSort[] = ['name', 'createdAt', 'quota', 'expiration'];
const DEFAULT_LIMIT = 50;

export default async function OrgsPage({ searchParams }: OrgsPageProps) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? '';
  const statusFilter = VALID_STATUSES.includes(sp.status as OrgStatus)
    ? (sp.status as OrgStatus)
    : undefined;
  const sort = VALID_SORTS.includes(sp.sort as AdminOrgSort)
    ? (sp.sort as AdminOrgSort)
    : undefined;
  // clamp [1,100] : une URL ?limit=500 provoquait un 400 backend (Zod max 100) -> page vide
  const limit = Math.min(100, Math.max(1, Number.parseInt(sp.limit ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
  const offset = Number.parseInt(sp.offset ?? '0', 10) || 0;

  // Fetch serveur — filtre/tri/pagination en SQL. Erreurs gérées dans
  // adminListOrgs (renvoie []).
  const orgs = await adminListOrgs({
    q: q || undefined,
    status: statusFilter,
    sort,
    limit,
    offset,
  });

  return (
    <>
      {/* En-tête de page */}
      <div
        style={{
          padding: '24px 24px 0',
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
        }}
      >
        <h1
          style={{
            fontSize: 'var(--text-lg)',
            fontWeight: 600,
            color: 'var(--text-primary)',
            margin: 0,
          }}
        >
          Organisations
        </h1>
        <span
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-muted)',
          }}
        >
          {orgs.length} résultat{orgs.length !== 1 ? 's' : ''} (page)
        </span>
      </div>

      {/* Tableau interactif (Client Component) */}
      <OrgListClient
        orgs={orgs}
        q={q}
        status={statusFilter ?? ''}
        sort={sort ?? ''}
        limit={limit}
        offset={offset}
      />
    </>
  );
}
