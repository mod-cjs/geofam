"use client";

/**
 * A-12 — Modal / Dialog
 *
 * Tailles : sm (480px) / md (600px) / lg (780px)
 * Structure : header + body + footer
 * Backdrop : rgba overlay
 *
 * Ouverture : opacity 0→1 + scale 0.98→1, var(--dur-base) var(--ease-entrance)
 * Fermeture : opacity 1→0, var(--dur-fast) var(--ease-exit)
 *
 * a11y :
 * - focus trap (focus premier élément focusable à l'ouverture)
 * - ESC ferme + retour focus déclencheur
 * - aria-modal="true"
 * - inert sur le reste du DOM (via data-inert attr + CSS pointer-events)
 * - Responsive : plein écran < 768px, footer fixe
 *
 * États : erreur inline / loading interne / responsive
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { X, Loader2, AlertCircle } from "lucide-react";

export type ModalSize = "sm" | "md" | "lg";

interface ModalProps {
  /** Contrôle l'ouverture */
  open: boolean;
  onClose: () => void;
  /** Titre de la modale (h2, id lié à aria-labelledby) */
  title: string;
  /** Description courte optionnelle */
  description?: string;
  size?: ModalSize;
  /** Contenu principal */
  children: ReactNode;
  /** Pied de modale (boutons) */
  footer?: ReactNode;
  /** État de chargement interne (masque le body, affiche spinner) */
  loading?: boolean;
  /** Erreur inline (s'affiche dans le body) */
  error?: string;
  className?: string;
}

const sizeWidths: Record<ModalSize, number> = {
  sm: 480,
  md: 600,
  lg: 780,
};

const FOCUSABLE_SELECTORS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  children,
  footer,
  loading = false,
  error,
  className,
}: ModalProps) {
  const [closing, setClosing] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
      prevFocusRef.current?.focus();
    }, 155); // var(--dur-fast) 150ms + marge
  }, [onClose]);

  /* Mémoriser le déclencheur et focus trap */
  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement as HTMLElement;

    /* Focus premier élément focusable après mount */
    requestAnimationFrame(() => {
      const el = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTORS);
      el?.focus();
    });
  }, [open]);

  /* ESC */
  useEffect(() => {
    if (!open) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, handleClose]);

  /* Bloquer le scroll body */
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  /* Focus trap Tab */
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)
    ).filter((el) => !el.closest("[aria-hidden=true]"));
    if (focusable.length === 0) { e.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  if (!open && !closing) return null;

  const maxW = sizeWidths[size];

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={handleClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 150,
          background: "rgba(0,0,0,0.45)",
          animation: closing
            ? `rds-modal-fade-out var(--dur-fast, 150ms) forwards`
            : `rds-modal-fade-in var(--dur-base, 200ms) forwards`,
        }}
      />

      {/* Dialog */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 151,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px",
          pointerEvents: "none",
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onKeyDown={onKeyDown}
          className={className}
          style={{
            background: "var(--surface-overlay)",
            borderRadius: "var(--radius-xl)",
            boxShadow: "var(--elevation-modal)",
            width: "100%",
            maxWidth: maxW,
            maxHeight: "calc(100dvh - 32px)",
            display: "flex",
            flexDirection: "column",
            pointerEvents: "auto",
            outline: "none",
            animation: closing
              ? `rds-modal-out var(--dur-fast, 150ms) var(--ease-exit, cubic-bezier(0.55,0,1,0.45)) forwards`
              : `rds-modal-in var(--dur-base, 200ms) var(--ease-entrance, cubic-bezier(0.165,0.84,0.44,1)) forwards`,
          }}
        >
          {/* Header */}
          <header
            style={{
              padding: "16px 20px",
              borderBottom: "1px solid var(--border-subtle)",
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              flexShrink: 0,
            }}
          >
            <div style={{ flex: 1 }}>
              <h2
                id={titleId}
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  margin: 0,
                  lineHeight: 1.3,
                }}
              >
                {title}
              </h2>
              {description && (
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--text-secondary)",
                    margin: "4px 0 0",
                    lineHeight: 1.4,
                  }}
                >
                  {description}
                </p>
              )}
            </div>
            <button
              onClick={handleClose}
              aria-label="Fermer"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--text-muted)",
                display: "flex",
                alignItems: "center",
                padding: 4,
                borderRadius: "var(--radius-sm)",
                flexShrink: 0,
                marginTop: -2,
              }}
            >
              <X size={18} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </header>

          {/* Body */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "20px",
              position: "relative",
            }}
          >
            {/* Erreur inline */}
            {error && (
              <div
                role="alert"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 12px",
                  marginBottom: 16,
                  background: "var(--status-fail-bg)",
                  borderRadius: "var(--radius-base)",
                  color: "var(--status-fail-tx)",
                  fontSize: 13,
                }}
              >
                <AlertCircle size={16} strokeWidth={1.5} aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            {/* Loading interne */}
            {loading ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "40px 0",
                  gap: 12,
                  color: "var(--text-muted)",
                }}
                aria-busy="true"
                aria-label="Chargement…"
              >
                <Loader2
                  size={24}
                  strokeWidth={1.5}
                  aria-hidden="true"
                  style={{ animation: "spin 1s linear infinite" }}
                />
                <span style={{ fontSize: 13 }}>Chargement…</span>
              </div>
            ) : (
              children
            )}
          </div>

          {/* Footer (sticky en responsive) */}
          {footer && (
            <footer
              style={{
                padding: "12px 20px",
                borderTop: "1px solid var(--border-subtle)",
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                flexShrink: 0,
                background: "var(--surface-overlay)",
              }}
            >
              {footer}
            </footer>
          )}
        </div>
      </div>

      <style>{`
        @keyframes rds-modal-in {
          from { opacity: 0; transform: scale(0.98); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes rds-modal-out {
          from { opacity: 1; }
          to   { opacity: 0; }
        }
        @keyframes rds-modal-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes rds-modal-fade-out {
          from { opacity: 1; }
          to   { opacity: 0; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @media (max-width: 767px) {
          [role="dialog"] {
            max-width: 100% !important;
            max-height: 100dvh !important;
            border-radius: 0 !important;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          [role="dialog"] { animation: none !important; }
        }
      `}</style>
    </>
  );
}
