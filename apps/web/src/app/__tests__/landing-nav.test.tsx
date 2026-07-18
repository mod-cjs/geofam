/**
 * Tests — LandingNav (repli mobile de la landing GEOFAM).
 *
 * DoD §9 : given/when/then, interaction réelle (clic/clavier), pas de mock du DOM.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { LandingNav } from '../LandingNav';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  document.body.style.overflow = '';
  act(() => {
    root = createRoot(container);
    root.render(<LandingNav />);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  document.body.style.overflow = '';
});

function toggleButton(): HTMLButtonElement {
  return container.querySelector('.landing-nav-toggle') as HTMLButtonElement;
}

function openMenu() {
  act(() => {
    toggleButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('LandingNav — repli mobile', () => {
  it('GIVEN la nav au chargement WHEN elle est rendue THEN le panneau mobile est absent et le bouton indique « Ouvrir le menu »', () => {
    expect(container.querySelector('#landing-mobile-menu')).toBeNull();
    expect(toggleButton().getAttribute('aria-label')).toBe('Ouvrir le menu');
    expect(toggleButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('GIVEN le bouton hamburger WHEN on clique dessus THEN le panneau mobile apparaît avec les 4 ancres (sans #tutoriels) + Se connecter + Demander un essai (WhatsApp)', () => {
    openMenu();

    const panel = container.querySelector('#landing-mobile-menu');
    expect(panel).not.toBeNull();
    expect(toggleButton().getAttribute('aria-expanded')).toBe('true');
    expect(toggleButton().getAttribute('aria-label')).toBe('Fermer le menu');

    const hrefs = Array.from(panel!.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '#logiciels',
      '#pourquoi',
      '#tarifs',
      '#contact',
      '/login',
      expect.stringContaining('https://wa.me/221768745508'),
    ]);

    const essaiLink = panel!.querySelector('a[target="_blank"]');
    expect(essaiLink?.textContent?.trim()).toBe('Demander un essai');
    expect(essaiLink?.getAttribute('rel')).toContain('noopener');
  });

  it('GIVEN le panneau mobile ouvert WHEN on clique un lien d’ancre THEN le panneau se referme', () => {
    openMenu();
    expect(container.querySelector('#landing-mobile-menu')).not.toBeNull();

    const firstLink = container.querySelector('#landing-mobile-menu a') as HTMLAnchorElement;
    act(() => {
      firstLink.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('#landing-mobile-menu')).toBeNull();
    expect(toggleButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('GIVEN le panneau mobile ouvert WHEN on presse Échap THEN le panneau se referme et le focus revient au bouton hamburger', () => {
    openMenu();
    expect(container.querySelector('#landing-mobile-menu')).not.toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(container.querySelector('#landing-mobile-menu')).toBeNull();
    expect(toggleButton().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggleButton());
  });

  it('GIVEN le panneau mobile ouvert THEN le scroll de fond est bloqué, et restauré à la fermeture', () => {
    expect(document.body.style.overflow).toBe('');
    openMenu();
    expect(document.body.style.overflow).toBe('hidden');

    act(() => {
      toggleButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.body.style.overflow).toBe('');
  });
});
