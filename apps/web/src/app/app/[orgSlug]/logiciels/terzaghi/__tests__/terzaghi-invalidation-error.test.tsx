/**
 * Tests — page Terzaghi : invalidation des résultats périmés + statut ERROR
 * (audit UI Lot 5bis, points MAJEUR n°2 et n°3).
 *
 * DoD §9 : test-first, given/when/then, chemins négatifs testés, zéro faux-vert.
 * Patron d'interaction : react-dom/client + act (pas de @testing-library/react
 * dans ce dépôt — cf. PvEmittedActions.test.tsx).
 *
 * Couverture :
 *  - Un calcul DONE affiche le verdict ; modifier un champ de saisie (φ) après
 *    coup invalide le résultat (retour à l'onglet Coupe, plus de verdict affiché).
 *  - Un CalcResult avec status 'ERROR' affiche un message d'erreur explicite,
 *    PAS de tableau vide/zéros ni le placeholder "cliquez sur Calculer".
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

import TerzaghiPage from '../page';

const PROJECT = {
  id: 'proj_fd_01',
  orgId: 'org_01',
  name: 'Fondation A12',
  domain: 'FD' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'u1',
};

const ENTITLEMENTS = {
  orgId: 'org_01',
  pack: 'FONDATIONS' as const,
  modules: ['terzaghi'],
  expiresAt: '2027-01-01T00:00:00.000Z',
  expired: false,
  quota: { limit: 100, used: 1, remaining: 99 },
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
    root.render(<TerzaghiPage />);
  });
}

function clickCalculer() {
  const btn = container.querySelector('[data-testid="btn-calculer"]') as HTMLButtonElement;
  act(() => {
    btn.click();
  });
}

describe('TerzaghiPage — invalidation des résultats périmés (audit Lot 5bis, §2)', () => {
  it('given un calcul DONE affiché, when un champ de saisie (φ) est modifié, then le résultat est invalidé (retour Coupe, plus de verdict)', async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_01',
      projectId: PROJECT.id,
      orgId: 'org_01',
      engineId: 'terzaghi',
      label: 'Terzaghi',
      domain: 'FD',
      status: 'DONE',
      params: {},
      output: { verdict: 'PASS', rows: [{ label: 'Rvd', value: 500, unit: 'kN' }] },
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    });

    render();
    await flush();
    clickCalculer();
    await flush();

    // Le calcul est DONE, l'onglet Vérifications est actif : le verdict est affiché.
    expect(container.textContent).toContain('Fondation vérifiée');

    // On modifie un champ de saisie (angle de frottement φ).
    const phiInput = Array.from(container.querySelectorAll('input')).find(
      (el) => el.previousElementSibling?.textContent?.includes('Angle φ'),
    ) as HTMLInputElement | undefined;
    expect(phiInput).toBeDefined();
    act(() => {
      phiInput!.dispatchEvent(new Event('focus', { bubbles: true }));
    });
    // Simule la saisie React contrôlée.
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      nativeSetter.call(phiInput, '30');
      phiInput!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();

    // Le verdict précédent ne doit plus être visible (résultat périmé invalidé) ;
    // l'onglet Vérifications, s'il est encore sélectionné, redevient vide/placeholder.
    expect(container.textContent).not.toContain('Fondation vérifiée');
  });
});

describe('TerzaghiPage — statut ERROR géré explicitement (audit Lot 5bis, §3)', () => {
  it("given un CalcResult status 'ERROR', when le calcul termine, then un message d'erreur est affiché — pas de placeholder ni de tableau vide trompeur", async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_err',
      projectId: PROJECT.id,
      orgId: 'org_01',
      engineId: 'terzaghi',
      label: 'Terzaghi',
      domain: 'FD',
      status: 'ERROR',
      params: {},
      output: null,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    });

    render();
    await flush();
    clickCalculer();
    await flush();

    expect(container.textContent).toContain('Erreur moteur — calcul non abouti');
    expect(container.textContent).not.toContain('Sélectionnez un projet et cliquez sur');
  });
});
