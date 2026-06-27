"use client";

/**
 * A-15 — Skeleton
 *
 * Variantes : text / row / badge / card / liste / OutputTable
 *
 * Règles :
 * - Visible SEULEMENT si délai > 400 ms (helper useDelayedFlag(400))
 * - clearTimeout dans le finally pour éviter flash 380–420 ms
 * - Dimensions identiques à l'état chargé (CLS = 0)
 * - Shimmer via opacity uniquement (keyframes roadsen-shimmer dans globals.css)
 * - Immobile sous prefers-reduced-motion
 */

import React, { useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/* Helper : délai avant affichage                                      */
/* ------------------------------------------------------------------ */

/**
 * Retourne true uniquement après `delayMs` millisecondes.
 * Utiliser la ref clear fournie dans le finally de la requête.
 */
export function useDelayedFlag(delayMs: number): [boolean, () => void] {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => setVisible(true), delayMs);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [delayMs]);

  function clear() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }

  return [visible, clear];
}

/* ------------------------------------------------------------------ */
/* Bloc shimmer de base                                                 */
/* ------------------------------------------------------------------ */

interface ShimmerBlockProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  style?: React.CSSProperties;
}

export function ShimmerBlock({ width = "100%", height = 16, borderRadius = 3, style }: ShimmerBlockProps) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "block",
        width,
        height,
        borderRadius,
        background: "var(--color-alt, #eef0f1)",
        animation: "roadsen-shimmer 1400ms ease-in-out infinite",
        ...style,
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Variantes nommées                                                    */
/* ------------------------------------------------------------------ */

/** Ligne de texte (un paragraphe de corps) */
export function SkeletonText({ lines = 1, className }: { lines?: number; className?: string }) {
  return (
    <span
      className={className}
      style={{ display: "flex", flexDirection: "column", gap: 6 }}
      aria-busy="true"
      aria-label="Chargement…"
    >
      {Array.from({ length: lines }).map((_, i) => (
        <ShimmerBlock
          key={i}
          height={14}
          width={i === lines - 1 && lines > 1 ? "65%" : "100%"}
        />
      ))}
    </span>
  );
}

/** Ligne de tableau (row height 40px comfortable) */
export function SkeletonRow({ columns = 4 }: { columns?: number }) {
  return (
    <tr aria-hidden="true">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} style={{ padding: "9px 12px" }}>
          <ShimmerBlock height={14} width={i === 0 ? "80%" : "60%"} />
        </td>
      ))}
    </tr>
  );
}

/** Badge (11px hauteur) */
export function SkeletonBadge() {
  return <ShimmerBlock width={64} height={20} borderRadius={2} />;
}

/** Card projet (hauteur fixe) */
export function SkeletonCard({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={className}
      aria-busy="true"
      aria-label="Chargement…"
      style={{
        background: "var(--surface-base)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--elevation-card)",
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        ...style,
      }}
    >
      <ShimmerBlock height={14} width="55%" />
      <ShimmerBlock height={12} width="80%" />
      <ShimmerBlock height={12} width="40%" />
    </div>
  );
}

/** Liste de calculs (colonne gauche 280px, items ~40px chacun) */
export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div
      aria-busy="true"
      aria-label="Chargement…"
      style={{ display: "flex", flexDirection: "column", gap: 1 }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 40,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 12px",
          }}
        >
          <ShimmerBlock width={20} height={20} borderRadius={2} />
          <ShimmerBlock width="55%" height={13} />
          <span style={{ marginLeft: "auto" }}>
            <ShimmerBlock width={48} height={13} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Tableau de résultats OutputTable — reproduit les proportions de colonnes */
export function SkeletonOutputTable({
  rows = 6,
  columns = 4,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <table
      aria-busy="true"
      aria-label="Chargement des résultats…"
      style={{ width: "100%", borderCollapse: "collapse" }}
    >
      <thead>
        <tr>
          {/* Colonne id gelée */}
          <th style={{ width: 160, padding: "9px 12px", textAlign: "left" }}>
            <ShimmerBlock height={12} width="70%" />
          </th>
          {Array.from({ length: columns - 1 }).map((_, i) => (
            <th key={i} style={{ padding: "9px 12px", textAlign: "right" }}>
              <ShimmerBlock height={12} width="50%" style={{ marginLeft: "auto" }} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonRow key={i} columns={columns} />
        ))}
      </tbody>
    </table>
  );
}
