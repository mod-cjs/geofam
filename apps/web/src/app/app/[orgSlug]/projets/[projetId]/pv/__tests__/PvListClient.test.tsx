/**
 * Tests — PvListClient, volet « option 3 » (le PV = le document que l'outil
 * imprime). Aperçu/Télécharger tentent D'ABORD le document HTML scellé
 * (GET .../pvs/:pvId/document). Contrat du client API (getPvDocument) : `null`
 * sur 404 = repli PDF pdfmake INCHANGÉ ; 409 REJETTE désormais (cf.
 * http-client.test.ts, révisé suite à reco qa-challenger) mais ce composant
 * l'absorbe localement en repli PDF via `fetchPvDocumentOrNull` (B1, revue
 * adverse : jamais de cul-de-sac ici, le PDF a son propre contrôle
 * d'intégrité indépendant). Toute AUTRE erreur (500…) reste un message
 * d'erreur, sans repli silencieux.
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
  mockGetProjectCached,
  mockPrintInertHtml,
} = vi.hoisted(() => ({
  mockListPvs: vi.fn(),
  mockVerifyPv: vi.fn(),
  mockDownloadPvPdf: vi.fn(),
  mockGetPvDocument: vi.fn(),
  mockGetProjectCached: vi.fn(),
  mockPrintInertHtml: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  listPvs: mockListPvs,
  verifyPv: mockVerifyPv,
  downloadPvPdf: mockDownloadPvPdf,
  getPvDocument: mockGetPvDocument,
  getProjectCached: mockGetProjectCached,
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
  mockGetProjectCached.mockReset();
  mockGetProjectCached.mockResolvedValue({ name: 'Route Dakar-Thiès — dimensionnement' });
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

  it("given un document altéré simulé en null (cas historique de repli), when on clique Aperçu, then le repli PDF s'affiche quand même (B1 : jamais de cul-de-sac)", async () => {
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

  it("given un document altéré (409, getPvDocument REJETTE — cf. http-client.ts révisé), when on clique Aperçu, then le repli PDF s'affiche quand même (wrapper local fetchPvDocumentOrNull, B1 : jamais de cul-de-sac)", async () => {
    // Révisé (reco qa-challenger) : httpGetPvDocument REJETTE désormais sur
    // 409 (au lieu de renvoyer null) pour que CalculsClient puisse fail-closed.
    // PvListClient absorbe ce rejet localement (fetchPvDocumentOrNull) pour
    // conserver sa politique B1 existante : le PDF a son propre contrôle
    // d'intégrité indépendant.
    mockListPvs.mockResolvedValue([PV]);
    mockGetPvDocument.mockRejectedValue({ statusCode: 409, message: 'Document altéré.' });
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

describe('PvListClient — verdict de conformité (maquette finale, écran 3)', () => {
  // Contexte (correction titulaire) : le badge « Scellé » atteste
  // l'INTÉGRITÉ, jamais la conformité — un PV peut être parfaitement scellé
  // et rapporter NON CONFORME. Les deux informations doivent donc être
  // affichées côte à côte, jamais fusionnées, et le badge Scellé ne doit
  // JAMAIS emprunter le vert/rouge des verdicts (ADR 0008).
  const PV_CONFORME: OfficialPv = { ...PV, output: { verdict: 'PASS' }, verdict: 'PASS' };
  const PV_NON_CONFORME: OfficialPv = {
    ...PV,
    id: 'pv_02',
    output: { verdict: 'FAIL' },
    verdict: 'FAIL',
  };
  const PV_NON_APPLICABLE: OfficialPv = {
    ...PV,
    id: 'pv_03',
    engineId: 'geoplaque',
    output: { verdict: 'NA' },
    verdict: 'NA',
  };

  it('given un PV rapportant CONFORME, when la liste s’affiche, then le verdict CONFORME et le badge Scellé apparaissent tous deux, distinctement', async () => {
    mockListPvs.mockResolvedValue([PV_CONFORME]);

    await renderPvList();

    expect(container.textContent).toContain('CONFORME');
    expect(container.textContent).toContain('Scellé');
  });

  it('given un PV rapportant NON CONFORME, when la liste s’affiche, then le verdict NON CONF. s’affiche ET le badge Scellé reste affiché normalement (jamais retiré, jamais recoloré en rouge)', async () => {
    mockListPvs.mockResolvedValue([PV_NON_CONFORME]);

    await renderPvList();

    expect(container.textContent).toContain('NON CONF.');
    const sealedBadge = Array.from(container.querySelectorAll('span')).find((s) =>
      s.textContent?.includes('Scellé'),
    );
    expect(sealedBadge).toBeTruthy();
    // Le badge Scellé ne doit JAMAIS utiliser les tokens de verdict (ADR 0008) :
    // un PV scellé NON CONFORME n'est pas "en échec" au sens du scellement.
    expect(sealedBadge!.style.cssText).not.toContain('--status-fail');
    expect(sealedBadge!.style.cssText).not.toContain('--status-pass');
  });

  it('given un PV NON APPLICABLE (ex. radier — pas de notion de conformité), when la liste s’affiche, then le verdict neutre NON APPLIC. s’affiche (ni masqué, ni traité comme un échec)', async () => {
    mockListPvs.mockResolvedValue([PV_NON_APPLICABLE]);

    await renderPvList();

    expect(container.textContent).toContain('NON APPLIC.');
    // Neutre : ne doit utiliser NI le token pass NI le token fail.
    const verdictBadge = Array.from(container.querySelectorAll('span')).find((s) =>
      s.textContent?.includes('NON APPLIC.'),
    );
    expect(verdictBadge).toBeTruthy();
    expect(verdictBadge!.style.cssText).not.toContain('--status-pass');
    expect(verdictBadge!.style.cssText).not.toContain('--status-fail');
  });

  // BLOQUANT qa-challenger (verdict.tsx) : le badge d'un PV SCELLÉ doit suivre
  // `pv.verdict` (copie du verdict SCELLÉ côté serveur, ADR 0012), PAS une
  // re-dérivation de `pv.output` par duck-typing — les deux logiques sont
  // indépendantes et PEUVENT diverger (ex. moteur non reconnu par la
  // whitelist normalizeOutput). Fixture volontairement contradictoire pour
  // prouver l'indépendance : sans cette divergence délibérée, un retour à
  // `extractVerdict(pv.output)` resterait indétectable (les fixtures
  // ci-dessus ont `output.verdict` et `pv.verdict` identiques par construction).
  it('given un PV scellé dont pv.verdict et output.verdict DIVERGENT, when la liste s’affiche, then le badge suit pv.verdict (le sceau), pas output', async () => {
    const PV_DIVERGENT: OfficialPv = {
      ...PV,
      id: 'pv_divergent',
      // output re-dérivable en FAIL (duck-typing) — sceau CONFORME (verdict='PASS').
      // Cas réel : ex. un correctif serveur post-scellement changerait la
      // dérivation client sans re-sceller ; le sceau doit rester la seule
      // vérité affichée pour un PV déjà émis.
      output: { verdict: 'FAIL' },
      verdict: 'PASS',
    };
    mockListPvs.mockResolvedValue([PV_DIVERGENT]);

    await renderPvList();

    expect(container.textContent).toContain('CONFORME');
    expect(container.textContent).not.toContain('NON CONF.');
  });

  it('given un PV scellé sans verdict exploitable (colonne absente, cas défensif), when la liste s’affiche, then aucun badge de verdict n’est affiché (pas de verdict inventé)', async () => {
    const PV_SANS_VERDICT: OfficialPv = {
      ...PV,
      id: 'pv_sans_verdict',
      output: { verdict: 'PASS' },
      verdict: undefined,
    };
    mockListPvs.mockResolvedValue([PV_SANS_VERDICT]);

    await renderPvList();

    expect(container.textContent).not.toContain('CONFORME');
    expect(container.textContent).not.toContain('NON APPLIC.');
    // Le badge Scellé, lui, reste affiché (l'intégrité est indépendante du verdict).
    expect(container.textContent).toContain('Scellé');
  });
});

describe('PvListClient — titre mnémonique (FX-10)', () => {
  it('given un PV scellé (engineId burmister) et le projet chargé, when la liste s’affiche, then le titre est "Note de calcul — {projet} · {logiciel}" (nom métier humanisé, pas le slug)', async () => {
    mockListPvs.mockResolvedValue([PV]);
    mockGetProjectCached.mockResolvedValue({
      name: 'Route Dakar-Thiès — dimensionnement',
    });

    await renderPvList();

    expect(mockGetProjectCached).toHaveBeenCalledWith('org_01', 'proj_01');
    expect(container.textContent).toContain(
      'Note de calcul — Route Dakar-Thiès — dimensionnement · ROADSENS — Chaussées',
    );
    // Plus jamais le slug brut affiché comme identifiant du logiciel.
    expect(container.textContent).not.toContain('burmister ·');
  });

  it('given le numéro officiel PV-2026-0001, when la liste s’affiche, then il reste visible en référence secondaire (pas comme titre)', async () => {
    mockListPvs.mockResolvedValue([PV]);
    mockGetProjectCached.mockResolvedValue({ name: 'Route Dakar-Thiès' });

    await renderPvList();

    // Le numéro (immuable, scellé) reste affiché — juste plus comme titre.
    expect(container.textContent).toContain(PV.number);
    const heading = container.querySelector(
      '[role="listitem"] span',
    ) as HTMLSpanElement | null;
    expect(heading?.textContent).not.toBe(PV.number);
    expect(heading?.textContent).toContain('Note de calcul —');
  });

  it('given le nom du projet pas encore résolu (getProjectCached en attente), when la liste s’affiche, then le titre reste correct sans planter (repli sans le segment projet)', async () => {
    mockListPvs.mockResolvedValue([PV]);
    // Ne se résout jamais dans le temps du test → projectName reste null.
    mockGetProjectCached.mockReturnValue(new Promise(() => {}));

    await renderPvList();

    expect(container.textContent).toContain('Note de calcul — ROADSENS — Chaussées');
    expect(container.textContent).toContain(PV.number);
  });
});
