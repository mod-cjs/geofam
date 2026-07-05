'use client';

/**
 * Badge statut d'organisation (ACTIVE / SUSPENDED / ARCHIVED).
 * Tokens CSS existants : --status-pass-* / --status-fail-* + custom muted.
 */

import type { OrgStatus } from '@/lib/api/admin-server';

interface OrgStatusBadgeProps {
  status: OrgStatus;
}

const CONFIG: Record<
  OrgStatus,
  { label: string; bg: string; fg: string }
> = {
  ACTIVE: {
    label: 'Actif',
    bg: 'var(--status-pass-bg)',
    fg: 'var(--status-pass-tx)',
  },
  SUSPENDED: {
    label: 'Suspendu',
    bg: 'var(--status-fail-bg)',
    fg: 'var(--status-fail-tx)',
  },
  ARCHIVED: {
    label: 'Archivé',
    bg: 'rgba(0,0,0,0.05)',
    fg: 'var(--text-muted)',
  },
};

export function OrgStatusBadge({ status }: OrgStatusBadgeProps) {
  const { label, bg, fg } = CONFIG[status] ?? CONFIG.ARCHIVED;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 7px',
        borderRadius: 'var(--radius-base)',
        fontSize: 'var(--text-xs)',
        fontWeight: 500,
        lineHeight: '18px',
        background: bg,
        color: fg,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}
