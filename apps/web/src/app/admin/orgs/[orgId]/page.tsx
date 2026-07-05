/**
 * /admin/orgs/[orgId] — détail composite d'une organisation.
 * Onglets Membres | Abonnement | Usage. Lecture seule (Lot 1).
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { OrgDetailClient } from '@/components/admin/OrgDetailClient';
import { adminGetOrg } from '@/lib/api/admin-server';

interface OrgDetailPageProps {
  params: Promise<{ orgId: string }>;
}

export default async function OrgDetailPage({ params }: OrgDetailPageProps) {
  const { orgId } = await params;

  const detail = await adminGetOrg(orgId);

  if (!detail) {
    // 404 propre — pas d'information sur la raison (anti-énumération)
    notFound();
  }

  return (
    <>
      {/* Fil d'Ariane */}
      <div
        style={{
          padding: '16px 24px 0',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 'var(--text-sm)',
          color: 'var(--text-muted)',
        }}
      >
        <Link
          href="/admin/orgs"
          style={{ color: 'var(--text-link)', textDecoration: 'none' }}
          onMouseOver={(e) => {
            (e.currentTarget as HTMLElement).style.textDecoration = 'underline';
          }}
          onMouseOut={(e) => {
            (e.currentTarget as HTMLElement).style.textDecoration = 'none';
          }}
        >
          Organisations
        </Link>
        <span aria-hidden="true">/</span>
        <span style={{ color: 'var(--text-primary)' }}>{detail.org.name}</span>
      </div>

      {/* Contenu interactif */}
      <OrgDetailClient detail={detail} />
    </>
  );
}
