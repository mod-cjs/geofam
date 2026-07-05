/**
 * /admin/subscriptions — console d'abonnements (vue money-centrée).
 *
 * Server Component : fetch GET /admin/subscriptions avec filtre/tri/pagination
 * portés par les query params. Partie interactive déléguée à
 * SubscriptionsClient (Client Component, met à jour l'URL).
 */

import type { AdminOrgSort, SubscriptionFilter } from '@/lib/api/admin-server';
import { adminListSubscriptions } from '@/lib/api/admin-server';
import { SubscriptionsClient } from '@/components/admin/SubscriptionsClient';

interface SearchParams {
  filter?: string;
  sort?: string;
  limit?: string;
  offset?: string;
}

interface SubscriptionsPageProps {
  searchParams: Promise<SearchParams>;
}

export const metadata = { title: 'Abonnements — Back-office' };

const VALID_FILTERS: SubscriptionFilter[] = [
  'expired',
  'expiring',
  'noquota',
  'nosub',
  'withsub',
];
const VALID_SORTS: AdminOrgSort[] = ['name', 'createdAt', 'quota', 'expiration'];
const DEFAULT_LIMIT = 50;

export default async function SubscriptionsPage({ searchParams }: SubscriptionsPageProps) {
  const sp = await searchParams;
  const filter = VALID_FILTERS.includes(sp.filter as SubscriptionFilter)
    ? (sp.filter as SubscriptionFilter)
    : undefined;
  const sort = VALID_SORTS.includes(sp.sort as AdminOrgSort)
    ? (sp.sort as AdminOrgSort)
    : undefined;
  const limit = Number.parseInt(sp.limit ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT;
  const offset = Number.parseInt(sp.offset ?? '0', 10) || 0;

  const orgs = await adminListSubscriptions({ filter, sort, limit, offset });

  return (
    <>
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
          Abonnements
        </h1>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
          {orgs.length} résultat{orgs.length !== 1 ? 's' : ''} (page)
        </span>
      </div>

      <SubscriptionsClient
        orgs={orgs}
        filter={filter ?? ''}
        sort={sort ?? ''}
        limit={limit}
        offset={offset}
      />
    </>
  );
}
