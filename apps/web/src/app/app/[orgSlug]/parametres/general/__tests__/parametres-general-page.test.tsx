/**
 * Tests — Paramètres généraux (item PRODUIT #4 : retrait du stub
 * « prochaine version »).
 *
 * DoD §9 : given/when/then, chemins négatifs (chargement, erreur réseau)
 * testés. Patron d'interaction : react-dom/client + act.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGetEntitlements, mockGetStoredOrgs } = vi.hoisted(() => ({
  mockGetEntitlements: vi.fn(),
  mockGetStoredOrgs: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'be-routes-dakar' }),
}));

vi.mock('@/lib/api/client', () => ({
  getEntitlements: mockGetEntitlements,
  getStoredOrgs: mockGetStoredOrgs,
}));

import ParametresGeneralPage from '../page';

function entitlements(over: Partial<{ pack: 'ROUTES' | 'FONDATIONS' | 'COMPLETE'; expired: boolean }> = {}) {
  return {
    orgId: 'org_01',
    pack: over.pack ?? 'COMPLETE',
    modules: ['burmister'],
    expiresAt: '2027-03-15T00:00:00.000Z',
    expired: over.expired ?? false,
    quota: { limit: 500, used: 120, remaining: 380 },
    serverTime: '2026-07-17T00:00:00.000Z',
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  mockGetEntitlements.mockReset().mockResolvedValue(entitlements());
  mockGetStoredOrgs.mockReset().mockReturnValue([{ id: 'org_01', slug: 'be-routes-dakar', role: 'OWNER' }]);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container.remove();
});

async function renderPage() {
  await act(async () => {
    root = createRoot(container);
    root.render(<ParametresGeneralPage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ParametresGeneralPage', () => {
  it('given un bureau et un abonnement chargés, when rendu, then AUCUN texte "prochaine version" n’est visible', async () => {
    await renderPage();
    expect(container.textContent).not.toMatch(/prochaine version/i);
  });

  it('given getStoredOrgs résout le bureau, when rendu, then le nom du bureau et le rôle sont affichés', async () => {
    await renderPage();
    expect(container.textContent).toMatch(/Be Routes Dakar/);
    expect(container.textContent).toMatch(/OWNER/);
  });

  it('given des entitlements chargés (pack COMPLETE, échéance connue), when rendu, then le pack et l’échéance sont affichés', async () => {
    await renderPage();
    expect(container.textContent).toMatch(/Plateforme complète/);
    expect(container.textContent).toMatch(/15 mars 2027/);
  });

  it('given un abonnement expiré, when rendu, then un badge "Expiré" est visible', async () => {
    mockGetEntitlements.mockResolvedValue(entitlements({ expired: true }));
    await renderPage();
    expect(container.textContent).toMatch(/Expiré/);
  });

  it('given un lien vers le compte, when rendu, then il pointe vers /app/be-routes-dakar/compte', async () => {
    await renderPage();
    const link = container.querySelector('a[href="/app/be-routes-dakar/compte"]');
    expect(link).not.toBeNull();
  });

  it('given une erreur réseau au chargement de l’abonnement, when rendu, then un état d’erreur avec Réessayer est affiché', async () => {
    mockGetEntitlements.mockRejectedValue(new Error('network down'));
    await renderPage();
    const retryBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      /réessayer/i.test(b.textContent ?? ''),
    );
    expect(retryBtn).toBeTruthy();
  });
});
