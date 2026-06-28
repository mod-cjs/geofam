"use client";

/**
 * A-01 — Button
 *
 * 4 variantes : action (latérite) / secondary / ghost / danger
 * 3 tailles : sm / md / lg
 * États : défaut · hover · focus-visible · loading (aria-busy) · disabled · icon-left · icon-only
 *
 * Règles non négociables :
 * - font-weight: 500 minimum obligatoire
 * - Sur fond asphalte (surface-nav) : --accent-action-on-nav (#d9954e)
 * - Bouton conditionnel = ABSENT, jamais grisé (ex. "Émettre PV")
 * - Aucun scale / translate sur ce bouton
 * - Loading > 400 ms : icône Loader2 rotation linear infinite
 */

import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "action" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Icône à gauche du label */
  iconLeft?: ReactNode;
  /** Bouton icône seul (sans label visible — fournir aria-label) */
  iconOnly?: boolean;
  children?: ReactNode;
  /** Sur fond asphalte (sidebar/topbar) — utilise --accent-action-on-nav */
  onDark?: boolean;
}

const sizeStyles: Record<ButtonSize, { height: string; px: string; fontSize: string; iconSize: number }> = {
  sm: { height: "28px", px: "10px", fontSize: "12px", iconSize: 14 },
  md: { height: "34px", px: "14px", fontSize: "13px", iconSize: 16 },
  lg: { height: "40px", px: "18px", fontSize: "14px", iconSize: 18 },
};

export function Button({
  variant = "action",
  size = "md",
  loading = false,
  iconLeft,
  iconOnly = false,
  children,
  onDark = false,
  disabled,
  className = "",
  style,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const sz = sizeStyles[size];

  const baseStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    height: sz.height,
    padding: iconOnly ? `0 ${sz.px}` : `0 ${sz.px}`,
    borderRadius: "var(--radius-base)",
    fontFamily: "var(--font-sans)",
    fontSize: sz.fontSize,
    fontWeight: 500,
    cursor: isDisabled ? "not-allowed" : "pointer",
    border: "none",
    outline: "none",
    transition: `background-color var(--dur-fast) var(--ease-state), opacity var(--dur-instant) var(--ease-state)`,
    opacity: isDisabled && !loading ? 0.65 : 1,
    userSelect: "none",
    whiteSpace: "nowrap",
    ...style,
  };

  const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
    action: {
      background: onDark ? "transparent" : "var(--accent-action)",
      color: onDark ? "var(--accent-action-on-nav)" : "var(--accent-fg)",
    },
    secondary: {
      background: "transparent",
      color: "var(--struct-petrole)",
      boxShadow: "inset 0 0 0 1px var(--struct-petrole)",
    },
    ghost: {
      background: "transparent",
      color: "var(--text-secondary)",
      boxShadow: "inset 0 0 0 1px var(--border-default)",
    },
    danger: {
      background: "var(--status-fail-bg)",
      color: "var(--status-fail-tx)",
    },
  };

  return (
    <button
      {...props}
      disabled={isDisabled}
      aria-busy={loading ? "true" : undefined}
      aria-disabled={isDisabled ? "true" : undefined}
      style={{ ...baseStyle, ...variantStyles[variant] }}
      className={`rds-btn rds-btn--${variant} rds-btn--${size}${className ? ` ${className}` : ""}`}
      onMouseEnter={(e) => {
        if (!isDisabled) {
          const el = e.currentTarget;
          if (variant === "action") {
            el.style.background = onDark
              ? "rgba(217,149,78,0.12)"
              : "var(--accent-action-hover)";
          } else if (variant === "secondary") {
            el.style.background = "rgba(31,78,74,0.06)";
          } else if (variant === "ghost") {
            el.style.background = "rgba(0,0,0,0.04)";
          } else if (variant === "danger") {
            el.style.background = "#f5d8d7";
          }
        }
        props.onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        if (!isDisabled) {
          const el = e.currentTarget;
          if (variant === "action") {
            el.style.background = onDark ? "transparent" : "var(--accent-action)";
          } else if (variant === "secondary") {
            el.style.background = "transparent";
          } else if (variant === "ghost") {
            el.style.background = "transparent";
          } else if (variant === "danger") {
            el.style.background = "var(--status-fail-bg)";
          }
        }
        props.onMouseLeave?.(e);
      }}
    >
      {loading ? (
        <Loader2
          size={sz.iconSize}
          strokeWidth={1.5}
          aria-hidden="true"
          style={{ animation: "spin 1s linear infinite", flexShrink: 0 }}
        />
      ) : (
        iconLeft && (
          <span aria-hidden="true" style={{ display: "flex", flexShrink: 0 }}>
            {iconLeft}
          </span>
        )
      )}
      {iconOnly ? (
        <span className="sr-only">{children}</span>
      ) : loading ? (
        <span>Calcul en cours</span>
      ) : (
        children
      )}
    </button>
  );
}

/* Inject spin keyframe once — needed because Tailwind's animate-spin
   depends on the full config; this is self-contained. */
if (typeof document !== "undefined") {
  const id = "__rds-spin";
  if (!document.getElementById(id)) {
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`;
    document.head.appendChild(style);
  }
}
