/**
 * /admin — tableau de bord plateforme (landing back-office SUPERADMIN).
 *
 * Server Component : fetch GET /admin/stats (agrégats cross-tenant) + GET
 * /admin/audit (8 dernières entrées, flux d'activité). Aucune interactivité
 * ici (pas de gestionnaire d'événement) — uniquement des liens (Link) vers
 * les consoles dédiées (Organisations / Abonnements / Audit).
 */

import Link from 'next/link';

import {
  adminGetStats,
  adminListGlobalAudit,
  type AuditEntryView,
  type PlatformStats,
} from '@/lib/api/admin-server';

export const metadata = { title: 'Tableau de bord — Back-office' };

export default async function AdminDashboardPage() {
  const [stats, recentAudit] = await Promise.all([
    adminGetStats(),
    adminListGlobalAudit({ limit: 8 }),
  ]);

  return (
    <div style={{ padding: 'var(--sp-6)' }}>
      <h1
        style={{
          fontSize: 'var(--text-lg)',
          fontWeight: 600,
          color: 'var(--text-primary)',
          margin: '0 0 20px',
        }}
      >
        Tableau de bord
      </h1>

      {!stats ? (
        <ErrorPanel />
      ) : (
        <>
          <KpiGrid stats={stats} />
          <Alerts stats={stats} />
        </>
      )}

      <RecentActivity entries={recentAudit} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------

function KpiGrid({ stats }: { stats: PlatformStats }) {
  const cards: { label: string; value: string | number; sub?: string }[] = [
    {
      label: 'Organisations actives',
      value: stats.orgs.active,
      sub: `${stats.orgs.suspended} suspendue${stats.orgs.suspended !== 1 ? 's' : ''} · ${stats.orgs.archived} archivée${stats.orgs.archived !== 1 ? 's' : ''}`,
    },
    { label: 'Utilisateurs', value: stats.usersTotal },
    { label: 'Appartenances actives', value: stats.membershipsActive },
    { label: 'PV émis', value: stats.pvTotal },
    {
      label: 'Quota consommé',
      value: `${stats.quota.consommeTotal} / ${stats.quota.allouTotal}`,
    },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 'var(--sp-4)',
        marginBottom: 'var(--sp-5)',
      }}
    >
      {cards.map((c) => (
        <div
          key={c.label}
          style={{
            background: 'var(--surface-base)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--elevation-card)',
            padding: '16px 18px',
          }}
        >
          <div
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 6,
            }}
          >
            {c.label}
          </div>
          <div
            style={{
              fontSize: 'var(--text-xl, 28px)',
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            {c.value}
          </div>
          {c.sub && (
            <div
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--text-muted)',
                marginTop: 4,
              }}
            >
              {c.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alertes (abonnements expirant / quotas au taquet)
// ---------------------------------------------------------------------------

function Alerts({ stats }: { stats: PlatformStats }) {
  const items: { text: string; tone: 'fail' | 'warn' }[] = [];

  if (stats.abonnements.expires > 0) {
    items.push({
      text: `${stats.abonnements.expires} abonnement${stats.abonnements.expires !== 1 ? 's' : ''} expiré${stats.abonnements.expires !== 1 ? 's' : ''}`,
      tone: 'fail',
    });
  }
  if (stats.abonnements.expirant30j > 0) {
    items.push({
      text: `${stats.abonnements.expirant30j} abonnement${stats.abonnements.expirant30j !== 1 ? 's' : ''} expirant sous 30 jours`,
      tone: 'warn',
    });
  }
  if (stats.abonnements.orgsQuota90pct > 0) {
    items.push({
      text: `${stats.abonnements.orgsQuota90pct} organisation${stats.abonnements.orgsQuota90pct !== 1 ? 's' : ''} à ≥ 90 % de quota`,
      tone: 'warn',
    });
  }
  if (stats.abonnements.orgsSansAbo > 0) {
    items.push({
      text: `${stats.abonnements.orgsSansAbo} organisation${stats.abonnements.orgsSansAbo !== 1 ? 's' : ''} sans abonnement`,
      tone: 'warn',
    });
  }

  if (items.length === 0) {
    return (
      <div
        style={{
          padding: '14px 18px',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--status-pass-bg)',
          color: 'var(--status-pass-tx)',
          fontSize: 'var(--text-sm)',
          marginBottom: 'var(--sp-5)',
        }}
      >
        Aucune alerte : abonnements et quotas sains.
      </div>
    );
  }

  return (
    <div
      style={{
        background: 'var(--surface-base)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--elevation-card)',
        padding: '4px 0',
        marginBottom: 'var(--sp-5)',
      }}
    >
      <div
        style={{
          padding: '12px 18px 6px',
          fontSize: 'var(--text-xs)',
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--text-secondary)',
        }}
      >
        Alertes
      </div>
      <ul role="list" style={{ listStyle: 'none', margin: 0, padding: '0 8px 8px' }}>
        {items.map((it, i) => (
          <li
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 10px',
              fontSize: 'var(--text-sm)',
              color: it.tone === 'fail' ? 'var(--status-fail-tx)' : 'var(--text-primary)',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                flexShrink: 0,
                background: it.tone === 'fail' ? 'var(--status-fail-tx)' : '#b86a2e',
              }}
            />
            {it.text}
          </li>
        ))}
      </ul>
      <div style={{ padding: '0 18px 10px', display: 'flex', gap: 16 }}>
        <Link
          href="/admin/subscriptions?filter=expiring"
          style={{ fontSize: 'var(--text-xs)', color: 'var(--struct-petrole)' }}
        >
          Voir les abonnements expirants →
        </Link>
        <Link
          href="/admin/subscriptions?filter=nosub"
          style={{ fontSize: 'var(--text-xs)', color: 'var(--struct-petrole)' }}
        >
          Voir les orgs sans abonnement →
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flux d'activité récent
// ---------------------------------------------------------------------------

function RecentActivity({ entries }: { entries: AuditEntryView[] }) {
  return (
    <div
      style={{
        background: 'var(--surface-base)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--elevation-card)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span
          style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--text-secondary)',
          }}
        >
          Activité récente
        </span>
        <Link
          href="/admin/audit"
          style={{ fontSize: 'var(--text-xs)', color: 'var(--struct-petrole)' }}
        >
          Journal complet →
        </Link>
      </div>

      {entries.length === 0 ? (
        <div
          style={{
            padding: '32px 18px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 'var(--text-sm)',
          }}
        >
          Aucune activité récente.
        </div>
      ) : (
        <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {entries.map((e) => (
            <li
              key={e.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 18px',
                borderBottom: '1px solid var(--border-subtle)',
                fontSize: 'var(--text-sm)',
              }}
            >
              <span style={{ color: 'var(--text-primary)' }}>{e.action}</span>
              <span
                style={{
                  color: 'var(--text-muted)',
                  fontSize: 'var(--text-xs)',
                  fontFamily: 'var(--font-mono)',
                  whiteSpace: 'nowrap',
                }}
              >
                {formatDateTime(e.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ErrorPanel() {
  return (
    <div
      role="alert"
      style={{
        padding: '16px 18px',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--status-fail-bg)',
        color: 'var(--status-fail-tx)',
        fontSize: 'var(--text-sm)',
        marginBottom: 'var(--sp-5)',
      }}
    >
      Impossible de charger les statistiques de la plateforme (backend indisponible ou
      erreur réseau).
    </div>
  );
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
