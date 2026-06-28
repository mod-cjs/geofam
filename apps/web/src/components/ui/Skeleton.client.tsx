'use client';

/**
 * Skeleton — composant wrapper unifié pour les pages de l'app.
 * Délègue aux composants atomiques du design system.
 */

import type { CSSProperties } from 'react';
import {
  SkeletonCard,
  SkeletonRow,
  SkeletonText,
  SkeletonOutputTable,
  ShimmerBlock,
} from './Skeleton';

type SkeletonVariant =
  | 'card-projet'
  | 'row'
  | 'text'
  | 'output-table'
  | 'badge';

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
      return (
        <div style={style} className={className}>
          <SkeletonRow />
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
