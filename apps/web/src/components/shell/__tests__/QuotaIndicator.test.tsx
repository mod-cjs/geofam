/**
 * Tests — QuotaIndicator (item PRODUIT #2 : quota compact et permanent dans
 * la Topbar).
 *
 * DoD §9 : given/when/then, chemins négatifs (chargement, erreur réseau)
 * testés autant que le chemin heureux. Patron d'interaction : react-dom/client
 * + act (pas de @testing-library/react dans ce dépôt).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGetEntitlements } = vi.hoisted(() => ({
  mockGetEntitlements: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  getEntitlements: mockGetEntitlements,
}));

import { QuotaIndicator } from '../QuotaIndicator';

const ORG_SLUG = 'be-routes-dakar'; // -> org_01 dans MOCK_ORGS (org-context réel)

function entitlements(over: Partial<{ expired: boolean; quota: { limit: number; used: number; remaining: number } }> = {}) {
  return {
    orgId: 'org_01',
    pack: 'COMPLETE' as const,
    modules: ['burmister'],
    expiresAt: '2027-01-01T00:00:00.000Z',
    expired: over.expired ?? false,
    quota: over.quota ?? { limit: 500, used: 120, remaining: 380 },
    serverTime: '2026-07-17T00:00:00.000Z',
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  mockGetEntitlements.mockReset();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container.remove();
});

async function renderIndicator() {
  await act(async () => {
    root = createRoot(container);
    root.render(<QuotaIndicator orgSlug={ORG_SLUG} />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('QuotaIndicator', () => {
  it('given entitlements pas encore résolues, when rendu, then rien ne s’affiche (pas de flash de donnée fausse)', async () => {
    mockGetEntitlements.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      root = createRoot(container);
      root.render(<QuotaIndicator orgSlug={ORG_SLUG} />);
    });
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('given entitlements chargées (120/500), when rendu, then affiche "120/500 calculs · 24 %" avec aria-label détaillé', async () => {
    mockGetEntitlements.mockResolvedValue(entitlements({ quota: { limit: 500, used: 120, remaining: 380 } }));
    await renderIndicator();

    const el = container.querySelector('[role="status"]');
    expect(el).not.toBeNull();
    expect(el!.textContent).toMatch(/120\/500 calculs · 24 %/);
    expect(el!.getAttribute('aria-label')).toMatch(/120 sur 500 calculs consommés \(24 %\)/);
  });

  it('given getEntitlements rejette (erreur réseau), when rendu, then rien ne s’affiche (fail-quiet, pas de plantage)', async () => {
    mockGetEntitlements.mockRejectedValue(new Error('network down'));
    await renderIndicator();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('given un abonnement expiré, when rendu, then l’aria-label signale l’expiration', async () => {
    mockGetEntitlements.mockResolvedValue(entitlements({ expired: true }));
    await renderIndicator();
    const el = container.querySelector('[role="status"]');
    expect(el!.getAttribute('aria-label')).toMatch(/expiré/i);
  });

  it('given quota > 90 % consommé, when rendu, then l’aria-label reflète le pourcentage critique', async () => {
    mockGetEntitlements.mockResolvedValue(entitlements({ quota: { limit: 100, used: 95, remaining: 5 } }));
    await renderIndicator();
    const el = container.querySelector('[role="status"]');
    expect(el!.textContent).toMatch(/95\/100 calculs · 95 %/);
  });
});
