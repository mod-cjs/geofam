"use client";

/**
 * A-23 — Avatar / Monogramme
 *
 * - Image avec fallback initiales
 * - Couleur dérivée du nom (hachage stable)
 * - Tailles : sm (24px) / md (28px) / lg (36px)
 * - État chargement : skeleton
 */

import type { HTMLAttributes } from "react";

export type AvatarSize = "sm" | "md" | "lg";

interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  name: string;
  src?: string;
  size?: AvatarSize;
  /** Skeleton en cours de chargement */
  loading?: boolean;
}

const sizeMap: Record<AvatarSize, { px: number; fontSize: number; fontWeight: number }> = {
  sm: { px: 24, fontSize: 9, fontWeight: 700 },
  md: { px: 28, fontSize: 11, fontWeight: 700 },
  lg: { px: 36, fontSize: 13, fontWeight: 700 },
};

/** Hachage stable → couleur de fond à partir du nom */
function nameToColor(name: string): string {
  const palette = [
    "#1f4e4a", // pétrole
    "#a05226", // latérite action
    "#2d5060", // bleu-ardoise
    "#4a4a47", // gris chaud
    "#6b4f38", // brun
    "#2f6b46", // vert foncé
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
}

/** Initiales depuis le nom complet (max 2 lettres) */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ name, src, size = "md", loading = false, style, ...rest }: AvatarProps) {
  const sz = sizeMap[size];
  const initials = getInitials(name);
  const bgColor = nameToColor(name);

  const baseStyle: React.CSSProperties = {
    width: sz.px,
    height: sz.px,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    overflow: "hidden",
    ...style,
  };

  if (loading) {
    return (
      <div
        {...rest}
        style={{
          ...baseStyle,
          background: "var(--color-alt, #eef0f1)",
          animation: "roadsen-shimmer 1400ms ease-in-out infinite",
        }}
        aria-hidden="true"
      />
    );
  }

  if (src) {
    return (
      <div {...rest} style={baseStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={name}
          width={sz.px}
          height={sz.px}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={(e) => {
            // Fallback vers initiales si image manquante
            const parent = (e.currentTarget as HTMLImageElement).parentElement;
            if (parent) {
              parent.removeChild(e.currentTarget);
              parent.style.background = bgColor;
              parent.textContent = initials;
              parent.style.fontSize = `${sz.fontSize}px`;
              parent.style.fontWeight = String(sz.fontWeight);
              parent.style.color = "#fff";
            }
          }}
        />
      </div>
    );
  }

  return (
    <div
      {...rest}
      title={name}
      aria-label={name}
      style={{
        ...baseStyle,
        background: bgColor,
        color: "#ffffff",
        fontSize: sz.fontSize,
        fontWeight: sz.fontWeight,
        userSelect: "none",
        fontFamily: "var(--font-sans)",
      }}
    >
      {initials}
    </div>
  );
}
