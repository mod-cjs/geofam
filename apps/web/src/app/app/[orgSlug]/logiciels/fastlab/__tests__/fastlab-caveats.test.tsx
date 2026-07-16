/**
 * Tests — FASTLAB, encart « Points à vérifier » / « Assistant famille R » (14/07).
 * Fidélité FASTLAB7.html (renderClassif) : le client affiche ces deux listes en
 * ENCART distinct (<div class="alert warn">/<div class="alert info">), PAS noyées
 * dans le tableau générique des paramètres. `natureLigneA`/`mfq` restent des lignes
 * normales (le client les affiche en simple "chip", pas en encart) — non-régression.
 *
 * DoD §9 : given/when/then. Patron d'interaction : react-dom/client + act (cf.
 * geoplaque-heatmap-selector.test.tsx / pressiopro-legacy-output.test.tsx).
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

import FastlabPage from '../page';

const PROJECT = {
  id: 'proj_lb_01',
  orgId: 'org_01',
  name: 'Échantillon SC2',
  domain: 'LB' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'u1',
};

const ENTITLEMENTS = {
  orgId: 'org_01',
  pack: 'FONDATIONS' as const,
  modules: ['labo'],
  expiresAt: '2027-01-01T00:00:00.000Z',
  expired: false,
  quota: { limit: 100, used: 1, remaining: 99 },
  serverTime: '2026-07-14T00:00:00.000Z',
};

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
    root.render(<FastlabPage />);
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

describe('FASTLAB — encart caveats/assistant R distinct (fidélité FASTLAB7)', () => {
  it('given caveats + rNote + Nature/module de finesse, when affiché, then caveats/rNote sont en ENCART distinct (hors table générique)', async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_labo_01',
      projectId: PROJECT.id,
      orgId: 'org_01',
      engineId: 'labo',
      label: 'FASTLAB',
      domain: 'LB',
      status: 'DONE',
      params: {},
      output: {
        verdict: 'NA',
        rows: [
          { label: 'Classe GTR', value: 'A2 h', unit: '' },
          { label: 'Description', value: 'Sables fins argileux, limons', unit: '' },
          {
            label: 'Justification du classement 1',
            value: 'Passant 80µm = 52 % > 35 %',
            unit: '',
          },
          {
            label: 'Point à vérifier',
            value: 'VBS manquante : sous-classe B incertaine.',
            unit: '',
          },
          { label: 'Assistant famille R', value: 'Famille géologique : R3', unit: '' },
          { label: 'Nature (ligne A)', value: 'Argile (au-dessus ligne A)', unit: '' },
          { label: 'Module de finesse', value: '2.41 (idéal)', unit: '' },
          { label: 'Dmax', value: 20, unit: 'mm' },
        ],
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    render();
    await flush();
    clickCalculer();
    await flush();

    // Encart caveats distinct (role="alert", data-testid dédié).
    const caveats = container.querySelector('[data-testid="fastlab-caveats"]');
    expect(caveats).not.toBeNull();
    expect(caveats?.textContent).toContain('Points à vérifier');
    expect(caveats?.textContent).toContain('VBS manquante');
    expect(caveats?.getAttribute('role')).toBe('alert');

    // Encart « Assistant famille R » distinct.
    const rnotes = container.querySelector('[data-testid="fastlab-rnotes"]');
    expect(rnotes).not.toBeNull();
    expect(rnotes?.textContent).toContain('Assistant famille R');
    expect(rnotes?.textContent).toContain('Famille géologique : R3');

    // Le tableau générique des paramètres ne noie plus ces deux lignes.
    const table = container.querySelector('[data-testid="resultat"] table');
    expect(table?.textContent).not.toContain('Point à vérifier');
    expect(table?.textContent).not.toContain('Assistant famille R');
    // Non-régression : Nature/Module de finesse restent en ligne normale (chip client).
    expect(table?.textContent).toContain('Nature (ligne A)');
    expect(table?.textContent).toContain('Module de finesse');
  });

  it('given aucun caveat/rNote, when affiché, then aucun encart ne s’affiche (pas de crash)', async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_labo_02',
      projectId: PROJECT.id,
      orgId: 'org_01',
      engineId: 'labo',
      label: 'FASTLAB',
      domain: 'LB',
      status: 'DONE',
      params: {},
      output: {
        verdict: 'NA',
        rows: [
          { label: 'Classe GTR', value: 'B2', unit: '' },
          { label: 'Dmax', value: 20, unit: 'mm' },
        ],
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    render();
    await flush();
    clickCalculer();
    await flush();

    expect(container.querySelector('[data-testid="fastlab-caveats"]')).toBeNull();
    expect(container.querySelector('[data-testid="fastlab-rnotes"]')).toBeNull();
  });
});
