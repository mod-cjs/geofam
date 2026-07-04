/**
 * B-04 — Shell layout authentifié
 * Sidebar + Topbar + providers tenant.
 * Server Component — les composants interactifs sont Client.
 */

import type { ReactNode } from 'react';
import { Providers } from '@/providers';
import { Sidebar } from '@/components/shell/Sidebar';
import { Topbar } from '@/components/shell/Topbar';
import { DemoPanel } from '@/components/shell/DemoPanel';

interface ShellLayoutProps {
  children: ReactNode;
  params: Promise<{ orgSlug: string }>;
}

export default async function ShellLayout({ children, params }: ShellLayoutProps) {
  const { orgSlug } = await params;

  return (
    <Providers>
      {/* Skip-link */}
      <a
        href="#main"
        style={{
          position: 'absolute',
          top: -40,
          left: 8,
          padding: '8px 12px',
          background: 'var(--struct-petrole)',
          color: '#fff',
          borderRadius: 'var(--radius-base)',
          fontSize: 'var(--text-sm)',
          fontWeight: 500,
          zIndex: 9999,
          textDecoration: 'none',
          transition: 'top var(--dur-fast)',
        }}
        onFocus={undefined}
        className="skip-link"
      >
        Aller au contenu principal
      </a>

      <Sidebar orgSlug={orgSlug} />
      <Topbar orgSlug={orgSlug} />

      {/* Contenu principal — décalé selon la sidebar */}
      <main
        id="main"
        tabIndex={-1}
        style={{
          marginTop: 48, // hauteur topbar
          minHeight: 'calc(100vh - 48px)',
          background: 'var(--surface-canvas)',
          outline: 'none',
        }}
        className="shell-main"
      >
        {children}
      </main>

      <DemoPanel />

      <style>{`
        .skip-link:focus {
          top: 8px;
        }
        /* Décalage sidebar desktop */
        @media (min-width: 1024px) {
          .shell-main {
            margin-left: var(--shell-sidebar-w, 240px);
            transition: margin-left var(--dur-base) var(--ease-state);
          }
        }
        @media (max-width: 1023px) {
          .shell-main {
            margin-left: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .shell-main { transition: none; }
        }
      `}</style>
    </Providers>
  );
}
