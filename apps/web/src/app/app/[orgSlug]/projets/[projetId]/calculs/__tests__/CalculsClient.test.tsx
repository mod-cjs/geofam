/**
 * Tests — CalculsClient (option 3 : sélection d'un calcul → document capturé
 * de l'outil → impression → scellement, ou repli métadonnées si non capturé).
 *
 * DoD §9 : given/when/then. États couverts :
 *  - snapshot présent  → iframe sandboxée + barre d'actions unifiée ;
 *  - snapshot absent (404) → repli sur le panneau de métadonnées existant,
 *    même barre d'actions unifiée ;
 *  - scellement → emitPv appelé pour le bon calcul, PV reflété localement ;
 *  - M3 (revue adverse) : sceller un calcul ROADSENS sans document capturé
 *    n'appelle JAMAIS emitPv en un clic silencieux — un avertissement explicite
 *    s'affiche d'abord, confirmation requise ; pour un moteur non pilote
 *    (capture pas encore câblée), aucun bouton Sceller n'est proposé ici.
 *  - FX-4 (revue adverse) : le titre affiché est le nom métier du logiciel
 *    (pas le slug technique), l'identifiant technique reste en sous-titre
 *    discret ; deux calculs du même moteur restent distinguables (date/heure
 *    complète + verdict).
 *  - Actions unifiées (revue titulaire) : « Ouvrir dans le logiciel » n'existe
 *    plus nulle part. Scellé → « Voir le PV scellé » (primaire) + « Imprimer »
 *    (secondaire, imprime le document scellé). Non scellé → « Sceller cette
 *    version » seule (pas de bouton Imprimer, aucun document officiel).
 *  - Fail-closed impression (reco qa-challenger) : sur un calcul scellé,
 *    404 (`getPvDocument` → null) = repli légitime sur l'aperçu ; 409/erreur
 *    réseau (`getPvDocument` rejette) = message d'erreur d'intégrité, RIEN
 *    n'est imprimé.
 *
 * Patron d'interaction : react-dom/client + act (pas de @testing-library/react
 * dans ce dépôt — cf. PvEmittedActions.test.tsx / dashboard-page.test.tsx).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockListCalcResults,
  mockGetCalcSnapshot,
  mockEmitPv,
  mockGetPvDocument,
  mockPrintInertHtml,
  mockPush,
} = vi.hoisted(() => ({
  mockListCalcResults: vi.fn(),
  mockGetCalcSnapshot: vi.fn(),
  mockEmitPv: vi.fn(),
  mockGetPvDocument: vi.fn(),
  mockPrintInertHtml: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/lib/api/client', () => ({
  listCalcResults: mockListCalcResults,
  getCalcSnapshot: mockGetCalcSnapshot,
  emitPv: mockEmitPv,
  getPvDocument: mockGetPvDocument,
}));

vi.mock('@/lib/print-inert-html', () => ({
  printInertHtml: mockPrintInertHtml,
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

// Un 2e calcul du MÊME moteur que CALC — sert à prouver que le titre (nom
// métier, identique) ne suffit plus à confondre les deux : seuls le libellé
// technique en sous-titre et la date/heure complète + verdict distinguent.
const CALC_2_MEME_MOTEUR: CalcResult = {
  ...CALC,
  id: 'calc_03',
  label: 'chaussee-burmister',
  output: { verdict: 'FAIL' },
  createdAt: '2026-07-01T10:05:30.000Z',
  updatedAt: '2026-07-01T10:05:30.000Z',
};

// Calcul déjà scellé (PV existant) — sert #6 : Imprimer doit lire le document
// scellé, pas le snapshot courant.
const CALC_SEALED: CalcResult = {
  ...CALC,
  id: 'calc_04',
  pvId: 'pv_01',
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
  mockGetPvDocument.mockReset();
  mockPrintInertHtml.mockReset();
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
  it("given un calcul avec un document capturé (non scellé), when sélectionné, then l'aperçu s'affiche en iframe sandboxée en lecture seule avec la seule action Sceller (pas d'Imprimer, pas d'Ouvrir)", async () => {
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

    // Non scellé : Sceller seule, pas d'Imprimer tant que le document
    // officiel n'existe pas.
    expect(findButtonByText('Sceller cette version')).toBeTruthy();
    expect(findButtonByText('Imprimer')).toBeFalsy();
    expect(findButtonByText('Ouvrir dans le logiciel')).toBeFalsy();
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
    expect(findButtonByText('Ouvrir dans le logiciel')).toBeFalsy();
  });

  it("given un calcul dont le chargement du document échoue (erreur réseau), when sélectionné, then l'écran retombe sans se bloquer sur le panneau de métadonnées", async () => {
    mockListCalcResults.mockResolvedValue([CALC]);
    mockGetCalcSnapshot.mockRejectedValue({ statusCode: 500, message: 'boom' });

    await renderCalculs();

    expect(container.querySelector('[data-testid="calc-snapshot-frame"]')).toBeNull();
    expect(container.querySelector('dl')).not.toBeNull();
  });

  it("given l'aperçu affiché, when on clique « Sceller cette version », then emitPv est appelé pour ce calcul et l'action devient « Voir le PV scellé » + « Imprimer »", async () => {
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
    expect(findButtonByText('Voir le PV scellé')).toBeTruthy();
    expect(findButtonByText('Imprimer')).toBeTruthy();
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

  describe('FX-4 (revue adverse) — titre = nom métier, deux calculs du même moteur distinguables', () => {
    it("given un calcul, when affiché dans la liste et dans le panneau, then le TITRE est le nom métier du logiciel et l'identifiant technique reste un sous-titre discret", async () => {
      mockListCalcResults.mockResolvedValue([CALC]);
      mockGetCalcSnapshot.mockResolvedValue(null);

      await renderCalculs();

      const item = container.querySelector('li button') as HTMLButtonElement;
      // Titre = nom métier (pas le slug/libellé technique du calcul).
      expect(item.textContent).toContain('ROADSENS — Chaussées');
      // Sous-titre = libellé technique du calcul, toujours présent mais discret.
      expect(item.textContent).toContain(CALC.label);

      const heading = container.querySelector('h2') as HTMLHeadingElement;
      expect(heading.textContent).toBe('ROADSENS — Chaussées');
      expect(container.querySelector('section')?.textContent).toContain(CALC.label);
    });

    it('given deux calculs du même moteur, when listés, then ils restent distinguables (libellé technique et date/heure complète + verdict différents)', async () => {
      mockListCalcResults.mockResolvedValue([CALC, CALC_2_MEME_MOTEUR]);
      mockGetCalcSnapshot.mockResolvedValue(null);

      await renderCalculs();

      const items = Array.from(container.querySelectorAll('li'));
      expect(items).toHaveLength(2);
      // Même titre (même moteur) mais contenu de la carte différent (verdict +
      // horodatage), donc les deux boutons ne sont jamais identiques.
      const texts = items.map((li) => li.textContent);
      expect(texts[0]).not.toBe(texts[1]);
      expect(container.textContent).toContain('CONFORME');
      expect(container.textContent).toContain('NON CONF.');
    });
  });

  describe('Actions unifiées (revue titulaire) — scellé : Voir le PV scellé + Imprimer', () => {
    it('given un calcul DÉJÀ scellé (PV existant) AVEC aperçu capturé, when on clique « Imprimer », then le document scellé (getPvDocument) est imprimé, pas le snapshot courant', async () => {
      mockListCalcResults.mockResolvedValue([CALC_SEALED]);
      mockGetCalcSnapshot.mockResolvedValue({
        displayHtml: '<p>Aperçu courant (peut diverger)</p>',
        printHtml: '<html><body>Snapshot courant</body></html>',
      });
      mockGetPvDocument.mockResolvedValue({
        html: '<html><body>Document scellé</body></html>',
      });

      await renderCalculs();

      expect(findButtonByText('Voir le PV scellé')).toBeTruthy();
      const printBtn = findButtonByText('Imprimer');
      expect(printBtn).toBeTruthy();

      await act(async () => {
        printBtn!.click();
      });
      await flush();

      expect(mockGetPvDocument).toHaveBeenCalledWith('org_01', 'proj_01', 'pv_01');
      expect(mockPrintInertHtml).toHaveBeenCalledWith(
        '<html><body>Document scellé</body></html>',
      );
      expect(mockPrintInertHtml).not.toHaveBeenCalledWith(
        '<html><body>Snapshot courant</body></html>',
      );
    });

    it("given un calcul DÉJÀ scellé SANS aperçu capturé (repli métadonnées), when affiché, then la même barre d'actions (Voir le PV scellé + Imprimer) est proposée", async () => {
      mockListCalcResults.mockResolvedValue([CALC_SEALED]);
      mockGetCalcSnapshot.mockResolvedValue(null);
      mockGetPvDocument.mockResolvedValue({
        html: '<html><body>Document scellé</body></html>',
      });

      await renderCalculs();

      expect(container.querySelector('dl')).not.toBeNull();
      expect(findButtonByText('Voir le PV scellé')).toBeTruthy();
      const printBtn = findButtonByText('Imprimer');
      expect(printBtn).toBeTruthy();
      expect(findButtonByText('Ouvrir dans le logiciel')).toBeFalsy();

      await act(async () => {
        printBtn!.click();
      });
      await flush();

      expect(mockPrintInertHtml).toHaveBeenCalledWith(
        '<html><body>Document scellé</body></html>',
      );
    });

    it("given un calcul DÉJÀ scellé mais SANS document scellé récupérable (404, getPvDocument → null) ET un aperçu capturé, when on clique « Imprimer », then l'écran retombe sur le snapshot courant (repli légitime, jamais de cul-de-sac)", async () => {
      mockListCalcResults.mockResolvedValue([CALC_SEALED]);
      mockGetCalcSnapshot.mockResolvedValue({
        displayHtml: '<p>Aperçu courant</p>',
        printHtml: '<html><body>Snapshot courant (repli)</body></html>',
      });
      mockGetPvDocument.mockResolvedValue(null);

      await renderCalculs();

      await act(async () => {
        findButtonByText('Imprimer')!.click();
      });
      await flush();

      expect(mockGetPvDocument).toHaveBeenCalledWith('org_01', 'proj_01', 'pv_01');
      expect(mockPrintInertHtml).toHaveBeenCalledWith(
        '<html><body>Snapshot courant (repli)</body></html>',
      );
      expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    it("given un calcul DÉJÀ scellé dont la lecture du document échoue (409, intégrité rompue), when on clique « Imprimer », then AUCUNE impression n'a lieu et un message d'erreur d'intégrité s'affiche (fail-closed)", async () => {
      mockListCalcResults.mockResolvedValue([CALC_SEALED]);
      mockGetCalcSnapshot.mockResolvedValue({
        displayHtml: '<p>Aperçu courant</p>',
        printHtml: '<html><body>Snapshot courant (repli)</body></html>',
      });
      mockGetPvDocument.mockRejectedValue({
        statusCode: 409,
        message: 'Document altéré ou sceau rompu.',
      });

      await renderCalculs();

      await act(async () => {
        findButtonByText('Imprimer')!.click();
      });
      await flush();

      expect(mockPrintInertHtml).not.toHaveBeenCalled();
      const alert = container.querySelector('[role="alert"]');
      expect(alert).not.toBeNull();
      expect(alert?.textContent).toContain('intégrité');
    });

    it("given un calcul DÉJÀ scellé dont la lecture du document échoue (erreur réseau générique), when on clique « Imprimer », then AUCUNE impression n'a lieu et un message d'erreur s'affiche (fail-closed, plus de repli silencieux)", async () => {
      mockListCalcResults.mockResolvedValue([CALC_SEALED]);
      mockGetCalcSnapshot.mockResolvedValue({
        displayHtml: '<p>Aperçu courant</p>',
        printHtml: '<html><body>Snapshot courant (repli réseau)</body></html>',
      });
      mockGetPvDocument.mockRejectedValue({ statusCode: 500, message: 'boom' });

      await renderCalculs();

      await act(async () => {
        findButtonByText('Imprimer')!.click();
      });
      await flush();

      expect(mockPrintInertHtml).not.toHaveBeenCalled();
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
    });

    it('given un calcul PAS ENCORE scellé (aucun PV), when affiché, then getPvDocument n’est jamais appelé et aucun bouton Imprimer n’est proposé', async () => {
      mockListCalcResults.mockResolvedValue([CALC]);
      mockGetCalcSnapshot.mockResolvedValue({
        displayHtml: '<p>Aperçu</p>',
        printHtml: '<html><body>Snapshot non scellé</body></html>',
      });

      await renderCalculs();

      expect(mockGetPvDocument).not.toHaveBeenCalled();
      expect(findButtonByText('Imprimer')).toBeFalsy();
      expect(findButtonByText('Sceller cette version')).toBeTruthy();
    });
  });
});
