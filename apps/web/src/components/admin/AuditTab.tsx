'use client';

/**
 * AuditTab — journal d'audit d'une organisation (Lot 2).
 *
 * Charge GET /admin/orgs/:orgId/audit au montage et au rechargement.
 * Affiche : action · acteur (userId tronqué) · cible · motif (extrait du payload) · date.
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 */

import { useEffect, useState, useCallback } from 'react';

import { Button } from '@/components/ui/Button';
import { clientListAudit } from '@/lib/api/admin-mutations-client';
import type { AuditEntryView } from '@/lib/api/admin-server';

interface AuditTabProps {
  orgId: string;
}

export function AuditTab({ orgId }: AuditTabProps) {
  const [entries, setEntries] = useState<AuditEntryView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await clientListAudit(orgId, { limit: 50 });
      setEntries(data);
    } catch (err) {
      setError(extractMessage(err));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && entries === null) {
    return (
      <div
        style={{
          padding: '40px 24px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 'var(--text-sm)',
        }}
        aria-busy="true"
        aria-label="Chargement du journal…"
      >
        Chargement…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '24px' }}>
        <p
          role="alert"
          style={{ color: 'var(--status-fail-tx)', fontSize: 'var(--text-sm)', margin: '0 0 12px' }}
        >
          {error}
        </p>
        <Button variant="ghost" size="sm" onClick={() => void load()} loading={loading}>
          Réessayer
        </Button>
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <div
        style={{
          padding: '40px 24px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 'var(--text-sm)',
        }}
      >
        Aucune entrée dans le journal d&apos;audit.
      </div>
    );
  }

  return (
    <div>
      {/* Barre de rechargement */}
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'flex-end',
        }}
      >
        <Button variant="ghost" size="sm" onClick={() => void load()} loading={loading}>
          Actualiser
        </Button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}
        >
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {['Date', 'Action', 'Acteur', 'Cible', 'Motif'].map((h) => (
                <th
                  key={h}
                  scope="col"
                  style={{
                    padding: '10px 16px',
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
              <tr
                key={entry.id}
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                <td
                  style={{
                    padding: '10px 16px',
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                  }}
                >
                  {formatDateTime(entry.createdAt)}
                </td>
                <td style={{ padding: '10px 16px' }}>
                  <ActionLabel action={entry.action} />
                </td>
                <td
                  style={{
                    padding: '10px 16px',
                    color: 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                  }}
                >
                  {entry.actorUserId.slice(0, 8)}&hellip;
                </td>
                <td
                  style={{
                    padding: '10px 16px',
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
                    padding: '10px 16px',
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composants de rendu
// ---------------------------------------------------------------------------

function ActionLabel({ action }: { action: string }) {
  const variant = actionVariant(action);
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 7px',
        borderRadius: 'var(--radius-base)',
        fontSize: 'var(--text-xs)',
        fontWeight: 500,
        background: variant.bg,
        color: variant.tx,
        whiteSpace: 'nowrap',
      }}
    >
      {action}
    </span>
  );
}

function actionVariant(action: string): { bg: string; tx: string } {
  const a = action.toLowerCase();
  if (a.includes('suspend') || a.includes('remov') || a.includes('archive')) {
    return {
      bg: 'var(--status-fail-bg)',
      tx: 'var(--status-fail-tx)',
    };
  }
  if (a.includes('topup') || a.includes('renew') || a.includes('quota')) {
    return {
      bg: 'rgba(31,78,74,0.08)',
      tx: 'var(--struct-petrole)',
    };
  }
  return {
    bg: 'rgba(0,0,0,0.05)',
    tx: 'var(--text-secondary)',
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Extrait le champ `motif` du payload JSON s'il existe. */
function extractMotif(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'motif' in payload) {
    const motif = (payload as { motif: unknown }).motif;
    if (typeof motif === 'string') return motif;
  }
  return '';
}

function extractMessage(err: unknown): string {
  if (
    err &&
    typeof err === 'object' &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
  ) {
    return (err as { message: string }).message;
  }
  return 'Une erreur inattendue est survenue.';
}
