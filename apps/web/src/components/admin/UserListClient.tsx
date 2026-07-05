'use client';

/**
 * Partie interactive de /admin/users :
 * - Champ de recherche (met à jour l'URL query param `q`)
 * - Tableau dense des utilisateurs
 */

import { Search } from 'lucide-react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';

import type { AdminUserView } from '@/lib/api/admin-server';

interface UserListClientProps {
  users: AdminUserView[];
  q: string;
}

export function UserListClient({ users, q }: UserListClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const updateSearch = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) {
        params.set('q', value.trim());
      } else {
        params.delete('q');
      }
      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`);
      });
    },
    [router, pathname, searchParams],
  );

  return (
    <div style={{ padding: 'var(--sp-6)' }}>
      {/* Barre de recherche */}
      <div style={{ marginBottom: 'var(--sp-4)', maxWidth: 360 }}>
        <div style={{ position: 'relative' }}>
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
            aria-label="Rechercher un utilisateur"
            placeholder="Rechercher par email ou nom…"
            defaultValue={q}
            onChange={(e) => updateSearch(e.target.value)}
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
        {users.length === 0 ? (
          <div
            style={{
              padding: '48px 24px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            {q ? 'Aucun utilisateur ne correspond à la recherche.' : 'Aucun utilisateur.'}
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
                {['Utilisateur', 'Rôle plateforme', 'Statut', 'Organisations'].map((h) => (
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
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.userId}
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  onMouseOver={(e) => {
                    (e.currentTarget as HTMLElement).style.background =
                      'var(--row-hover-bg)';
                  }}
                  onMouseOut={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }}
                >
                  {/* Utilisateur */}
                  <td style={{ padding: '10px 14px' }}>
                    <div
                      style={{ fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2 }}
                    >
                      {u.fullName}
                    </div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                      {u.email}
                    </div>
                  </td>

                  {/* Rôle plateforme */}
                  <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>
                    {u.platformRole ?? (
                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </td>

                  {/* Statut */}
                  <td style={{ padding: '10px 14px' }}>
                    {u.isActive ? (
                      <span
                        style={{
                          fontSize: 'var(--text-xs)',
                          color: 'var(--status-pass-tx)',
                          background: 'var(--status-pass-bg)',
                          padding: '2px 7px',
                          borderRadius: 'var(--radius-base)',
                          fontWeight: 500,
                        }}
                      >
                        Actif
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: 'var(--text-xs)',
                          color: 'var(--text-muted)',
                          background: 'rgba(0,0,0,0.05)',
                          padding: '2px 7px',
                          borderRadius: 'var(--radius-base)',
                          fontWeight: 500,
                        }}
                      >
                        Inactif
                      </span>
                    )}
                  </td>

                  {/* Nombre d'orgs */}
                  <td
                    style={{
                      padding: '10px 14px',
                      color: 'var(--text-secondary)',
                      textAlign: 'right',
                      paddingRight: 20,
                    }}
                  >
                    {u.nbOrgs}
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
