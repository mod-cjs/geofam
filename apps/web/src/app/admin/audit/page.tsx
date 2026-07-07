/**
 * /admin/audit — journal d'audit GLOBAL (toutes orgs, SUPERADMIN-only).
 *
 * Server Component : fetch GET /admin/audit avec les filtres/pagination portés
 * par les query params (action, actor, from, to, limit, offset). La partie
 * interactive (formulaire de filtre, pagination) est déléguée à
 * GlobalAuditClient (Client Component) qui met à jour l'URL.
 */

import { redirect } from 'next/navigation';

import { adminListGlobalAudit } from '@/lib/api/admin-server';
import { GlobalAuditClient } from '@/components/admin/GlobalAuditClient';

interface SearchParams {
  action?: string;
  actor?: string;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
}

interface AuditPageProps {
  searchParams: Promise<SearchParams>;
}

export const metadata = { title: 'Audit — Back-office' };

const DEFAULT_LIMIT = 50;

export default async function GlobalAuditPage({ searchParams }: AuditPageProps) {
  const sp = await searchParams;
  const action = sp.action?.trim() ?? '';
  const actor = sp.actor?.trim() ?? '';
  const from = sp.from?.trim() ?? '';
  const to = sp.to?.trim() ?? '';
  // clamp [1,100] : une URL ?limit=500 provoquait un 400 backend (Zod max 100) -> page vide
  const limit = Math.min(100, Math.max(1, Number.parseInt(sp.limit ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
  const offset = Number.parseInt(sp.offset ?? '0', 10) || 0;

  // Résultat discriminé : distingue panne backend (5xx/réseau) de journal vide
  // (audit Lot 5bis, famine d'erreurs). unauthorized -> redirect (session
  // expirée entre la garde layout et cette page).
  const result = await adminListGlobalAudit({
    action: action || undefined,
    actor: actor || undefined,
    from: from || undefined,
    to: to || undefined,
    limit,
    offset,
  });

  if (!result.ok && result.reason === 'unauthorized') {
    redirect('/login');
  }
  const entries = result.ok ? result.data : [];
  const fetchError = !result.ok;

  return (
    <>
      <div
        style={{
          padding: '24px 24px 0',
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
        }}
      >
        <h1
          style={{
            fontSize: 'var(--text-lg)',
            fontWeight: 600,
            color: 'var(--text-primary)',
            margin: 0,
          }}
        >
          Journal d&apos;audit
        </h1>
        {!fetchError && (
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            {entries.length} entrée{entries.length !== 1 ? 's' : ''} (page)
          </span>
        )}
      </div>

      <GlobalAuditClient
        entries={entries}
        action={action}
        actor={actor}
        from={from}
        to={to}
        limit={limit}
        offset={offset}
        fetchError={fetchError}
      />
    </>
  );
}
