/**
 * Tests — PvEmittedActions (audit Lot 4 : impasse post-émission PV corrigée).
 *
 * DoD §9 : test-first, given/when/then, chemins négatifs (409 sceau cassé,
 * erreur générique) testés autant que le chemin heureux.
 *
 * Note : tests d'interaction via react-dom/client + act (jsdom), fidèle au
 * patron ArrayRowsField.test.tsx (pas de @testing-library/react dans ce dépôt).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockDownloadPvPdf } = vi.hoisted(() => ({
  mockDownloadPvPdf: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  downloadPvPdf: mockDownloadPvPdf,
}));

import { PvEmittedActions } from '../PvEmittedActions';
import type { OfficialPv } from '@/lib/api/types';

const PV: OfficialPv = {
  id: 'pv_01',
  number: 'PV-2026-0001',
  orgId: 'org_01',
  projectId: 'proj_01',
  calcResultId: 'calc_01',
  engineId: 'burmister',
  hmacTruncated: 'a3f8c2d1',
  sealedAt: '2026-06-01T10:00:00.000Z',
  sealedBy: 'Amadou Diallo',
  params: {},
  output: null,
};

// Stubs jsdom pour le téléchargement (comportement natif non implémenté par jsdom)
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
  mockDownloadPvPdf.mockReset();
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container.remove();
});

async function renderActions(onNewCalcul: () => void = () => {}) {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <PvEmittedActions
        pv={PV}
        orgId="org_01"
        orgSlug="starfire"
        projetId="proj_01"
        accent="#1a4a7a"
        onNewCalcul={onNewCalcul}
      />,
    );
  });
}

describe('PvEmittedActions — trois actions réelles après émission', () => {
  it('given un PV émis, when rendu, then les trois actions sont présentes (télécharger/voir/nouveau calcul)', async () => {
    await renderActions();
    expect(container.querySelector('[data-testid="pv-download-pdf"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pv-view-link"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pv-new-calcul"]')).not.toBeNull();
  });

  it('given un PV émis, when rendu, then "Voir le PV" pointe vers l\'onglet PV & Livrables du projet', async () => {
    await renderActions();
    const link = container.querySelector('[data-testid="pv-view-link"]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/app/starfire/projets/proj_01/pv');
  });

  it('given un clic sur Télécharger, when downloadPvPdf réussit, then le PDF est téléchargé sans erreur affichée', async () => {
    mockDownloadPvPdf.mockResolvedValueOnce(new Blob(['%PDF'], { type: 'application/pdf' }));
    await renderActions();
    const btn = container.querySelector('[data-testid="pv-download-pdf"]') as HTMLButtonElement;
    await act(async () => {
      btn.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockDownloadPvPdf).toHaveBeenCalledWith('pv_01', 'org_01', 'proj_01');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('given un clic sur Télécharger, when le serveur refuse 409 (sceau cassé), then le message clair du backend est affiché (pas un générique "réessayez")', async () => {
    mockDownloadPvPdf.mockRejectedValueOnce({
      statusCode: 409,
      reason: 'SERVER_ERROR',
      message: "Intégrité du PV non vérifiée — anomalie d'intégrité, contactez le support.",
    });
    await renderActions();
    const btn = container.querySelector('[data-testid="pv-download-pdf"]') as HTMLButtonElement;
    await act(async () => {
      btn.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Intégrité du PV non vérifiée");
  });

  it('given un clic sur Télécharger, when une erreur générique survient (pas 409), then un message générique de réessai est affiché', async () => {
    mockDownloadPvPdf.mockRejectedValueOnce({ statusCode: 500, message: 'boom' });
    await renderActions();
    const btn = container.querySelector('[data-testid="pv-download-pdf"]') as HTMLButtonElement;
    await act(async () => {
      btn.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Réessayez');
  });

  it('given un clic sur Nouveau calcul, when déclenché, then le callback fourni par la page est appelé', async () => {
    const onNewCalcul = vi.fn();
    await renderActions(onNewCalcul);
    const btn = container.querySelector('[data-testid="pv-new-calcul"]') as HTMLButtonElement;
    act(() => {
      btn.click();
    });
    expect(onNewCalcul).toHaveBeenCalledOnce();
  });
});
