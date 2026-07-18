/**
 * Tests — InstallAppButton (item PRODUIT : bouton « Installer l'application »,
 * patron deferred beforeinstallprompt).
 *
 * DoD §9 : given/when/then, chemins négatifs (navigateur non supporté —
 * DIA/Safari/Firefox — qui ne déclenche jamais l'événement) testés au même
 * titre que le chemin heureux. Patron d'interaction : react-dom/client + act
 * (pas de @testing-library/react dans ce dépôt).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { InstallAppButton } from '../InstallAppButton';

let container: HTMLDivElement;
let root: Root;

async function dispatchBeforeInstallPrompt(overrides: { prompt?: () => Promise<void>; userChoice?: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }> } = {}) {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.assign(event, {
    platforms: ['web'],
    prompt: overrides.prompt ?? vi.fn().mockResolvedValue(undefined),
    userChoice: overrides.userChoice ?? Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
  });
  await act(async () => {
    window.dispatchEvent(event);
    // laisser passer le micro-tick de mise à jour d'état
    await Promise.resolve();
  });
  return event;
}

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(<InstallAppButton />);
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  // matchMedia n'existe pas nativement en jsdom.
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

describe('InstallAppButton', () => {
  it("given aucun événement beforeinstallprompt (navigateur non supporté, ex. DIA/Safari/Firefox), when rendu, then affiche le repli « Comment installer » (pas de bouton d'installation fantôme)", async () => {
    await render();
    const fallback = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes("Comment installer")
    );
    expect(fallback).not.toBeUndefined();
    expect(
      Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.includes('Installer l’application') || b.textContent?.includes("Installer l'application"))
    ).toBe(false);
  });

  it("given le repli affiché, when on clique dessus, then une modale d'instructions honnêtes s'ouvre (mentionne DIA et recommande Chrome/Edge)", async () => {
    await render();
    const fallback = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Comment installer')
    )!;
    await act(async () => {
      fallback.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.body.textContent).toMatch(/DIA/);
    expect(document.body.textContent).toMatch(/Chrome/);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("given un événement beforeinstallprompt simulé, when rendu, then affiche le bouton « Installer l'application » (et le repli disparaît)", async () => {
    await render();
    await dispatchBeforeInstallPrompt();

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.some((b) => b.textContent?.includes("Installer l'application") || b.textContent?.includes('Installer l’application'))).toBe(true);
    expect(buttons.some((b) => b.textContent?.includes('Comment installer'))).toBe(false);
  });

  it("given le bouton d'installation affiché, when on clique dessus, then prompt() est appelé et userChoice est attendu", async () => {
    await render();
    const promptMock = vi.fn().mockResolvedValue(undefined);
    await dispatchBeforeInstallPrompt({ prompt: promptMock });

    const installBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Installer')
    )!;
    await act(async () => {
      installBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(promptMock).toHaveBeenCalledTimes(1);
  });

  it("given l'événement appinstalled, when il se déclenche, then le bouton et le repli disparaissent tous les deux (déjà installée)", async () => {
    await render();
    await dispatchBeforeInstallPrompt();
    expect(container.querySelectorAll('button').length).toBeGreaterThan(0);

    await act(async () => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(container.querySelectorAll('button').length).toBe(0);
  });

  it("given l'app déjà lancée en mode standalone (display-mode: standalone), when rendu, then rien ne s'affiche", async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(display-mode: standalone)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    await render();
    expect(container.querySelectorAll('button').length).toBe(0);
  });
});
