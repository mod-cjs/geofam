"use client";

/**
 * A-11 — Card / Panel
 *
 * Règles :
 * - Jamais élévation + bordure + background coloré simultanément
 * - box-shadow: 0 0 0 1px (zéro-offset) préféré à border
 * - Variantes : card-projet / card-moteur / panel-formulaire / panel-repliable
 */

import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Cliquable = hover avec background-color subtle */
  clickable?: boolean;
  /** Card désactivée */
  disabled?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

const paddingMap = {
  none: "0",
  sm: "12px",
  md: "20px",
  lg: "24px",
};

export function Card({
  children,
  clickable = false,
  disabled = false,
  padding = "md",
  style,
  className,
  ...rest
}: CardProps) {
  return (
    <div
      {...rest}
      style={{
        background: "var(--surface-base)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--elevation-card)",
        padding: paddingMap[padding],
        cursor: clickable && !disabled ? "pointer" : undefined,
        opacity: disabled ? 0.55 : 1,
        transition: clickable ? `background-color var(--dur-fast) var(--ease-state)` : undefined,
        ...style,
      }}
      className={className}
      onMouseEnter={(e) => {
        if (clickable && !disabled) {
          e.currentTarget.style.background = "var(--row-hover-bg, rgba(31,78,74,0.04))";
        }
        rest.onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        if (clickable && !disabled) {
          e.currentTarget.style.background = "var(--surface-base)";
        }
        rest.onMouseLeave?.(e);
      }}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panel repliable                                                      */
/* ------------------------------------------------------------------ */

interface CollapsiblePanelProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

export function CollapsiblePanel({
  title,
  children,
  defaultOpen = true,
  className,
}: CollapsiblePanelProps) {
  // Utilise un state local via forwardRef serait nécessaire, mais ce composant
  // est un Server Component sauf si marqué 'use client'. Pour la galerie
  // et l'usage général, on le marque 'use client' via l'export du fichier parent.
  // Ici on fait un composant contrôlé simple HTML pour éviter de marquer tout le module.
  return (
    <details
      open={defaultOpen}
      className={className}
      style={{
        background: "var(--surface-base)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--elevation-card)",
        overflow: "hidden",
      }}
    >
      <summary
        style={{
          padding: "12px 20px",
          fontSize: 13,
          fontWeight: 500,
          color: "var(--text-primary)",
          cursor: "pointer",
          borderBottom: `1px solid var(--border-subtle)`,
          listStyle: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          userSelect: "none",
        }}
      >
        {title}
        <span
          aria-hidden="true"
          style={{ color: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}
        >
          ▾
        </span>
      </summary>
      <div style={{ padding: 20 }}>{children}</div>
    </details>
  );
}
