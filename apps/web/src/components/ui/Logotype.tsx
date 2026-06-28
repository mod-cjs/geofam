/**
 * A-18 — Logotype ROADSEN
 *
 * Variante complète (≥ 32 px) : wordmark + barre de strates (latérite 3px / pétrole 2px / asphalte 1px)
 * Variante glyphe (< 32 px)   : initiale "R" + filet latérite seul
 *
 * La barre de strates est l'unique actif propriétaire. Ne jamais réduire la fidélité sur la variante complète.
 * Le motif 3-strates est INTERDIT < 32 px : fusion inacceptable sur favicon.
 */

interface LogotypeProps {
  /** Hauteur totale du composant (détermine la variante) */
  size?: number;
  /** Force la variante glyphe indépendamment de la taille */
  variant?: "full" | "glyph";
  className?: string;
}

export function Logotype({ size = 48, variant, className }: LogotypeProps) {
  const isGlyph = variant === "glyph" || (variant !== "full" && size < 32);

  if (isGlyph) {
    return <GlyphVariant size={size} className={className} />;
  }
  return <FullVariant className={className} />;
}

/** Variante complète : wordmark + barre de strates */
function FullVariant({ className }: { className?: string }) {
  return (
    <div
      className={className}
      style={{ display: "inline-flex", flexDirection: "column", gap: 5 }}
      aria-label="ROADSEN"
    >
      {/* Wordmark */}
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: "0.08em",
          color: "var(--text-on-nav)",
          lineHeight: 1,
          userSelect: "none",
        }}
      >
        ROADSEN
      </span>
      {/* Barre de strates */}
      <StrataBar />
    </div>
  );
}

/** Variante glyphe : initiale R + filet latérite seul */
function GlyphVariant({ size, className }: { size: number; className?: string }) {
  return (
    <div
      className={className}
      style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}
      aria-label="ROADSEN"
    >
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: Math.max(size * 0.7, 12),
          fontWeight: 600,
          color: "var(--text-on-nav)",
          lineHeight: 1,
          userSelect: "none",
        }}
      >
        R
      </span>
      {/* Filet latérite seul — 2px */}
      <div
        style={{
          height: 2,
          width: "100%",
          background: "var(--accent-brand)",
          borderRadius: 1,
        }}
      />
    </div>
  );
}

/** Barre de strates — largeur = largeur du wordmark (auto) */
export function StrataBar({ width }: { width?: number | string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        width: width ?? "100%",
      }}
    >
      {/* Strate 1 — latérite 3px */}
      <div style={{ height: 3, background: "#b86a2e", borderRadius: 1 }} />
      {/* Strate 2 — pétrole 2px */}
      <div style={{ height: 2, background: "#1f4e4a", borderRadius: 1 }} />
      {/* Strate 3 — asphalte 1px */}
      <div style={{ height: 1, background: "#22262b", borderRadius: 0.5 }} />
    </div>
  );
}
