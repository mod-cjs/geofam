/**
 * Tests — PvListClient, volet « option 3 » (le PV = le document que l'outil
 * imprime). Aperçu/Télécharger tentent D'ABORD le document HTML scellé
 * (GET .../pvs/:pvId/document). Contrat du client API (getPvDocument) : `null`
 * = repli PDF pdfmake INCHANGÉ (404 comme 409 — B1, revue adverse : jamais de
 * cul-de-sac, le 409 est loggé séparément côté http-client, cf.
 * http-client.test.ts). Toute AUTRE erreur (500…) reste un message d'erreur,
 * sans repli silencieux.
 *
 * DoD §9 : given/when/then, chemins négatifs (repli 404/409, erreur générique)
 * testés autant que le chemin heureux.
 *
 * Patron d'interaction : react-dom/client + act (pas de @testing-library/react
 * dans ce dépôt — cf. PvEmittedActions.test.tsx).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockListPvs,
  mockVerifyPv,
  mockDownloadPvPdf,
  mockGetPvDocument,
  mockPrintInertHtml,
} = vi.hoisted(() => ({
  mockListPvs: vi.fn(),
  mockVerifyPv: vi.fn(),
  mockDownloadPvPdf: vi.fn(),
  mockGetPvDocument: vi.fn(),
  mockPrintInertHtml: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  listPvs: mockListPvs,
  verifyPv: mockVerifyPv,
  downloadPvPdf: mockDownloadPvPdf,
  getPvDocument: mockGetPvDocument,
}));

vi.mock('@/lib/print-inert-html', () => ({
  printInertHtml: mockPrintInertHtml,
}));

import PvListClient from '../PvListClient';

import { ToastProvider } from '@/components/ui/Toast';
import type { OfficialPv } from '@/lib/api/types';

const PV: OfficialPv = {
  id: 'pv_01',
  number: 'PV-2026-0001',
  orgId: 'org_01',
  projectId: 'proj_01',
  calcResultId: 'calc_01',
  engineId: 'burmister',
  hmacTruncated: 'aaaa1111',
  sealedAt: '2026-07-05T09:00:00.000Z',
  sealedBy: 'Amadou Diallo',
  params: {},
  output: null,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  mockListPvs.mockReset();
  mockVerifyPv.mockReset();
  mockDownloadPvPdf.mockReset();
  mockGetPvDocument.mockReset();
  mockPrintInertHtml.mockReset();
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
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

async function renderPvList() {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <ToastProvider>
        <PvListClient orgSlug="be-routes-dakar" projetId="proj_01" />
      </ToastProvider>,
    );
  });
  await flush();
}

function apercuBtn(): HTMLButtonElement {
  return container.querySelector(
    `[aria-label="Aperçu PDF du PV ${PV.number}"]`,
  ) as HTMLButtonElement;
}
function telechargerBtn(): HTMLButtonElement {
  return container.querySelector(
    `[aria-label="Télécharger le PDF du PV ${PV.number}"]`,
  ) as HTMLButtonElement;
}

describe('PvListClient — Aperçu/Télécharger tentent le document scellé en priorité', () => {
  it("given un PV avec un document HTML scellé, when on clique Aperçu, then le document s'affiche en iframe sandboxée (pas le PDF pdfmake)", async () => {
    mockListPvs.mockResolvedValue([PV]);
    mockGetPvDocument.mockResolvedValue({ html: '<p>Document scellé</p>' });

    await renderPvList();
    await act(async () => {
      apercuBtn().click();
    });
    await flush();

    expect(mockGetPvDocument).toHaveBeenCalledWith('org_01', 'proj_01', 'pv_01');
    const docIframe = container.querySelector(
      '[data-testid="pv-preview-doc-iframe"]',
    ) as HTMLIFrameElement | null;
    expect(docIframe).not.toBeNull();
    expect(docIframe!.getAttribute('sandbox')).toBe('');
    expect(docIframe!.srcdoc).toBe('<p>Document scellé</p>');
    expect(container.querySelector('[data-testid="pv-preview-iframe"]')).toBeNull();
    expect(mockDownloadPvPdf).not.toHaveBeenCalled();
  });

  it("given un PV SANS document HTML (404 → null), when on clique Aperçu, then le repli PDF existant s'affiche (comportement inchangé)", async () => {
    mockListPvs.mockResolvedValue([PV]);
    mockGetPvDocument.mockResolvedValue(null);
    mockDownloadPvPdf.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));

    await renderPvList();
    await act(async () => {
      apercuBtn().click();
    });
    await flush();

    expect(mockDownloadPvPdf).toHaveBeenCalledWith('pv_01', 'org_01', 'proj_01');
    const pdfIframe = container.querySelector(
      '[data-testid="pv-preview-iframe"]',
    ) as HTMLIFrameElement | null;
    expect(pdfIframe).not.toBeNull();
    expect(pdfIframe!.getAttribute('src')).toBe('blob:mock');
    expect(container.querySelector('[data-testid="pv-preview-doc-iframe"]')).toBeNull();
  });

  it("given un document altéré (409, absorbé en null par la couche API — cf. http-client.test.ts), when on clique Aperçu, then le repli PDF s'affiche quand même (B1 : jamais de cul-de-sac)", async () => {
    // B1 (revue adverse) : httpGetPvDocument convertit désormais 404 ET 409 en
    // `null` (avec un log distinct pour le 409, testé au niveau http-client).
    // Du point de vue de PvListClient, un 409 est donc indiscernable d'un 404 :
    // ce test prouve que le composant retombe bien sur le PDF dans les deux cas.
    mockListPvs.mockResolvedValue([PV]);
    mockGetPvDocument.mockResolvedValue(null);
    mockDownloadPvPdf.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));

    await renderPvList();
    await act(async () => {
      apercuBtn().click();
    });
    await flush();

    expect(mockDownloadPvPdf).toHaveBeenCalledWith('pv_01', 'org_01', 'proj_01');
    const pdfIframe = container.querySelector(
      '[data-testid="pv-preview-iframe"]',
    ) as HTMLIFrameElement | null;
    expect(pdfIframe).not.toBeNull();
    expect(container.querySelector('[data-testid="pv-preview-doc-iframe"]')).toBeNull();
  });

  it("given une erreur serveur générique (pas 404/409) sur GET .../document, when on clique Aperçu, then un message d'erreur s'affiche sans repli silencieux", async () => {
    mockListPvs.mockResolvedValue([PV]);
    mockGetPvDocument.mockRejectedValue({
      statusCode: 500,
      message: 'Erreur interne.',
    });

    await renderPvList();
    await act(async () => {
      apercuBtn().click();
    });
    await flush();

    expect(container.querySelector('[data-testid="pv-preview-doc-iframe"]')).toBeNull();
    expect(container.querySelector('[data-testid="pv-preview-iframe"]')).toBeNull();
    expect(mockDownloadPvPdf).not.toHaveBeenCalled();
    // Erreur générique (pas 409) → message de réessai générique (pdfErrorMessage),
    // pas de repli silencieux sur le PDF.
    expect(container.textContent).toContain(
      'Erreur lors du chargement du PDF. Réessayez.',
    );
  });

  it('given un PV avec un document HTML scellé, when on clique Télécharger, then le document est imprimé tel quel (pas de téléchargement PDF)', async () => {
    mockListPvs.mockResolvedValue([PV]);
    mockGetPvDocument.mockResolvedValue({ html: '<p>Document scellé</p>' });

    await renderPvList();
    await act(async () => {
      telechargerBtn().click();
    });
    await flush();

    expect(mockPrintInertHtml).toHaveBeenCalledWith('<p>Document scellé</p>');
    expect(mockDownloadPvPdf).not.toHaveBeenCalled();
  });

  it('given un PV SANS document HTML (404 → null), when on clique Télécharger, then le PDF pdfmake est téléchargé (comportement inchangé)', async () => {
    mockListPvs.mockResolvedValue([PV]);
    mockGetPvDocument.mockResolvedValue(null);
    mockDownloadPvPdf.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));

    await renderPvList();
    await act(async () => {
      telechargerBtn().click();
    });
    await flush();

    expect(mockDownloadPvPdf).toHaveBeenCalledWith('pv_01', 'org_01', 'proj_01');
    expect(mockPrintInertHtml).not.toHaveBeenCalled();
    expect(container.textContent).toContain(`${PV.number} téléchargé.`);
  });
});
