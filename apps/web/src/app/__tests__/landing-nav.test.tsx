/**
 * Tests — LandingNav (repli mobile de la landing GEOFAM).
 *
 * DoD §9 : given/when/then, interaction réelle (clic), pas de mock du DOM.
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
});

function toggleButton(): HTMLButtonElement {
  return container.querySelector('.landing-nav-toggle') as HTMLButtonElement;
}

describe('LandingNav — repli mobile', () => {
  it('GIVEN la nav au chargement WHEN elle est rendue THEN le panneau mobile est absent et le bouton indique « Ouvrir le menu »', () => {
    expect(container.querySelector('#landing-mobile-menu')).toBeNull();
    expect(toggleButton().getAttribute('aria-label')).toBe('Ouvrir le menu');
    expect(toggleButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('GIVEN le bouton hamburger WHEN on clique dessus THEN le panneau mobile apparaît avec les 5 ancres + Se connecter + Essai gratuit', () => {
    act(() => {
      toggleButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const panel = container.querySelector('#landing-mobile-menu');
    expect(panel).not.toBeNull();
    expect(toggleButton().getAttribute('aria-expanded')).toBe('true');
    expect(toggleButton().getAttribute('aria-label')).toBe('Fermer le menu');

    const hrefs = Array.from(panel!.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '#logiciels',
      '#pourquoi',
      '#tarifs',
      '#tutoriels',
      '#contact',
      '/login',
      expect.stringContaining('mailto:direction@geofam.tech?subject='),
    ]);
  });

  it('GIVEN le panneau mobile ouvert WHEN on clique un lien d’ancre THEN le panneau se referme', () => {
    act(() => {
      toggleButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('#landing-mobile-menu')).not.toBeNull();

    const firstLink = container.querySelector('#landing-mobile-menu a') as HTMLAnchorElement;
    act(() => {
      firstLink.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('#landing-mobile-menu')).toBeNull();
    expect(toggleButton().getAttribute('aria-expanded')).toBe('false');
  });
});
