/**
 * A-08 — Verdict Banner
 *
 * Triple redondance : couleur + icône Lucide stroke 1.5 + libellé texte
 * Variantes : CONFORME (pass) / NON CONFORME (fail)
 * Modes : compact (résultats) / étendu (PV)
 *
 * Règles :
 * - Latérite (#b86a2e) et bordeaux-verdict (#8b1a1a) JAMAIS adjacents sans séparateur neutre ≥ 16px
 * - Dark mode : fond clair conservé (île claire provisoire)
 * - NE PAS utiliser pour autre chose que les verdicts de conformité
 */

import { CheckCircle, XCircle } from "lucide-react";
import type { ReactNode } from "react";

export type VerdictType = "pass" | "fail";

interface VerdictBannerProps {
  verdict: VerdictType;
  /** Libellé principal (défaut : CONFORME / NON CONFORME) */
  label?: string;
  /** Message explicatif */
  message?: ReactNode;
  /** Compact = badge en ligne dans les résultats ; étendu = bandeau PV */
  mode?: "compact" | "extended";
  className?: string;
}

export function VerdictBanner({
  verdict,
  label,
  message,
  mode = "extended",
  className,
}: VerdictBannerProps) {
  const isPass = verdict === "pass";
  const defaultLabel = isPass ? "CONFORME" : "NON CONFORME";
  const displayLabel = label ?? defaultLabel;

  const bgColor = isPass ? "var(--status-pass-bg)" : "var(--status-fail-bg)";
  const txColor = isPass ? "var(--status-pass-tx)" : "var(--status-fail-tx)";
  const insetColor = txColor;

  if (mode === "compact") {
    return (
      <span
        className={className}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "3px 9px",
          borderRadius: "var(--radius-base)",
          background: bgColor,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.04em",
          color: txColor,
          userSelect: "none",
          whiteSpace: "nowrap",
        }}
        aria-label={`Verdict : ${displayLabel}`}
      >
        {isPass ? (
          <CheckCircle size={13} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <XCircle size={13} strokeWidth={1.5} aria-hidden="true" />
        )}
        <span>{displayLabel}</span>
      </span>
    );
  }

  /* Mode étendu (PV, résultats principaux) */
  return (
    <div
      className={className}
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        gap: 12,
        padding: "11px 14px",
        borderRadius: "var(--radius-base)",
        background: bgColor,
        boxShadow: `inset 3px 0 0 ${insetColor}`,
      }}
    >
      {/* Icône */}
      <span
        aria-hidden="true"
        style={{ color: txColor, display: "flex", marginTop: 1, flexShrink: 0 }}
      >
        {isPass ? (
          <CheckCircle size={18} strokeWidth={1.5} />
        ) : (
          <XCircle size={18} strokeWidth={1.5} />
        )}
      </span>

      {/* Contenu */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: txColor,
          }}
        >
          {displayLabel}
        </span>
        {message && (
          <span
            style={{
              fontSize: 12.5,
              lineHeight: 1.5,
              color: isPass ? "#234d31" : "#7a1911",
            }}
          >
            {message}
          </span>
        )}
      </div>
    </div>
  );
}
