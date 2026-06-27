"use client";

/**
 * A-19 — Tooltip
 *
 * États : hover (délai 250ms) / focus (délai 250ms) / riche (avec <Kbd>) / reduced-motion
 *
 * Règles :
 * - Complément informatif uniquement — jamais nom accessible primaire
 * - Délai 250ms avant ouverture (mouseenter / focus)
 * - Fermeture immédiate (mouseleave / blur)
 * - Elevation-popover + surface-overlay
 * - Reduced-motion : apparition directe (opacity 0→1 en 0ms)
 * - Position : haut par défaut, repositionnement si hors viewport
 */

import { useRef, useState, useCallback, useId, type ReactNode } from "react";
import { Kbd } from "./Kbd";

/* ré-export pour les consommateurs */
export { Kbd };

interface TooltipProps {
  /** Contenu du tooltip (string ou ReactNode riche) */
  content: ReactNode;
  /** Élément déclencheur */
  children: ReactNode;
  /** Délai d'ouverture en ms (défaut 250) */
  delay?: number;
  /** Position préférée (top par défaut) */
  position?: "top" | "bottom" | "left" | "right";
  className?: string;
}

export function Tooltip({
  content,
  children,
  delay = 250,
  position = "top",
  className,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);

  /* Positionnement CSS selon la position demandée */
  const positionStyle: Record<string, React.CSSProperties> = {
    top: { bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" },
    bottom: { top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)" },
    left: { right: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" },
    right: { left: "calc(100% + 8px)", top: "50%", transform: "translateY(-50%)" },
  };

  return (
    <span
      className={className}
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {/* Injecter aria-describedby sur le premier enfant via wrapper */}
      <span aria-describedby={visible ? tooltipId : undefined} style={{ display: "contents" }}>
        {children}
      </span>

      {visible && (
        <span
          id={tooltipId}
          role="tooltip"
          style={{
            position: "absolute",
            zIndex: 50,
            ...positionStyle[position],
            background: "var(--surface-overlay)",
            color: "var(--text-primary)",
            fontSize: 12,
            lineHeight: 1.4,
            padding: "6px 10px",
            borderRadius: "var(--radius-base)",
            boxShadow: "var(--elevation-popover)",
            whiteSpace: "nowrap",
            maxWidth: 280,
            whiteSpaceCollapse: "preserve",
            pointerEvents: "none",
            /* Reduced-motion : pas de transition */
          }}
        >
          {content}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Variante riche : tooltip avec raccourci clavier                     */
/* ------------------------------------------------------------------ */

interface TooltipRichProps extends Omit<TooltipProps, "content"> {
  /** Texte descriptif */
  text: string;
  /** Raccourci affiché (simple ou chord) */
  shortcut?: string | string[];
}

export function TooltipRich({ text, shortcut, ...props }: TooltipRichProps) {
  const content = (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span>{text}</span>
      {shortcut && (
        Array.isArray(shortcut) ? (
          <span style={{ display: "inline-flex", gap: 2 }}>
            {shortcut.map((k, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                {i > 0 && <span style={{ color: "var(--text-muted)", fontSize: 10 }}>+</span>}
                <Kbd>{k}</Kbd>
              </span>
            ))}
          </span>
        ) : (
          <Kbd>{shortcut}</Kbd>
        )
      )}
    </span>
  );
  return <Tooltip content={content} {...props} />;
}
