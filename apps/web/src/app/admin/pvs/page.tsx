/**
 * /admin/pvs — supervision des procès-verbaux, TOUTES organisations (SUPERADMIN-only).
 *
 * Server Component : fetch GET /admin/pvs (métadonnées seulement, recherche par numéro,
 * pagination). L'interactivité (recherche, pagination) est déléguée à PvListClient.
 */

import { redirect } from 'next/navigation';

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

  // Résultat discriminé : distingue panne backend (5xx/réseau) de supervision
  // vide (audit Lot 5bis, famine d'erreurs). unauthorized -> redirect (session
  // expirée entre la garde layout et cette page).
  const result = await adminListPvs({ q: q || undefined, limit, offset });

  if (!result.ok && result.reason === 'unauthorized') {
    redirect('/login');
  }
  const pvs = result.ok ? result.data : [];
  const fetchError = !result.ok;

  return (
    <>
      <div style={{ padding: '24px 24px 0', display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
          Procès-verbaux
        </h1>
        {!fetchError && (
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            {pvs.length} PV (page)
          </span>
        )}
      </div>
      <PvListClient pvs={pvs} q={q} limit={limit} offset={offset} fetchError={fetchError} />
    </>
  );
}
