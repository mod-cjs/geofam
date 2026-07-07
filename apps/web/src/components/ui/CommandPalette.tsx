"use client";

/**
 * A-20 — Command Palette (Cmd+K)
 *
 * Via lib `cmdk`.
 *
 * États :
 * - Fermée
 * - Ouverte vide (affiche récents)
 * - Saisie / filtrage
 * - Résultats groupés (navigation + actions)
 * - Aucun résultat
 * - Focus trap
 * - Récents vides (org neuve)
 * - Hors contexte projet (actions contextuelles absentes)
 *
 * Règles :
 * - Apparition < 100ms (opacity uniquement, jamais spring — règle Raycast)
 * - focus trap géré par cmdk
 * - Raccourcis Cmd+K (ouverture), ESC (fermeture)
 * - Raccourcis N/D/Ctrl+Entrée/E affichés en <Kbd>
 *
 * Le contenu (récents par tenant, actions contextuelles) sera branché plus tard ;
 * ici le composant + l'ossature.
 */

import { Command } from "cmdk";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  Calculator,
  FileText,
  FolderOpen,
  Plus,
  Stamp,
} from "lucide-react";
import { Kbd, KbdChord } from "./Kbd";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface CommandItem {
  id: string;
  label: string;
  group: "navigation" | "actions" | "recent";
  icon?: ReactNode;
  /** Raccourci affiché */
  shortcut?: string | string[];
  /** Disponible uniquement si un projet est ouvert */
  requiresProject?: boolean;
  onSelect: () => void;
}

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

interface CommandPaletteContextValue {
  open: boolean;
  openPalette: () => void;
  closePalette: () => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue>({
  open: false,
  openPalette: () => {},
  closePalette: () => {},
});

export function useCommandPalette() {
  return useContext(CommandPaletteContext);
}

/* ------------------------------------------------------------------ */
/* Provider — gestion globale Cmd+K                                   */
/* ------------------------------------------------------------------ */

interface CommandPaletteProviderProps {
  children: ReactNode;
  /** Items fournis par le contexte parent (navigation, actions, récents) */
  items?: CommandItem[];
  /** Vrai si un projet est actuellement ouvert */
  hasProject?: boolean;
}

export function CommandPaletteProvider({
  children,
  items = [],
  hasProject = false,
}: CommandPaletteProviderProps) {
  const [open, setOpen] = useState(false);

  const openPalette = useCallback(() => setOpen(true), []);
  const closePalette = useCallback(() => setOpen(false), []);

  /* Raccourci Cmd+K / Ctrl+K */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <CommandPaletteContext.Provider value={{ open, openPalette, closePalette }}>
      {children}
      <CommandPalette
        open={open}
        onClose={closePalette}
        items={items}
        hasProject={hasProject}
      />
    </CommandPaletteContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* Composant principal                                                 */
/* ------------------------------------------------------------------ */

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items?: CommandItem[];
  hasProject?: boolean;
}

const GROUP_LABELS: Record<CommandItem["group"], string> = {
  navigation: "Navigation",
  actions: "Actions",
  recent: "Récents",
};

export function CommandPalette({
  open,
  onClose,
  items = [],
  hasProject = false,
}: CommandPaletteProps) {
  const [search, setSearch] = useState("");

  /* Reset au re-ouverture */
  useEffect(() => {
    if (open) setSearch("");
  }, [open]);

  /* Filtrer les items contextuels */
  const visibleItems = items.filter(
    (item) => !item.requiresProject || hasProject
  );

  /* Groupes */
  const groups = (["recent", "navigation", "actions"] as const).reduce<
    Record<string, CommandItem[]>
  >((acc, g) => {
    const group = visibleItems.filter((i) => i.group === g);
    if (group.length > 0) acc[g] = group;
    return acc;
  }, {});

  const hasItems = visibleItems.length > 0;

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 160,
          background: "rgba(0,0,0,0.40)",
        }}
      />

      {/* Palette */}
      <div
        style={{
          position: "fixed",
          top: "20%",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 161,
          width: "min(640px, calc(100vw - 32px))",
          /* Apparition < 100ms — opacity uniquement */
          animation: "rds-cmdk-in var(--dur-instant, 100ms) ease forwards",
        }}
        role="dialog"
        aria-label="Palette de commandes"
        aria-modal="true"
      >
        <Command
          label="Palette de commandes"
          loop
          style={{
            background: "var(--surface-overlay)",
            borderRadius: "var(--radius-xl)",
            boxShadow: "var(--elevation-modal)",
            overflow: "hidden",
            fontFamily: "var(--font-sans)",
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        >
          {/* Input de recherche */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "0 16px",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Rechercher une commande…"
              autoFocus
              style={{
                flex: 1,
                padding: "14px 0",
                fontSize: 15,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "var(--text-primary)",
                fontFamily: "var(--font-sans)",
              }}
            />
            <Kbd>Esc</Kbd>
          </div>

          {/* Liste */}
          <Command.List
            style={{
              maxHeight: 400,
              overflowY: "auto",
              padding: "4px 0",
            }}
          >
            {/* Aucun résultat */}
            <Command.Empty
              style={{
                padding: "24px 16px",
                textAlign: "center",
                fontSize: 13,
                color: "var(--text-muted)",
              }}
            >
              Aucun résultat pour « {search} »
            </Command.Empty>

            {/* Items groupés */}
            {Object.entries(groups).map(([group, groupItems]) => (
              <Command.Group
                key={group}
                heading={GROUP_LABELS[group as CommandItem["group"]]}
                style={{ paddingBottom: 4 }}
              >
                {groupItems.map((item) => (
                  <CommandItemRow
                    key={item.id}
                    item={item}
                    onSelect={() => {
                      item.onSelect();
                      onClose();
                    }}
                  />
                ))}
              </Command.Group>
            ))}

            {/* État vide : aucun item chargé (org neuve) */}
            {!hasItems && search === "" && (
              <div
                style={{
                  padding: "24px 16px",
                  textAlign: "center",
                  fontSize: 13,
                  color: "var(--text-muted)",
                }}
              >
                Aucune commande récente.
              </div>
            )}
          </Command.List>

          {/* Pied de palette — raccourcis */}
          <div
            style={{
              borderTop: "1px solid var(--border-subtle)",
              padding: "8px 16px",
              display: "flex",
              gap: 16,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <PaletteShortcut label="Nouveau calcul" shortcut="N" />
            <PaletteShortcut label="Dupliquer" shortcut="D" />
            <PaletteShortcut label="Calculer" shortcut={["Ctrl", "Entrée"]} />
            <PaletteShortcut label="Exporter" shortcut="E" />
          </div>
        </Command>
      </div>

      <style>{`
        @keyframes rds-cmdk-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        [cmdk-group-heading] {
          padding: 6px 12px 2px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        [cmdk-item] {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          font-size: 13px;
          color: var(--text-primary);
          cursor: pointer;
          border-radius: 0;
          outline: none;
          transition: background-color var(--dur-fast, 150ms) var(--ease-state);
        }
        [cmdk-item][data-selected="true"],
        [cmdk-item]:hover {
          background: rgba(31,78,74,0.06);
          color: var(--text-primary);
        }
        [cmdk-item][aria-disabled="true"] {
          opacity: 0.4;
          cursor: not-allowed;
        }
        @media (prefers-reduced-motion: reduce) {
          [role="dialog"][aria-label="Palette de commandes"] { animation: none !important; }
        }
      `}</style>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Ligne d'item de commande                                            */
/* ------------------------------------------------------------------ */

function CommandItemRow({
  item,
  onSelect,
}: {
  item: CommandItem;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={item.label}
      onSelect={onSelect}
      aria-label={item.label}
    >
      {item.icon && (
        <span
          aria-hidden="true"
          style={{ display: "flex", flexShrink: 0, color: "var(--text-secondary)" }}
        >
          {item.icon}
        </span>
      )}
      <span style={{ flex: 1 }}>{item.label}</span>
      {item.shortcut && (
        <span style={{ marginLeft: "auto" }}>
          {Array.isArray(item.shortcut) ? (
            <KbdChord keys={item.shortcut} />
          ) : (
            <Kbd>{item.shortcut}</Kbd>
          )}
        </span>
      )}
    </Command.Item>
  );
}

/* ------------------------------------------------------------------ */
/* Raccourci dans le pied de palette                                   */
/* ------------------------------------------------------------------ */

function PaletteShortcut({ label, shortcut }: { label: string; shortcut: string | string[] }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        color: "var(--text-muted)",
      }}
    >
      {Array.isArray(shortcut) ? (
        <KbdChord keys={shortcut} />
      ) : (
        <Kbd>{shortcut}</Kbd>
      )}
      <span>{label}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Items de démonstration (ossature galerie)                           */
/* ------------------------------------------------------------------ */

export const DEMO_COMMAND_ITEMS: CommandItem[] = [
  {
    id: "nav-projets",
    label: "Aller aux Projets",
    group: "navigation",
    icon: <FolderOpen size={16} strokeWidth={1.5} />,
    onSelect: () => {},
  },
  {
    id: "action-new-calc",
    label: "Nouveau calcul",
    group: "actions",
    icon: <Plus size={16} strokeWidth={1.5} />,
    shortcut: "N",
    requiresProject: true,
    onSelect: () => {},
  },
  {
    id: "action-duplicate",
    label: "Dupliquer comme gabarit",
    group: "actions",
    icon: <Calculator size={16} strokeWidth={1.5} />,
    shortcut: "D",
    requiresProject: true,
    onSelect: () => {},
  },
  {
    id: "action-emit-pv",
    label: "Émettre un PV",
    group: "actions",
    icon: <Stamp size={16} strokeWidth={1.5} />,
    requiresProject: true,
    onSelect: () => {},
  },
  {
    id: "recent-burmister",
    label: "Burmister n°12 — RN2 PK45",
    group: "recent",
    icon: <FileText size={16} strokeWidth={1.5} />,
    onSelect: () => {},
  },
  {
    id: "recent-terzaghi",
    label: "Terzaghi — Semelle B1",
    group: "recent",
    icon: <FileText size={16} strokeWidth={1.5} />,
    onSelect: () => {},
  },
];
