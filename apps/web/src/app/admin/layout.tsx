/**
 * Shell /admin — back-office SUPERADMIN.
 *
 * Garde SERVEUR : ce Server Component appelle GET /admin/me avec le token du
 * cookie avant de rendre quoi que ce soit. Si platformRole !== SUPERADMIN
 * (ou pas de token, ou backend indisponible), redirect /login — anti-énumération
 * (même comportement que 401 ou 403).
 *
 * Le front ne décide jamais l'autorisation : le backend @Roles(SUPERADMIN) reste
 * la frontière réelle ; cette garde est un 2e rideau UX côté serveur.
 *
 * Code-split automatique par le segment de route /admin : aucune page tenant
 * ne tire ce code, aucun import @roadsen/engines ne peut s'y glisser (DoD §8).
 */

import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { AdminNav } from '@/components/admin/AdminNav';
import { adminGetMe } from '@/lib/api/admin-server';

interface AdminLayoutProps {
  children: ReactNode;
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  // Garde serveur : appel GET /admin/me côté serveur avec le token cookie.
  // adminGetMe renvoie null si pas de token, si 401/403, ou si réseau KO.
  const me = await adminGetMe();

  if (me?.platformRole !== 'SUPERADMIN') {
    // Redirect /login — comportement identique qu'il s'agisse d'une absence
    // de token, d'un token valide non-SUPERADMIN, ou d'une erreur réseau.
    // Anti-énumération : on ne distingue pas 401 de 403.
    redirect('/login');
  }

  return (
    <>
      {/* Skip-link */}
      <a
        href="#admin-main"
        style={{
          position: 'absolute',
          top: -40,
          left: 8,
          padding: '8px 12px',
          background: 'var(--struct-petrole)',
          color: 'var(--struct-petrole-fg)',
          borderRadius: 'var(--radius-base)',
          fontSize: 'var(--text-sm)',
          fontWeight: 500,
          zIndex: 9999,
          textDecoration: 'none',
          transition: 'top var(--dur-fast)',
        }}
        className="admin-skip-link"
      >
        Aller au contenu principal
      </a>

      <AdminNav />

      <main
        id="admin-main"
        tabIndex={-1}
        style={{
          marginTop: 48,
          minHeight: 'calc(100vh - 48px)',
          background: 'var(--surface-canvas)',
          outline: 'none',
        }}
        className="admin-main"
      >
        {children}
      </main>

      <style>{`
        .admin-skip-link:focus {
          top: 8px;
        }
        @media (min-width: 1024px) {
          .admin-main {
            margin-left: 240px;
          }
        }
        @media (max-width: 1023px) {
          .admin-main {
            margin-left: 0;
          }
        }
      `}</style>
    </>
  );
}
