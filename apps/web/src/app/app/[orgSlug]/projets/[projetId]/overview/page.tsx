'use client';

/**
 * B-12 — Onglet Vue d'ensemble
 * Synthèse : derniers calculs, derniers PV, compteurs.
 */

import { Calculator, FileCheck2, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { DomainTag } from '@/components/ui/DomainTag';
import type { Domain } from '@/components/ui/DomainTag';
import { Skeleton } from '@/components/ui/Skeleton.client';
import { getProjectCached, listCalcResults, listPvs } from '@/lib/api/client';
import type { CalcResult, OfficialPv, Project } from '@/lib/api/types';
import { metaOf } from '@/lib/engine-labels';
import { useOrgId } from '@/lib/org-context';

/**
 * Mapping engineId → domaine sémantique.
 * Source de vérité : mémoire geosuite-engine-mapping.
 * IDs alignés sur le vocabulaire d'entitlements (casagrande=pieux, geoplaque=radier, fastlab=labo).
 */
const ENGINE_DOMAIN: Record<string, Domain> = {
  burmister: 'road',
  pressiometre: 'lab',
  fastlab: 'lab',
  terzaghi: 'foundation',
  casagrande: 'foundation',
  geoplaque: 'foundation',
};

interface Props {
  params: Promise<{ orgSlug: string; projetId: string }>;
}

export default function OverviewPage({ params: paramsPromise }: Props) {
  const [orgSlug, setOrgSlug] = useState('');
  const [projetId, setProjetId] = useState('');
  // useOrgId résout le slug via le hook (null jusqu'à montage en mode réel),
  // ce qui aligne le comportement sur CalculsClient/PvListClient.
  const orgId = useOrgId(orgSlug);
  const [calculs, setCalculs] = useState<CalcResult[]>([]);
  const [pvs, setPvs] = useState<OfficialPv[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  // Étape 1 : extraire les paramètres de route depuis la Promise.
  useEffect(() => {
    paramsPromise.then(({ orgSlug: s, projetId: p }) => {
      setOrgSlug(s);
      setProjetId(p);
    });
  }, [paramsPromise]);

  // Étape 2 : charger les données une fois orgId résolu.
  useEffect(() => {
    if (!orgId || !projetId) return;
    // getProjectCached : partagé avec la bande projet — les compteurs affichés
    // ici viennent donc EXACTEMENT de la même source que les pastilles d'onglet.
    getProjectCached(orgId, projetId)
      .then(setProject)
      .catch(() => {});
    Promise.all([listCalcResults(orgId, projetId), listPvs(orgId, projetId)]).then(
      ([c, v]) => {
        setCalculs(c);
        setPvs(v);
        setLoading(false);
      },
    );
  }, [orgId, projetId]);

  if (loading) {
    return (
      <div
        style={{ padding: 24 }}
        aria-busy="true"
        aria-label="Chargement de la vue d'ensemble"
      >
        <Skeleton variant="text" style={{ width: 200, height: 24, marginBottom: 16 }} />
        <Skeleton variant="card-projet" />
      </div>
    );
  }

  // L'API renvoie ces listes triées du plus RÉCENT au plus ancien
  // (calc-results.service : orderBy createdAt desc ; pv.service : sealedAt desc).
  // `slice(-3)` prenait donc la QUEUE — les trois plus ANCIENS — sous le libellé
  // « Derniers … ». Le correctif est `slice(0, 3)`, sans `.reverse()`.
  const recentCalculs = calculs.slice(0, 3);
  const recentPvs = pvs.slice(0, 3);

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto', width: '100%' }}>
      {/* Compteurs */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 12,
          marginBottom: 32,
        }}
      >
        <StatCard
          label="Calculs"
          // Compteur servi par l'API (`calcCount`), PAS la longueur de la liste :
          // c'est la même source que les pastilles d'onglet, donc les deux ne
          // peuvent plus se contredire. Les listes ci-dessous restent chargées
          // pour AFFICHER les derniers éléments — jamais pour les compter.
          value={project?.calcCount ?? calculs.length}
          icon={<Calculator size={20} strokeWidth={1.5} aria-hidden="true" />}
        />
        <StatCard
          label="PV scellés"
          value={project?.pvCount ?? pvs.length}
          icon={<FileCheck2 size={20} strokeWidth={1.5} aria-hidden="true" />}
        />
      </div>

      {/* Derniers calculs */}
      <section aria-labelledby="recent-calculs">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <h2
            id="recent-calculs"
            style={{
              fontSize: 'var(--text-base)',
              fontWeight: 600,
              color: 'var(--text-primary)',
              margin: 0,
            }}
          >
            Derniers calculs
          </h2>
          <Link
            href={`/app/${orgSlug}/projets/${projetId}/calculs`}
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text-link)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            Voir tous <ArrowRight size={12} strokeWidth={1.5} aria-hidden="true" />
          </Link>
        </div>
        {recentCalculs.length === 0 ? (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            Aucun calcul encore.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recentCalculs.map((c) => (
              <Link
                key={c.id}
                href={`/app/${orgSlug}/projets/${projetId}/calculs`}
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
                <DomainTag domain={ENGINE_DOMAIN[c.engineId] ?? 'road'} size="compact" />
                <span
                  style={{
                    flex: 1,
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text-primary)',
                    fontWeight: 500,
                  }}
                >
                  {metaOf(c.engineId).nom}
                </span>
                <Badge
                  variant={
                    c.status === 'DONE'
                      ? 'recalculable'
                      : c.status === 'ERROR'
                        ? 'erreur'
                        : 'neutre'
                  }
                  label={c.status === 'DONE' ? 'Calculé' : c.status}
                />
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Derniers PV */}
      <section aria-labelledby="recent-pvs" style={{ marginTop: 28 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <h2
            id="recent-pvs"
            style={{
              fontSize: 'var(--text-base)',
              fontWeight: 600,
              color: 'var(--text-primary)',
              margin: 0,
            }}
          >
            Derniers PV scellés
          </h2>
          <Link
            href={`/app/${orgSlug}/projets/${projetId}/pv`}
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text-link)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            Voir tous <ArrowRight size={12} strokeWidth={1.5} aria-hidden="true" />
          </Link>
        </div>
        {recentPvs.length === 0 ? (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            Aucun PV émis.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recentPvs.map((pv) => (
              <Link
                key={pv.id}
                href={`/app/${orgSlug}/projets/${projetId}/pv`}
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
                <FileCheck2
                  size={16}
                  strokeWidth={1.5}
                  aria-hidden="true"
                  style={{ color: 'var(--struct-petrole-text)' }}
                />
                <span
                  style={{
                    flex: 1,
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text-primary)',
                    fontWeight: 500,
                  }}
                >
                  {pv.number}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-muted)',
                  }}
                >
                  {pv.hmacTruncated}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
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
      <div style={{ color: 'var(--struct-petrole-text)' }}>{icon}</div>
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
        <div
          style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 2 }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}
