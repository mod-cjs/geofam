/**
 * A-24 — Kbd (raccourci clavier)
 *
 * Balise sémantique <kbd>
 * Fond subtil, border-radius 3px, Geist Mono 11px
 * Transverse à Cmd+K / Aide / tooltips
 */

import type { ReactNode } from "react";

interface KbdProps {
  children: ReactNode;
  className?: string;
}

/** Raccourci clavier simple */
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1px 5px",
        borderRadius: "var(--radius-sm)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 1.4,
        color: "var(--text-secondary)",
        background: "var(--color-alt, #eef0f1)",
        boxShadow: "inset 0 0 0 1px var(--border-default)",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </kbd>
  );
}

/** Chord : combinaison de touches (Ctrl+Entrée) */
interface KbdChordProps {
  keys: string[];
  className?: string;
}

export function KbdChord({ keys, className }: KbdChordProps) {
  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
      aria-label={keys.join(" + ")}
    >
      {keys.map((key, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
          {i > 0 && (
            <span
              aria-hidden="true"
              style={{ color: "var(--text-muted)", fontSize: 10, padding: "0 1px" }}
            >
              +
            </span>
          )}
          <Kbd>{key}</Kbd>
        </span>
      ))}
    </span>
  );
}
