'use client';

/**
 * A-13 — Dropdown / Menu d'actions
 *
 * Ouverture : opacity + translateY(-4px)→0, var(--dur-base) var(--ease-entrance)
 * Fermeture : opacity, var(--dur-fast) var(--ease-exit)
 * Items : défaut / hover / focus / avec icône / danger / séparateur / désactivé
 * Focus trap : actif à l'ouverture (flèches haut/bas, Tab, ESC)
 * Fermeture : mousedown hors zone + ESC + retour focus déclencheur
 * Largeur : 160–280px
 *
 * Base réutilisable pour OrgSwitcher et menu avatar.
 */

import {
  createContext,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface DropdownItem {
  id: string;
  label: string;
  /** Icône Lucide (16px, strokeWidth 1.5) */
  icon?: ReactNode;
  /** Item danger (rouge) */
  danger?: boolean;
  /** Item désactivé */
  disabled?: boolean;
  /** Séparateur AU-DESSUS de cet item */
  separator?: boolean;
  onClick?: () => void;
}

interface DropdownContextValue {
  close: () => void;
}
const DropdownContext = createContext<DropdownContextValue>({ close: () => {} });

/* ------------------------------------------------------------------ */
/* Composant principal                                                 */
/* ------------------------------------------------------------------ */

interface DropdownProps {
  /** Élément déclencheur (bouton, avatar, etc.) */
  trigger: ReactNode;
  items: DropdownItem[];
  /** Largeur du panneau (défaut 200px) */
  width?: number | string;
  /** Alignement du panneau (défaut "left") */
  align?: 'left' | 'right';
  className?: string;
}

export function Dropdown({
  trigger,
  items,
  width = 200,
  align = 'left',
  className,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  /* Fermeture avec animation */
  const close = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
      /* Retour focus au déclencheur */
      const btn = triggerRef.current?.querySelector<HTMLElement>(
        'button, [role=button], a',
      );
      btn?.focus();
    }, 155); // var(--dur-fast) 150ms + marge
  }, []);

  /* Fermeture mousedown hors zone */
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const panel = panelRef.current;
      const trigger = triggerRef.current;
      if (
        panel &&
        !panel.contains(e.target as Node) &&
        trigger &&
        !trigger.contains(e.target as Node)
      ) {
        close();
      }
    }
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, [open, close]);

  /* Focus trap clavier */
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"])',
      ) ?? [],
    );
    const idx = items.indexOf(document.activeElement as HTMLElement);

    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      /* Sort du menu → fermer */
      close();
    }
  }

  function toggleOpen() {
    if (open) {
      close();
    } else {
      setOpen(true);
      /* Focus premier item à la prochaine frame */
      setTimeout(() => {
        const first = panelRef.current?.querySelector<HTMLElement>(
          '[role="menuitem"]:not([aria-disabled="true"])',
        );
        first?.focus();
      }, 20);
    }
  }

  return (
    <DropdownContext.Provider value={{ close }}>
      <div
        ref={triggerRef}
        className={className}
        style={{ position: 'relative', display: 'inline-flex' }}
        onKeyDown={onKeyDown}
      >
        {/* Déclencheur — on clone l'enfant avec aria-expanded */}
        <div
          onClick={toggleOpen}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
        >
          {trigger}
        </div>

        {/* Panneau */}
        {open && (
          <div
            id={menuId}
            ref={panelRef}
            role="menu"
            aria-orientation="vertical"
            style={{
              position: 'absolute',
              zIndex: 100,
              top: 'calc(100% + 4px)',
              ...(align === 'right' ? { right: 0 } : { left: 0 }),
              width,
              minWidth: 160,
              maxWidth: 280,
              background: 'var(--surface-overlay)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--elevation-popover)',
              padding: '4px 0',
              outline: 'none',
              animation: closing
                ? `rds-dd-out var(--dur-fast, 150ms) var(--ease-exit, cubic-bezier(0.55,0,1,0.45)) forwards`
                : `rds-dd-in var(--dur-base, 200ms) var(--ease-entrance, cubic-bezier(0.165,0.84,0.44,1)) forwards`,
            }}
          >
            {items.map((item) => (
              <DropdownItemRow key={item.id} item={item} onClose={close} />
            ))}
          </div>
        )}

        <style>{`
          @keyframes rds-dd-in {
            from { opacity: 0; transform: translateY(-4px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          @keyframes rds-dd-out {
            from { opacity: 1; }
            to   { opacity: 0; }
          }
          @media (prefers-reduced-motion: reduce) {
            [role="menu"] { animation: none !important; }
          }
        `}</style>
      </div>
    </DropdownContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* Ligne d'item                                                        */
/* ------------------------------------------------------------------ */

function DropdownItemRow({ item, onClose }: { item: DropdownItem; onClose: () => void }) {
  const [hovered, setHovered] = useState(false);

  function handleClick() {
    if (item.disabled) return;
    item.onClick?.();
    onClose();
  }

  return (
    <>
      {item.separator && (
        <hr
          aria-hidden="true"
          style={{
            margin: '4px 0',
            border: 'none',
            borderTop: '1px solid var(--border-subtle)',
          }}
        />
      )}
      <div
        role="menuitem"
        tabIndex={item.disabled ? -1 : 0}
        aria-disabled={item.disabled ? 'true' : undefined}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 12px',
          fontSize: 13,
          fontWeight: 400,
          cursor: item.disabled ? 'not-allowed' : 'pointer',
          color: item.disabled
            ? 'var(--text-muted)'
            : item.danger
              ? 'var(--status-fail-tx)'
              : 'var(--text-primary)',
          background:
            hovered && !item.disabled
              ? item.danger
                ? 'var(--status-fail-bg)'
                : 'rgba(31,78,74,0.05)'
              : 'transparent',
          transition: `background-color var(--dur-fast, 150ms) var(--ease-state, cubic-bezier(0.455,0.03,0.515,0.955))`,
          userSelect: 'none',
          outline: 'none',
        }}
      >
        {item.icon && (
          <span
            aria-hidden="true"
            style={{
              display: 'flex',
              flexShrink: 0,
              color: item.disabled
                ? 'var(--text-muted)'
                : item.danger
                  ? 'var(--status-fail-tx)'
                  : 'var(--text-secondary)',
            }}
          >
            {item.icon}
          </span>
        )}
        <span>{item.label}</span>
      </div>
    </>
  );
}
