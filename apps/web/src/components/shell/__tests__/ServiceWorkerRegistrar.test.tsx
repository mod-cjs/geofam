/**
 * Tests — ServiceWorkerRegistrar (installabilité PWA).
 *
 * DoD §9 : given/when/then, chemins négatifs testés (non-support, échec de
 * register, environnement dev), zéro faux-vert.
 *
 * Patron d'interaction : react-dom/client + act (pas de @testing-library/react
 * dans ce dépôt — cf. ToolFrame.test.tsx).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ServiceWorkerRegistrar } from '../ServiceWorkerRegistrar';

let container: HTMLDivElement;
let root: Root;

/** Le jsdom du dépôt n'expose pas navigator.serviceWorker par défaut : on le
 *  définit/retire via defineProperty (pas de remplacement de `navigator` en
 *  entier, qui ferait perdre `userAgent` et casserait la détection jsdom de
 *  React — d'où le warning "not configured to support act"). */
function stubServiceWorker(value: { register: ReturnType<typeof vi.fn> } | undefined) {
  if (value === undefined) {
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
    return;
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    value,
    configurable: true,
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container.remove();
  stubServiceWorker(undefined);
  vi.unstubAllEnvs();
});

async function renderRegistrar() {
  await act(async () => {
    root = createRoot(container);
    root.render(<ServiceWorkerRegistrar />);
  });
}

describe('ServiceWorkerRegistrar', () => {
  it("given NODE_ENV=production et l'API serviceWorker supportée, when monté, then register('/sw.js', {scope:'/'}) est appelé", async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const register = vi.fn().mockResolvedValue({});
    stubServiceWorker({ register });

    await renderRegistrar();

    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('given NODE_ENV=development (dev local), when monté, then register n’est PAS appelé (évite les conflits avec le HMR Turbopack)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const register = vi.fn().mockResolvedValue({});
    stubServiceWorker({ register });

    await renderRegistrar();

    expect(register).not.toHaveBeenCalled();
  });

  it("given un navigateur sans l'API serviceWorker (ex. Safari ancien), when monté, then aucune exception n'est levée et rien n'est appelé", async () => {
    vi.stubEnv('NODE_ENV', 'production');
    stubServiceWorker(undefined);

    await expect(renderRegistrar()).resolves.not.toThrow();
  });

  it('given register() rejette (ex. HTTPS absent en local), when monté, then le rejet est absorbé silencieusement (pas de unhandled rejection)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const register = vi.fn().mockRejectedValue(new Error('secure context required'));
    stubServiceWorker({ register });

    await expect(renderRegistrar()).resolves.not.toThrow();
    // Laisse la microtâche de rejet se résoudre avant la fin du test.
    await act(async () => {
      await Promise.resolve();
    });
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });
});
