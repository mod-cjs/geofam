/**
 * Tests — page ROADSENS : sélection d'un cas de validation (preset) — VOLET B
 * (décision titulaire 13/07, « zéro écart » avec l'outil client).
 *
 * Comportement de référence (`loadPreset()` de la définitive) : sélectionner un cas
 * de validation dans l'onglet Structure LANCE immédiatement le calcul serveur (même
 * chemin que le bouton « Calculer ») et BASCULE sur l'onglet Résultats une fois la
 * réponse reçue. En cas d'échec (réseau/quota), PAS de bascule — l'utilisateur reste
 * sur Structure, l'erreur est affichée explicitement.
 *
 * DoD §9 : given/when/then, chemin heureux + chemin négatif, zéro faux-vert.
 * Patron d'interaction : react-dom/client + act (pas de @testing-library/react dans
 * ce dépôt — cf. terzaghi-invalidation-error.test.tsx / PvEmittedActions.test.tsx).
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

import RoadsensPage from '../page';

const PROJECT = {
  id: 'proj_ch_01',
  orgId: 'org_01',
  name: 'Route N1',
  domain: 'CH' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'u1',
};

const ENTITLEMENTS = {
  orgId: 'org_01',
  pack: 'ROUTES' as const,
  modules: ['burmister'],
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
    root.render(<RoadsensPage />);
  });
}

function selectPreset(id: string) {
  const select = container.querySelector(
    'select[aria-label="Charger une famille de structure validée"]',
  ) as HTMLSelectElement;
  act(() => {
    select.value = id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function activeTabId(): string | null {
  const activeBtn = Array.from(container.querySelectorAll('[role="tab"]')).find(
    (b) => b.getAttribute('aria-selected') === 'true',
  );
  return activeBtn?.id ?? null;
}

describe('RoadsensPage — sélection d’un cas de validation (Volet B, décision titulaire 13/07)', () => {
  it('given un projet sélectionné, when un cas de validation est choisi, then le calcul serveur est lancé et l’onglet Résultats devient actif', async () => {
    mockRunCalc.mockResolvedValue({
      id: 'calc_preset_01',
      projectId: PROJECT.id,
      orgId: 'org_01',
      engineId: 'chaussee-burmister',
      label: 'ROADSENS — Cas s1 (catalogue)',
      domain: 'CH',
      status: 'DONE',
      params: {},
      output: {
        verdict: 'PASS',
        rows: [{ label: 'Famille de structure', value: 'bitumineuse épaisse', unit: '' }],
      },
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    });

    render();
    await flush();

    // GIVEN : au chargement, l'onglet Structure est actif (comportement par défaut).
    expect(activeTabId()).toBe('roadsens-tab-structure');

    // WHEN : sélection d'un cas de validation du catalogue.
    selectPreset('s1');
    await flush();

    // THEN : le calcul serveur a été déclenché (même chemin que « Calculer »)…
    expect(mockRunCalc).toHaveBeenCalledTimes(1);
    // … et l'onglet Résultats devient actif dès la réponse reçue (fidèle à l'outil
    // client, qui bascule sur le panneau Résultats après doCalc()).
    expect(activeTabId()).toBe('roadsens-tab-resultats');
  });

  it("given l'appel serveur échoue (réseau/quota), when un cas de validation est choisi, then l'onglet reste sur Structure (pas de bascule) et l'erreur est affichée", async () => {
    mockRunCalc.mockRejectedValue({
      statusCode: 402,
      reason: 'QUOTA',
      message: "Quota d'utilisation atteint",
    });

    render();
    await flush();

    selectPreset('s1');
    await flush();

    expect(mockRunCalc).toHaveBeenCalledTimes(1);
    // Chemin négatif : jamais de bascule silencieuse sur un résultat inexistant.
    expect(activeTabId()).toBe('roadsens-tab-structure');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Quota de calculs épuisé.',
    );
  });

  it('given aucun projet sélectionné, when un cas de validation est choisi, then la structure est posée mais le calcul est DIFFÉRÉ (aucun appel serveur, pas de bascule)', async () => {
    // Aucun projet CH disponible : projectId reste vide, le calcul ne peut pas être
    // lancé automatiquement (pas de régression — l'utilisateur doit choisir un dossier).
    mockListProjects.mockResolvedValue([]);

    render();
    await flush();

    selectPreset('s1');
    await flush();

    expect(mockRunCalc).not.toHaveBeenCalled();
    expect(activeTabId()).toBe('roadsens-tab-structure');
  });
});
