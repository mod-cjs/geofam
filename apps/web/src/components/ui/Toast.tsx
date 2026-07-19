'use client';

/**
 * A-14 — Toast / Notification
 *
 * Types : succès (4s) / erreur (6s persistante) / warning / info
 * Entrée : slide-up + opacity  (var(--dur-base) var(--ease-entrance))
 * Sortie : opacity seule       (var(--dur-fast) var(--ease-exit))
 * Stack : max 3 toasts visibles
 * Position : bottom-right ≥ 768px / top-center < 768px
 *
 * a11y :
 * - aria-live="polite"   (succès / info / warning)
 * - aria-live="assertive" (erreur)
 * - aria-atomic="true"
 *
 * API : ToastProvider + useToast hook
 */

import { AlertCircle, CheckCircle, Info, X, AlertTriangle } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  /** Label du bouton d'action (ex. "Réessayer") */
  actionLabel?: string;
  onAction?: () => void;
  /** Durée avant auto-dismiss (ms). 0 = persistant. Défaut : 4000 succès / 6000 erreur */
  duration?: number;
  /** Pour l'animation de sortie */
  exiting?: boolean;
}

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

interface ToastContextValue {
  toasts: ToastItem[];
  addToast: (opts: Omit<ToastItem, 'id' | 'exiting'>) => string;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

export const MAX_TOASTS = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    /* Déclenche l'animation de sortie */
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    /* Supprime après animation */
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 160); // var(--dur-fast) = 150ms + marge
  }, []);

  const addToast = useCallback(
    (opts: Omit<ToastItem, 'id' | 'exiting'>): string => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const defaultDuration =
        opts.duration !== undefined ? opts.duration : opts.type === 'error' ? 6000 : 4000;

      setToasts((prev) => {
        const next = [...prev, { ...opts, id, exiting: false }];
        /* Stack max 3 : retirer les plus anciens */
        return next.slice(-MAX_TOASTS);
      });

      if (defaultDuration > 0) {
        const timer = setTimeout(() => dismissToast(id), defaultDuration);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [dismissToast],
  );

  /* Nettoyage des timers à l'unmount */
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, dismissToast }}>
      {children}
      <ToastRegion toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* Hook consommateur                                                   */
/* ------------------------------------------------------------------ */

export function useToast(): Omit<ToastContextValue, 'toasts'> {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return { addToast: ctx.addToast, dismissToast: ctx.dismissToast };
}

/* ------------------------------------------------------------------ */
/* Région d'affichage (positionnement adaptatif)                      */
/* ------------------------------------------------------------------ */

const iconByType: Record<ToastType, ReactNode> = {
  success: <CheckCircle size={16} strokeWidth={1.5} aria-hidden="true" />,
  error: <AlertCircle size={16} strokeWidth={1.5} aria-hidden="true" />,
  warning: <AlertTriangle size={16} strokeWidth={1.5} aria-hidden="true" />,
  info: <Info size={16} strokeWidth={1.5} aria-hidden="true" />,
};

export const colorByType: Record<ToastType, { icon: string; border: string }> = {
  success: { icon: 'var(--status-pass-tx)', border: 'rgba(47,107,70,0.2)' },
  error: { icon: 'var(--status-fail-tx)', border: 'rgba(139,26,26,0.2)' },
  warning: { icon: '#92550a', border: 'rgba(146,85,10,0.2)' },
  info: { icon: 'var(--struct-petrole-text)', border: 'rgba(31,78,74,0.2)' },
};

interface ToastRegionProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

function ToastRegion({ toasts, onDismiss }: ToastRegionProps) {
  return (
    <>
      {/* Zone polite (succès / info / warning) */}
      <div
        aria-live="polite"
        aria-atomic="false"
        aria-relevant="additions"
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 200 }}
      />
      {/* Zone assertive (erreurs) */}
      <div
        aria-live="assertive"
        aria-atomic="true"
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 200 }}
      />

      {/* Conteneur visuel */}
      <div
        style={{
          position: 'fixed',
          /* bottom-right ≥ 768px — top-center < 768px via CSS custom */
          bottom: 24,
          right: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          zIndex: 200,
          pointerEvents: 'none',
          maxWidth: 360,
          width: 'calc(100vw - 48px)',
        }}
        /* Responsive via media query inline non disponible ; on applique via className */
        className="rds-toast-region"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </div>

      {/* Style inline pour responsive — compatible avec Tailwind v4 */}
      <style>{`
        @media (max-width: 767px) {
          .rds-toast-region {
            bottom: auto !important;
            right: auto !important;
            top: 16px !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
          }
        }
        @keyframes rds-toast-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        @keyframes rds-toast-out {
          from { opacity: 1; }
          to   { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .rds-toast-card { animation: none !important; }
        }
      `}</style>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Carte toast individuelle                                            */
/* ------------------------------------------------------------------ */

export function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const colors = colorByType[toast.type];

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      className="rds-toast-card"
      style={{
        background: 'var(--surface-base)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--elevation-modal)',
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        pointerEvents: 'auto',
        animation: toast.exiting
          ? `rds-toast-out var(--dur-fast, 150ms) var(--ease-exit, cubic-bezier(0.55,0,1,0.45)) forwards`
          : `rds-toast-in var(--dur-base, 200ms) var(--ease-entrance, cubic-bezier(0.165,0.84,0.44,1)) forwards`,
        borderLeft: `3px solid ${colors.border}`,
      }}
    >
      {/* Icône */}
      <span style={{ color: colors.icon, flexShrink: 0, marginTop: 1 }}>
        {iconByType[toast.type]}
      </span>

      {/* Contenu */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--text-primary)',
            margin: 0,
            lineHeight: 1.4,
          }}
        >
          {toast.message}
        </p>

        {toast.actionLabel && toast.onAction && (
          <button
            onClick={() => {
              toast.onAction!();
              onDismiss(toast.id);
            }}
            style={{
              marginTop: 6,
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--accent-action)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              textDecoration: 'underline',
              textUnderlineOffset: 2,
            }}
          >
            {toast.actionLabel}
          </button>
        )}
      </div>

      {/* Fermeture */}
      <button
        onClick={() => onDismiss(toast.id)}
        aria-label="Fermer la notification"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          padding: 2,
          borderRadius: 'var(--radius-sm)',
          flexShrink: 0,
        }}
      >
        <X size={14} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}
