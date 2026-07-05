'use client';

/**
 * Partie interactive de /admin/subscriptions :
 * - Filtre famille money (expired/expiring/noquota/nosub/withsub) → query param
 * - Tri (name/createdAt/quota/expiration) → query param
 * - Pagination (limit/offset) → query param
 * - Tableau : org, pack, quota (QuotaBar), consommation, expiration, statut.
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 */

import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';

import { OrgStatusBadge } from './OrgStatusBadge';
import { QuotaBar } from './QuotaBar';
import type { AdminOrgListItem } from '@/lib/api/admin-server';

const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Toutes' },
  { value: 'expired', label: 'Expirés' },
  { value: 'expiring', label: 'Expirant sous 30 j' },
  { value: 'noquota', label: 'Quota épuisé' },
  { value: 'nosub', label: 'Sans abonnement' },
  { value: 'withsub', label: 'Avec abonnement' },
];

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Tri par défaut (nom)' },
  { value: 'name', label: 'Nom' },
  { value: 'createdAt', label: 'Date de création' },
  { value: 'quota', label: 'Quota' },
  { value: 'expiration', label: 'Expiration' },
];

interface SubscriptionsClientProps {
  orgs: AdminOrgListItem[];
  filter: string;
  sort: string;
  limit: number;
  offset: number;
}

export function SubscriptionsClient({
  orgs,
  filter,
  sort,
  limit,
  offset,
}: SubscriptionsClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      // Changer un filtre/tri repart de la 1re page.
      params.delete('offset');
      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`);
      });
    },
    [router, pathname, searchParams],
  );

  const goToOffset = useCallback(
    (newOffset: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (newOffset > 0) params.set('offset', String(newOffset));
      else params.delete('offset');
      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`);
      });
    },
    [pathname, router, searchParams],
  );

  return (
    <div style={{ padding: 'var(--sp-6)' }}>
      {/* Filtres */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--sp-3)',
          marginBottom: 'var(--sp-4)',
          flexWrap: 'wrap',
        }}
      >
        <select
          aria-label="Filtrer par famille d'abonnement"
          value={filter}
          onChange={(e) => updateParam('filter', e.target.value)}
          style={selectStyle}
        >
          {FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Trier par"
          value={sort}
          onChange={(e) => updateParam('sort', e.target.value)}
          style={selectStyle}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Tableau */}
      <div
        style={{
          background: 'var(--surface-base)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--elevation-card)',
          overflow: 'hidden',
          opacity: isPending ? 0.7 : 1,
          transition: 'opacity var(--dur-fast)',
        }}
      >
        {orgs.length === 0 ? (
          <div
            style={{
              padding: '48px 24px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            Aucune organisation ne correspond à ce filtre.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
            <thead>
              <tr
                style={{
                  background: 'rgba(31,78,74,0.04)',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                {['Organisation', 'Pack', 'Quota', 'Consommation', 'Expiration', 'Statut'].map(
                  (h) => (
                    <th
                      key={h}
                      scope="col"
                      style={{
                        padding: '10px 14px',
                        textAlign: 'left',
                        fontWeight: 500,
                        color: 'var(--text-secondary)',
                        fontSize: 'var(--text-xs)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr key={org.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '10px 14px' }}>
                    <Link
                      href={`/admin/orgs/${org.id}`}
                      style={{ textDecoration: 'none', color: 'inherit' }}
                    >
                      <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                        {org.name}
                      </div>
                      <div
                        style={{
                          fontSize: 'var(--text-xs)',
                          color: 'var(--text-muted)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {org.slug}
                      </div>
                    </Link>
                  </td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>
                    {org.subscription?.pack ?? (
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    {org.subscription ? (
                      <QuotaBar
                        consommation={org.subscription.consommation}
                        quota={org.subscription.quota}
                        width={100}
                      />
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                        Sans abonnement
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>
                    {org.subscription ? org.subscription.consommation : '—'}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    {org.subscription ? (
                      <span
                        style={{
                          fontSize: 'var(--text-xs)',
                          color: org.subscription.expired
                            ? 'var(--status-fail-tx)'
                            : 'var(--text-secondary)',
                          fontWeight: org.subscription.expired ? 500 : 400,
                        }}
                      >
                        {formatDate(org.subscription.dateFin)}
                        {org.subscription.expired && ' — expiré'}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                        —
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <OrgStatusBadge status={org.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 'var(--sp-2)',
          marginTop: 'var(--sp-3)',
        }}
      >
        <button
          type="button"
          onClick={() => goToOffset(Math.max(0, offset - limit))}
          disabled={offset === 0}
          style={{ ...pagerButtonStyle, opacity: offset === 0 ? 0.5 : 1 }}
        >
          Précédent
        </button>
        <button
          type="button"
          onClick={() => goToOffset(offset + limit)}
          disabled={orgs.length < limit}
          style={{ ...pagerButtonStyle, opacity: orgs.length < limit ? 0.5 : 1 }}
        >
          Suivant
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const selectStyle: React.CSSProperties = {
  height: 32,
  padding: '0 28px 0 10px',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-base)',
  fontSize: 'var(--text-sm)',
  background: 'var(--surface-base)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  appearance: 'none',
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7077' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 8px center',
  outline: 'none',
};

const pagerButtonStyle: React.CSSProperties = {
  height: 32,
  padding: '0 14px',
  background: 'var(--surface-base)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-base)',
  fontSize: 'var(--text-sm)',
  cursor: 'pointer',
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}
