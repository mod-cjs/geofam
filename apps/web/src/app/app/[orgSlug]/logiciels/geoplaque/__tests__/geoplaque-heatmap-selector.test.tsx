/**
 * Tests — GEOPLAQUE, sélecteur de cartes multi-champs (radier) — décision titulaire
 * 14/07, fidélité au panneau `res-field` du client (GEOPLAQUE_V10.html L.2550-2552 :
 * mêmes libellés, même ordre : Tassement, Distorsion |∇w|, Rotation θx, Rotation θy,
 * Réaction, Coef. réaction, Moment Mx, Moment My, Moment Mxy).
 *
 * DoD §9 : given/when/then, chemins négatifs (absent → pas de crash) testés.
 * Patron d'interaction : react-dom/client + act (cf. terzaghi-invalidation-error.test.tsx).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { HeatmapData } from '@/lib/api/types';

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

function hm(vMin: number, vMax: number, unit: string, label: string): HeatmapData {
  return {
    x0: 0,
    y0: 0,
    x1: 6,
    y1: 6,
    cols: 2,
    rows: 2,
    vals: [vMin, vMax, vMin, vMax],
    vMin,
    vMax,
    unit,
    label,
  };
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

function clickCalculer() {
  const btn = container.querySelector(
    '[data-testid="btn-calculer"]',
  ) as HTMLButtonElement;
  act(() => {
    btn.click();
  });
}

describe('GEOPLAQUE — sélecteur multi-champs (heatmaps présent)', () => {
  it("given un calcul avec `heatmaps`, when le résultat est affiché, then les boutons de champ apparaissent dans l'ordre client, avec « Tassement » sélectionné par défaut", async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_01',
      projectId: PROJECT.id,
      orgId: 'org_01',
      engineId: 'radier',
      label: 'GEOPLAQUE',
      domain: 'FD',
      status: 'DONE',
      params: {},
      output: {
        verdict: 'NA',
        rows: [{ label: 'Tassement max', value: 12.3, unit: 'mm' }],
        heatmaps: {
          deflexion: hm(0, 12.3, 'mm', 'Tassement'),
          pente: hm(0, 0.002, 'rad', 'Distorsion'),
          rotationX: hm(-0.001, 0.001, 'rad', 'Rotation θx'),
          rotationY: hm(-0.001, 0.001, 'rad', 'Rotation θy'),
          reaction: hm(10, 180, 'kPa', 'Réaction'),
          raideur: hm(500, 4000, 'kN/m3', 'Coef. réaction'),
          momentX: hm(-40, 60, 'kN.m/ml', 'Moment Mx'),
          momentY: hm(-30, 50, 'kN.m/ml', 'Moment My'),
          momentXY: hm(-10, 10, 'kN.m/ml', 'Moment Mxy'),
        },
      },
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
    });

    render();
    await flush();
    clickCalculer();
    await flush();

    const expectedOrder = [
      'deflexion',
      'pente',
      'rotationX',
      'rotationY',
      'reaction',
      'raideur',
      'momentX',
      'momentY',
      'momentXY',
    ];
    const buttons = expectedOrder.map((k) =>
      container.querySelector(`[data-testid="heatmap-field-${k}"]`),
    );
    buttons.forEach((b) => expect(b).not.toBeNull());

    const deflexionBtn = container.querySelector(
      '[data-testid="heatmap-field-deflexion"]',
    ) as HTMLButtonElement;
    expect(deflexionBtn.textContent).toContain('Tassement');
    expect(deflexionBtn.getAttribute('aria-pressed')).toBe('true');

    const reactionBtn = container.querySelector(
      '[data-testid="heatmap-field-reaction"]',
    ) as HTMLButtonElement;
    expect(reactionBtn.textContent).toContain('Réaction');
    expect(reactionBtn.getAttribute('aria-pressed')).toBe('false');

    // Légende initiale (déflexion, mm).
    expect(container.textContent).toContain('mm');
    expect(container.textContent).toContain('12.30');
  });

  it('given le panneau affiché, when on clique sur « Réaction », then le champ sélectionné change (légende + aria-pressed), sans dépendre de la seule couleur', async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_02',
      projectId: PROJECT.id,
      orgId: 'org_01',
      engineId: 'radier',
      label: 'GEOPLAQUE',
      domain: 'FD',
      status: 'DONE',
      params: {},
      output: {
        verdict: 'NA',
        rows: [],
        heatmaps: {
          deflexion: hm(0, 12.3, 'mm', 'Tassement'),
          reaction: hm(10, 180, 'kPa', 'Réaction'),
        },
      },
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
    });

    render();
    await flush();
    clickCalculer();
    await flush();

    const deflexionBtn = container.querySelector(
      '[data-testid="heatmap-field-deflexion"]',
    ) as HTMLButtonElement;
    const reactionBtn = container.querySelector(
      '[data-testid="heatmap-field-reaction"]',
    ) as HTMLButtonElement;
    expect(deflexionBtn.getAttribute('aria-pressed')).toBe('true');
    expect(reactionBtn.getAttribute('aria-pressed')).toBe('false');

    act(() => {
      reactionBtn.click();
    });
    await flush();

    expect(reactionBtn.getAttribute('aria-pressed')).toBe('true');
    expect(deflexionBtn.getAttribute('aria-pressed')).toBe('false');
    expect(container.textContent).toContain('kPa');
    expect(container.textContent).toContain('180.00');
  });
});

describe('GEOPLAQUE — fallback legacy (heatmaps absent, ancien calcul persisté)', () => {
  it('given un CalcResult persisté avant le sélecteur (seul `heatmap` legacy présent), when affiché, then la carte de déflexion legacy est montrée SANS boutons de champ (pas de crash)', async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_legacy',
      projectId: PROJECT.id,
      orgId: 'org_01',
      engineId: 'radier',
      label: 'GEOPLAQUE',
      domain: 'FD',
      status: 'DONE',
      params: {},
      output: {
        verdict: 'NA',
        rows: [{ label: 'Tassement max', value: 9.1, unit: 'mm' }],
        heatmap: {
          x0: 0,
          y0: 0,
          x1: 6,
          y1: 6,
          cols: 2,
          rows: 2,
          vals: [0, 9.1, 0, 9.1],
          vMin: 0,
          vMax: 9.1,
        },
      },
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    });

    render();
    await flush();
    clickCalculer();
    await flush();

    expect(
      container.querySelector('[role="group"][aria-label="Champ de cartographie"]'),
    ).toBeNull();
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(container.textContent).toContain('9.10');
  });
});

describe('GEOPLAQUE — aucune cartographie disponible', () => {
  it("given un calcul sans `heatmap` ni `heatmaps`, when affiché, then aucun panneau de cartographie n'apparaît (pas de crash)", async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_no_map',
      projectId: PROJECT.id,
      orgId: 'org_01',
      engineId: 'radier',
      label: 'GEOPLAQUE',
      domain: 'FD',
      status: 'DONE',
      params: {},
      output: { verdict: 'NA', rows: [{ label: 'Tassement max', value: 5, unit: 'mm' }] },
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    });

    render();
    await flush();
    clickCalculer();
    await flush();

    expect(container.querySelector('canvas')).toBeNull();
    expect(
      container.querySelector('[role="group"][aria-label="Champ de cartographie"]'),
    ).toBeNull();
  });
});
