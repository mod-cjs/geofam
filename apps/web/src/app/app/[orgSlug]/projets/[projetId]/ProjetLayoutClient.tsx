'use client';

/**
 * ProjetLayoutClient — bande projet 44px + onglets de navigation.
 * Persiste l'onglet actif via l'URL.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';

import { DomainTag } from '@/components/ui/DomainTag';
import { getProjectCached } from '@/lib/api/client';
import type { Project } from '@/lib/api/types';
import { useOrgId } from '@/lib/org-context';
import { projectRef } from '@/lib/project-ref';

interface Tab {
  id: string;
  label: string;
  href: string;
  pattern: RegExp;
  /** Clé de compteur affiché en pastille — absent = onglet sans compteur. */
  count?: 'calculs' | 'pv';
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
      count: 'calculs',
    },
    {
      id: 'pv',
      label: 'PV & Livrables',
      href: `${base}/pv`,
      pattern: /\/pv(\/|$)/,
      count: 'pv',
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
    // getProjectCached : partagé avec Topbar (fil d'Ariane) et PvListClient
    // (titre mnémonique) — évite un GET /projects/:id redondant, ces
    // composants n'étant pas dans une relation ancêtre/descendant.
    getProjectCached(orgId, projetId)
      .then(setProject)
      .catch(() => {});
  }, [orgId, projetId]);

  // Les compteurs viennent du projet lui-même (`calcCount` / `pvCount`, servis
  // par l'API). AUCUN appel de liste ici : la version précédente appelait
  // `listCalcResults` + `listPvs` uniquement pour lire leur longueur, ce qui
  // téléchargeait les lignes entières (`output` JSONB compris) — 2,5 Mo par
  // ouverture de projet, la liste des calculs étant même récupérée deux fois.
  // Règle : une liste ne sert jamais à compter.
  const counts = {
    calculs: project?.calcCount ?? null,
    pv: project?.pvCount ?? null,
  };

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
          {project && (
            <>
              {/* Référence courte : repère de lecture stable, dérivé de
                  l'identité du projet. Le seul numéro qui fait référence
                  reste celui du PV — d'où le libellé neutre « réf. ». */}
              <span
                title={`Référence courte du projet — ${projectRef(project)}`}
                style={{
                  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                  fontSize: 10.5,
                  letterSpacing: '0.04em',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '2px 6px',
                  lineHeight: 1,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {projectRef(project)}
              </span>
              <DomainTag domain={project.domain} />
            </>
          )}
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
                  <Link
                    href={tab.href}
                    role="tab"
                    aria-selected={active}
                    id={`tab-${tab.id}`}
                    // La pastille chiffrée est décorative (aria-hidden) : le
                    // compte est porté ici, sinon il serait perdu à l'oral.
                    aria-label={
                      tab.count && counts[tab.count] !== null
                        ? `${tab.label} (${counts[tab.count]})`
                        : undefined
                    }
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0 14px',
                      height: 44,
                      fontSize: 'var(--text-sm)',
                      fontWeight: active ? 600 : 400,
                      // État actif marqué en pétrole (règle shell : actif = pétrole, jamais latérite) :
                      // libellé pétrole + fond pétrole très léger + soulignement → présence sans casser l'identité.
                      color: active
                        ? 'var(--struct-petrole-text)'
                        : 'var(--text-secondary)',
                      // Teinte dérivée de la couleur d'état active : en dark le
                      // pétrole codé en dur était quasi invisible sur le panel.
                      background: active
                        ? 'color-mix(in srgb, var(--struct-petrole-text) 10%, transparent)'
                        : 'transparent',
                      gap: 7,
                      textDecoration: 'none',
                      borderBottom: active
                        ? '2px solid var(--struct-petrole-text)'
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
                    {/* Compteur : rendu seulement quand la valeur est CONNUE.
                        Tant qu'elle ne l'est pas, aucune pastille — mieux vaut
                        rien qu'un « 0 » qui se lirait comme « projet vide ». */}
                    {tab.count && counts[tab.count] !== null && (
                      <span
                        aria-hidden="true"
                        style={{
                          fontSize: 10.5,
                          fontWeight: 600,
                          lineHeight: 1,
                          padding: '2px 6px',
                          borderRadius: 999,
                          color: active
                            ? 'var(--struct-petrole-text)'
                            : 'var(--text-muted)',
                          background: active
                            ? 'color-mix(in srgb, var(--struct-petrole-text) 16%, transparent)'
                            : 'var(--surface-alt, rgba(127,127,127,0.12))',
                        }}
                      >
                        {counts[tab.count]}
                      </span>
                    )}
                  </Link>
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
