/**
 * Tests — Sidebar, section « Logiciels » (bug F5 diagnostiqué).
 *
 * Avant correctif : `useLogicielsItems` renvoyait `[]` tant que
 * `modules === null` (entitlements en cours de chargement), indiscernable
 * d'un « aucun logiciel inclus » réel -> la section « Logiciels » restait
 * vide un instant après chaque refresh, avant de se remplir d'un coup.
 *
 * DoD §9 : given/when/then. Patron d'interaction : react-dom/client + act
 * (pas de @testing-library/react dans ce dépôt — cf. QuotaIndicator.test.tsx).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockUseOrgIdReady,
  mockGetEntitlements,
  mockLogout,
  mockGetStoredUser,
  mockGetStoredOrgs,
} = vi.hoisted(() => ({
  mockUseOrgIdReady: vi.fn(),
  mockGetEntitlements: vi.fn(),
  mockLogout: vi.fn(),
  mockGetStoredUser: vi.fn(() => null),
  mockGetStoredOrgs: vi.fn(() => []),
}));

const ORG_SLUG = 'be-routes-dakar';

vi.mock('next/navigation', () => ({
  usePathname: () => `/app/${ORG_SLUG}`,
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/org-context', () => ({
  useOrgIdReady: mockUseOrgIdReady,
}));

vi.mock('@/lib/api/client', () => ({
  logout: mockLogout,
  getStoredUser: mockGetStoredUser,
  getStoredOrgs: mockGetStoredOrgs,
  getEntitlements: mockGetEntitlements,
}));

import { Sidebar } from '../Sidebar';

function entitlements(modules: string[]) {
  return {
    orgId: 'org_01',
    pack: 'COMPLETE' as const,
    modules,
    expiresAt: '2027-01-01T00:00:00.000Z',
    expired: false,
    quota: { limit: 500, used: 10, remaining: 490 },
    serverTime: '2026-08-01T00:00:00.000Z',
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  // La sidebar attend un #main pour gérer l'inert du drawer mobile.
  const main = document.createElement('div');
  main.id = 'main';
  document.body.appendChild(main);
  mockUseOrgIdReady.mockReset();
  mockGetEntitlements.mockReset();
  mockLogout.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container.remove();
  document.getElementById('main')?.remove();
});

async function render() {
  await act(async () => {
    root = createRoot(container);
    root.render(<Sidebar orgSlug={ORG_SLUG} />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Section « Logiciels » de la sidebar DESKTOP (le drawer mobile duplique le
 * même contenu — on cible le desktop pour éviter toute ambiguïté de sélection). */
function logicielsList(): HTMLUListElement {
  const desktop = container.querySelector('.sidebar-desktop');
  expect(desktop).not.toBeNull();
  const lists = desktop!.querySelectorAll('ul[role="list"]');
  // Ordre des <ul> dans SidebarContent : [0] nav principale, [1] logiciels, [2] ressources.
  return lists[1] as HTMLUListElement;
}

describe('Sidebar — section Logiciels, squelettes pendant la résolution', () => {
  it('given orgId encore en cours de résolution (ready=false), when rendu, then la section Logiciels affiche des items squelettes (pas vide, pas de vrai libellé)', async () => {
    mockUseOrgIdReady.mockReturnValue({ orgId: null, ready: false });
    mockGetEntitlements.mockReturnValue(new Promise(() => {}));

    await render();

    const list = logicielsList();
    expect(list.getAttribute('aria-busy')).toBe('true');
    expect(list.children.length).toBeGreaterThan(0);
    expect(list.querySelectorAll('.sidebar-skel').length).toBeGreaterThan(0);
    expect(list.textContent).not.toMatch(
      /ROADSENS|Terzaghi|CASAGRANDE|GEOPLAQUE|PressioPro|FASTLAB/,
    );
  });

  it('given entitlements en cours de chargement (orgId résolu), when rendu, then reste en squelettes (pas de section vide, pas de libellé)', async () => {
    mockUseOrgIdReady.mockReturnValue({ orgId: 'org_01', ready: true });
    mockGetEntitlements.mockReturnValue(new Promise(() => {}));

    await render();

    const list = logicielsList();
    expect(list.children.length).toBeGreaterThan(0);
    expect(list.querySelectorAll('.sidebar-skel').length).toBeGreaterThan(0);
  });

  it('given entitlements chargées avec ROADSENS (burmister) inclus, when rendu, then la section Logiciels affiche ROADSENS et aucun squelette', async () => {
    mockUseOrgIdReady.mockReturnValue({ orgId: 'org_01', ready: true });
    mockGetEntitlements.mockResolvedValue(entitlements(['burmister']));

    await render();

    const list = logicielsList();
    expect(list.textContent).toMatch(/ROADSENS/);
    expect(list.querySelectorAll('.sidebar-skel').length).toBe(0);
    // Modules hors pack absents (fail-closed — jamais affichés, même verrouillés).
    expect(list.textContent).not.toMatch(/Terzaghi/);
  });

  it('given getEntitlements rejette et aucun module connu, when rendu, then la section Logiciels devient vide (aucun logiciel) — jamais de squelette figé', async () => {
    mockUseOrgIdReady.mockReturnValue({ orgId: 'org_01', ready: true });
    mockGetEntitlements.mockRejectedValue(new Error('network down'));

    await render();

    const list = logicielsList();
    expect(list.children.length).toBe(0);
    expect(list.getAttribute('aria-busy')).toBeNull();
  });
});
