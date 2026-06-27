'use client';

/**
 * ProjetLayoutClient — bande projet 44px + onglets de navigation.
 * Persiste l'onglet actif via l'URL.
 */

import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { getProject } from '@/lib/api/client';
import type { Project } from '@/lib/api/types';
import { useOrgId } from '@/lib/org-context';

interface Tab {
  id: string;
  label: string;
  href: string;
  pattern: RegExp;
}

function buildTabs(orgSlug: string, projetId: string): Tab[] {
  const base = `/app/${orgSlug}/projets/${projetId}`;
  return [
    {
      id: 'overview',
      label: "Vue d'ensemble",
      href: `${base}/overview`,
      pattern: /\/overview$/,
    },
    {
      id: 'calculs',
      label: 'Calculs',
      href: `${base}/calculs`,
      pattern: /\/calculs(\/|$)/,
    },
    {
      id: 'pv',
      label: 'PV & Livrables',
      href: `${base}/pv`,
      pattern: /\/pv(\/|$)/,
    },
    {
      id: 'infos',
      label: 'Informations',
      href: `${base}/infos`,
      pattern: /\/infos$/,
    },
  ];
}

interface ProjetLayoutClientProps {
  children: ReactNode;
  orgSlug: string;
  projetId: string;
}

export default function ProjetLayoutClient({
  children,
  orgSlug,
  projetId,
}: ProjetLayoutClientProps) {
  const pathname = usePathname();
  const orgId = useOrgId(orgSlug);
  const [project, setProject] = useState<Project | null>(null);
  const tabs = buildTabs(orgSlug, projetId);

  useEffect(() => {
    if (!orgId) return;
    getProject(orgId, projetId)
      .then(setProject)
      .catch(() => {});
  }, [orgId, projetId]);

  function isTabActive(tab: Tab): boolean {
    return tab.pattern.test(pathname);
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 'calc(100vh - 48px)',
      }}
    >
      {/* Bande projet 44px */}
      <div
        style={{
          height: 44,
          background: 'var(--surface-base)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          gap: 16,
          flexShrink: 0,
          overflow: 'hidden',
          position: 'sticky',
          top: 48,
          zIndex: 10,
        }}
      >
        {/* Nom du projet */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 200,
            }}
            title={project?.name}
          >
            {project?.name ?? '—'}
          </span>
          {project && <Badge variant="neutre" label={project.domain} />}
        </div>

        {/* Séparateur vertical */}
        <div
          style={{
            width: 1,
            height: 20,
            background: 'var(--border-subtle)',
            flexShrink: 0,
          }}
        />

        {/* Onglets */}
        <nav
          aria-label="Onglets du projet"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 0,
            overflow: 'auto',
            scrollbarWidth: 'none',
          }}
        >
          <ul
            role="tablist"
            style={{ display: 'flex', listStyle: 'none', padding: 0, margin: 0, gap: 0 }}
          >
            {tabs.map((tab) => {
              const active = isTabActive(tab);
              return (
                <li key={tab.id} role="presentation">
                  <a
                    href={tab.href}
                    role="tab"
                    aria-selected={active}
                    id={`tab-${tab.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0 14px',
                      height: 44,
                      fontSize: 'var(--text-sm)',
                      fontWeight: active ? 600 : 400,
                      // État actif marqué en pétrole (règle shell : actif = pétrole, jamais latérite) :
                      // libellé pétrole + fond pétrole très léger + soulignement → présence sans casser l'identité.
                      color: active ? 'var(--struct-petrole)' : 'var(--text-secondary)',
                      background: active ? 'rgba(31, 78, 74, 0.07)' : 'transparent',
                      textDecoration: 'none',
                      borderBottom: active
                        ? '2px solid var(--struct-petrole)'
                        : '2px solid transparent',
                      transition: `color var(--dur-fast) var(--ease-state), border-color var(--dur-fast) var(--ease-state)`,
                      whiteSpace: 'nowrap',
                    }}
                    onMouseOver={(e) => {
                      if (!active)
                        (e.currentTarget as HTMLElement).style.color =
                          'var(--text-primary)';
                    }}
                    onMouseOut={(e) => {
                      if (!active)
                        (e.currentTarget as HTMLElement).style.color =
                          'var(--text-secondary)';
                    }}
                  >
                    {tab.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {/* Contenu de l'onglet */}
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}
