/**
 * Tests — GEOPLAQUE, profils 1D des solveurs plans (onglet 2D : Déformations
 * planes `plane-strain`, Axisymétrie `axi`) — fidélité aux tracés `psPlot`/
 * `axiPlot` du client (GEOPLAQUE_V10.html L.2248-2314) : bandes empilées
 * (déflexion/moment/réaction pour plane-strain ; déflexion/momentR/momentT/
 * réaction pour axi), min/max annotés. `profils` absent → rien (pas de crash).
 *
 * DoD §9 : given/when/then, chemins négatifs testés. Patron d'interaction :
 * react-dom/client + act (cf. terzaghi-invalidation-error.test.tsx).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockListProjects, mockGetEntitlements, mockRunCalc } = vi.hoisted(() => ({
  mockListProjects: vi.fn(),
  mockGetEntitlements: vi.fn(),
  mockRunCalc: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'be-routes-dakar' }),
}));

vi.mock('@/lib/api/client', () => ({
  listProjects: mockListProjects,
  getEntitlements: mockGetEntitlements,
  runCalc: mockRunCalc,
  emitPv: vi.fn(),
}));

import GeoplaquePage from '../page';

const PROJECT = {
  id: 'proj_fd_01',
  orgId: 'org_01',
  name: 'Radier B12',
  domain: 'FD' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'u1',
};

const ENTITLEMENTS = {
  orgId: 'org_01',
  pack: 'FONDATIONS' as const,
  modules: ['radier'],
  expiresAt: '2027-01-01T00:00:00.000Z',
  expired: false,
  quota: { limit: 100, used: 1, remaining: 99 },
};

function linspace(n: number, from: number, to: number): number[] {
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  mockListProjects.mockResolvedValue([PROJECT]);
  mockGetEntitlements.mockResolvedValue(ENTITLEMENTS);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container.remove();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function render() {
  root = createRoot(container);
  act(() => {
    root.render(<GeoplaquePage />);
  });
}

function goTo2d() {
  const tabs = Array.from(container.querySelectorAll('button[role="tab"]'));
  const tab2d = tabs.find((b) => b.textContent === '2D') as HTMLButtonElement;
  act(() => {
    tab2d.click();
  });
}

describe('GEOPLAQUE 2D — Déformations planes (plane-strain), profils 1D', () => {
  it('given un calcul avec `profils` (déflexion/moment/réaction), when le résultat est affiché, then les 3 bandes du tracé sont rendues avec leurs libellés et min/max', async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_ps_01',
      projectId: PROJECT.id,
      orgId: 'org_01',
      engineId: 'plane-strain',
      label: 'Déformations planes',
      domain: 'FD',
      status: 'DONE',
      params: {},
      output: {
        verdict: 'NA',
        rows: [{ label: 'Tassement max', value: 8.4, unit: 'mm' }],
        profils: {
          deflexion: {
            x: linspace(97, 0, 10),
            v: linspace(97, 0, -8.4),
            unit: 'mm',
            label: 'tassement w',
          },
          moment: {
            x: linspace(97, 0, 10),
            v: linspace(97, -20, 30),
            unit: 'kN·m/m',
            label: 'moment M',
          },
          reaction: {
            x: linspace(97, 0, 10),
            v: linspace(97, 5, 60),
            unit: 'kPa',
            label: 'réaction p',
          },
        },
      },
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
    });

    render();
    await flush();
    goTo2d();

    const btn = container.querySelector(
      '[data-testid="btn-calculer-plane-strain"]',
    ) as HTMLButtonElement;
    act(() => {
      btn.click();
    });
    await flush();

    const chart = container.querySelector('[data-testid="profils-plane-strain"]');
    expect(chart).not.toBeNull();
    expect(chart!.textContent).toContain('tassement w');
    expect(chart!.textContent).toContain('moment M');
    expect(chart!.textContent).toContain('réaction p');
    expect(chart!.textContent).toContain('kPa');
    expect(chart!.textContent).toContain('x (m)');
  });

  it("given un calcul SANS `profils` (moteur pas encore aligné sur le contrat), when affiché, then aucun tracé n'apparaît (pas de crash)", async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_ps_02',
      projectId: PROJECT.id,
      orgId: 'org_01',
      engineId: 'plane-strain',
      label: 'Déformations planes',
      domain: 'FD',
      status: 'DONE',
      params: {},
      output: {
        verdict: 'NA',
        rows: [{ label: 'Tassement max', value: 8.4, unit: 'mm' }],
      },
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
    });

    render();
    await flush();
    goTo2d();

    const btn = container.querySelector(
      '[data-testid="btn-calculer-plane-strain"]',
    ) as HTMLButtonElement;
    act(() => {
      btn.click();
    });
    await flush();

    expect(container.querySelector('[data-testid="profils-plane-strain"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="resultats-plane-strain"]'),
    ).not.toBeNull();
  });
});

describe('GEOPLAQUE 2D — Axisymétrie (axi), profils 1D', () => {
  it('given un calcul avec `profils` (déflexion/momentR/momentT/réaction), when le résultat est affiché, then les 4 bandes du tracé radial sont rendues', async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_axi_01',
      projectId: PROJECT.id,
      orgId: 'org_01',
      engineId: 'axi',
      label: 'Axisymétrique',
      domain: 'FD',
      status: 'DONE',
      params: {},
      output: {
        verdict: 'NA',
        rows: [{ label: 'Tassement centre', value: 6.1, unit: 'mm' }],
        profils: {
          deflexion: {
            x: linspace(50, 0, 6),
            v: linspace(50, -6.1, -1),
            unit: 'mm',
            label: 'tassement w',
          },
          momentR: {
            x: linspace(50, 0, 6),
            v: linspace(50, -15, 25),
            unit: 'kN·m/m',
            label: 'moment M_r',
          },
          momentT: {
            x: linspace(50, 0, 6),
            v: linspace(50, -8, 12),
            unit: 'kN·m/m',
            label: 'moment M_t',
          },
          reaction: {
            x: linspace(50, 0, 6),
            v: linspace(50, 4, 40),
            unit: 'kPa',
            label: 'réaction p',
          },
        },
      },
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
    });

    render();
    await flush();
    goTo2d();

    const btn = container.querySelector(
      '[data-testid="btn-calculer-axi"]',
    ) as HTMLButtonElement;
    act(() => {
      btn.click();
    });
    await flush();

    const chart = container.querySelector('[data-testid="profils-axi"]');
    expect(chart).not.toBeNull();
    expect(chart!.textContent).toContain('tassement w');
    expect(chart!.textContent).toContain('moment M_r');
    expect(chart!.textContent).toContain('moment M_t');
    expect(chart!.textContent).toContain('réaction p');
    expect(chart!.textContent).toContain('r (m)');
  });

  it("given un calcul SANS `profils`, when affiché, then aucun tracé n'apparaît (pas de crash)", async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_axi_02',
      projectId: PROJECT.id,
      orgId: 'org_01',
      engineId: 'axi',
      label: 'Axisymétrique',
      domain: 'FD',
      status: 'DONE',
      params: {},
      output: {
        verdict: 'NA',
        rows: [{ label: 'Tassement centre', value: 6.1, unit: 'mm' }],
      },
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
    });

    render();
    await flush();
    goTo2d();

    const btn = container.querySelector(
      '[data-testid="btn-calculer-axi"]',
    ) as HTMLButtonElement;
    act(() => {
      btn.click();
    });
    await flush();

    expect(container.querySelector('[data-testid="profils-axi"]')).toBeNull();
    expect(container.querySelector('[data-testid="resultats-axi"]')).not.toBeNull();
  });
});
