'use client';

/**
 * Partie interactive de /admin/users :
 * - Champ de recherche (met à jour l'URL query param `q`)
 * - Tableau dense des utilisateurs
 * - Actions Vague 2 : désactiver/réactiver un compte GLOBAL, reset du mot de passe.
 */

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';

import { Button } from '@/components/ui/Button';
import { CreateUserModal } from './CreateUserModal';
import {
  clientResetPassword,
  clientSetUserActive,
  type MutationError,
} from '@/lib/api/admin-mutations-client';
import type { AdminUserView } from '@/lib/api/admin-server';

interface UserListClientProps {
  users: AdminUserView[];
  q: string;
}

const btnStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  padding: '3px 9px',
  borderRadius: 'var(--radius-base)',
  border: '1px solid var(--border-default)',
  background: 'var(--surface-base)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export function UserListClient({ users, q }: UserListClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<AdminUserView | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetDone, setResetDone] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  function handleCreated() {
    router.refresh();
  }

  const updateSearch = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) params.set('q', value.trim());
      else params.delete('q');
      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`);
      });
    },
    [router, pathname, searchParams],
  );

  async function toggleActive(u: AdminUserView) {
    const next = !u.isActive;
    if (!window.confirm(`${next ? 'Réactiver' : 'Désactiver'} le compte ${u.email} ?`)) return;
    setError(null);
    setBusyId(u.userId);
    try {
      await clientSetUserActive(u.userId, next, crypto.randomUUID());
      router.refresh();
    } catch (e) {
      setError(`${u.email} : ${(e as MutationError).message ?? 'échec'}`);
    } finally {
      setBusyId(null);
    }
  }

  async function submitReset() {
    if (!resetFor) return;
    setError(null);
    setBusyId(resetFor.userId);
    try {
      await clientResetPassword(resetFor.userId, { newPassword }, crypto.randomUUID());
      setResetDone(true);
    } catch (e) {
      setError(`${resetFor.email} : ${(e as MutationError).message ?? 'échec'}`);
    } finally {
      setBusyId(null);
    }
  }

  function closeReset() {
    setResetFor(null);
    setNewPassword('');
    setResetDone(false);
  }

  return (
    <div style={{ padding: 'var(--sp-6)' }}>
      {/* Barre de recherche + création */}
      <div
        style={{
          marginBottom: 'var(--sp-4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ position: 'relative', maxWidth: 360, flex: '1 1 260px' }}>
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
          />
        </div>
        <Button variant="action" size="sm" onClick={() => setCreateOpen(true)}>
          Nouvel utilisateur
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            marginBottom: 'var(--sp-3)',
            padding: '8px 12px',
            borderRadius: 'var(--radius-base)',
            background: 'var(--status-fail-bg)',
            color: 'var(--status-fail-tx)',
            fontSize: 'var(--text-xs)',
          }}
        >
          {error}
        </div>
      )}

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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
            <thead>
              <tr
                style={{
                  background: 'rgba(31,78,74,0.04)',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                {['Utilisateur', 'Rôle plateforme', 'Statut', 'Organisations', 'Actions'].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    style={{
                      padding: '10px 14px',
                      textAlign: h === 'Organisations' ? 'right' : 'left',
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
                <tr key={u.userId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '10px 14px' }}>
                    <Link
                      href={`/admin/users/${u.userId}`}
                      className="admin-breadcrumb-link"
                      style={{ fontWeight: 500, color: 'var(--text-link)', textDecoration: 'none', marginBottom: 2, display: 'block' }}
                    >
                      {u.fullName}
                    </Link>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                      {u.email}
                    </div>
                  </td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>
                    {u.platformRole ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span
                      style={{
                        fontSize: 'var(--text-xs)',
                        color: u.isActive ? 'var(--status-pass-tx)' : 'var(--text-muted)',
                        background: u.isActive ? 'var(--status-pass-bg)' : 'rgba(0,0,0,0.05)',
                        padding: '2px 7px',
                        borderRadius: 'var(--radius-base)',
                        fontWeight: 500,
                      }}
                    >
                      {u.isActive ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: '10px 14px',
                      color: 'var(--text-secondary)',
                      textAlign: 'right',
                    }}
                  >
                    {u.nbOrgs}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        disabled={busyId === u.userId}
                        onClick={() => toggleActive(u)}
                        style={btnStyle}
                      >
                        {u.isActive ? 'Désactiver' : 'Réactiver'}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === u.userId}
                        onClick={() => setResetFor(u)}
                        style={btnStyle}
                      >
                        Reset mdp
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal reset mot de passe */}
      {resetFor && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Réinitialiser le mot de passe"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
          onClick={closeReset}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface-base)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--sp-6)',
              width: 420,
              maxWidth: '90vw',
              boxShadow: 'var(--elevation-modal, 0 20px 60px -20px rgba(0,0,0,0.4))',
            }}
          >
            <h3 style={{ margin: '0 0 8px', fontSize: 'var(--text-base)', color: 'var(--text-primary)' }}>
              Réinitialiser le mot de passe
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
              Compte : <strong>{resetFor.email}</strong>
            </p>
            {resetDone ? (
              <>
                <p
                  style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--status-pass-tx)',
                    marginBottom: 16,
                  }}
                >
                  ✓ Mot de passe réinitialisé. Communique-le à l&apos;utilisateur par un canal sûr —
                  il n&apos;est stocké nulle part.
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" onClick={closeReset} style={{ ...btnStyle, padding: '6px 14px' }}>
                    Fermer
                  </button>
                </div>
              </>
            ) : (
              <>
                <label
                  htmlFor="reset-pw"
                  style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginBottom: 4 }}
                >
                  Nouveau mot de passe (≥ 12 caractères)
                </label>
                <input
                  id="reset-pw"
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="off"
                  style={{
                    width: '100%',
                    height: 34,
                    padding: '0 10px',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-base)',
                    fontSize: 'var(--text-sm)',
                    background: 'var(--surface-base)',
                    color: 'var(--text-primary)',
                    boxSizing: 'border-box',
                    marginBottom: 16,
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button type="button" onClick={closeReset} style={{ ...btnStyle, padding: '6px 14px' }}>
                    Annuler
                  </button>
                  <button
                    type="button"
                    disabled={newPassword.length < 12 || busyId === resetFor.userId}
                    onClick={submitReset}
                    style={{
                      ...btnStyle,
                      padding: '6px 14px',
                      background: 'var(--accent-action, #a05226)',
                      color: '#fff',
                      borderColor: 'transparent',
                      opacity: newPassword.length < 12 ? 0.5 : 1,
                    }}
                  >
                    Réinitialiser
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal création d'utilisateur */}
      <CreateUserModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={handleCreated} />
    </div>
  );
}
