/**
 * Tests — robustesse « zéro écart » (14/07) : un ANCIEN calcul persisté (avant
 * l'introduction de `pressio` dans le contrat) ne porte AUCUNE clé `pressio`. Le
 * panneau enrichi (KPI/extrapolation/courbe corrigée/mesures corrigées) doit alors
 * être ABSENT, sans crash, et le panneau EXISTANT (courbe lectures + table générique)
 * doit rester affiché à l'identique.
 *
 * DoD §9 : given/when/then. Patron d'interaction : react-dom/client + act (cf.
 * geoplaque-heatmap-selector.test.tsx).
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

import PressioProPage from '../page';

const PROJECT = {
  id: 'proj_lb_01',
  orgId: 'org_01',
  name: 'Sondage BH-01',
  domain: 'LB' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'u1',
};

const ENTITLEMENTS = {
  orgId: 'org_01',
  pack: 'FONDATIONS' as const,
  modules: ['pressiometre'],
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
    root.render(<PressioProPage />);
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

describe('PressioPro — robustesse sur un ancien calcul persisté (pressio absent)', () => {
  it('given une sortie SANS `pressio` (ancien contrat), when affichée, then aucun crash, le panneau enrichi est absent, le panneau existant reste affiché', async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_legacy_01',
      projectId: PROJECT.id,
      orgId: 'org_01',
      engineId: 'pressiometre',
      label: 'PressioPro — legacy',
      domain: 'LB',
      status: 'DONE',
      params: {},
      output: {
        verdict: 'NA',
        rows: [
          { label: 'Pression limite p_L', value: 4.3911, unit: 'bar' }, // ANCIEN contrat (bar, pas pressio)
          { label: 'Module pressiométrique E_M', value: 3.4064, unit: 'MPa' },
          { label: 'Catégorie de sol', value: 'Sol mou (cat. B)', unit: '' },
        ],
        // PAS de clé `pressio` — simule un calcul persisté avant le 14/07.
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    render();
    await flush();
    clickCalculer();
    await flush();

    // Le panneau « Résultats » (existant) s'affiche toujours, sans throw.
    const resultats = container.querySelector('[data-testid="resultats"]');
    expect(resultats).not.toBeNull();
    expect(container.textContent).toContain('Sol mou (cat. B)');
    expect(container.textContent).toContain('Résultats du dépouillement');

    // Le panneau enrichi « zéro écart » (dépend de `pressio.depouillement`) est ABSENT.
    expect(container.querySelector('[data-testid="pressio-depouillement"]')).toBeNull();
  });
});
