/**
 * /admin/pvs — supervision des procès-verbaux, TOUTES organisations (SUPERADMIN-only).
 *
 * Server Component : fetch GET /admin/pvs (métadonnées seulement, recherche par numéro,
 * pagination). L'interactivité (recherche, pagination) est déléguée à PvListClient.
 */

import { PvListClient } from '@/components/admin/PvListClient';
import { adminListPvs } from '@/lib/api/admin-server';

interface SearchParams {
  q?: string;
  limit?: string;
  offset?: string;
}

interface PvsPageProps {
  searchParams: Promise<SearchParams>;
}

export const metadata = { title: 'PV — Back-office' };

const DEFAULT_LIMIT = 50;

export default async function PvsPage({ searchParams }: PvsPageProps) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? '';
  const limit = Math.min(100, Math.max(1, Number.parseInt(sp.limit ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
  const offset = Number.parseInt(sp.offset ?? '0', 10) || 0;

  const pvs = await adminListPvs({ q: q || undefined, limit, offset });

  return (
    <>
      <div style={{ padding: '24px 24px 0', display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
          Procès-verbaux
        </h1>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
          {pvs.length} PV (page)
        </span>
      </div>
      <PvListClient pvs={pvs} q={q} limit={limit} offset={offset} />
    </>
  );
}
