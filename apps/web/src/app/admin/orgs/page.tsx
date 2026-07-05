/**
 * /admin/orgs — inventaire des organisations.
 *
 * Server Component : fetch des données avec le token cookie, puis rendu.
 * La partie interactive (recherche, filtre statut) est délégée à OrgListClient
 * qui met à jour les URL query params → le Server Component se re-déclenche.
 */

import type { OrgStatus } from '@/lib/api/admin-server';
import { adminListOrgs } from '@/lib/api/admin-server';
import { OrgListClient } from '@/components/admin/OrgListClient';

interface SearchParams {
  q?: string;
  status?: string;
  limit?: string;
  offset?: string;
}

interface OrgsPageProps {
  searchParams: Promise<SearchParams>;
}

export const metadata = { title: 'Organisations — Back-office' };

export default async function OrgsPage({ searchParams }: OrgsPageProps) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? '';
  const statusFilter = sp.status ?? '';
  const limit = parseInt(sp.limit ?? '50', 10);
  const offset = parseInt(sp.offset ?? '0', 10);

  // Fetch serveur — erreurs gérées dans adminListOrgs (renvoie [])
  const allOrgs = await adminListOrgs({
    q: q || undefined,
    limit,
    offset,
  });

  // Filtre statut côté front si query param fourni (le backend ne filtre pas
  // par statut via admin_list_orgs en Lot 1 — on filtre dans la page).
  const orgs =
    statusFilter
      ? allOrgs.filter((o) => o.status === (statusFilter as OrgStatus))
      : allOrgs;

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
        {/* Comptage : filtre statut appliqué EN MÉMOIRE sur la page courante (limit=50).
            Une org au-delà de la limite serait invisible. Pagination complète = dette. */}
        <span
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-muted)',
          }}
        >
          {orgs.length} résultat{orgs.length !== 1 ? 's' : ''}
          {limit <= 50 && allOrgs.length >= limit && ' (page limitée à 50)'}
        </span>
      </div>

      {/* Tableau interactif (Client Component) */}
      <OrgListClient orgs={orgs} q={q} status={statusFilter} />
    </>
  );
}
