'use client';

/**
 * Skeleton — composant wrapper unifié pour les pages de l'app.
 * Délègue aux composants atomiques du design system.
 */

import type { CSSProperties } from 'react';

import {
  SkeletonCard,
  SkeletonText,
  SkeletonOutputTable,
  ShimmerBlock,
} from './Skeleton';

type SkeletonVariant = 'card-projet' | 'row' | 'text' | 'output-table' | 'badge';

interface SkeletonProps {
  variant: SkeletonVariant;
  style?: CSSProperties;
  className?: string;
}

export function Skeleton({ variant, style, className }: SkeletonProps) {
  switch (variant) {
    case 'card-projet':
      return <SkeletonCard style={style} className={className} />;
    case 'row':
      // FX-9 : rendu 100 % div (jamais de <tr> hors <table> — HTML invalide,
      // erreur d'hydratation React). Icône + 1-2 barres, hauteur ~80px
      // (dimensions proches de PvRow/liste, cf. CLS = 0).
      return (
        <div
          className={className}
          aria-busy="true"
          aria-label="Chargement…"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            height: 80,
            padding: '14px 16px',
            background: 'var(--surface-base)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--elevation-card)',
            ...style,
          }}
        >
          <ShimmerBlock width={36} height={36} borderRadius="var(--radius-base)" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ShimmerBlock height={14} width="55%" />
            <ShimmerBlock height={12} width="35%" />
          </div>
        </div>
      );
    case 'text':
      return (
        <div style={style} className={className}>
          <SkeletonText lines={1} />
        </div>
      );
    case 'output-table':
      return (
        <div style={style} className={className}>
          <SkeletonOutputTable />
        </div>
      );
    case 'badge':
      return <ShimmerBlock width={60} height={20} borderRadius={3} style={style} />;
    default:
      return <SkeletonCard style={style} className={className} />;
  }
}
