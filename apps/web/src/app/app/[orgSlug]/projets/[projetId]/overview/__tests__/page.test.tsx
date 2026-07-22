/**
 * Tests — OverviewPage, cartes « Derniers calculs » (FX-10).
 *
 * Avant correctif : le backend réel ne persiste pas de `label` métier
 * (adapters.ts `adaptCalcResult`/`adaptPersistedCalcResult` retombent sur
 * `raw.engineId`), donc la carte affichait le slug brut backend
 * ("chaussee-burmister") au lieu du nom du logiciel. Après correctif : la
 * carte affiche le nom métier humanisé (`metaOf`), source unique
 * engine-labels.ts (partagée avec CalculsClient et PV & Livrables).
 *
 * DoD §9 : given/when/then, zéro faux-vert.
 *
 * Patron d'interaction : react-dom/client + act (pas de @testing-library/react
 * dans ce dépôt — cf. PvListClient.test.tsx).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockListCalcResults, mockListPvs, mockGetProjectCached } = vi.hoisted(() => ({
  mockListCalcResults: vi.fn(),
  mockListPvs: vi.fn(),
  // P0-1 : les StatCards lisent désormais `calcCount`/`pvCount` sur le projet
  // (même source que les pastilles d'onglet) au lieu de compter les listes.
  mockGetProjectCached: vi.fn().mockResolvedValue({
    id: 'proj-1',
    orgId: 'org-1',
    name: 'Projet de test',
    domain: 'CH',
    createdAt: '2026-07-17T12:00:00.000Z',
    updatedAt: '2026-07-17T12:00:00.000Z',
    createdBy: 'user-1',
  }),
}));

vi.mock('@/lib/api/client', () => ({
  listCalcResults: mockListCalcResults,
  listPvs: mockListPvs,
  getProjectCached: mockGetProjectCached,
}));

import OverviewPage from '../page';

import type { CalcResult } from '@/lib/api/types';

const CALC: CalcResult = {
  id: 'calc_01',
  projectId: 'proj_01',
  orgId: 'org_01',
  // Backend réel : engineId = registryId brut (pas un slug court).
  engineId: 'chaussee-burmister',
  // Reflète le repli backend réel adapters.ts (label = engineId, avant correctif
  // c'était donc le slug affiché tel quel).
  label: 'chaussee-burmister',
  domain: 'CH',
  status: 'DONE',
  params: {},
  output: null,
  createdAt: '2026-07-05T09:00:00.000Z',
  updatedAt: '2026-07-05T09:00:00.000Z',
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  mockListCalcResults.mockReset();
  mockListPvs.mockReset();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container.remove();
});

async function flush(rounds = 4) {
  await act(async () => {
    for (let i = 0; i < rounds; i += 1) {
      await Promise.resolve();
    }
  });
}

async function renderOverview() {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <OverviewPage
        params={Promise.resolve({ orgSlug: 'be-routes-dakar', projetId: 'proj_01' })}
      />,
    );
  });
  await flush();
}

describe('OverviewPage — Derniers calculs (FX-10, nom métier humanisé)', () => {
  it('given un calcul dont le label backend retombe sur le registryId brut, when la vue d’ensemble s’affiche, then la carte montre le nom métier humanisé, pas le slug', async () => {
    mockListCalcResults.mockResolvedValue([CALC]);
    mockListPvs.mockResolvedValue([]);

    await renderOverview();

    expect(container.textContent).toContain('ROADSENS — Chaussées');
    expect(container.textContent).not.toContain('chaussee-burmister');
  });

  it('given un moteur inconnu, when la vue d’ensemble s’affiche, then repli défensif sur l’id brut (pas d’exception)', async () => {
    mockListCalcResults.mockResolvedValue([{ ...CALC, engineId: 'moteur-inconnu' }]);
    mockListPvs.mockResolvedValue([]);

    await renderOverview();

    expect(container.textContent).toContain('moteur-inconnu');
  });
});
