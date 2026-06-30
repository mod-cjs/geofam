"use client";

/**
 * A-10 — Metric
 *
 * Composant unique pour l'affichage d'une valeur numérique géotechnique.
 *
 * Variantes :
 * - isolated   : valeur phare 32px 600 (résultat principal)
 * - table      : valeur en tableau 14px 600 + unité muted
 * - unavailable: affiche '—' (jamais 'NaN' ou 'Infinity' brut)
 * - out-of-range: valeur hors plage (--status-fail-tx)
 *
 * Règles non négociables :
 * - NaN | Infinity → '—'
 * - Geist Mono + tabular-nums + text-align right
 * - Unité en muted séparé (jamais dans la cellule chiffre)
 * - Helper fmt() : Intl.NumberFormat('fr-FR') + espace fine U+202F
 */

import type { HTMLAttributes } from "react";

export type MetricVariant = "isolated" | "table" | "unavailable" | "out-of-range";

/** Helper formatage — défini une fois, jamais répliqué inline */
export function fmt(n: number, decimals = 4): string {
  if (!isFinite(n) || isNaN(n)) return "—"; // '—'
  // .replace : l'espace fine ICU (U+202F/U+00A0) diffère entre Node SSR et le
  // navigateur selon la version ICU → mismatch d'hydratation (#418). On normalise
  // en espace simple, déterministe partout.
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: decimals })
    .format(n)
    .replace(/[\u202F\u00A0]/g, " ");
}

interface MetricProps extends HTMLAttributes<HTMLSpanElement> {
  /** Valeur numérique. NaN / Infinity → '—' automatiquement. */
  value: number | null | undefined;
  /** Unité affichée en muted à droite (ex. "kPa", "MPa", "%") */
  unit?: string;
  /** Nombre de décimales (défaut 4) */
  decimals?: number;
  /** Variante d'affichage */
  variant?: MetricVariant;
  /** Texte de remplacement si value est null/undefined */
  unavailableText?: string;
}

const numericBase: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontVariantNumeric: "tabular-nums",
  letterSpacing: 0,
};

export function Metric({
  value,
  unit,
  decimals = 4,
  variant = "table",
  unavailableText = "—",
  style,
  className,
  ...rest
}: MetricProps) {
  /* Normalisation : null / undefined / NaN / Infinity → indisponible */
  const isUnavailable =
    value === null ||
    value === undefined ||
    (typeof value === "number" && (!isFinite(value) || isNaN(value)));

  const displayValue = isUnavailable ? unavailableText : fmt(value as number, decimals);

  /* Styles par variante */
  const variantStyle: React.CSSProperties =
    variant === "isolated"
      ? {
          ...numericBase,
          fontSize: 32,
          fontWeight: 600,
          lineHeight: 1.1,
          color: "var(--text-primary)",
          display: "inline-flex",
          alignItems: "baseline",
          gap: "6px",
        }
      : variant === "out-of-range"
      ? {
          ...numericBase,
          fontSize: 14,
          fontWeight: 600,
          color: "var(--status-fail-tx)",
          display: "inline-flex",
          alignItems: "baseline",
          gap: "4px",
        }
      : variant === "unavailable"
      ? {
          ...numericBase,
          fontSize: 14,
          fontWeight: 400,
          color: "var(--text-muted)",
          display: "inline-flex",
        }
      : /* table (défaut) */
        {
          ...numericBase,
          fontSize: 14,
          fontWeight: 600,
          color: "var(--text-primary)",
          display: "inline-flex",
          alignItems: "baseline",
          gap: "4px",
        };

  return (
    <span
      {...rest}
      style={{ ...variantStyle, ...style }}
      className={className}
    >
      <span>{displayValue}</span>
      {unit && !isUnavailable && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: variant === "isolated" ? 16 : 12,
            fontWeight: 400,
            color: "var(--text-muted)",
          }}
          aria-hidden="true"
        >
          {unit}
        </span>
      )}
    </span>
  );
}
