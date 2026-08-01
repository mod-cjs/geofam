/**
 * Tests — galerie GEOFAM (page.tsx), bug F5 diagnostiqué : au refresh, l'orgId
 * (mode réel) et les entitlements sont résolus post-montage, tous deux
 * asynchrones. Avant correctif : `orgId=null` (résolution en cours) et
 * `orgId=null` (pas d'org) étaient indiscernables -> `loading` basculait à
 * `false` prématurément -> `evaluateGate(null, …)` faisait flasher les badges
 * « Non inclus » avant la vérité serveur.
 *
 * DoD §9 : given/when/then, chemin négatif (échec réseau, fail-closed) inclus,
 * zéro badge de statut pendant la résolution (squelettes neutres uniquement).
 * Patron d'interaction : react-dom/client + act (pas de @testing-library/react
 * dans ce dépôt — cf. QuotaIndicator.test.tsx).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockUseOrgIdReady, mockGetEntitlements } = vi.hoisted(() => ({
  mockUseOrgIdReady: vi.fn(),
  mockGetEntitlements: vi.fn(),
}));

const ORG_SLUG = 'be-routes-dakar';

vi.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: ORG_SLUG }),
}));

vi.mock('@/lib/org-context', () => ({
  useOrgIdReady: mockUseOrgIdReady,
}));

vi.mock('@/lib/api/client', () => ({
  getEntitlements: mockGetEntitlements,
}));

import LogicielsGallery from '../page';

function entitlements(
  over: Partial<{
    modules: string[];
    expired: boolean;
    quota: { limit: number; used: number; remaining: number };
  }> = {},
) {
  return {
    orgId: 'org_01',
    pack: 'COMPLETE' as const,
    modules: over.modules ?? ['burmister'],
    expiresAt: '2027-01-01T00:00:00.000Z',
    expired: over.expired ?? false,
    quota: over.quota ?? { limit: 500, used: 10, remaining: 490 },
    serverTime: '2026-08-01T00:00:00.000Z',
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  mockUseOrgIdReady.mockReset();
  mockGetEntitlements.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container.remove();
});

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(<LogicielsGallery />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function skeletonCount() {
  return container.querySelectorAll('.geofam-skel').length;
}

describe('LogicielsGallery — squelettes pendant la résolution (pas de flash)', () => {
  it('given orgId encore en cours de résolution (ready=false), when rendu, then affiche des squelettes et aucun badge de statut', async () => {
    mockUseOrgIdReady.mockReturnValue({ orgId: null, ready: false });
    mockGetEntitlements.mockReturnValue(new Promise(() => {}));

    await render();

    expect(container.textContent).not.toMatch(/Non inclus/);
    expect(container.textContent).not.toMatch(/Disponible/);
    expect(skeletonCount()).toBeGreaterThan(0);
    // Résolution non terminée -> pas d'appel entitlements (dépend de orgId).
    expect(mockGetEntitlements).not.toHaveBeenCalled();
  });

  it('given orgId résolu mais entitlements encore en vol, when rendu, then reste en squelettes (pas de badge)', async () => {
    mockUseOrgIdReady.mockReturnValue({ orgId: 'org_01', ready: true });
    mockGetEntitlements.mockReturnValue(new Promise(() => {}));

    await render();

    expect(container.textContent).not.toMatch(/Non inclus/);
    expect(container.textContent).not.toMatch(/Disponible/);
    expect(skeletonCount()).toBeGreaterThan(0);
    expect(mockGetEntitlements).toHaveBeenCalledWith('org_01');
  });

  it('given entitlements chargées (ROADSENS inclus, autres non), when rendu, then affiche "Disponible" pour ROADSENS et "Non inclus" pour les modules hors pack, sans squelette résiduel', async () => {
    mockUseOrgIdReady.mockReturnValue({ orgId: 'org_01', ready: true });
    mockGetEntitlements.mockResolvedValue(entitlements({ modules: ['burmister'] }));

    await render();

    expect(container.textContent).toMatch(/Disponible/);
    expect(container.textContent).toMatch(/Non inclus/);
    expect(skeletonCount()).toBe(0);
  });

  it('given getEntitlements rejette et aucun amorçage connu, when rendu, then tout reste verrouillé (fail-closed) et un message d’erreur apparaît — jamais de « Disponible » supposé', async () => {
    mockUseOrgIdReady.mockReturnValue({ orgId: 'org_01', ready: true });
    mockGetEntitlements.mockRejectedValue(new Error('network down'));

    await render();

    expect(container.textContent).toMatch(/Impossible de charger votre abonnement/);
    expect(container.textContent).not.toMatch(/Disponible/);
    expect(skeletonCount()).toBe(0);
  });

  it('given un amorçage localStorage connu pour cet org (stale-while-revalidate) alors que orgId n’est pas encore résolu, when rendu, then affiche directement les badges réels amorcés, sans squelette', async () => {
    window.localStorage.setItem(
      `roadsen_entitlements_snapshot:${ORG_SLUG}`,
      JSON.stringify(entitlements({ modules: ['burmister'] })),
    );
    mockUseOrgIdReady.mockReturnValue({ orgId: null, ready: false });
    mockGetEntitlements.mockReturnValue(new Promise(() => {}));

    await render();

    expect(container.textContent).toMatch(/Disponible/);
    expect(skeletonCount()).toBe(0);
  });

  it('given un amorçage localStorage stale puis un fetch réseau qui échoue, when rendu, then conserve l’amorçage affiché plutôt que de tout verrouiller à nouveau', async () => {
    window.localStorage.setItem(
      `roadsen_entitlements_snapshot:${ORG_SLUG}`,
      JSON.stringify(entitlements({ modules: ['burmister'] })),
    );
    mockUseOrgIdReady.mockReturnValue({ orgId: 'org_01', ready: true });
    mockGetEntitlements.mockRejectedValue(new Error('network down'));

    await render();

    // L'amorçage reste affiché (ROADSENS toujours "Disponible") ; le message
    // d'erreur reflète une revalidation ratée, pas un verrouillage total.
    expect(container.textContent).toMatch(/Disponible/);
    expect(container.textContent).toMatch(/dernière vérification connue/);
  });
});
