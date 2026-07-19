'use client';

/**
 * A-16 — EmptyState
 *
 * Variantes distinctes (vide absolu ≠ filtre ≠ pré-calcul ≠ erreur réseau) :
 * - blank       : premier usage, aucune donnée
 * - filtered    : filtre sans résultat (avec action "Effacer les filtres")
 * - pre-calc    : zone résultat avant premier calcul (min-height réservée)
 * - network-err : erreur réseau (avec action "Réessayer")
 *
 * Règles :
 * - Textes métier en props (jamais génériques en dur)
 * - Pas d'emojis
 * - Pas d'illustration (sauf schéma sobre optionnel — prop optionnelle)
 * - CTA optionnel
 */

import { AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from './Button';

export type EmptyVariant = 'blank' | 'filtered' | 'pre-calc' | 'network-err';

interface EmptyStateProps {
  variant: EmptyVariant;
  /** Titre court factuel */
  title: string;
  /** Sous-titre ou description (1 ligne recommandée) */
  description?: string;
  /** Label du CTA principal */
  ctaLabel?: string;
  /** Handler du CTA */
  onCta?: () => void;
  /** Schéma sobre optionnel (SVG monochrome pétrole) */
  illustration?: ReactNode;
  className?: string;
  /** Hauteur minimale réservée (pour CLS = 0 sur la zone pré-calcul) */
  minHeight?: number | string;
}

export function EmptyState({
  variant,
  title,
  description,
  ctaLabel,
  onCta,
  illustration,
  className,
  minHeight,
}: EmptyStateProps) {
  const isError = variant === 'network-err';

  return (
    <div
      role="status"
      aria-live="polite"
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '32px 24px',
        minHeight: minHeight ?? (variant === 'pre-calc' ? 200 : undefined),
        gap: 12,
      }}
    >
      {/* Icône d'erreur réseau */}
      {isError && (
        <AlertCircle
          size={24}
          strokeWidth={1.5}
          aria-hidden="true"
          style={{ color: 'var(--status-fail-tx)' }}
        />
      )}

      {/* Illustration optionnelle */}
      {!isError && illustration && (
        <div
          aria-hidden="true"
          style={{ color: 'var(--struct-petrole-text)', opacity: 0.4, marginBottom: 4 }}
        >
          {illustration}
        </div>
      )}

      {/* Titre */}
      <p
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: isError ? 'var(--status-fail-tx)' : 'var(--text-primary)',
          lineHeight: 1.4,
          margin: 0,
        }}
      >
        {title}
      </p>

      {/* Description */}
      {description && (
        <p
          style={{
            fontSize: 13,
            color: 'var(--text-muted)',
            lineHeight: 1.5,
            margin: 0,
            maxWidth: 400,
          }}
        >
          {description}
        </p>
      )}

      {/* CTA */}
      {ctaLabel && onCta && (
        <div style={{ marginTop: 8 }}>
          {variant === 'network-err' ? (
            <Button variant="secondary" size="sm" onClick={onCta}>
              {ctaLabel}
            </Button>
          ) : variant === 'filtered' ? (
            <Button variant="ghost" size="sm" onClick={onCta}>
              {ctaLabel}
            </Button>
          ) : (
            <Button variant="action" size="sm" onClick={onCta}>
              {ctaLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Variantes pré-câblées courantes (textes métier ROADSEN)             */
/* ------------------------------------------------------------------ */

/** Zone résultat avant premier calcul (CLS = 0, min-height identique à OutputTable) */
export function PreCalcEmptyState({ minHeight = 240 }: { minHeight?: number }) {
  return (
    <EmptyState
      variant="pre-calc"
      title="Le résultat apparaîtra ici après calcul."
      minHeight={minHeight}
    />
  );
}

/** Liste calculs vide */
export function NoCalcEmptyState({ onNewCalc }: { onNewCalc?: () => void }) {
  return (
    <EmptyState
      variant="blank"
      title="Aucun calcul dans ce projet."
      description="Lancez un premier calcul depuis la bibliothèque de moteurs."
      ctaLabel={onNewCalc ? 'Nouveau calcul' : undefined}
      onCta={onNewCalc}
    />
  );
}

/** Liste PV vide */
export function NoPvEmptyState() {
  return (
    <EmptyState
      variant="blank"
      title="Aucun PV émis."
      description="Les PV apparaissent ici une fois un calcul scellé."
    />
  );
}

/** Erreur réseau générique */
export function NetworkErrorEmptyState({ onRetry }: { onRetry?: () => void }) {
  return (
    <EmptyState
      variant="network-err"
      title="Impossible de charger les données."
      description="Vérifiez votre connexion et réessayez."
      ctaLabel={onRetry ? 'Réessayer' : undefined}
      onCta={onRetry}
    />
  );
}

/** Filtre sans résultat */
export function FilterEmptyState({ onClear }: { onClear?: () => void }) {
  return (
    <EmptyState
      variant="filtered"
      title="Aucun résultat pour ces critères."
      description="Modifiez ou effacez les filtres pour afficher tous les éléments."
      ctaLabel={onClear ? 'Effacer les filtres' : undefined}
      onCta={onClear}
    />
  );
}
