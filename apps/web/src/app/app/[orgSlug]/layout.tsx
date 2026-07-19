/**
 * B-04 — Shell layout authentifié
 * Sidebar + Topbar + providers tenant.
 * Server Component — les composants interactifs sont Client.
 */

import type { ReactNode } from 'react';

import { HelpLauncher } from '@/components/shell/HelpLauncher';
import { Sidebar } from '@/components/shell/Sidebar';
import { Topbar } from '@/components/shell/Topbar';
import { Providers } from '@/providers';

interface ShellLayoutProps {
  children: ReactNode;
  params: Promise<{ orgSlug: string }>;
}

export default async function ShellLayout({ children, params }: ShellLayoutProps) {
  const { orgSlug } = await params;

  return (
    // data-theme="dark" scope l'app authentifiée à la palette maquette
    // (cf. globals.css §2) sans toucher le back-office /admin ni la landing
    // publique (choix de portée — voir Incrément 1 de la refonte).
    // min-height + background dark posés ICI (plutôt que sur html/body,
    // qui restent clairs pour /admin et la landing) : évite un flash clair
    // (body garde --surface-canvas clair, hors de ce wrapper) sur les pages
    // courtes/l'overscroll, sans effet de bord hors de ce sous-arbre.
    <div
      data-theme="dark"
      style={{ minHeight: '100vh', background: 'var(--surface-canvas)' }}
    >
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
        <HelpLauncher orgSlug={orgSlug} />

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
    </div>
  );
}
