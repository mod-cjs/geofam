/**
 * Tests — CalculsClient (option 3 : sélection d'un calcul → document capturé
 * de l'outil → impression → scellement, ou repli métadonnées si non capturé).
 *
 * DoD §9 : given/when/then. États couverts :
 *  - snapshot présent  → iframe sandboxée + actions Imprimer/Sceller ;
 *  - snapshot absent (404) → repli sur le panneau de métadonnées existant ;
 *  - scellement → emitPv appelé pour le bon calcul, PV reflété localement ;
 *  - M3 (revue adverse) : sceller un calcul ROADSENS sans document capturé
 *    n'appelle JAMAIS emitPv en un clic silencieux — un avertissement explicite
 *    s'affiche d'abord, confirmation requise ; pour un moteur non pilote
 *    (capture pas encore câblée), aucun bouton Sceller n'est proposé ici.
 *
 * Patron d'interaction : react-dom/client + act (pas de @testing-library/react
 * dans ce dépôt — cf. PvEmittedActions.test.tsx / dashboard-page.test.tsx).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockListCalcResults, mockGetCalcSnapshot, mockEmitPv, mockPush } = vi.hoisted(
  () => ({
    mockListCalcResults: vi.fn(),
    mockGetCalcSnapshot: vi.fn(),
    mockEmitPv: vi.fn(),
    mockPush: vi.fn(),
  }),
);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/lib/api/client', () => ({
  listCalcResults: mockListCalcResults,
  getCalcSnapshot: mockGetCalcSnapshot,
  emitPv: mockEmitPv,
}));

import CalculsClient from '../CalculsClient';

import { ToastProvider } from '@/components/ui/Toast';
import type { CalcResult, OfficialPv } from '@/lib/api/types';

const CALC: CalcResult = {
  id: 'calc_01',
  projectId: 'proj_01',
  orgId: 'org_01',
  engineId: 'chaussee-burmister',
  label: 'Calcul chaussée n°1',
  domain: 'CH',
  status: 'DONE',
  params: {},
  output: { verdict: 'PASS' },
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-01T10:00:00.000Z',
};

// Moteur non pilote (capture option 3 pas encore câblée) — sert à prouver
// qu'aucun bouton Sceller n'est proposé hors roadsens quand le document est absent.
const CALC_TERZAGHI: CalcResult = {
  ...CALC,
  id: 'calc_02',
  engineId: 'fondation-terzaghi',
  label: 'Calcul fondation n°1',
};

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
  mockListCalcResults.mockReset();
  mockGetCalcSnapshot.mockReset();
  mockEmitPv.mockReset();
  mockPush.mockReset();
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

async function renderCalculs() {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <ToastProvider>
        <CalculsClient orgSlug="be-routes-dakar" projetId="proj_01" />
      </ToastProvider>,
    );
  });
  await flush();
}

function findButtonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text),
  ) as HTMLButtonElement | undefined;
}

describe("CalculsClient — document de l'outil (option 3)", () => {
  it("given un calcul avec un document capturé, when sélectionné, then l'aperçu s'affiche en iframe sandboxée en lecture seule avec les actions Imprimer/Sceller", async () => {
    mockListCalcResults.mockResolvedValue([CALC]);
    mockGetCalcSnapshot.mockResolvedValue({
      displayHtml: '<p>Résultat affiché</p>',
      printHtml: '<html><body>Document imprimable</body></html>',
    });

    await renderCalculs();

    expect(mockGetCalcSnapshot).toHaveBeenCalledWith('org_01', 'proj_01', 'calc_01');

    const iframe = container.querySelector(
      '[data-testid="calc-snapshot-frame"]',
    ) as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    // Lecture seule stricte : sandbox="" (aucun token, jamais allow-scripts).
    expect(iframe!.getAttribute('sandbox')).toBe('');
    expect(iframe!.srcdoc).toBe('<p>Résultat affiché</p>');

    expect(findButtonByText('Imprimer les détails')).toBeTruthy();
    expect(findButtonByText('Sceller cette version')).toBeTruthy();
    // Panneau de métadonnées reconstruit remplacé par l'aperçu → pas de <dl>.
    expect(container.querySelector('dl')).toBeNull();
  });

  it("given un calcul SANS document capturé (404 → null), when sélectionné, then le panneau de métadonnées existant s'affiche avec la mention de repli", async () => {
    mockListCalcResults.mockResolvedValue([CALC]);
    mockGetCalcSnapshot.mockResolvedValue(null);

    await renderCalculs();

    expect(container.querySelector('[data-testid="calc-snapshot-frame"]')).toBeNull();
    expect(container.textContent).toContain('Rendu non capturé');
    expect(container.textContent).toContain('relancer le calcul dans le logiciel');
    // Le panneau de métadonnées existant reste consultable.
    expect(container.querySelector('dl')).not.toBeNull();
    expect(container.textContent).toContain('CONFORME');
  });

  it("given un calcul dont le chargement du document échoue (erreur réseau), when sélectionné, then l'écran retombe sans se bloquer sur le panneau de métadonnées", async () => {
    mockListCalcResults.mockResolvedValue([CALC]);
    mockGetCalcSnapshot.mockRejectedValue({ statusCode: 500, message: 'boom' });

    await renderCalculs();

    expect(container.querySelector('[data-testid="calc-snapshot-frame"]')).toBeNull();
    expect(container.querySelector('dl')).not.toBeNull();
  });

  it("given l'aperçu affiché, when on clique « Sceller cette version », then emitPv est appelé pour ce calcul et l'action devient « PV déjà scellé »", async () => {
    mockListCalcResults.mockResolvedValue([CALC]);
    mockGetCalcSnapshot.mockResolvedValue({
      displayHtml: '<p>Résultat affiché</p>',
      printHtml: '<html><body>Document imprimable</body></html>',
    });
    mockEmitPv.mockResolvedValue(PV);

    await renderCalculs();

    const sealBtn = findButtonByText('Sceller cette version');
    expect(sealBtn).toBeTruthy();

    await act(async () => {
      sealBtn!.click();
    });
    await flush();

    expect(mockEmitPv).toHaveBeenCalledWith('org_01', 'proj_01', {
      calcResultId: 'calc_01',
    });
    expect(findButtonByText('PV déjà scellé — voir')).toBeTruthy();
    expect(findButtonByText('Sceller cette version')).toBeFalsy();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("given l'émission du PV échoue (ex. quota), when on clique « Sceller cette version », then un message d'erreur clair s'affiche et l'action reste disponible", async () => {
    mockListCalcResults.mockResolvedValue([CALC]);
    mockGetCalcSnapshot.mockResolvedValue({
      displayHtml: '<p>Résultat affiché</p>',
      printHtml: '<html><body>Document imprimable</body></html>',
    });
    mockEmitPv.mockRejectedValue({
      statusCode: 402,
      reason: 'QUOTA',
      message: "Quota d'utilisation atteint",
    });

    await renderCalculs();

    const sealBtn = findButtonByText('Sceller cette version');
    await act(async () => {
      sealBtn!.click();
    });
    await flush();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Quota d'utilisation atteint");
    expect(findButtonByText('Sceller cette version')).toBeTruthy();
  });

  describe('M3 (revue adverse) — scellement sans document capturé jamais silencieux', () => {
    it("given un calcul ROADSENS SANS document capturé, when on clique « Sceller cette version », then un avertissement explicite s'affiche et emitPv n'est PAS encore appelé", async () => {
      mockListCalcResults.mockResolvedValue([CALC]);
      mockGetCalcSnapshot.mockResolvedValue(null);

      await renderCalculs();

      const sealBtn = findButtonByText('Sceller cette version');
      expect(sealBtn).toBeTruthy();

      await act(async () => {
        sealBtn!.click();
      });
      await flush();

      expect(mockEmitPv).not.toHaveBeenCalled();
      const warning = container.querySelector('[role="alert"]');
      expect(warning?.textContent).toContain("n'a pas été capturé");
      expect(warning?.textContent).toContain('format standard');
      expect(findButtonByText('Confirmer le scellement sans document')).toBeTruthy();
    });

    it("given l'avertissement affiché, when on clique « Annuler », then l'avertissement disparaît et emitPv n'est jamais appelé", async () => {
      mockListCalcResults.mockResolvedValue([CALC]);
      mockGetCalcSnapshot.mockResolvedValue(null);

      await renderCalculs();

      await act(async () => {
        findButtonByText('Sceller cette version')!.click();
      });
      await flush();
      expect(findButtonByText('Confirmer le scellement sans document')).toBeTruthy();

      await act(async () => {
        findButtonByText('Annuler')!.click();
      });
      await flush();

      expect(mockEmitPv).not.toHaveBeenCalled();
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(findButtonByText('Sceller cette version')).toBeTruthy();
    });

    it("given l'avertissement affiché, when on clique « Confirmer le scellement sans document », then emitPv est appelé pour ce calcul", async () => {
      mockListCalcResults.mockResolvedValue([CALC]);
      mockGetCalcSnapshot.mockResolvedValue(null);
      mockEmitPv.mockResolvedValue(PV);

      await renderCalculs();

      await act(async () => {
        findButtonByText('Sceller cette version')!.click();
      });
      await flush();

      await act(async () => {
        findButtonByText('Confirmer le scellement sans document')!.click();
      });
      await flush();

      expect(mockEmitPv).toHaveBeenCalledWith('org_01', 'proj_01', {
        calcResultId: 'calc_01',
      });
    });

    it("given un calcul d'un moteur NON pilote (capture pas câblée) sans document, when sélectionné, then AUCUN bouton Sceller n'est proposé depuis cet écran", async () => {
      mockListCalcResults.mockResolvedValue([CALC_TERZAGHI]);
      mockGetCalcSnapshot.mockResolvedValue(null);

      await renderCalculs();

      expect(findButtonByText('Sceller cette version')).toBeFalsy();
      expect(container.textContent).toContain('Aucun PV émis — ouvrez le logiciel');
      expect(mockEmitPv).not.toHaveBeenCalled();
    });
  });
});
