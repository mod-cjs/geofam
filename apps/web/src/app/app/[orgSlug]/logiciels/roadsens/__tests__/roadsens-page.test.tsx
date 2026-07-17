/**
 * Tests — shell GEOFAM de la page ROADSENS (clone UI client, ADR 0015).
 *
 * DoD §9 : given/when/then, chemins négatifs (gate bloqué, erreur d'émission
 * PV) testés autant que le chemin heureux. `ToolFrame` est mocké ici — sa
 * boucle de bridge est testée en isolation dans
 * `lib/tool-bridge/__tests__/ToolFrame.test.tsx` ; ce fichier ne couvre QUE
 * le câblage du shell (projet, gate, bouton PV branché sur le dernier
 * calcResultId remonté par ToolFrame).
 *
 * Patron d'interaction : react-dom/client + act (pas de @testing-library/react
 * dans ce dépôt — cf. terzaghi-page.test.tsx / PvEmittedActions.test.tsx).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockListProjects,
  mockGetEntitlements,
  mockEmitPv,
  mockDownloadPvPdf,
  mockCreateProject,
} = vi.hoisted(() => ({
  mockListProjects: vi.fn(),
  mockGetEntitlements: vi.fn(),
  mockEmitPv: vi.fn(),
  mockDownloadPvPdf: vi.fn(),
  mockCreateProject: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'be-routes-dakar' }),
}));

vi.mock('@/lib/api/client', () => ({
  listProjects: mockListProjects,
  getEntitlements: mockGetEntitlements,
  emitPv: mockEmitPv,
  downloadPvPdf: mockDownloadPvPdf,
  createProject: mockCreateProject,
  getStoredToken: () => 'token-abc',
}));

// Stub — la boucle de bridge (ready/init/calc/store/pv) est testée dans
// lib/tool-bridge/__tests__/ToolFrame.test.tsx. Ici on vérifie seulement le
// câblage : props reçues + remontée de calcResultId au shell.
vi.mock('@/lib/tool-bridge/ToolFrame', () => ({
  ToolFrame: (props: {
    toolId: string;
    engineId: string;
    orgId: string | null;
    orgSlug: string;
    projectId: string;
    projectLabel: string;
    accessToken: string | null;
    onCalcResultId?: (id: string | null) => void;
  }) => (
    <div data-testid="tool-frame-stub" data-props={JSON.stringify(props)}>
      <button
        type="button"
        data-testid="simulate-calc-done"
        onClick={() => props.onCalcResultId?.('calc_42')}
      >
        Simuler calcul terminé
      </button>
    </div>
  ),
}));

import RoadsensPage from '../page';

const PROJECT = {
  id: 'proj_ch_01',
  orgId: 'org_01',
  name: 'Route A12',
  domain: 'CH' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'u1',
};

function entitlements(
  overrides: Partial<{
    modules: string[];
    expired: boolean;
    quota: { limit: number; used: number; remaining: number };
  }> = {},
) {
  return {
    orgId: 'org_01',
    pack: 'COMPLETE' as const,
    modules: overrides.modules ?? ['burmister'],
    expiresAt: '2027-01-01T00:00:00.000Z',
    expired: overrides.expired ?? false,
    quota: overrides.quota ?? { limit: 500, used: 100, remaining: 400 },
    serverTime: '2026-07-16T00:00:00.000Z',
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  mockListProjects.mockReset().mockResolvedValue([PROJECT]);
  mockGetEntitlements.mockReset().mockResolvedValue(entitlements());
  mockEmitPv.mockReset();
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
    root.render(<RoadsensPage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('Page ROADSENS — shell GEOFAM', () => {
  it('given un seul projet CH, when montage, then le projet est présélectionné et ToolFrame reçoit le contexte projet (toolId roadsens, engineId burmister)', async () => {
    await renderPage();
    const stub = container.querySelector('[data-testid="tool-frame-stub"]');
    expect(stub).not.toBeNull();
    const props = JSON.parse(stub!.getAttribute('data-props')!);
    expect(props).toMatchObject({
      toolId: 'roadsens',
      engineId: 'burmister',
      projectId: 'proj_ch_01',
      projectLabel: 'Route A12',
      accessToken: 'token-abc',
    });
  });

  it('given des projets CH, LEGACY(null) et FD, when montage, then le picker montre CH + legacy et EXCLUT le FD', async () => {
    // Même règle que terzaghi (bug swap mock->réel) : le filtre retient le
    // domaine du logiciel (CH) OU un domaine null (projet legacy, domaine
    // inconnu -> sélectionnable partout plutôt qu'invisible partout), et
    // écarte un domaine explicitement autre (FD).
    mockListProjects.mockResolvedValue([
      { ...PROJECT, id: 'p_ch', name: 'Route CH', domain: 'CH' },
      { ...PROJECT, id: 'p_legacy', name: 'Projet legacy', domain: null },
      { ...PROJECT, id: 'p_fd', name: 'Fondation FD', domain: 'FD' },
    ]);
    await renderPage();
    const select = container.querySelector(
      'select[aria-label="Projet"]',
    ) as HTMLSelectElement;
    expect(select).not.toBeNull();
    const labels = Array.from(select.querySelectorAll('option')).map(
      (o) => o.textContent,
    );
    expect(labels).toContain('Route CH');
    expect(labels).toContain('Projet legacy');
    expect(labels).not.toContain('Fondation FD');
  });

  it("given aucun projet sélectionné (liste vide), when montage, then ToolFrame n'est PAS rendu (placeholder affiché)", async () => {
    mockListProjects.mockResolvedValue([]);
    await renderPage();
    expect(container.querySelector('[data-testid="tool-frame-stub"]')).toBeNull();
    expect(container.textContent).toMatch(/Sélectionnez ou créez un projet/);
  });

  it('given le bouton "Émettre le PV" n\'a pas encore de calcul, when rendu, then il est désactivé', async () => {
    await renderPage();
    const btn = container.querySelector(
      '[data-testid="btn-emettre-pv"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('given ToolFrame remonte un calcResultId, when le calcul est "terminé", then le bouton PV s\'active', async () => {
    await renderPage();
    const simulate = container.querySelector(
      '[data-testid="simulate-calc-done"]',
    ) as HTMLButtonElement;
    await act(async () => {
      simulate.click();
    });
    const btn = container.querySelector(
      '[data-testid="btn-emettre-pv"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('given un calcul terminé, when "Émettre le PV" cliqué et emitPv résout, then le PV scellé est affiché', async () => {
    mockEmitPv.mockResolvedValue({
      id: 'pv_01',
      number: 'PV-2026-0007',
      orgId: 'org_01',
      projectId: 'proj_ch_01',
      calcResultId: 'calc_42',
      engineId: 'burmister',
      hmacTruncated: 'a1b2c3d4',
      sealedAt: '2026-07-16T10:00:00.000Z',
      sealedBy: 'Amadou Diallo',
      params: {},
      output: null,
    });
    await renderPage();
    const simulate = container.querySelector(
      '[data-testid="simulate-calc-done"]',
    ) as HTMLButtonElement;
    await act(async () => {
      simulate.click();
    });
    const btn = container.querySelector(
      '[data-testid="btn-emettre-pv"]',
    ) as HTMLButtonElement;
    await act(async () => {
      btn.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockEmitPv).toHaveBeenCalledWith('org_01', 'proj_ch_01', {
      calcResultId: 'calc_42',
    });
    expect(container.textContent).toMatch(/PV-2026-0007/);
  });

  it('given emitPv échoue, when "Émettre le PV" cliqué, then un message d\'erreur explicite est affiché', async () => {
    mockEmitPv.mockRejectedValue({ message: 'Quota épuisé.' });
    await renderPage();
    const simulate = container.querySelector(
      '[data-testid="simulate-calc-done"]',
    ) as HTMLButtonElement;
    await act(async () => {
      simulate.click();
    });
    const btn = container.querySelector(
      '[data-testid="btn-emettre-pv"]',
    ) as HTMLButtonElement;
    await act(async () => {
      btn.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(
      /Quota épuisé/,
    );
  });

  it("given le module burmister n'est PAS inclus dans l'abonnement, when montage, then la bannière de gate est affichée", async () => {
    mockGetEntitlements.mockResolvedValue(entitlements({ modules: ['terzaghi'] }));
    await renderPage();
    const banner = container.querySelector('[data-testid="gate-banner"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toMatch(/non inclus/i);
  });

  it("given un abonnement actif AVEC le module, when montage, then aucune bannière de gate n'est affichée", async () => {
    await renderPage();
    expect(container.querySelector('[data-testid="gate-banner"]')).toBeNull();
  });
});
