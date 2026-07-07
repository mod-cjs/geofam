/**
 * /admin/pvs/[pvId] — détail d'un PV (SUPERADMIN-only), supervision cross-tenant.
 *
 * Server Component pur : GET /admin/pvs/:pvId (adminGetPv) renvoie déjà `sealValid`
 * RE-VÉRIFIÉ serveur (secret PV_SIGNING_SECRET) — aucun gestionnaire d'événement
 * nécessaire ici (lecture seule), donc pas de composant client à extraire.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { adminGetPv } from '@/lib/api/admin-server';

interface PvDetailPageProps {
  params: Promise<{ pvId: string }>;
}

export const metadata = { title: 'PV — Back-office' };

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default async function PvDetailPage({ params }: PvDetailPageProps) {
  const { pvId } = await params;
  const pv = await adminGetPv(pvId);
  if (!pv) notFound();

  return (
    <div style={{ padding: 'var(--sp-6)', maxWidth: 720 }}>
      <Link
        href="/admin/pvs"
        style={{
          fontSize: 'var(--text-sm)',
          color: 'var(--text-secondary)',
          textDecoration: 'none',
        }}
      >
        ← Procès-verbaux
      </Link>

      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          marginTop: 12,
          marginBottom: 20,
        }}
      >
        <h1
          style={{
            fontSize: 'var(--text-lg)',
            fontWeight: 600,
            color: 'var(--text-primary)',
            margin: 0,
            fontFamily: 'var(--font-mono)',
          }}
        >
          {pv.pvNumber}
        </h1>
        <SealBadge sealValid={pv.sealValid} />
      </div>

      <div
        style={{
          background: 'var(--surface-base)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--elevation-card)',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <Field label="Organisation" value={pv.orgName} />
        <Field label="Projet" value={pv.projectName} />
        <Field label="Moteur" value={`${pv.engineId} · ${pv.engineVersion}`} />
        <Field label="Statut science" value={pv.scienceStatus} />
        <Field label="Verdict">
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              fontSize: 'var(--text-xs)',
              fontWeight: 500,
              padding: '2px 8px',
              borderRadius: 'var(--radius-base)',
              color: pv.verdict === 'CONFORME' ? 'var(--status-pass-tx)' : 'var(--text-muted)',
              background: pv.verdict === 'CONFORME' ? 'var(--status-pass-bg)' : 'rgba(0,0,0,0.05)',
            }}
          >
            {pv.verdict}
          </span>
        </Field>
        <Field label="Scellé le" value={formatDate(pv.sealedAt)} />
        <Field label="Vérification du sceau">
          <SealBadge sealValid={pv.sealValid} />
        </Field>
      </div>

      <p
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-muted)',
          marginTop: 16,
          lineHeight: 1.6,
        }}
      >
        Le sceau est re-vérifié côté serveur à chaque consultation (secret de scellement,
        jamais exposé au navigateur). Pas de téléchargement du PDF depuis le back-office —
        cette action reste tenant (organisation propriétaire du PV).
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 'var(--text-xs)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--text-secondary)',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
        {children ?? value ?? '—'}
      </div>
    </div>
  );
}

function SealBadge({ sealValid }: { sealValid: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 'var(--text-xs)',
        fontWeight: 600,
        padding: '3px 9px',
        borderRadius: 'var(--radius-base)',
        color: sealValid ? 'var(--status-pass-tx)' : 'var(--status-fail-tx)',
        background: sealValid ? 'var(--status-pass-bg)' : 'var(--status-fail-bg)',
      }}
    >
      {sealValid ? 'Sceau valide' : 'Sceau invalide'}
    </span>
  );
}
