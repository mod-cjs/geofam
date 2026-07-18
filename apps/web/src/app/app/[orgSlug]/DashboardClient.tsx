'use client';

/**
 * Tableau de bord d'organisation (item PRODUIT #1).
 *
 * En-tête (bureau + rôle) · tuiles de synthèse (quota, projets, PV récents) ·
 * section Logiciels (6 cartes, gate entitlements — même logique que la
 * galerie) · projets récents · PV récents.
 *
 * Aucun nouveau backend : réutilise getEntitlements / listProjects / listPvs.
 * listPvs est par projet (pas d'endpoint org-wide) → agrégation client sur les
 * projets les plus récents via `mergeRecentPvs` (lib/dashboard-helpers.ts).
 */

import { Calculator, FileCheck2, FolderOpen, Lock } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import { QuotaBar } from '@/components/admin/QuotaBar';
import { NetworkErrorEmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton.client';
import { getEntitlements, getStoredOrgs, listPvs, listProjects } from '@/lib/api/client';
import type { EntitlementsResponse, OfficialPv, OrgClaim, Project } from '@/lib/api/types';
import { mergeRecentPvs, sortProjectsByRecency, type RecentPvEntry } from '@/lib/dashboard-helpers';
import { SOFTWARE_CATALOG } from '@/lib/software-catalog';
import { evaluateGate } from '@/lib/subscription-gate';
import { useOrgId } from '@/lib/org-context';

const RECENT_PROJECTS_LIMIT = 5;
const RECENT_PVS_LIMIT = 5;
/** Nombre de projets (les plus récents) sur lesquels on interroge les PV — borné pour rester léger. */
const PV_LOOKUP_PROJECT_LIMIT = 5;

interface Props {
  orgSlug: string;
}

export default function DashboardClient({ orgSlug }: Props) {
  const orgId = useOrgId(orgSlug);

  // Hydraté après montage — même init que SSR (getStoredOrgs lit sessionStorage,
  // null côté serveur) pour éviter le mismatch #418.
  const [orgs, setOrgs] = useState<OrgClaim[]>([]);
  useEffect(() => {
    setOrgs(getStoredOrgs());
  }, []);
  const currentOrg = orgs.find((o) => o.slug === orgSlug);
  const orgLabel = orgSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const [ent, setEnt] = useState<EntitlementsResponse | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [recentPvs, setRecentPvs] = useState<RecentPvEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [entitlements, allProjects] = await Promise.all([
          getEntitlements(orgId),
          listProjects(orgId),
        ]);
        if (cancelled) return;

        const sorted = sortProjectsByRecency(allProjects);
        setEnt(entitlements);
        setProjects(sorted);

        const lookupProjects = sorted.slice(0, PV_LOOKUP_PROJECT_LIMIT);
        const pvLists = await Promise.all(
          lookupProjects.map((p) =>
            listPvs(orgId, p.id).catch((): OfficialPv[] => []),
          ),
        );
        if (cancelled) return;
        setRecentPvs(mergeRecentPvs(pvLists, lookupProjects, RECENT_PVS_LIMIT));
        setLoading(false);
      } catch {
        if (!cancelled) {
          setError('Impossible de charger le tableau de bord. Vérifiez votre connexion.');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orgId, reloadToken]);

  if (loading) {
    return (
      <div style={{ padding: 24, maxWidth: 1080, margin: '0 auto' }} aria-busy="true" aria-label="Chargement du tableau de bord">
        <Skeleton variant="text" style={{ width: 220, height: 28, marginBottom: 24 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <Skeleton variant="card-projet" />
          <Skeleton variant="card-projet" />
          <Skeleton variant="card-projet" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, maxWidth: 1080, margin: '0 auto' }}>
        <NetworkErrorEmptyState onRetry={() => setReloadToken((n) => n + 1)} />
      </div>
    );
  }

  const recentProjects = projects.slice(0, RECENT_PROJECTS_LIMIT);

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 20px 56px' }}>
      {/* En-tête */}
      <header style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-secondary)' }}>
          Tableau de bord
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 24, margin: '4px 0 6px', color: 'var(--text-primary)' }}>{orgLabel}</h1>
          {currentOrg && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                color: 'var(--struct-petrole)',
                background: 'var(--status-pass-bg)',
                borderRadius: 20,
                padding: '2px 8px',
              }}
            >
              {currentOrg.role}
            </span>
          )}
        </div>
      </header>

      {/* Tuiles de synthèse */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
          marginBottom: 32,
        }}
      >
        <StatTile
          label="Projets"
          value={projects.length}
          icon={<FolderOpen size={20} strokeWidth={1.5} aria-hidden="true" />}
        />
        <StatTile
          label="PV scellés récents"
          value={recentPvs.length}
          icon={<FileCheck2 size={20} strokeWidth={1.5} aria-hidden="true" />}
        />
        <div
          style={{
            padding: '16px 20px',
            background: 'var(--surface-base)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--elevation-card)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ color: 'var(--struct-petrole)' }}>
            <Calculator size={20} strokeWidth={1.5} aria-hidden="true" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
              Quota {ent ? `· pack ${ent.pack}` : ''}
            </div>
            {ent && <QuotaBar consommation={ent.quota.used} quota={ent.quota.limit} width="100%" />}
            {ent?.expired && (
              <div style={{ fontSize: 11, color: 'var(--status-fail-tx)', marginTop: 4, fontWeight: 600 }}>
                Abonnement expiré
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Logiciels */}
      <section aria-labelledby="dashboard-logiciels" style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 id="dashboard-logiciels" style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Logiciels
          </h2>
          <Link
            href={`/app/${orgSlug}/logiciels`}
            style={{ fontSize: 'var(--text-xs)', color: 'var(--text-link)' }}
          >
            Voir la galerie complète →
          </Link>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {SOFTWARE_CATALOG.map((s) => {
            const gate = evaluateGate(ent, s.engineId);
            const clickable = gate.allowed;
            const card = (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '14px 16px',
                  background: 'var(--surface-base)',
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: 'var(--elevation-card)',
                  opacity: clickable ? 1 : 0.65,
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    flex: 'none',
                    display: 'grid',
                    placeItems: 'center',
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: 15,
                    background: s.accent,
                  }}
                >
                  {s.nom[0]}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{s.nom}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.tagline}
                  </div>
                </div>
                {!clickable && (
                  <Lock size={14} strokeWidth={2} aria-hidden="true" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                )}
              </div>
            );
            return clickable ? (
              <Link key={s.id} href={`/app/${orgSlug}/logiciels/${s.id}`} style={{ textDecoration: 'none' }}>
                {card}
              </Link>
            ) : (
              <div key={s.id} aria-disabled="true">
                {card}
              </div>
            );
          })}
        </div>
      </section>

      {/* Projets récents */}
      <section aria-labelledby="dashboard-projets" style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 id="dashboard-projets" style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Projets récents
          </h2>
          <Link href={`/app/${orgSlug}/projets`} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-link)' }}>
            Voir tous →
          </Link>
        </div>
        {recentProjects.length === 0 ? (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>Aucun projet pour le moment.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recentProjects.map((p) => (
              <Link
                key={p.id}
                href={`/app/${orgSlug}/projets/${p.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 14px',
                  background: 'var(--surface-base)',
                  borderRadius: 'var(--radius-base)',
                  boxShadow: 'var(--elevation-card)',
                  textDecoration: 'none',
                  color: 'var(--text-primary)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 500,
                }}
              >
                {p.name}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* PV récents */}
      <section aria-labelledby="dashboard-pvs">
        <h2 id="dashboard-pvs" style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 12px' }}>
          PV scellés récents
        </h2>
        {recentPvs.length === 0 ? (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>Aucun PV émis pour le moment.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recentPvs.map((pv) => (
              <Link
                key={pv.id}
                href={`/app/${orgSlug}/projets/${pv.projectId}/pv`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 14px',
                  background: 'var(--surface-base)',
                  borderRadius: 'var(--radius-base)',
                  boxShadow: 'var(--elevation-card)',
                  textDecoration: 'none',
                }}
              >
                <FileCheck2 size={16} strokeWidth={1.5} aria-hidden="true" style={{ color: 'var(--struct-petrole)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontWeight: 500 }}>
                  {pv.number}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{pv.projectName}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatTile({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div
      style={{
        padding: '16px 20px',
        background: 'var(--surface-base)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--elevation-card)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <div style={{ color: 'var(--struct-petrole)' }}>{icon}</div>
      <div>
        <div
          style={{
            fontSize: 'var(--text-2xl)',
            fontWeight: 600,
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1.1,
          }}
        >
          {value}
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
      </div>
    </div>
  );
}
