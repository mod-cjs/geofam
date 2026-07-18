'use client';

/**
 * Lanceur d'aide flottant — accès SUPPORT permanent (demande titulaire 18/07).
 *
 * Bouton rond, discret, position fixed bottom-right, monté dans le shell
 * authentifié (layout d'org) : accessible depuis N'IMPORTE QUELLE page de
 * l'app, pas seulement /aide. Déplie un petit panneau (WhatsApp, tutoriels
 * YouTube, centre d'aide) + le bouton d'installation PWA (InstallAppButton).
 *
 * a11y :
 * - bouton aria-label « Aide et support », aria-expanded, aria-controls
 * - panneau role="dialog" (non modal — pas de focus trap ni de blocage du
 *   scroll : c'est un panneau flottant, pas une boîte de dialogue bloquante)
 * - fermeture : Échap, clic en dehors, re-clic sur le bouton
 * - focus renvoyé sur le bouton déclencheur à la fermeture
 * - icônes aria-hidden, liens externes annoncés (nouvel onglet)
 */

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { HelpCircle, MessageCircle, PlaySquare, BookOpen, X } from 'lucide-react';
import { InstallAppButton } from './InstallAppButton';

const WHATSAPP_NUMBER = '221768745508';
const WHATSAPP_MESSAGE = "Bonjour, j'ai besoin d'aide sur GEOFAM";
const WHATSAPP_HREF = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;
const YOUTUBE_HREF = 'https://www.youtube.com/@GEOTECHNIQUE-c7h';

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '9px 10px',
  borderRadius: 'var(--radius-base)',
  color: 'var(--text-primary)',
  fontSize: 'var(--text-sm)',
  fontWeight: 500,
  textDecoration: 'none',
};

interface HelpLauncherProps {
  orgSlug: string;
}

export function HelpLauncher({ orgSlug }: HelpLauncherProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Échap ferme le panneau et rend le focus au bouton déclencheur.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Clic en dehors du bouton et du panneau ferme le panneau.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // Focus le premier élément du panneau à l'ouverture.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Aide et support"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="help-launcher-btn"
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: 'var(--struct-petrole)',
          color: '#fff',
          border: 'none',
          boxShadow: 'var(--elevation-popover)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 90,
          transition: `background var(--dur-fast) var(--ease-state)`,
        }}
        onMouseOver={(e) => {
          (e.currentTarget as HTMLElement).style.background = 'var(--accent-action)';
        }}
        onMouseOut={(e) => {
          (e.currentTarget as HTMLElement).style.background = 'var(--struct-petrole)';
        }}
      >
        {open ? (
          <X size={22} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <HelpCircle size={22} strokeWidth={1.5} aria-hidden="true" />
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Aide et support"
          className="help-launcher-panel"
          style={{
            position: 'fixed',
            bottom: 76,
            right: 20,
            width: 260,
            background: 'var(--surface-overlay)',
            borderRadius: 'var(--radius-xl)',
            boxShadow: 'var(--elevation-popover)',
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            zIndex: 90,
          }}
        >
          <a
            href={WHATSAPP_HREF}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Contacter le support par WhatsApp (ouvre WhatsApp dans un nouvel onglet)"
            style={itemStyle}
            onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(31,78,74,0.06)'; }}
            onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <MessageCircle size={18} strokeWidth={1.5} aria-hidden="true" />
            WhatsApp
          </a>

          <a
            href={YOUTUBE_HREF}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Voir les tutoriels vidéo sur YouTube (ouvre YouTube dans un nouvel onglet)"
            style={itemStyle}
            onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(31,78,74,0.06)'; }}
            onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <PlaySquare size={18} strokeWidth={1.5} aria-hidden="true" />
            Tutoriels vidéo
          </a>

          <Link
            href={`/app/${orgSlug}/aide`}
            style={itemStyle}
            onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(31,78,74,0.06)'; }}
            onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <BookOpen size={18} strokeWidth={1.5} aria-hidden="true" />
            Centre d&rsquo;aide
          </Link>

          <div style={{ height: 1, background: 'var(--border-subtle)', margin: '6px 4px' }} />

          <div style={{ padding: '2px 10px 4px' }}>
            <InstallAppButton />
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 767px) {
          .help-launcher-btn { bottom: 16px !important; right: 16px !important; }
          .help-launcher-panel {
            right: 16px !important;
            bottom: 72px !important;
            width: calc(100vw - 32px) !important;
            max-width: 300px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .help-launcher-btn { transition: none !important; }
        }
      `}</style>
    </>
  );
}
