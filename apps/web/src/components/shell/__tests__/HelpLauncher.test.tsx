/**
 * Tests — HelpLauncher (item PRODUIT : accès SUPPORT permanent, WhatsApp +
 * tutoriels toujours visibles depuis n'importe quelle page authentifiée).
 *
 * DoD §9 : given/when/then, chemins négatifs (fermeture Échap/clic dehors)
 * testés autant que le chemin heureux. Patron d'interaction : react-dom/client
 * + act (pas de @testing-library/react dans ce dépôt).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { HelpLauncher } from '../HelpLauncher';

const ORG_SLUG = 'be-routes-dakar';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(<HelpLauncher orgSlug={ORG_SLUG} />);
  });
}

function getLauncherButton(): HTMLButtonElement {
  return container.querySelector('button[aria-label="Aide et support"]') as HTMLButtonElement;
}

describe('HelpLauncher', () => {
  it('given le shell authentifié rendu, when la page se charge, then le bouton flottant « Aide et support » est visible et fermé par défaut', async () => {
    await render();
    const btn = getLauncherButton();
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[role="dialog"][aria-label="Aide et support"]')).toBeNull();
  });

  it('given le panneau fermé, when on clique sur le bouton, then le panneau s’ouvre avec les 3 actions (WhatsApp, tutoriels, centre d’aide) aux bonnes URLs', async () => {
    await render();
    await act(async () => {
      getLauncherButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const panel = container.querySelector('[role="dialog"][aria-label="Aide et support"]');
    expect(panel).not.toBeNull();

    const whatsapp = panel!.querySelector('a[href*="wa.me"]') as HTMLAnchorElement;
    expect(whatsapp.href).toBe(
      'https://wa.me/221768745508?text=Bonjour%2C%20j%27ai%20besoin%20d%27aide%20sur%20GEOFAM'
    );
    expect(whatsapp.target).toBe('_blank');
    expect(whatsapp.rel).toMatch(/noopener/);

    const youtube = panel!.querySelector('a[href*="youtube.com"]') as HTMLAnchorElement;
    expect(youtube.href).toBe('https://www.youtube.com/@GEOTECHNIQUE-c7h');
    expect(youtube.target).toBe('_blank');

    const aide = panel!.querySelector(`a[href="/app/${ORG_SLUG}/aide"]`);
    expect(aide).not.toBeNull();

    expect(getLauncherButton().getAttribute('aria-expanded')).toBe('true');
  });

  it('given le panneau ouvert, when on appuie sur Échap, then le panneau se ferme et le focus revient au bouton déclencheur', async () => {
    await render();
    await act(async () => {
      getLauncherButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(getLauncherButton());
  });

  it('given le panneau ouvert, when on clique en dehors du panneau et du bouton, then le panneau se ferme', async () => {
    await render();
    await act(async () => {
      getLauncherButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('given le panneau ouvert, when on reclique sur le bouton flottant, then le panneau se referme (toggle)', async () => {
    await render();
    await act(async () => {
      getLauncherButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => {
      getLauncherButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
