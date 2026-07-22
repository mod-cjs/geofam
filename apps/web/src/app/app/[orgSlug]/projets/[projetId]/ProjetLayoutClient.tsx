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

// Deux onglets (maquette finale, écran 2/3) : « Vue d'ensemble » et
// « Informations » disparaissent. Leurs seules informations réelles
// (compteurs, nom, domaine) sont déjà portées par cette bande (ci-dessous) et
// par la liste des projets — cf. rename-inline.test.tsx pour le renommage en
// ligne et les actions d'archivage désormais sur la liste, pas ici.
// L'ancienne route /overview et /infos ne disparaît pas pour autant : elle
// redirige vers Calculs plutôt que de laisser un 404 (des liens/signets
// existent) — cf. overview/page.tsx et infos/page.tsx.
function buildTabs(orgSlug: string, projetId: string): Tab[] {
  const base = `/app/${orgSlug}/projets/${projetId}`;
  return [
    {
      id: 'calculs',
      label: 'Calculs',
      href: `${base}/calculs`,
      pattern: /\/calculs(\/|$)/,
      count: 'calculs',
    },
    {
      id: 'pv',
      label: 'PV scellés',
      href: `${base}/pv`,
      pattern: /\/pv(\/|$)/,
      count: 'pv',
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
    // Hauteur BORNÉE (pas `minHeight`) : c'est la condition pour que l'onglet
    // Calculs puisse offrir un panneau de détail pleine hauteur avec défilement
    // interne, plutôt que de laisser croître la page entière. La hauteur vit
    // dans `.app-tab-shell` (globals.css) et non ici : elle a besoin de DEUX
    // déclarations `height` (repli `vh`, puis `dvh` qui l'écrase) — impossible
    // en style inline, où une clé ne peut pas se répéter. Sans `dvh`, la barre
    // du navigateur mobile pousserait le pied d'actions hors écran.
    <div
      className="app-tab-shell"
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {/* Bande projet 44px — les onglets suivent IMMÉDIATEMENT le groupe
          nom+tag (correction titulaire, maquette écran 2 : « le
          positionnement des onglets n'est pas correct »). Avant correction,
          un séparateur vertical isolait visuellement les deux groupes ; il
          disparaît (la maquette n'en porte pas). Aucune marge automatique
          n'est utilisée nulle part ici : c'est elle qui pousserait les
          onglets loin du reste au lieu de les faire suivre normalement. */}
      <div
        data-testid="projet-bande"
        style={{
          height: 44,
          background: 'var(--surface-base)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          gap: 12,
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

        {/* Onglets — second et DERNIER groupe de la bande, sans rien entre
            les deux : c'est ce qui les fait suivre visuellement le nom+tag
            plutôt que d'être perçus comme une zone à part. */}
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

      {/* Contenu de l'onglet — `minHeight: 0` est le correctif du piège flex
          classique : sans lui, ce conteneur grandirait avec son contenu au
          lieu de se borner à l'espace restant, et l'onglet Calculs ne pourrait
          jamais offrir un panneau pleine hauteur avec défilement interne.
          `overflow: auto` conserve un comportement de défilement NORMAL pour
          les onglets qui n'ont pas leur propre région de défilement interne
          (PV scellés) : leur contenu défile ici plutôt que dans le document,
          sans changement perceptible pour l'utilisateur. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'auto',
        }}
      >
        {children}
      </div>
    </div>
  );
}
