'use client';

/**
 * B-06 — Topbar contextuelle
 * 48px · breadcrumb · Cmd+K · CTA contextuel · avatar (sans cloche — F-06)
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Search } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Kbd } from '@/components/ui/Kbd';
import { useCommandPalette } from '@/components/ui/CommandPalette';
import { getStoredUser } from '@/lib/api/client';
import { useState, useEffect, type ReactNode } from 'react';
import { QuotaIndicator } from './QuotaIndicator';

interface TopbarProps {
  orgSlug: string;
  /** CTA contextuel — fourni par la page enfant via context ou slot */
  ctaSlot?: ReactNode;
  /** Fil d'Ariane personnalisé — segments [{label, href?}] */
  breadcrumbItems?: { label: string; href?: string }[];
}

export function Topbar({ orgSlug, ctaSlot, breadcrumbItems }: TopbarProps) {
  const pathname = usePathname();
  const { openPalette } = useCommandPalette();
  // Valeur hydratée après montage — même init que SSR (getStoredUser retourne null
  // côté serveur), mise à jour en useEffect pour éviter l'erreur React #418.
  const [user, setUser] = useState<{ name: string }>({ name: 'U' });
  useEffect(() => {
    const u = getStoredUser();
    if (u) setUser(u);
  }, []);

  // Fil d'Ariane par défaut depuis le pathname
  const defaultBreadcrumb = buildDefaultBreadcrumb(pathname, orgSlug);
  const segments = breadcrumbItems ?? defaultBreadcrumb;

  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        left: 0,
        height: 48,
        background: 'var(--surface-nav)',
        boxShadow: 'var(--elevation-sticky)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 16px',
        zIndex: 20,
        '--surface-current': 'var(--surface-nav)',
      } as React.CSSProperties}
    >
      {/* Espace pour sidebar (ajusté via CSS) */}
      <div className="topbar-sidebar-offset" style={{ flexShrink: 0 }} />

      {/* Breadcrumb */}
      <nav aria-label="Fil d'Ariane" style={{ flex: 1, minWidth: 0 }}>
        <Breadcrumb segments={segments} />
      </nav>

      {/* Cmd+K */}
      <button
        onClick={openPalette}
        aria-label="Rechercher ou lancer une action (Cmd+K)"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 10px',
          height: 30,
          background: 'var(--nav-hover)',
          border: '1px solid var(--border-nav)',
          borderRadius: 'var(--radius-base)',
          cursor: 'pointer',
          color: 'var(--muted-on-nav)',
          fontSize: 'var(--text-xs)',
          whiteSpace: 'nowrap',
          flexShrink: 0,
          transition: `background var(--dur-fast) var(--ease-state)`,
        }}
        onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.12)'; }}
        onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover)'; }}
      >
        <Search size={12} strokeWidth={1.5} aria-hidden="true" />
        <span>Rechercher…</span>
        <Kbd>⌘K</Kbd>
      </button>

      {/* Quota — indicateur compact et permanent (item PRODUIT #2) */}
      <QuotaIndicator orgSlug={orgSlug} />

      {/* CTA contextuel */}
      {ctaSlot && (
        <div style={{ flexShrink: 0 }}>
          {ctaSlot}
        </div>
      )}

      {/* Avatar (sans cloche — décision F-06) */}
      <Link
        href={`/app/${orgSlug}/compte`}
        aria-label={`Mon compte — ${user.name}`}
        style={{ flexShrink: 0, display: 'flex', textDecoration: 'none' }}
      >
        <Avatar name={user.name} size="sm" />
      </Link>

      <style>{`
        @media (max-width: 1023px) {
          .topbar-sidebar-offset { width: 48px !important; }
        }
        @media (min-width: 1024px) {
          .topbar-sidebar-offset { width: 240px; }
        }
      `}</style>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDefaultBreadcrumb(
  pathname: string,
  orgSlug: string
): { label: string; href?: string }[] {
  const segments = pathname.split('/').filter(Boolean);
  // /app/[orgSlug]/projets/[projetId]/calculs/[calculId]
  const items: { label: string; href?: string }[] = [];

  if (segments.length >= 3 && segments[0] === 'app') {
    items.push({ label: 'Mes projets', href: `/app/${orgSlug}/projets` });
  }

  if (segments[2] === 'projets' && segments[3]) {
    // Nom du projet non disponible ici sans fetch — afficher l'ID tronqué
    const projetId = segments[3];
    items.push({
      label: `Projet ${projetId.slice(0, 8)}…`,
      href: `/app/${orgSlug}/projets/${projetId}`,
    });
  }

  if (segments[4] === 'calculs' && segments[5]) {
    items.push({ label: `Calcul ${segments[5].slice(0, 8)}…` });
  }

  if (segments[4] === 'pv' && segments[5]) {
    items.push({ label: `PV ${segments[5].slice(0, 8)}…` });
  }

  return items;
}
