'use client';

/**
 * Nav sticky de la landing publique GEOFAM (`/`).
 *
 * Transparente sur le hero (fond --marketing-navy, cf. page.tsx) ; devient
 * opaque (--surface-nav + ombre --elevation-sticky) une fois le scroll engagé,
 * pour rester lisible au-dessus des sections claires qui suivent le hero.
 *
 * Repli mobile : bascule simple (bouton hamburger -> panneau empilé), piloté
 * par un state local — pas de media query pour l'ouverture/fermeture elle-même
 * (seule la visibilité du bouton hamburger vs. la nav desktop dépend du CSS).
 *
 * CTA « Essai gratuit » et « Se connecter » : liens réels (mailto / /login),
 * pas de Button (composant bouton HTML — inadapté à une navigation).
 */

import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Logotype } from '@/components/ui/Logotype';

import { ESSAI_GRATUIT_HREF } from './landing-constants';

const NAV_LINKS: { href: string; label: string }[] = [
  { href: '#logiciels', label: 'Logiciels' },
  { href: '#pourquoi', label: 'Pourquoi' },
  { href: '#tarifs', label: 'Tarifs' },
  { href: '#tutoriels', label: 'Tutoriels' },
  { href: '#contact', label: 'Contact' },
];

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        background: scrolled ? 'var(--surface-nav)' : 'transparent',
        boxShadow: scrolled ? 'var(--elevation-sticky)' : 'none',
        transition: `background-color var(--dur-base) var(--ease-state), box-shadow var(--dur-base) var(--ease-state)`,
      }}
    >
      <div
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          padding: '0 20px',
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <Link href="/" aria-label="GEOFAM — accueil" style={{ display: 'flex', flexShrink: 0 }}>
          <Logotype variant="full" />
        </Link>

        <nav
          aria-label="Navigation principale"
          className="landing-nav-desktop"
          style={{ display: 'flex', alignItems: 'center', gap: 28 }}
        >
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="landing-nav-link"
              style={{
                color: 'var(--text-on-nav)',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="landing-nav-actions" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link href="/login" className="landing-cta landing-cta--ghost-on-dark">
            Se connecter
          </Link>
          <a href={ESSAI_GRATUIT_HREF} className="landing-cta landing-cta--action-on-dark">
            Essai gratuit
          </a>
        </div>

        <button
          type="button"
          className="landing-nav-toggle"
          aria-expanded={mobileOpen}
          aria-controls="landing-mobile-menu"
          aria-label={mobileOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
          onClick={() => setMobileOpen((open) => !open)}
          style={{
            display: 'none',
            alignItems: 'center',
            justifyContent: 'center',
            width: 40,
            height: 40,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-on-nav)',
            cursor: 'pointer',
          }}
        >
          {mobileOpen ? (
            <X size={22} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Menu size={22} strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>
      </div>

      {mobileOpen && (
        <div
          id="landing-mobile-menu"
          className="landing-nav-mobile-panel"
          style={{
            background: 'var(--surface-nav)',
            padding: '4px 20px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            boxShadow: 'var(--elevation-sticky)',
          }}
        >
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setMobileOpen(false)}
              style={{
                color: 'var(--text-on-nav)',
                fontSize: 'var(--text-base)',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              {l.label}
            </a>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
            <Link
              href="/login"
              onClick={() => setMobileOpen(false)}
              className="landing-cta landing-cta--ghost-on-dark"
              style={{ justifyContent: 'center' }}
            >
              Se connecter
            </Link>
            <a
              href={ESSAI_GRATUIT_HREF}
              onClick={() => setMobileOpen(false)}
              className="landing-cta landing-cta--action-on-dark"
              style={{ justifyContent: 'center' }}
            >
              Essai gratuit
            </a>
          </div>
        </div>
      )}

      <style>{`
        .landing-nav-link { opacity: 0.9; transition: opacity var(--dur-fast) var(--ease-state); }
        .landing-nav-link:hover { opacity: 1; color: var(--accent-action-on-nav); }

        @media (max-width: 767px) {
          .landing-nav-desktop, .landing-nav-actions { display: none !important; }
          .landing-nav-toggle { display: inline-flex !important; }
        }
        @media (min-width: 768px) {
          .landing-nav-toggle { display: none !important; }
          .landing-nav-mobile-panel { display: none !important; }
        }
      `}</style>
    </header>
  );
}
