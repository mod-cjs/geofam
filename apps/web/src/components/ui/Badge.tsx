/**
 * A-06 — Badge statut
 *
 * Triple redondance OBLIGATOIRE : couleur + icône + libellé texte
 * Vert/rouge = verdicts UNIQUEMENT (Conforme / Non conforme)
 * Badge Scellé = fond asphalte, jamais vert
 *
 * Variantes : conforme (pass) · non-conforme (fail) · neutre · recalculable · scellé · en-cours · erreur
 */

import { Check, Clock, Lock, RefreshCw, X, AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';

export type BadgeVariant =
  | 'conforme'
  | 'non-conforme'
  | 'neutre'
  | 'recalculable'
  | 'scelle'
  | 'en-cours'
  | 'erreur';

interface BadgeProps {
  variant: BadgeVariant;
  /** Libellé personnalisé — sinon utilise le libellé par défaut */
  label?: string;
  className?: string;
}

const badgeConfig: Record<
  BadgeVariant,
  {
    label: string;
    icon: ReactNode;
    style: React.CSSProperties;
  }
> = {
  conforme: {
    label: 'Conforme',
    icon: <Check size={11} strokeWidth={2} aria-hidden="true" />,
    style: {
      background: 'var(--status-pass-bg)',
      color: 'var(--status-pass-tx)',
    },
  },
  'non-conforme': {
    label: 'Non conforme',
    icon: <X size={11} strokeWidth={2} aria-hidden="true" />,
    style: {
      background: 'var(--status-fail-bg)',
      color: 'var(--status-fail-tx)',
    },
  },
  neutre: {
    label: 'En attente',
    icon: <Clock size={11} strokeWidth={1.5} aria-hidden="true" />,
    style: {
      background: 'var(--color-alt, #eef0f1)',
      color: 'var(--text-secondary)',
    },
  },
  recalculable: {
    label: 'Recalculable',
    icon: <RefreshCw size={11} strokeWidth={1.5} aria-hidden="true" />,
    style: {
      background: 'transparent',
      color: 'var(--text-secondary)',
      boxShadow: 'inset 0 0 0 1px var(--border-default)',
    },
  },
  scelle: {
    label: 'Scellé',
    icon: <Lock size={11} strokeWidth={1.5} aria-hidden="true" />,
    style: {
      background: 'var(--surface-nav)',
      color: '#ffffff',
    },
  },
  'en-cours': {
    label: 'En cours',
    icon: <Clock size={11} strokeWidth={1.5} aria-hidden="true" />,
    style: {
      background: '#eff6ff',
      color: '#1d4ed8',
    },
  },
  erreur: {
    label: 'Erreur',
    icon: <AlertTriangle size={11} strokeWidth={1.5} aria-hidden="true" />,
    style: {
      background: 'var(--status-fail-bg)',
      color: 'var(--status-fail-tx)',
    },
  },
};

export function Badge({ variant, label, className }: BadgeProps) {
  const config = badgeConfig[variant];
  const displayLabel = label ?? config.label;

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
        padding: '2px 8px',
        borderRadius: 2 /* pas rounded-full — le pill est trop ludique */,
        ...config.style,
      }}
      aria-label={displayLabel}
    >
      {config.icon}
      <span>{displayLabel}</span>
    </span>
  );
}

/** Variante compacte pour les listes (sans padding horizontal) */
export function BadgeCompact({ variant, label, className }: BadgeProps) {
  const config = badgeConfig[variant];
  const displayLabel = label ?? config.label;

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1,
        padding: '1px 5px',
        borderRadius: 2,
        ...config.style,
      }}
      aria-label={displayLabel}
    >
      {config.icon}
      <span>{displayLabel}</span>
    </span>
  );
}
