'use client';

/**
 * Barre de progression consommation/quota.
 * Orange sous 50 %, rouge si > 90 %, vert si <= 50 % (patron tokens existants).
 * Affiche les chiffres bruts sous la barre.
 */

interface QuotaBarProps {
  consommation: number;
  quota: number;
  /** Largeur de la barre en px ou CSS string (défaut : 120px) */
  width?: number | string;
}

export function QuotaBar({ consommation, quota, width = 120 }: QuotaBarProps) {
  if (quota <= 0) {
    return (
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>—</span>
    );
  }

  const pct = Math.min(100, Math.round((consommation / quota) * 100));

  // Rouge > 90 %, orange 50–90 %, vert <= 50 %
  const barColor =
    pct > 90
      ? 'var(--status-fail-tx)'
      : pct > 50
        ? '#b86a2e' // --accent-brand (orange)
        : 'var(--status-pass-tx)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: width }}>
      {/* Piste */}
      <div
        aria-label={`${pct} % du quota consommé`}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          width: '100%',
          height: 6,
          borderRadius: 3,
          background: 'var(--border-subtle)',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${pct}%`,
            background: barColor,
            borderRadius: 3,
            transition: 'width var(--dur-base) var(--ease-state)',
          }}
        />
      </div>
      {/* Chiffres bruts */}
      <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
        {consommation} / {quota}
      </span>
    </div>
  );
}
