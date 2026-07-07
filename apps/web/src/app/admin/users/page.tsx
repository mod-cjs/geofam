/**
 * /admin/users — recherche et liste des utilisateurs.
 * Server Component : fetch avec le token cookie.
 */

import { redirect } from 'next/navigation';

import { adminSearchUsers } from '@/lib/api/admin-server';
import { UserListClient } from '@/components/admin/UserListClient';

interface SearchParams {
  q?: string;
  limit?: string;
}

interface UsersPageProps {
  searchParams: Promise<SearchParams>;
}

export const metadata = { title: 'Utilisateurs — Back-office' };

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? '';
  const limit = parseInt(sp.limit ?? '50', 10);

  // Résultat discriminé : distingue panne backend (5xx/réseau) de liste vide
  // (audit Lot 5bis, famine d'erreurs). unauthorized -> redirect (session
  // expirée entre la garde layout et cette page).
  const result = await adminSearchUsers({ q: q || undefined, limit });

  if (!result.ok && result.reason === 'unauthorized') {
    redirect('/login');
  }
  const users = result.ok ? result.data : [];
  const fetchError = !result.ok;

  return (
    <>
      {/* En-tête */}
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
          Utilisateurs
        </h1>
        {!fetchError && (
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            {users.length} résultat{users.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <UserListClient users={users} q={q} fetchError={fetchError} />
    </>
  );
}
