'use client';

/**
 * AdminSidebar — back-office SUPERADMIN.
 * 2 entrées : Organisations / Utilisateurs.
 * Même palette que la Sidebar tenant (--surface-nav asphalte).
 */

import { Building2, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Logotype } from '@/components/ui/Logotype';

const NAV_ITEMS = [
  {
    id: 'orgs',
    label: 'Organisations',
    icon: <Building2 size={20} strokeWidth={1.5} aria-hidden="true" />,
    href: '/admin/orgs',
  },
  {
    id: 'users',
    label: 'Utilisateurs',
    icon: <Users size={20} strokeWidth={1.5} aria-hidden="true" />,
    href: '/admin/users',
  },
] as const;

export function AdminSidebar() {
  const pathname = usePathname();

  function isActive(href: string) {
    return pathname.startsWith(href);
  }

  return (
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

      {/* Styles responsive — masquer sur mobile */}
      <style>{`
        @media (max-width: 1023px) {
          .admin-sidebar { display: none !important; }
        }
      `}</style>
    </aside>
  );
}
