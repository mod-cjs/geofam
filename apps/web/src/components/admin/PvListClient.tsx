'use client';

/**
 * Partie interactive de /admin/pvs : recherche par numéro (met à jour l'URL) + table
 * des PV (tous tenants, métadonnées) + pagination. Lecture seule (supervision).
 */

import { Search } from 'lucide-react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';

import type { AdminPvListItem } from '@/lib/api/admin-server';

interface PvListClientProps {
  pvs: AdminPvListItem[];
  q: string;
  limit: number;
  offset: number;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

export function PvListClient({ pvs, q, limit, offset }: PvListClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const navigate = useCallback(
    (next: { q?: string; offset?: number }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next.q !== undefined) {
        if (next.q.trim()) params.set('q', next.q.trim());
        else params.delete('q');
        params.delete('offset');
      }
      if (next.offset !== undefined) params.set('offset', String(Math.max(0, next.offset)));
      startTransition(() => router.replace(`${pathname}?${params.toString()}`));
    },
    [router, pathname, searchParams],
  );

  return (
    <div style={{ padding: 'var(--sp-6)' }}>
      <div style={{ marginBottom: 'var(--sp-4)', maxWidth: 360, position: 'relative' }}>
        <Search
          size={14}
          strokeWidth={1.5}
          aria-hidden="true"
          style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}
        />
        <input
          type="search"
          aria-label="Rechercher un PV par numéro"
          placeholder="Rechercher par numéro (PV-…)…"
          defaultValue={q}
          onChange={(e) => navigate({ q: e.target.value })}
          style={{
            width: '100%',
            height: 32,
            padding: '0 12px 0 32px',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-base)',
            fontSize: 'var(--text-sm)',
            background: 'var(--surface-base)',
            color: 'var(--text-primary)',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div
        style={{
          background: 'var(--surface-base)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--elevation-card)',
          overflow: 'hidden',
          opacity: isPending ? 0.7 : 1,
          transition: 'opacity var(--dur-fast)',
        }}
      >
        {pvs.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
            {q ? 'Aucun PV ne correspond à cette recherche.' : 'Aucun procès-verbal émis.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
            <thead>
              <tr style={{ background: 'rgba(31,78,74,0.04)', borderBottom: '1px solid var(--border-subtle)' }}>
                {['N° PV', 'Organisation', 'Projet', 'Moteur', 'Verdict', 'Scellé le'].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    style={{
                      padding: '10px 14px',
                      textAlign: 'left',
                      fontWeight: 500,
                      color: 'var(--text-secondary)',
                      fontSize: 'var(--text-xs)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pvs.map((p) => (
                <tr key={p.pvId} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                    {p.pvNumber}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ color: 'var(--text-primary)' }}>{p.orgName}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{p.orgSlug}</div>
                  </td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>{p.projectName}</td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>
                    {p.engineId}
                    <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}> {p.engineVersion}</span>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span
                      style={{
                        fontSize: 'var(--text-xs)',
                        fontWeight: 500,
                        padding: '2px 7px',
                        borderRadius: 'var(--radius-base)',
                        color: p.verdict === 'CONFORME' ? 'var(--status-pass-tx)' : 'var(--text-muted)',
                        background: p.verdict === 'CONFORME' ? 'var(--status-pass-bg)' : 'rgba(0,0,0,0.05)',
                      }}
                    >
                      {p.verdict}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {formatDate(p.sealedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 'var(--sp-3)' }}>
        <button
          type="button"
          disabled={offset <= 0 || isPending}
          onClick={() => navigate({ offset: offset - limit })}
          style={{ fontSize: 'var(--text-xs)', padding: '5px 12px', borderRadius: 'var(--radius-base)', border: '1px solid var(--border-default)', background: 'var(--surface-base)', color: 'var(--text-secondary)', cursor: offset <= 0 ? 'not-allowed' : 'pointer', opacity: offset <= 0 ? 0.5 : 1 }}
        >
          Précédent
        </button>
        <button
          type="button"
          disabled={pvs.length < limit || isPending}
          onClick={() => navigate({ offset: offset + limit })}
          style={{ fontSize: 'var(--text-xs)', padding: '5px 12px', borderRadius: 'var(--radius-base)', border: '1px solid var(--border-default)', background: 'var(--surface-base)', color: 'var(--text-secondary)', cursor: pvs.length < limit ? 'not-allowed' : 'pointer', opacity: pvs.length < limit ? 0.5 : 1 }}
        >
          Suivant
        </button>
      </div>
    </div>
  );
}
