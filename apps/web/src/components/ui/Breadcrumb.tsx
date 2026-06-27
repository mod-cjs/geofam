"use client";

/**
 * A-22 — Breadcrumb (fil d'Ariane)
 *
 * - aria-label="Fil d'Ariane" sur nav
 * - Séparateurs "/" aria-hidden
 * - Dernier segment non cliquable
 * - Troncature milieu > 4 niveaux (...)
 * - Segments intermédiaires : text-secondary 13px
 * - Dernier segment : text-on-nav 13px 500 (sur fond asphalte topbar)
 */

import type { ReactNode } from "react";

export interface BreadcrumbSegment {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  segments: BreadcrumbSegment[];
  /** Sur fond asphalte (topbar) */
  onDark?: boolean;
  className?: string;
}

export function Breadcrumb({ segments, onDark = true, className }: BreadcrumbProps) {
  // Troncature : si > 4 segments, on garde le premier, "...", et les 2 derniers
  let displayed: (BreadcrumbSegment | null)[] = segments;
  if (segments.length > 4) {
    displayed = [
      segments[0],
      null, // représente "..."
      segments[segments.length - 2],
      segments[segments.length - 1],
    ];
  }

  const textDefault = onDark ? "rgba(255,255,255,0.55)" : "var(--text-secondary)";
  const textCurrent = onDark ? "var(--text-on-nav)" : "var(--text-primary)";
  const textHover = onDark ? "#ffffff" : "var(--text-primary)";

  return (
    <nav aria-label="Fil d'Ariane" className={className}>
      <ol
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          listStyle: "none",
          margin: 0,
          padding: 0,
          fontSize: 13,
        }}
      >
        {displayed.map((segment, index) => {
          const isLast = index === displayed.length - 1;
          const isEllipsis = segment === null;

          if (isEllipsis) {
            return (
              <li key="ellipsis" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span aria-hidden="true" style={{ color: "rgba(255,255,255,0.3)", margin: "0 2px" }}>
                  /
                </span>
                <span style={{ color: textDefault }}>…</span>
              </li>
            );
          }

          return (
            <li key={index} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {index > 0 && (
                <span
                  aria-hidden="true"
                  style={{ color: onDark ? "rgba(255,255,255,0.3)" : "var(--text-muted)", margin: "0 2px" }}
                >
                  /
                </span>
              )}
              {isLast || !segment.href ? (
                <span
                  aria-current={isLast ? "page" : undefined}
                  style={{
                    color: isLast ? textCurrent : textDefault,
                    fontWeight: isLast ? 500 : 400,
                  }}
                >
                  {segment.label}
                </span>
              ) : (
                <a
                  href={segment.href}
                  style={{
                    color: textDefault,
                    textDecoration: "none",
                    transition: `color var(--dur-fast) var(--ease-state)`,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = textHover; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = textDefault; }}
                >
                  {segment.label}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
