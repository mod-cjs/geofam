'use client';

/**
 * Partie interactive de /admin/orgs :
 * - Champ de recherche (met à jour l'URL query param `q`)
 * - Filtre statut (query param `status`)
 * - Tableau dense (données reçues du Server Component parent)
 */

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';

import { OrgStatusBadge } from './OrgStatusBadge';
import { QuotaBar } from './QuotaBar';
import type { AdminOrgListItem, OrgStatus } from '@/lib/api/admin-server';

const STATUS_OPTIONS: { value: OrgStatus | ''; label: string }[] = [
  { value: '', label: 'Tous les statuts' },
  { value: 'ACTIVE', label: 'Actif' },
  { value: 'SUSPENDED', label: 'Suspendu' },
  { value: 'ARCHIVED', label: 'Archivé' },
];

interface OrgListClientProps {
  orgs: AdminOrgListItem[];
  q: string;
  status: string;
}

export function OrgListClient({ orgs, q, status }: OrgListClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`);
      });
    },
    [router, pathname, searchParams],
  );

  return (
    <div style={{ padding: 'var(--sp-6)' }}>
      {/* Barre de filtres */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--sp-3)',
          marginBottom: 'var(--sp-4)',
          flexWrap: 'wrap',
        }}
      >
        {/* Recherche */}
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 0 }}>
          <Search
            size={14}
            strokeWidth={1.5}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}
          />
          <input
            type="search"
            aria-label="Rechercher une organisation"
            placeholder="Rechercher par nom ou slug…"
            defaultValue={q}
            onChange={(e) => updateParam('q', e.target.value)}
            style={{
              width: '100%',
              height: 32,
              padding: '0 12px 0 32px',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-base)',
              fontSize: 'var(--text-sm)',
              background: 'var(--surface-base)',
              color: 'var(--text-primary)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            onFocus={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-focus)';
            }}
            onBlur={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-default)';
            }}
          />
        </div>

        {/* Filtre statut */}
        <select
          aria-label="Filtrer par statut"
          value={status}
          onChange={(e) => updateParam('status', e.target.value)}
          style={{
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
          }}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {/* Lien onboarding */}
        <Link
          href="/admin/orgs/new"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 32,
            padding: '0 14px',
            background: 'var(--struct-petrole)',
            color: 'var(--struct-petrole-fg)',
            borderRadius: 'var(--radius-base)',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            textDecoration: 'none',
            flexShrink: 0,
          }}
          onMouseOver={(e) => {
            (e.currentTarget as HTMLElement).style.opacity = '0.88';
          }}
          onMouseOut={(e) => {
            (e.currentTarget as HTMLElement).style.opacity = '1';
          }}
        >
          Nouvelle organisation
        </Link>
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
            {q || status ? 'Aucune organisation ne correspond aux critères.' : 'Aucune organisation.'}
          </div>
        ) : (
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 'var(--text-sm)',
            }}
          >
            <thead>
              <tr
                style={{
                  background: 'rgba(31,78,74,0.04)',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                {['Nom / Slug', 'Statut', 'Pack', 'Quota', 'Expiration', 'Membres'].map(
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
                <tr
                  key={org.id}
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  onMouseOver={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--row-hover-bg)';
                  }}
                  onMouseOut={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }}
                >
                  {/* Nom / Slug */}
                  <td style={{ padding: '10px 14px' }}>
                    <Link
                      href={`/admin/orgs/${org.id}`}
                      style={{
                        display: 'block',
                        textDecoration: 'none',
                        color: 'inherit',
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 500,
                          color: 'var(--text-primary)',
                          marginBottom: 2,
                        }}
                      >
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

                  {/* Statut */}
                  <td style={{ padding: '10px 14px' }}>
                    <OrgStatusBadge status={org.status} />
                  </td>

                  {/* Pack */}
                  <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>
                    {org.subscription?.pack ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>

                  {/* Quota */}
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

                  {/* Expiration */}
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
                      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>—</span>
                    )}
                  </td>

                  {/* Membres */}
                  <td
                    style={{
                      padding: '10px 14px',
                      color: 'var(--text-secondary)',
                      textAlign: 'right',
                      paddingRight: 20,
                    }}
                  >
                    {org.nbMembres}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
