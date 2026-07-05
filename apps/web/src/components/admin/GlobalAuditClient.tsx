'use client';

/**
 * Partie interactive de /admin/audit :
 * - Filtres (action, acteur, période) → query params
 * - Pagination (limit/offset) → query params
 * - Tableau (mêmes conventions visuelles que AuditTab, org-scopé)
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 */

import { useCallback, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

import type { AuditEntryView } from '@/lib/api/admin-server';

interface GlobalAuditClientProps {
  entries: AuditEntryView[];
  action: string;
  actor: string;
  from: string;
  to: string;
  limit: number;
  offset: number;
}

export function GlobalAuditClient({
  entries,
  action,
  actor,
  from,
  to,
  limit,
  offset,
}: GlobalAuditClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Champs contrôlés localement (soumission explicite, pas de debounce réseau
  // à chaque frappe — le filtre `actor` est un UUID, `action` un marqueur exact).
  const [actionDraft, setActionDraft] = useState(action);
  const [actorDraft, setActorDraft] = useState(actor);
  const [fromDraft, setFromDraft] = useState(from);
  const [toDraft, setToDraft] = useState(to);

  const applyFilters = useCallback(
    (overrides?: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      const next: Record<string, string> = {
        action: actionDraft,
        actor: actorDraft,
        from: fromDraft,
        to: toDraft,
        ...overrides,
      };
      for (const [key, value] of Object.entries(next)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      // Toute nouvelle recherche repart de la 1re page.
      params.delete('offset');
      router.replace(`${pathname}?${params.toString()}`);
    },
    [actionDraft, actorDraft, fromDraft, toDraft, pathname, router, searchParams],
  );

  const goToOffset = useCallback(
    (newOffset: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (newOffset > 0) params.set('offset', String(newOffset));
      else params.delete('offset');
      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  return (
    <div style={{ padding: 'var(--sp-6)' }}>
      {/* Barre de filtres */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          applyFilters();
        }}
        style={{
          display: 'flex',
          gap: 'var(--sp-3)',
          marginBottom: 'var(--sp-4)',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        <Field label="Action">
          <input
            type="text"
            aria-label="Filtrer par action"
            placeholder="ex. QUOTA_TOPUP"
            value={actionDraft}
            onChange={(e) => setActionDraft(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Acteur (UUID)">
          <input
            type="text"
            aria-label="Filtrer par acteur"
            placeholder="uuid superadmin"
            value={actorDraft}
            onChange={(e) => setActorDraft(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Depuis">
          <input
            type="date"
            aria-label="Depuis le"
            value={fromDraft}
            onChange={(e) => setFromDraft(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Jusqu'à">
          <input
            type="date"
            aria-label="Jusqu'au"
            value={toDraft}
            onChange={(e) => setToDraft(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <button type="submit" style={submitButtonStyle}>
          Filtrer
        </button>
        {(action || actor || from || to) && (
          <button
            type="button"
            onClick={() => {
              setActionDraft('');
              setActorDraft('');
              setFromDraft('');
              setToDraft('');
              applyFilters({ action: '', actor: '', from: '', to: '' });
            }}
            style={{ ...submitButtonStyle, background: 'transparent', color: 'var(--text-secondary)' }}
          >
            Réinitialiser
          </button>
        )}
      </form>

      {/* Tableau */}
      <div
        style={{
          background: 'var(--surface-base)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--elevation-card)',
          overflow: 'hidden',
        }}
      >
        {entries.length === 0 ? (
          <div
            style={{
              padding: '48px 24px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            {action || actor || from || to
              ? 'Aucune entrée ne correspond aux filtres.'
              : "Aucune entrée dans le journal d'audit."}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
              <thead>
                <tr
                  style={{
                    background: 'rgba(31,78,74,0.04)',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  {['Date', 'Action', 'Acteur', 'Cible', 'Motif'].map((h) => (
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
                {entries.map((entry) => (
                  <tr key={entry.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td
                      style={{
                        padding: '10px 14px',
                        color: 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-xs)',
                      }}
                    >
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 7px',
                          borderRadius: 'var(--radius-base)',
                          fontSize: 'var(--text-xs)',
                          fontWeight: 500,
                          background: 'rgba(0,0,0,0.05)',
                          color: 'var(--text-secondary)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {entry.action}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: '10px 14px',
                        color: 'var(--text-secondary)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-xs)',
                      }}
                    >
                      {entry.actorUserId.slice(0, 8)}&hellip;
                    </td>
                    <td
                      style={{
                        padding: '10px 14px',
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-xs)',
                      }}
                    >
                      {entry.targetUserId
                        ? `user:${entry.targetUserId.slice(0, 8)}…`
                        : entry.targetOrgId
                          ? `org:${entry.targetOrgId.slice(0, 8)}…`
                          : '—'}
                    </td>
                    <td
                      style={{
                        padding: '10px 14px',
                        color: 'var(--text-secondary)',
                        maxWidth: 260,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={extractMotif(entry.payload)}
                    >
                      {extractMotif(entry.payload) || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 'var(--sp-2)',
          marginTop: 'var(--sp-3)',
        }}
      >
        <button
          type="button"
          onClick={() => goToOffset(Math.max(0, offset - limit))}
          disabled={offset === 0}
          style={{ ...pagerButtonStyle, opacity: offset === 0 ? 0.5 : 1 }}
        >
          Précédent
        </button>
        <button
          type="button"
          onClick={() => goToOffset(offset + limit)}
          disabled={entries.length < limit}
          style={{ ...pagerButtonStyle, opacity: entries.length < limit ? 0.5 : 1 }}
        >
          Suivant
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  height: 32,
  padding: '0 10px',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-base)',
  fontSize: 'var(--text-sm)',
  background: 'var(--surface-base)',
  color: 'var(--text-primary)',
  outline: 'none',
  boxSizing: 'border-box',
};

const submitButtonStyle: React.CSSProperties = {
  height: 32,
  padding: '0 14px',
  background: 'var(--struct-petrole)',
  color: 'var(--struct-petrole-fg)',
  border: 'none',
  borderRadius: 'var(--radius-base)',
  fontSize: 'var(--text-sm)',
  fontWeight: 500,
  cursor: 'pointer',
};

const pagerButtonStyle: React.CSSProperties = {
  height: 32,
  padding: '0 14px',
  background: 'var(--surface-base)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-base)',
  fontSize: 'var(--text-sm)',
  cursor: 'pointer',
};

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

function extractMotif(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'motif' in payload) {
    const motif = (payload as { motif: unknown }).motif;
    if (typeof motif === 'string') return motif;
  }
  return '';
}
