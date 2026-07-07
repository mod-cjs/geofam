'use client';

/**
 * AdminSidebar — back-office SUPERADMIN.
 * 5 entrées : Tableau de bord / Organisations / Abonnements / Audit / Utilisateurs.
 * Même palette que la Sidebar tenant (--surface-nav asphalte).
 *
 * Responsive : sidebar fixe en desktop (>=1024px), drawer mobile en dessous
 * (piloté par AdminNav, même patron que la Sidebar tenant : bouton toggle,
 * overlay, inert/aria-hidden du main, fermeture ESC).
 */

import { Building2, FileCheck, LayoutDashboard, ScrollText, Users, Wallet, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Logotype } from '@/components/ui/Logotype';

const NAV_ITEMS = [
  {
    id: 'dashboard',
    label: 'Tableau de bord',
    icon: <LayoutDashboard size={20} strokeWidth={1.5} aria-hidden="true" />,
    href: '/admin',
  },
  {
    id: 'orgs',
    label: 'Organisations',
    icon: <Building2 size={20} strokeWidth={1.5} aria-hidden="true" />,
    href: '/admin/orgs',
  },
  {
    id: 'subscriptions',
    label: 'Abonnements',
    icon: <Wallet size={20} strokeWidth={1.5} aria-hidden="true" />,
    href: '/admin/subscriptions',
  },
  {
    id: 'audit',
    label: 'Audit',
    icon: <ScrollText size={20} strokeWidth={1.5} aria-hidden="true" />,
    href: '/admin/audit',
  },
  {
    id: 'pvs',
    label: 'PV',
    icon: <FileCheck size={20} strokeWidth={1.5} aria-hidden="true" />,
    href: '/admin/pvs',
  },
  {
    id: 'users',
    label: 'Utilisateurs',
    icon: <Users size={20} strokeWidth={1.5} aria-hidden="true" />,
    href: '/admin/users',
  },
] as const;

interface AdminNavContentProps {
  onClose?: () => void;
}

function AdminNavContent({ onClose }: AdminNavContentProps) {
  const pathname = usePathname();

  function isActive(href: string) {
    // '/admin' est le préfixe de TOUTES les routes back-office : l'entrée
    // Tableau de bord ne doit être active QUE sur /admin exactement.
    if (href === '/admin') return pathname === '/admin';
    return pathname.startsWith(href);
  }

  return (
    <>
      {/* Logotype */}
      <div
        style={{
          padding: '20px 16px',
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <Logotype size={36} />
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Fermer la navigation"
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-on-nav)',
              padding: 4,
              borderRadius: 'var(--radius-base)',
              display: 'flex',
            }}
          >
            <X size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Séparateur */}
      <div style={{ height: 1, background: 'var(--border-nav)', flexShrink: 0 }} />

      {/* Navigation */}
      <nav
        aria-label="Sections back-office"
        style={{ flex: 1, overflow: 'auto', padding: '8px 8px 0' }}
      >
        {/* Section label */}
        <div
          style={{
            fontSize: 11,
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--muted-on-nav)',
            padding: '12px 10px 6px',
          }}
        >
          Administration
        </div>

        <ul role="list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 10px',
                    borderRadius: 'var(--radius-base)',
                    textDecoration: 'none',
                    color: active ? 'var(--accent-action-on-nav)' : 'var(--text-on-nav)',
                    background: active ? 'rgba(31,78,74,0.12)' : 'transparent',
                    borderLeft: active
                      ? '3px solid var(--struct-petrole)'
                      : '3px solid transparent',
                    fontSize: 'var(--text-sm)',
                    fontWeight: active ? 500 : 400,
                    transition:
                      'background var(--dur-fast) var(--ease-state), color var(--dur-fast) var(--ease-state)',
                  }}
                  onMouseOver={(e) => {
                    if (!active)
                      (e.currentTarget as HTMLElement).style.background = 'var(--nav-hover)';
                  }}
                  onMouseOut={(e) => {
                    if (!active)
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

interface AdminSidebarProps {
  /** Piloté par AdminNav (état partagé avec le bouton hamburger de la topbar). */
  mobileOpen?: boolean;
  onClose?: () => void;
}

export function AdminSidebar({ mobileOpen = false, onClose }: AdminSidebarProps) {
  return (
    <>
      {/* Backdrop mobile */}
      {mobileOpen && (
        <div
          aria-hidden="true"
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(17,18,16,0.6)',
            zIndex: 40,
            display: 'none',
          }}
          className="admin-mobile-backdrop"
        />
      )}

      {/* Drawer mobile */}
      <aside
        id="admin-sidebar-drawer"
        aria-label="Navigation back-office"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: 280,
          background: 'var(--surface-nav)',
          zIndex: 50,
          transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform var(--dur-base) var(--ease-state)',
          display: 'none', // CSS media query l'active
          flexDirection: 'column',
          boxShadow: mobileOpen ? 'var(--elevation-modal)' : 'none',
        }}
        className="admin-sidebar-mobile"
      >
        <AdminNavContent onClose={onClose} />
      </aside>

      {/* Sidebar desktop */}
      <aside
        aria-label="Navigation back-office"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: 240,
          background: 'var(--surface-nav)',
          borderRight: '1px solid var(--border-nav)',
          zIndex: 30,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        className="admin-sidebar"
      >
        <AdminNavContent />
      </aside>

      {/* Styles responsive */}
      <style>{`
        @media (max-width: 1023px) {
          .admin-sidebar { display: none !important; }
          .admin-sidebar-mobile { display: flex !important; }
          .admin-mobile-backdrop { display: block !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          .admin-sidebar-mobile { transition: none !important; }
        }
      `}</style>
    </>
  );
}
