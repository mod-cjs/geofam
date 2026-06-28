"use client";

/**
 * A-21 — Tabs (onglets de navigation projet)
 *
 * - role="tablist" + navigation flèches clavier (←/→, Home, End)
 * - Underline 2px pétrole animé SEUL à la sélection (indicateur, pas le contenu)
 * - Swap de contenu INSTANTANÉ (0 ms — règle haute fréquence)
 * - Latérite INTERDIT sur underline actif (pétrole uniquement)
 * - Actions haute fréquence = zéro animation sur le contenu
 */

import { type KeyboardEvent, type ReactNode, useState, useRef } from "react";

interface Tab {
  id: string;
  label: string;
  content: ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  defaultActiveId?: string;
  /** Sur fond clair (surface-base) ou fond asphalte */
  theme?: "light" | "dark";
  className?: string;
}

export function Tabs({ tabs, defaultActiveId, theme = "light", className }: TabsProps) {
  const [activeId, setActiveId] = useState(defaultActiveId ?? tabs[0]?.id);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const activeTab = tabs.find((t) => t.id === activeId);

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    let nextIndex: number | null = null;

    if (e.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (e.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex !== null) {
      e.preventDefault();
      tabRefs.current[nextIndex]?.focus();
      setActiveId(tabs[nextIndex].id);
    }
  }

  const isDark = theme === "dark";
  const textDefault = isDark ? "rgba(255,255,255,0.6)" : "var(--text-secondary)";
  const textHover = isDark ? "rgba(255,255,255,0.9)" : "var(--text-primary)";
  const textActive = isDark ? "var(--text-on-nav)" : "var(--text-primary)";
  const underlineColor = "var(--struct-petrole)";

  return (
    <div className={className}>
      {/* Tablist */}
      <div
        role="tablist"
        aria-label="Onglets de navigation"
        style={{
          display: "flex",
          gap: 2,
          borderBottom: `1px solid var(--border-subtle)`,
        }}
      >
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeId;
          return (
            <button
              key={tab.id}
              ref={(el) => { tabRefs.current[index] = el; }}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.id}`}
              id={`tab-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveId(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = textHover;
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = textDefault;
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "0 12px",
                height: 44,
                fontSize: 13,
                fontWeight: isActive ? 500 : 400,
                color: isActive ? textActive : textDefault,
                background: "transparent",
                border: "none",
                borderBottom: `2px solid ${isActive ? underlineColor : "transparent"}`,
                cursor: "pointer",
                outline: "none",
                /* L'indicateur underline anime, le reste est instantané */
                transition: `color var(--dur-fast) var(--ease-state), border-color var(--dur-fast) var(--ease-state)`,
                marginBottom: -1, /* couvre la bordure du conteneur */
                whiteSpace: "nowrap",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Panneau — swap instantané (0 ms) */}
      {activeTab && (
        <div
          id={`tabpanel-${activeTab.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${activeTab.id}`}
          tabIndex={0}
        >
          {activeTab.content}
        </div>
      )}
    </div>
  );
}
