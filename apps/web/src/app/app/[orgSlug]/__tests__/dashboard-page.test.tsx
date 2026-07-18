/**
 * Tests — Dashboard d'organisation (item PRODUIT #1, `/app/[orgSlug]`).
 *
 * DoD §9 : given/when/then, chemins négatifs (erreur réseau, org vide)
 * testés autant que le chemin heureux. Patron d'interaction : react-dom/client
 * + act (pas de @testing-library/react dans ce dépôt — cf. roadsens-page.test.tsx).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGetEntitlements, mockListProjects, mockListPvs, mockGetStoredOrgs } = vi.hoisted(() => ({
  mockGetEntitlements: vi.fn(),
  mockListProjects: vi.fn(),
  mockListPvs: vi.fn(),
  mockGetStoredOrgs: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  getEntitlements: mockGetEntitlements,
  listProjects: mockListProjects,
  listPvs: mockListPvs,
  getStoredOrgs: mockGetStoredOrgs,
}));

import DashboardClient from '../DashboardClient';

const ORG_SLUG = 'be-routes-dakar'; // -> org_01 dans MOCK_ORGS (org-context réel, non mocké)

function entitlements(over: Partial<{ modules: string[]; expired: boolean; quota: { limit: number; used: number; remaining: number } }> = {}) {
  return {
    orgId: 'org_01',
    pack: 'COMPLETE' as const,
    modules: over.modules ?? ['burmister', 'terzaghi', 'pieux', 'radier', 'pressiometre', 'labo'],
    expiresAt: '2027-01-01T00:00:00.000Z',
    expired: over.expired ?? false,
    quota: over.quota ?? { limit: 500, used: 120, remaining: 380 },
    serverTime: '2026-07-17T00:00:00.000Z',
  };
}

const PROJECT_A = {
  id: 'proj_a',
  orgId: 'org_01',
  name: 'Route A12',
  domain: 'CH' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z',
  createdBy: 'u1',
};

const PROJECT_B = {
  id: 'proj_b',
  orgId: 'org_01',
  name: 'Fondation B',
  domain: 'FD' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  createdBy: 'u1',
};

const PV_A = {
  id: 'pv_a',
  number: 'PV-2026-0001',
  orgId: 'org_01',
  projectId: 'proj_a',
  calcResultId: 'calc_1',
  engineId: 'burmister',
  hmacTruncated: 'abcd1234',
  sealedAt: '2026-07-11T00:00:00.000Z',
  sealedBy: 'Amadou Diallo',
  params: {},
  output: {},
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  mockGetEntitlements.mockReset().mockResolvedValue(entitlements());
  mockListProjects.mockReset().mockResolvedValue([PROJECT_A, PROJECT_B]);
  mockListPvs.mockReset().mockImplementation((_orgId: string, projectId: string) =>
    Promise.resolve(projectId === 'proj_a' ? [PV_A] : []),
  );
  mockGetStoredOrgs.mockReset().mockReturnValue([{ id: 'org_01', slug: ORG_SLUG, role: 'OWNER' }]);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container.remove();
});

async function renderDashboard() {
  await act(async () => {
    root = createRoot(container);
    root.render(<DashboardClient orgSlug={ORG_SLUG} />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('DashboardClient', () => {
  it('given le montage initial (données pas encore résolues), when rendu, then un état de chargement accessible est affiché', async () => {
    let resolveEnt: (v: unknown) => void = () => {};
    mockGetEntitlements.mockReturnValue(new Promise((r) => (resolveEnt = r)));

    await act(async () => {
      root = createRoot(container);
      root.render(<DashboardClient orgSlug={ORG_SLUG} />);
    });

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    resolveEnt(entitlements());
  });

  it('given entitlements + projets + PV chargés, when rendu, then l’en-tête montre le bureau et le rôle', async () => {
    await renderDashboard();
    expect(container.textContent).toMatch(/Be Routes Dakar/);
    expect(container.textContent).toMatch(/OWNER/);
  });

  it('given 2 projets et 1 PV scellé, when rendu, then les tuiles de synthèse reflètent ces comptes', async () => {
    await renderDashboard();
    // Tuile "Projets" = 2
    const tiles = container.textContent ?? '';
    expect(tiles).toMatch(/2[\s\S]*Projets/);
    expect(tiles).toMatch(/1[\s\S]*PV scellés récents/);
  });

  it('given les 6 logiciels du catalogue, when rendu, then les 6 cartes sont affichées', async () => {
    await renderDashboard();
    for (const nom of ['ROADSENS', 'Terzaghi', 'CASAGRANDE', 'GEOPLAQUE', 'PressioPro', 'FASTLAB']) {
      expect(container.textContent).toContain(nom);
    }
  });

  it('given un module NON inclus dans les entitlements (ex. pack ROUTES seul), when rendu, then sa carte logiciel est verrouillée (non cliquable)', async () => {
    mockGetEntitlements.mockResolvedValue(entitlements({ modules: ['burmister'] }));
    await renderDashboard();
    const links = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).not.toContain(`/app/${ORG_SLUG}/logiciels/terzaghi`);
    expect(links).toContain(`/app/${ORG_SLUG}/logiciels/roadsens`);
  });

  it('given un projet avec un PV scellé, when rendu, then le PV récent affiche son numéro et le nom du projet', async () => {
    await renderDashboard();
    const pvLink = Array.from(container.querySelectorAll('a')).find((a) =>
      a.getAttribute('href')?.includes('/pv'),
    );
    expect(pvLink).toBeTruthy();
    expect(pvLink!.textContent).toMatch(/PV-2026-0001/);
    expect(pvLink!.textContent).toMatch(/Route A12/);
  });

  it('given aucun projet dans l’organisation, when rendu, then les sections projets/PV affichent un état vide et listPvs n’est jamais appelé', async () => {
    mockListProjects.mockResolvedValue([]);
    await renderDashboard();
    expect(container.textContent).toMatch(/Aucun projet pour le moment/);
    expect(container.textContent).toMatch(/Aucun PV émis pour le moment/);
    expect(mockListPvs).not.toHaveBeenCalled();
  });

  it('given une erreur réseau au chargement, when rendu, then un état d’erreur avec action Réessayer est affiché (pas de plantage silencieux)', async () => {
    mockGetEntitlements.mockRejectedValue(new Error('network down'));
    await renderDashboard();
    expect(container.textContent).toMatch(/Impossible de charger/);
    const retryBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      /réessayer/i.test(b.textContent ?? ''),
    );
    expect(retryBtn).toBeTruthy();
  });

  it('given un abonnement expiré, when rendu, then un avertissement d’expiration est visible', async () => {
    mockGetEntitlements.mockResolvedValue(entitlements({ expired: true }));
    await renderDashboard();
    expect(container.textContent).toMatch(/expiré/i);
  });
});
