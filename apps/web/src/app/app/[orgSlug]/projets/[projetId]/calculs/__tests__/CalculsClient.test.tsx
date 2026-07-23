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
 *  - Nom mnémonique (décision titulaire 22/07/2026, remplace FX-4) : le titre
 *    affiché est `Logiciel · Projet · #n` (ou le nom personnalisé, si
 *    renommé) — le nom métier du logiciel et l'identifiant technique restent
 *    en sous-titre discret ; deux calculs du même moteur restent distinguables
 *    (numéro #n, date/heure complète + verdict) ; renommage inline (crayon) ;
 *    suppression d'un calcul NON scellé ; recherche étendue au nom d'affichage.
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
  mockGetProjectCached,
  mockRenameCalcResult,
  mockDeleteCalcResult,
  mockPrintInertHtml,
  mockPush,
} = vi.hoisted(() => ({
  mockListCalcResults: vi.fn(),
  mockGetCalcSnapshot: vi.fn(),
  mockEmitPv: vi.fn(),
  mockGetPvDocument: vi.fn(),
  mockGetProjectCached: vi.fn(),
  mockRenameCalcResult: vi.fn(),
  mockDeleteCalcResult: vi.fn(),
  mockPrintInertHtml: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/lib/api/client', () => ({
  listCalcResults: mockListCalcResults,
  getCalcSnapshot: mockGetCalcSnapshot,
  renameCalcResult: mockRenameCalcResult,
  deleteCalcResult: mockDeleteCalcResult,
  emitPv: mockEmitPv,
  getPvDocument: mockGetPvDocument,
  getProjectCached: mockGetProjectCached,
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

// Nom de projet fixe (mnémonique, décision titulaire 22/07/2026) — un objet
// minimal suffit : `displayNameOf` ne lit que `.name` sur la valeur résolue
// par `getProjectCached`.
const PROJECT = { name: 'RN2 — PK45' };

/** Mnémonique attendu `Logiciel · Projet · #n` — helper de lisibilité des tests. */
function mnemo(nomCourtLogiciel: string, seq: number): string {
  return `${nomCourtLogiciel} · ${PROJECT.name} · #${seq}`;
}

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
  mockGetProjectCached.mockReset();
  mockRenameCalcResult.mockReset();
  mockDeleteCalcResult.mockReset();
  mockGetProjectCached.mockResolvedValue(PROJECT);
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

// Distinct de findButtonByText : « Sceller » (confirmation du dialogue de
// nommage) est un SOUS-TEXTE de « Sceller cette version » (toujours visible
// sous le dialogue, Modal n'étant pas un unmount de la page) — une recherche
// par inclusion matcherait les deux boutons.
function findButtonByExactText(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  ) as HTMLButtonElement | undefined;
}

/** Ouvre le dialogue de nommage (clic « Sceller cette version ») puis confirme
 * (clic « Sceller » dans la modale) — parcours complet désormais requis pour
 * que emitPv soit appelé (décision titulaire 22/07/2026). */
async function sceller() {
  await act(async () => {
    findButtonByText('Sceller cette version')!.click();
  });
  await flush();
  await act(async () => {
    findButtonByExactText('Sceller')!.click();
  });
  await flush();
}

describe('CalculsClient — Exporter (JSON) : livrable « Exporter » de l’outil client', () => {
  // L'outil client Terzaghi offre Calculer / Exporter / Imprimer. « Exporter »
  // télécharge la SAISIE (état S) dans un JSON ré-importable. On porte ce
  // livrable sur un calcul PERSISTÉ de l'historique : notre `params` EST cette
  // forme S. Aucune sortie moteur exportée (DoD §8), aucun appel réseau.
  const CALC_AVEC_ENTREES: CalcResult = {
    ...CALC,
    engineId: 'fondation-terzaghi',
    params: {
      projet: 'Bâtiment R+5 — exemple',
      solCat: 'marnes',
      forme: 'rect',
      B: 6,
      L: 10,
      D: 4.5,
      sondage: [{ z: 1.5, pl: 2.5, em: 8 }],
    },
  };

  it('given un calcul sélectionné, when on clique « Exporter (JSON) », then un téléchargement se déclenche avec le fichier <logiciel>-<projet>.json et le contenu = les ENTRÉES', async () => {
    mockListCalcResults.mockResolvedValue([CALC_AVEC_ENTREES]);
    mockGetCalcSnapshot.mockResolvedValue(null);

    // Capture du Blob téléchargé + du nom de fichier, sans écrire de vrai fichier.
    let capturedBlob: Blob | null = null;
    let capturedName = '';
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((b: Blob) => {
      capturedBlob = b;
      return 'blob:mock';
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        capturedName = this.download;
      });

    try {
      await renderCalculs();
      const btn = findButtonByText('Exporter (JSON)');
      expect(btn).not.toBeUndefined();
      await act(async () => btn!.click());

      expect(clickSpy).toHaveBeenCalledTimes(1);
      // Nom de fichier calqué sur l'outil : logiciel (terzaghi) + projet slugifié.
      expect(capturedName).toBe('terzaghi-batiment-r-5-exemple.json');
      // Contenu = les ENTRÉES exactes, rien d'autre (pas de sortie moteur).
      expect(capturedBlob).not.toBeNull();
      const text = await capturedBlob!.text();
      expect(JSON.parse(text)).toEqual(CALC_AVEC_ENTREES.params);
      expect(text).not.toContain('verdict'); // aucune sortie moteur
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });
});

describe('CalculsClient — Aperçu de la note avant scellement (filigrané, revue #6)', () => {
  // L'outil client imprime la note à tout moment. On porte ce livrable de
  // TRAVAIL, mais la revue #6 avait retiré l'impression pré-scellement (risque
  // qu'un aperçu se fasse passer pour le PV). Réconciliation : autorisé, mais
  // FILIGRANÉ « non scellé » — impossible à confondre avec le PV opposable.
  it('given un calcul NON scellé avec document capturé, when on clique « Aperçu de la note », then le document est imprimé AVEC le filigrane « NON SCELLÉ » et le contenu d’origine', async () => {
    mockListCalcResults.mockResolvedValue([CALC]);
    mockGetCalcSnapshot.mockResolvedValue({
      displayHtml: '<p>Aperçu écran</p>',
      printHtml:
        '<!doctype html><html><head><title>Note</title></head><body><h1>Note de calcul</h1></body></html>',
    });

    await renderCalculs();
    const btn = findButtonByText('Aperçu de la note');
    expect(btn).not.toBeUndefined();
    await act(async () => btn!.click());

    expect(mockPrintInertHtml).toHaveBeenCalledTimes(1);
    const printed = mockPrintInertHtml.mock.calls[0][0] as string;
    // DEUX mécanismes vérifiés SÉPARÉMENT (esprit mutation, revue adverse) :
    // ils portent le même mot « NON SCELLÉ », donc un unique `toContain` resterait
    // vert si on retirait l'un des deux — or le filigrane TUILÉ est la seule marque
    // par page à l'impression (le bandeau n'apparaît qu'en page 1).
    // On cible l'ÉLÉMENT DE RENDU (attribut class du <div>), pas le sélecteur CSS :
    // retirer un <div> tout en gardant sa règle `.__draft-…{}` supprimerait la
    // marque à l'écran/impression SANS que le test ne rougisse (faux-vert attrapé).
    //  1. le bandeau en tête (div dédié + texte complet)
    expect(printed).toContain('class="__draft-banner"');
    expect(printed).toContain('DOCUMENT DE TRAVAIL — NON SCELLÉ · non opposable');
    //  2. le filigrane tuilé par page (div overlay + fond SVG répété) — la SEULE
    //     marque par page à l'impression ; retirer ce div fait rougir CE test.
    expect(printed).toContain('class="__draft-wm"');
    expect(printed).toContain('data:image/svg+xml');
    expect(printed).toContain('background-repeat:repeat');
    // Document d'origine PRÉSERVÉ (on n'injecte que de la présentation).
    expect(printed).toContain('<h1>Note de calcul</h1>');
  });

  it('given un calcul DÉJÀ scellé, when la barre d’actions est rendue, then « Aperçu de la note » N’EST PAS proposé (le scellé imprime son PV officiel, pas un aperçu)', async () => {
    mockListCalcResults.mockResolvedValue([CALC_SEALED]);
    mockGetCalcSnapshot.mockResolvedValue({
      displayHtml: '<p>x</p>',
      printHtml: '<html><body>y</body></html>',
    });

    await renderCalculs();
    // Un calcul scellé propose « Voir le PV scellé » + « Imprimer » (le PV),
    // jamais « Aperçu de la note » (qui est le brouillon non scellé).
    expect(findButtonByText('Aperçu de la note')).toBeUndefined();
    expect(findButtonByText('Voir le PV scellé')).not.toBeUndefined();
  });
});

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

  it("given l'aperçu affiché, when on clique « Sceller cette version », then un dialogue de nommage s'ouvre, PRÉ-REMPLI du nom d'affichage courant", async () => {
    mockListCalcResults.mockResolvedValue([CALC]);
    mockGetCalcSnapshot.mockResolvedValue({
      displayHtml: '<p>Résultat affiché</p>',
      printHtml: '<html><body>Document imprimable</body></html>',
    });

    await renderCalculs();

    const sealBtn = findButtonByText('Sceller cette version');
    expect(sealBtn).toBeTruthy();
    expect(mockEmitPv).not.toHaveBeenCalled();

    await act(async () => {
      sealBtn!.click();
    });
    await flush();

    // emitPv n'est PAS encore appelé : seul le dialogue de nommage s'ouvre.
    expect(mockEmitPv).not.toHaveBeenCalled();
    const nameInput = container.querySelector(
      '#pv-name-input',
    ) as HTMLInputElement | null;
    expect(nameInput).not.toBeNull();
    expect(nameInput!.value).toBe(mnemo('ROADSENS', 1));
  });

  it("given le dialogue de nommage ouvert, when on valide « Sceller » sans modifier le nom, then emitPv est appelé avec le nom pré-rempli et l'action devient « Voir le PV scellé » + « Imprimer »", async () => {
    mockListCalcResults.mockResolvedValue([CALC]);
    mockGetCalcSnapshot.mockResolvedValue({
      displayHtml: '<p>Résultat affiché</p>',
      printHtml: '<html><body>Document imprimable</body></html>',
    });
    mockEmitPv.mockResolvedValue(PV);

    await renderCalculs();
    await sceller();

    expect(mockEmitPv).toHaveBeenCalledWith('org_01', 'proj_01', {
      calcResultId: 'calc_01',
      name: mnemo('ROADSENS', 1),
    });
    expect(findButtonByText('Voir le PV scellé')).toBeTruthy();
    expect(findButtonByText('Imprimer')).toBeTruthy();
    expect(findButtonByText('Sceller cette version')).toBeFalsy();
    // Le dialogue de nommage s'est refermé après succès.
    expect(container.querySelector('#pv-name-input')).toBeNull();
  });

  it('given le dialogue de nommage ouvert, when on ÉDITE le nom avant de valider, then emitPv reçoit le nom MODIFIÉ (pas le mnémonique pré-rempli)', async () => {
    mockListCalcResults.mockResolvedValue([CALC]);
    mockGetCalcSnapshot.mockResolvedValue({
      displayHtml: '<p>Résultat affiché</p>',
      printHtml: '<html><body>Document imprimable</body></html>',
    });
    mockEmitPv.mockResolvedValue(PV);

    await renderCalculs();

    await act(async () => {
      findButtonByText('Sceller cette version')!.click();
    });
    await flush();

    const nameInput = container.querySelector('#pv-name-input') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(nameInput, 'Structure S1 — étude finale');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      findButtonByExactText('Sceller')!.click();
    });
    await flush();

    expect(mockEmitPv).toHaveBeenCalledWith('org_01', 'proj_01', {
      calcResultId: 'calc_01',
      name: 'Structure S1 — étude finale',
    });
  });

  it("given le dialogue de nommage ouvert, when on clique « Annuler », then emitPv n'est jamais appelé et le dialogue se ferme", async () => {
    mockListCalcResults.mockResolvedValue([CALC]);
    mockGetCalcSnapshot.mockResolvedValue({
      displayHtml: '<p>Résultat affiché</p>',
      printHtml: '<html><body>Document imprimable</body></html>',
    });

    await renderCalculs();

    await act(async () => {
      findButtonByText('Sceller cette version')!.click();
    });
    await flush();
    expect(container.querySelector('#pv-name-input')).not.toBeNull();

    await act(async () => {
      findButtonByExactText('Annuler')!.click();
    });
    await flush();

    expect(mockEmitPv).not.toHaveBeenCalled();
    expect(container.querySelector('#pv-name-input')).toBeNull();
  });

  it("given l'émission du PV échoue (ex. quota), when on valide le dialogue de nommage, then un message d'erreur clair s'affiche DANS le dialogue et l'action reste disponible", async () => {
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
    await sceller();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Quota d'utilisation atteint");
    // Le dialogue reste ouvert (échec) : le champ nom est toujours là.
    expect(container.querySelector('#pv-name-input')).not.toBeNull();
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

    it("given l'avertissement affiché, when on clique « Confirmer le scellement sans document », then le dialogue de nommage s'ouvre (emitPv toujours pas appelé)", async () => {
      mockListCalcResults.mockResolvedValue([CALC]);
      mockGetCalcSnapshot.mockResolvedValue(null);

      await renderCalculs();

      await act(async () => {
        findButtonByText('Sceller cette version')!.click();
      });
      await flush();

      await act(async () => {
        findButtonByText('Confirmer le scellement sans document')!.click();
      });
      await flush();

      expect(mockEmitPv).not.toHaveBeenCalled();
      expect(container.querySelector('#pv-name-input')).not.toBeNull();
    });

    it('given le dialogue de nommage ouvert après confirmation M3, when on valide « Sceller », then emitPv est appelé pour ce calcul', async () => {
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

      await act(async () => {
        findButtonByExactText('Sceller')!.click();
      });
      await flush();

      expect(mockEmitPv).toHaveBeenCalledWith('org_01', 'proj_01', {
        calcResultId: 'calc_01',
        name: mnemo('ROADSENS', 1),
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

  describe('Nom mnémonique (décision titulaire 22/07/2026, remplace FX-4) — titre = Logiciel · Projet · #n, logiciel en sous-titre', () => {
    it('given un calcul SANS nom personnalisé, when affiché, then la LISTE porte la forme compacte « Logiciel · #n » et le PANNEAU la forme complète « Logiciel · Projet · #n »', async () => {
      mockListCalcResults.mockResolvedValue([CALC]);
      mockGetCalcSnapshot.mockResolvedValue(null);

      await renderCalculs();

      // COLONNE ÉTROITE — forme COMPACTE (décision titulaire 22/07/2026, prise
      // après vérification dans l'application réelle : le nom complet y était
      // tronqué à « ROADSENS · Route Dakar-T… » sur TOUTES les lignes, coupant
      // le #n qui les distingue. Le nom du projet y est de toute façon redondant
      // — on est déjà DANS ce projet.
      // Sélection = direct child <button> du <li> (les boutons crayon/corbeille
      // sont des SIBLINGS, pas des enfants imbriqués — cf. structure de la ligne).
      const item = container.querySelector('li > button') as HTMLButtonElement;
      expect(item.textContent).toContain('ROADSENS · #1');
      expect(item.textContent).not.toContain(PROJECT.name);
      // Sous-titre = nom métier du logiciel + libellé technique, toujours
      // présents mais discrets (ne sont plus le titre).
      expect(item.textContent).toContain('ROADSENS — Chaussées');
      expect(item.textContent).toContain(CALC.label);

      // PANNEAU DE DÉTAIL (large) — forme COMPLÈTE, projet inclus.
      const heading = container.querySelector('h2') as HTMLHeadingElement;
      expect(heading.textContent).toBe(mnemo('ROADSENS', 1));
      expect(container.querySelector('section')?.textContent).toContain(
        'ROADSENS — Chaussées',
      );
      expect(container.querySelector('section')?.textContent).toContain(CALC.label);
    });

    it('given deux calculs du même moteur, when listés, then ils restent distinguables (numéro #n distinct, en plus du verdict et de l’horodatage)', async () => {
      mockListCalcResults.mockResolvedValue([CALC, CALC_2_MEME_MOTEUR]);
      mockGetCalcSnapshot.mockResolvedValue(null);

      await renderCalculs();

      const items = Array.from(container.querySelectorAll('li'));
      expect(items).toHaveLength(2);
      // C'EST LE DÉFAUT D'ORIGINE : sans le #n, ces deux lignes porteraient un
      // libellé identique. Le rang doit rester VISIBLE en forme compacte — s'il
      // était rogné par la troncature, le défaut réapparaîtrait à l'écran.
      expect(container.textContent).toContain('ROADSENS · #1');
      expect(container.textContent).toContain('ROADSENS · #2');
      const texts = items.map((li) => li.textContent);
      expect(texts[0]).not.toBe(texts[1]);
      expect(container.textContent).toContain('CONFORME');
      expect(container.textContent).toContain('NON CONF.');
    });

    it('given un calcul renommé (name personnalisé), when affiché, then le TITRE est ce nom personnalisé, PAS le mnémonique', async () => {
      const CALC_RENOMME = { ...CALC, name: 'Structure S1 — variante retenue' };
      mockListCalcResults.mockResolvedValue([CALC_RENOMME]);
      mockGetCalcSnapshot.mockResolvedValue(null);

      await renderCalculs();

      const item = container.querySelector('li > button') as HTMLButtonElement;
      expect(item.textContent).toContain('Structure S1 — variante retenue');
      expect(item.textContent).not.toContain(mnemo('ROADSENS', 1));
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

  describe('Panneau de détail PLEINE HAUTEUR (correction titulaire, maquette écran 2)', () => {
    // Le défaut corrigé : le panneau s'arrêtait à une hauteur dictée par son
    // contenu, laissant un grand vide sous un document court. Attendu : le
    // panneau occupe toute la hauteur disponible, SEUL le corps défile (pas
    // la page), et les actions restent ancrées en bas — jamais de hauteur en
    // dur ni de calc() fragile propre à ce composant (flex + min-height:0).
    it("given l'aperçu affiché (document capturé), when rendu, then le corps défile indépendamment (overflow auto, flex extensible) et les actions restent hors de cette zone (flex: none)", async () => {
      mockListCalcResults.mockResolvedValue([CALC]);
      mockGetCalcSnapshot.mockResolvedValue({
        displayHtml: '<p>Résultat affiché</p>',
        printHtml: '<html><body>Document imprimable</body></html>',
      });

      await renderCalculs();

      const body = container.querySelector(
        '[data-testid="calc-detail-body"]',
      ) as HTMLElement;
      const footer = container.querySelector(
        '[data-testid="calc-detail-footer"]',
      ) as HTMLElement;
      expect(body).not.toBeNull();
      expect(footer).not.toBeNull();

      // Le corps est la SEULE région qui défile — pas la page.
      expect(body.style.overflowY).toBe('auto');
      expect(body.style.minHeight).toBe('0px');

      // Les actions ne font PAS partie de la zone défilante, et restent
      // dimensionnées à leur contenu (jamais étirées/rognées). jsdom
      // normalise le mot-clé `flex: none` en sa forme longue équivalente.
      expect(footer.style.flexGrow).toBe('0');
      expect(footer.style.flexShrink).toBe('0');
      expect(body.contains(footer)).toBe(false);
      expect(footer.querySelector('button')).not.toBeNull();
      // Le document (iframe) est dans le corps, jamais dans les actions.
      expect(body.querySelector('[data-testid="calc-snapshot-frame"]')).not.toBeNull();
      expect(footer.querySelector('[data-testid="calc-snapshot-frame"]')).toBeNull();
    });

    it("given l'aperçu affiché, when rendu, then le DOCUMENT LUI-MÊME remplit la hauteur du corps (le panneau plein ne suffit pas si son contenu reste figé)", async () => {
      mockListCalcResults.mockResolvedValue([CALC]);
      mockGetCalcSnapshot.mockResolvedValue({
        displayHtml: '<p>Résultat affiché</p>',
        printHtml: '<html><body>Document imprimable</body></html>',
      });

      await renderCalculs();

      const body = container.querySelector(
        '[data-testid="calc-detail-body"]',
      ) as HTMLElement;
      const frame = container.querySelector(
        '[data-testid="calc-snapshot-frame"]',
      ) as HTMLElement;
      expect(body).not.toBeNull();
      expect(frame).not.toBeNull();

      // LE DÉFAUT VÉRIFIÉ EN CONDITIONS RÉELLES : le panneau était bien pleine
      // hauteur (604 px mesurés dans le navigateur), mais l'iframe du document
      // restait à sa hauteur figée de 420 px. Résultat : la note de calcul du
      // logiciel client coupée en plein milieu d'un critère, et 184 px de vide
      // en dessous — exactement le reproche d'origine, que le panneau plein
      // seul ne corrigeait pas.
      //
      // On ne peut PAS dimensionner l'iframe sur son contenu : `sandbox=""`
      // interdit tout script, donc rien ne peut mesurer le document depuis
      // l'intérieur et nous renvoyer sa hauteur. La remplir est la seule
      // option — elle défile alors en interne.
      expect(body.style.display).toBe('flex');
      expect(body.style.flexDirection).toBe('column');
      expect(frame.style.flexGrow).toBe('1');
      // Un plancher reste légitime (écran très court) ; ce qui est interdit,
      // c'est qu'il soit la SEULE règle de hauteur, comme c'était le cas.
      expect(frame.style.minHeight).toBe('420px');
    });

    it('given le panneau de détail, when rendu, then il se borne à la hauteur disponible (height: 100%, overflow: hidden) — jamais une hauteur dictée par le contenu', async () => {
      mockListCalcResults.mockResolvedValue([CALC]);
      mockGetCalcSnapshot.mockResolvedValue(null);

      await renderCalculs();

      const panel = container.querySelector('section') as HTMLElement;
      expect(panel.style.height).toBe('100%');
      expect(panel.style.overflow).toBe('hidden');

      const detail = container.querySelector(
        '[data-testid="calc-detail-panel"]',
      ) as HTMLElement;
      expect(detail.style.height).toBe('100%');
      expect(detail.style.minHeight).toBe('0px');
    });

    it("given l'historique des calculs, when rendu, then SEULE la liste défile (overflow auto) — l'en-tête (titre + bouton Nouveau calcul) reste hors de cette zone", async () => {
      mockListCalcResults.mockResolvedValue([CALC]);
      mockGetCalcSnapshot.mockResolvedValue(null);

      await renderCalculs();

      const scrollRegion = container.querySelector(
        '[data-testid="calculs-list-scroll"]',
      ) as HTMLElement;
      expect(scrollRegion.style.overflowY).toBe('auto');
      expect(scrollRegion.style.minHeight).toBe('0px');

      const nouveauCalculBtn = findButtonByText('Nouveau calcul')!;
      expect(scrollRegion.contains(nouveauCalculBtn)).toBe(false);

      const item = container.querySelector('li button') as HTMLButtonElement;
      expect(scrollRegion.contains(item)).toBe(true);
    });
  });

  describe('Trois verdicts, pas deux (correction titulaire) — CONFORME / NON CONFORME / NON APPLICABLE', () => {
    // Défaut corrigé : le code ne connaissait que deux verdicts et EXCLUAIT
    // explicitement NA (`verdict !== 'NA'`) — un calcul NON APPLICABLE (ex.
    // moteur d'extraction, pas de notion de conformité) n'affichait AUCUN
    // badge nulle part, ni dans la liste ni dans le panneau. Ce n'est pas un
    // échec rendu à tort, mais une information réelle disparue.
    const CALC_NA: CalcResult = {
      ...CALC,
      id: 'calc_na',
      engineId: 'fondation-geoplaque',
      output: { verdict: 'NA' },
    };

    it("given un calcul dont le verdict est NON APPLICABLE, when listé dans l'historique, then le badge NON APPLIC. est visible (pas masqué, pas confondu avec un échec)", async () => {
      mockListCalcResults.mockResolvedValue([CALC_NA]);
      mockGetCalcSnapshot.mockResolvedValue(null);

      await renderCalculs();

      const item = container.querySelector('li') as HTMLLIElement;
      expect(item.textContent).toContain('NON APPLIC.');
      expect(item.textContent).not.toContain('NON CONF.');
    });

    it("given un calcul avec un document capturé ET un verdict, when l'aperçu est affiché, then le verdict reste visible dans l'en-tête (avant correction : absent dès qu'un aperçu snapshot existait)", async () => {
      mockListCalcResults.mockResolvedValue([CALC]); // verdict PASS
      mockGetCalcSnapshot.mockResolvedValue({
        displayHtml: '<p>Résultat affiché</p>',
        printHtml: '<html><body>doc</body></html>',
      });

      await renderCalculs();

      const header = container.querySelector(
        '[data-testid="calc-detail-header"]',
      ) as HTMLElement;
      expect(header.textContent).toContain('CONFORME');
    });

    it('given un calcul SANS document capturé (repli métadonnées) et un verdict NON APPLICABLE, when affiché, then la ligne Verdict affiche NON APPLICABLE plutôt que de disparaître', async () => {
      mockListCalcResults.mockResolvedValue([CALC_NA]);
      mockGetCalcSnapshot.mockResolvedValue(null);

      await renderCalculs();

      expect(container.querySelector('dl')?.textContent).toContain('NON APPLICABLE');
    });
  });

  describe('Note de fidélité et de confidentialité (DoD §8) — engagement visible', () => {
    it("given l'aperçu affiché (document capturé), when rendu, then la note du panneau annonce que le rendu reproduit à l'identique le logiciel client et que le calcul est exécuté côté serveur", async () => {
      mockListCalcResults.mockResolvedValue([CALC]);
      mockGetCalcSnapshot.mockResolvedValue({
        displayHtml: '<p>Résultat affiché</p>',
        printHtml: '<html><body>doc</body></html>',
      });

      await renderCalculs();

      const footer = container.querySelector(
        '[data-testid="calc-detail-footer"]',
      ) as HTMLElement;
      expect(footer.textContent).toContain(
        "Rendu produit par le logiciel du client, reproduit à l'identique.",
      );
      expect(footer.textContent).toContain('Calcul exécuté côté serveur.');
    });
  });
});

// ---------------------------------------------------------------------------
// Renommage en ligne d'un calcul (patron rename-inline des projets, P0-7)
// ---------------------------------------------------------------------------

describe('CalculsClient — renommage en ligne (patron rename-inline)', () => {
  const champ = () =>
    container.querySelector<HTMLInputElement>('input[aria-label^="Renommer le calcul"]');
  const boutonRenommer = () =>
    container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Renommer le calcul"]',
    );

  function saisir(input: HTMLInputElement, valeur: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    setter.call(input, valeur);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('#1 GIVEN un calcul SANS nom personnalisé — WHEN on clique le crayon — THEN un champ pré-rempli du MNÉMONIQUE s’ouvre', async () => {
    mockListCalcResults.mockResolvedValue([CALC]);
    mockGetCalcSnapshot.mockResolvedValue(null);
    await renderCalculs();

    expect(boutonRenommer()).not.toBeNull();
    await act(async () => boutonRenommer()!.click());
    expect(champ()?.value).toBe(mnemo('ROADSENS', 1));
  });

  it('#2 GIVEN un nouveau nom — WHEN on valide (Entrée) — THEN renameCalcResult est appelé et la liste se met à jour SANS rechargement complet', async () => {
    mockListCalcResults.mockResolvedValue([CALC]);
    mockGetCalcSnapshot.mockResolvedValue(null);
    mockRenameCalcResult.mockResolvedValue({ ...CALC, name: 'Structure S1 — finale' });
    await renderCalculs();

    await act(async () => boutonRenommer()!.click());
    const input = champ()!;
    await act(async () => saisir(input, 'Structure S1 — finale'));
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await flush();

    expect(mockRenameCalcResult).toHaveBeenCalledWith(
      'org_01',
      'proj_01',
      'calc_01',
      'Structure S1 — finale',
    );
    expect(mockListCalcResults).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Structure S1 — finale');
  });

  it('#3 GIVEN une saisie VIDE — WHEN on valide — THEN renameCalcResult est appelé avec null (retour au mnémonique), PAS ignoré', async () => {
    const CALC_RENOMME = { ...CALC, name: 'Nom personnalisé' };
    mockListCalcResults.mockResolvedValue([CALC_RENOMME]);
    mockGetCalcSnapshot.mockResolvedValue(null);
    mockRenameCalcResult.mockResolvedValue(CALC);
    await renderCalculs();

    await act(async () => boutonRenommer()!.click());
    const input = champ()!;
    await act(async () => saisir(input, '   '));
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await flush();

    expect(mockRenameCalcResult).toHaveBeenCalledWith(
      'org_01',
      'proj_01',
      'calc_01',
      null,
    );
  });

  it('#3bis GIVEN un calcul DÉJÀ au mnémonique (pas de nom personnalisé) — WHEN on valide une saisie VIDE — THEN AUCUN appel API (rien à réinitialiser)', async () => {
    mockListCalcResults.mockResolvedValue([CALC]);
    mockGetCalcSnapshot.mockResolvedValue(null);
    await renderCalculs();

    await act(async () => boutonRenommer()!.click());
    const input = champ()!;
    await act(async () => saisir(input, ''));
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await flush();

    expect(mockRenameCalcResult).not.toHaveBeenCalled();
  });

  it('#4 GIVEN un nom IDENTIQUE au nom personnalisé actuel — WHEN on valide — THEN AUCUN appel API', async () => {
    const CALC_RENOMME = { ...CALC, name: 'Nom personnalisé' };
    mockListCalcResults.mockResolvedValue([CALC_RENOMME]);
    mockGetCalcSnapshot.mockResolvedValue(null);
    await renderCalculs();

    await act(async () => boutonRenommer()!.click());
    const input = champ()!;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await flush();

    expect(mockRenameCalcResult).not.toHaveBeenCalled();
  });

  it('#4bis GIVEN un calcul SANS nom — WHEN on ouvre le crayon et on valide sans rien modifier (Entrée) — THEN AUCUN appel API : le mnémonique ne se fige pas', async () => {
    // LE DÉFAUT (revue adverse) : le champ est pré-rempli avec le MNÉMONIQUE.
    // Valider sans modifier envoyait un PATCH qui le persistait comme nom
    // personnalisé. Le nom devenait alors MENTEUR — il ne suivait plus ni le
    // projet renommé ni le rang — et repassait en forme longue dans la colonne
    // étroite, ramenant la troncature que ce lot venait de corriger.
    mockListCalcResults.mockResolvedValue([CALC]); // name: null
    mockGetCalcSnapshot.mockResolvedValue(null);
    await renderCalculs();

    await act(async () => boutonRenommer()!.click());
    const input = champ()!;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await flush();

    expect(mockRenameCalcResult).not.toHaveBeenCalled();
  });

  it('#4ter GIVEN un calcul SANS nom — WHEN on ouvre le crayon et on clique AILLEURS (blur) — THEN AUCUN appel API', async () => {
    // Le blur est le geste le plus naturel pour abandonner une saisie : il ne
    // doit pas écrire ce que l'utilisateur n'a pas tapé. Échap ne peut pas être
    // le seul moyen d'annuler.
    mockListCalcResults.mockResolvedValue([CALC]);
    mockGetCalcSnapshot.mockResolvedValue(null);
    await renderCalculs();

    await act(async () => boutonRenommer()!.click());
    const input = champ()!;
    await act(async () => {
      input.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
    });
    await flush();

    expect(mockRenameCalcResult).not.toHaveBeenCalled();
  });

  it('#5 GIVEN un champ ouvert — WHEN Échap — THEN annulation SANS écriture', async () => {
    mockListCalcResults.mockResolvedValue([CALC]);
    mockGetCalcSnapshot.mockResolvedValue(null);
    await renderCalculs();

    await act(async () => boutonRenommer()!.click());
    const input = champ()!;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(mockRenameCalcResult).not.toHaveBeenCalled();
    expect(champ()).toBeNull();
    expect(container.textContent).toContain(mnemo('ROADSENS', 1));
  });

  it('#6 GIVEN un échec serveur — WHEN on valide — THEN le nom affiché revient à l’ancien (pas d’UI optimiste menteuse)', async () => {
    mockListCalcResults.mockResolvedValue([CALC]);
    mockGetCalcSnapshot.mockResolvedValue(null);
    mockRenameCalcResult.mockRejectedValue(new Error('boom'));
    await renderCalculs();

    await act(async () => boutonRenommer()!.click());
    const input = champ()!;
    await act(async () => saisir(input, 'Ne doit pas rester'));
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await flush();

    expect(container.textContent).toContain(mnemo('ROADSENS', 1));
    expect(container.textContent).not.toContain('Ne doit pas rester');
  });
});

// ---------------------------------------------------------------------------
// Suppression d'un calcul NON scellé (menu de la ligne)
// ---------------------------------------------------------------------------

describe('CalculsClient — suppression d’un calcul non scellé', () => {
  const boutonSupprimerListe = () =>
    container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Supprimer le calcul"]',
    );
  const boutonConfirmer = () =>
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === 'Supprimer définitivement',
    );

  it('GIVEN un calcul NON scellé — WHEN affiché — THEN le bouton Supprimer est proposé sur la ligne', async () => {
    mockListCalcResults.mockResolvedValue([CALC]);
    mockGetCalcSnapshot.mockResolvedValue(null);
    await renderCalculs();

    expect(boutonSupprimerListe()).not.toBeNull();
  });

  it("GIVEN un calcul portant un PV (scellé) — WHEN affiché — THEN AUCUN bouton Supprimer n'est proposé sur la ligne", async () => {
    mockListCalcResults.mockResolvedValue([CALC_SEALED]);
    mockGetCalcSnapshot.mockResolvedValue(null);
    await renderCalculs();

    expect(boutonSupprimerListe()).toBeNull();
  });

  it('GIVEN le bouton Supprimer — WHEN cliqué — THEN une modale de confirmation IRRÉVERSIBLE s’ouvre, deleteCalcResult n’est pas encore appelé', async () => {
    mockListCalcResults.mockResolvedValue([CALC]);
    mockGetCalcSnapshot.mockResolvedValue(null);
    await renderCalculs();

    await act(async () => boutonSupprimerListe()!.click());
    await flush();

    expect(document.body.textContent).toMatch(/irr[ée]versible/i);
    expect(mockDeleteCalcResult).not.toHaveBeenCalled();
  });

  it('GIVEN la modale de confirmation — WHEN on confirme — THEN deleteCalcResult est appelé et le calcul disparaît de la liste', async () => {
    mockListCalcResults.mockResolvedValue([CALC]);
    mockGetCalcSnapshot.mockResolvedValue(null);
    mockDeleteCalcResult.mockResolvedValue(undefined);
    await renderCalculs();

    await act(async () => boutonSupprimerListe()!.click());
    await flush();
    await act(async () => boutonConfirmer()!.click());
    await flush();

    expect(mockDeleteCalcResult).toHaveBeenCalledWith('org_01', 'proj_01', 'calc_01');
    expect(container.textContent).not.toContain(mnemo('ROADSENS', 1));
  });

  it('GIVEN un calcul portant malgré tout un PV côté serveur (409, concurrence) — WHEN on confirme — THEN un message exploitable s’affiche, le calcul reste dans la liste', async () => {
    mockListCalcResults.mockResolvedValue([CALC]);
    mockGetCalcSnapshot.mockResolvedValue(null);
    mockDeleteCalcResult.mockRejectedValue({
      statusCode: 409,
      reason: 'SERVER_ERROR',
      message: 'Ce calcul porte un PV scellé, il ne peut pas être supprimé.',
    });
    await renderCalculs();

    await act(async () => boutonSupprimerListe()!.click());
    await flush();
    await act(async () => boutonConfirmer()!.click());
    await flush();

    expect(document.body.textContent).toMatch(/PV scell/i);
    expect(container.textContent).toContain(mnemo('ROADSENS', 1));
  });
});

// ---------------------------------------------------------------------------
// Filtres par logiciel, recherche, pagination — écran 2 (maquette 21/07/2026,
// P1 dégelé). Ordre attendu de la chaîne : filtrer (chips + recherche) ->
// paginer. Chaque changement de filtre/recherche remet la page à 1 (DoD §9 —
// piège identifié : un simple bornage `min(page, totalPages)` masquerait un
// oubli de remise à 1 tant que le nouveau total de pages ne descend pas
// EN-DESSOUS de la page courante — cf. test de remise à 1 ci-dessous, construit
// pour distinguer les deux comportements).
// ---------------------------------------------------------------------------

function makeCalc(overrides: Partial<CalcResult> & { id: string }): CalcResult {
  return { ...CALC, label: overrides.id, ...overrides };
}

/**
 * Saisit une valeur dans un input contrôlé React en jsdom. Une simple
 * assignation `input.value = ...` ne déclenche pas le onChange React (le
 * tracker interne de React ne voit pas le changement) — même patron que
 * `toolbar.test.tsx` (recherche projets, écran 1).
 */
function saisir(input: HTMLInputElement, valeur: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )!.set!;
  setter.call(input, valeur);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('CalculsClient — filtres par logiciel (P1 dégelé)', () => {
  const CALC_PIEUX_1 = makeCalc({
    id: 'p1',
    engineId: 'fondation-profonde-pieux',
    pvId: 'pv_p1',
  });
  const CALC_PIEUX_2 = makeCalc({ id: 'p2', engineId: 'fondation-profonde-pieux' });
  const CALC_TERZ_1 = makeCalc({
    id: 't1',
    engineId: 'fondation-terzaghi',
    pvId: 'pv_t1',
  });
  const CALC_RADIER_1 = makeCalc({ id: 'r1', engineId: 'radier-plaque' });
  const MIXTE = [CALC_PIEUX_1, CALC_PIEUX_2, CALC_TERZ_1, CALC_RADIER_1];

  it("given des calculs de plusieurs logiciels, when rendu, then « Tous » porte l'effectif total et chaque logiciel présent porte son propre effectif — les logiciels ABSENTS restent affichés, désactivés (jamais masqués)", async () => {
    mockListCalcResults.mockResolvedValue(MIXTE);
    mockGetCalcSnapshot.mockResolvedValue(null);

    await renderCalculs();

    const chips = container.querySelectorAll(
      '[role="group"][aria-label*="logiciel"] button',
    );
    const tous = Array.from(chips).find((b) => b.textContent?.startsWith('Tous'));
    expect(tous?.textContent).toContain('4');
    expect(tous?.getAttribute('aria-pressed')).toBe('true');

    function chip(label: string): HTMLButtonElement {
      return Array.from(chips).find((b) =>
        b.textContent?.startsWith(label),
      ) as HTMLButtonElement;
    }

    expect(chip('CASAGRANDE').textContent).toContain('2');
    expect(chip('CASAGRANDE').disabled).toBe(false);
    expect(chip('Terzaghi').textContent).toContain('1');
    expect(chip('GEOPLAQUE').textContent).toContain('1');

    // Absents de la liste chargée : affichés mais désactivés, pas masqués.
    expect(chip('ROADSENS')).toBeTruthy();
    expect(chip('ROADSENS').textContent).toContain('0');
    expect(chip('ROADSENS').disabled).toBe(true);
    expect(chip('PressioPro')).toBeTruthy();
    expect(chip('PressioPro').textContent).toContain('0');
    expect(chip('PressioPro').disabled).toBe(true);
    expect(chip('FASTLAB').textContent).toContain('0');
    expect(chip('FASTLAB').disabled).toBe(true);

    // Non scellés : calc_02 (pieux) et r1 (radier) n'ont pas de pvId.
    expect(chip('Non scellés').textContent).toContain('2');
  });

  it('given les chips de logiciel, when on clique CASAGRANDE, then seuls les calculs de ce logiciel restent listés, et « Tous » redevient cliquable pour revenir', async () => {
    mockListCalcResults.mockResolvedValue(MIXTE);
    mockGetCalcSnapshot.mockResolvedValue(null);

    await renderCalculs();

    const chips = () =>
      Array.from(
        container.querySelectorAll('[role="group"][aria-label*="logiciel"] button'),
      ) as HTMLButtonElement[];
    const casagrande = chips().find((b) => b.textContent?.startsWith('CASAGRANDE'))!;

    await act(async () => {
      casagrande.click();
    });
    await flush();

    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(casagrande.getAttribute('aria-pressed')).toBe('true');
    const tousApres = chips().find((b) => b.textContent?.startsWith('Tous'))!;
    expect(tousApres.getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      tousApres.click();
    });
    await flush();

    expect(container.querySelectorAll('li')).toHaveLength(4);
  });

  it('given le chip « Non scellés », when cliqué, then seuls les calculs sans PV apparaissent', async () => {
    mockListCalcResults.mockResolvedValue(MIXTE);
    mockGetCalcSnapshot.mockResolvedValue(null);

    await renderCalculs();

    const nonScelles = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.startsWith('Non scellés'),
    ) as HTMLButtonElement;

    await act(async () => {
      nonScelles.click();
    });
    await flush();

    // Assertion scopée à la LISTE (pas au panneau de détail) : la sélection
    // par défaut (premier calcul chargé, p1) survit au changement de filtre
    // et reste affichée dans le panneau — ce n'est pas ce que ce test vérifie.
    const liste = container.querySelector(
      '[data-testid="calculs-list-scroll"]',
    ) as HTMLElement;
    expect(liste.querySelectorAll('li')).toHaveLength(2);
    expect(liste.textContent).not.toContain('p1');
    expect(liste.textContent).not.toContain('t1');
  });

  it('given un logiciel à effectif ZÉRO, when on clique dessus (bouton disabled), then rien ne se passe — le filtre reste sur « Tous »', async () => {
    mockListCalcResults.mockResolvedValue(MIXTE);
    mockGetCalcSnapshot.mockResolvedValue(null);

    await renderCalculs();

    const roadsens = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.startsWith('ROADSENS'),
    ) as HTMLButtonElement;

    await act(async () => {
      roadsens.click();
    });
    await flush();

    // disabled -> le clic natif n'a déclenché aucun handler ; la liste entière
    // reste affichée (pas de filtrage sur un logiciel à 0 calcul).
    expect(container.querySelectorAll('li')).toHaveLength(4);
  });
});

describe('CalculsClient — recherche (insensible casse + accents)', () => {
  const CALC_ETE = makeCalc({
    id: 'semelle-ete',
    engineId: 'fondation-terzaghi',
    label: 'Semelle — campagne d’été',
  });
  const CALC_HIVER = makeCalc({
    id: 'pieu-hiver',
    engineId: 'fondation-profonde-pieux',
    label: 'Pieu — campagne d’hiver',
  });

  it('given une recherche insensible à la casse et aux accents, when on tape « ete », then seul le calcul dont le libellé contient « été » reste affiché — en direct, sans validation', async () => {
    mockListCalcResults.mockResolvedValue([CALC_ETE, CALC_HIVER]);
    mockGetCalcSnapshot.mockResolvedValue(null);

    await renderCalculs();
    expect(container.querySelectorAll('li')).toHaveLength(2);

    const search = container.querySelector('input[type="search"]') as HTMLInputElement;
    expect(search).toBeTruthy();

    await act(async () => {
      saisir(search, 'ete');
    });
    await flush();

    expect(container.querySelectorAll('li')).toHaveLength(1);
    expect(container.textContent).toContain('été');
    expect(container.textContent).not.toContain('hiver');
  });

  it('given une recherche qui vise le nom du logiciel (pas le libellé), when on tape « casagrande », then les calculs CASAGRANDE ressortent', async () => {
    mockListCalcResults.mockResolvedValue([
      CALC_HIVER, // pieux -> CASAGRANDE
      CALC_ETE, // terzaghi
    ]);
    mockGetCalcSnapshot.mockResolvedValue(null);

    await renderCalculs();

    const search = container.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      saisir(search, 'CASAGRANDE');
    });
    await flush();

    expect(container.querySelectorAll('li')).toHaveLength(1);
    expect(container.textContent).toContain(CALC_HIVER.label);
  });

  it("given une recherche sans aucune correspondance, when tapée, then un message d'absence de résultat s'affiche (pas l'état vide « aucun calcul »)", async () => {
    mockListCalcResults.mockResolvedValue([CALC_ETE]);
    mockGetCalcSnapshot.mockResolvedValue(null);

    await renderCalculs();

    const search = container.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      saisir(search, 'zzz-introuvable');
    });
    await flush();

    expect(container.querySelectorAll('li')).toHaveLength(0);
    expect(container.textContent).toContain('Aucun calcul ne correspond');
  });

  it('given une recherche qui vise le NOM PERSONNALISÉ d’un calcul renommé, when tapée, then ce calcul ressort (recherche étendue au nom d’affichage)', async () => {
    const CALC_RENOMME = makeCalc({
      id: 'calc-renomme',
      engineId: 'chaussee-burmister',
      name: 'Variante définitive validée client',
    });
    mockListCalcResults.mockResolvedValue([CALC_ETE, CALC_RENOMME]);
    mockGetCalcSnapshot.mockResolvedValue(null);

    await renderCalculs();
    const search = container.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      saisir(search, 'définitive validée');
    });
    await flush();

    expect(container.querySelectorAll('li')).toHaveLength(1);
    expect(container.textContent).toContain('Variante définitive validée client');
  });

  it('given une recherche qui vise le MNÉMONIQUE calculé (nom de projet), when tapée, then le calcul SANS nom personnalisé ressort aussi', async () => {
    mockListCalcResults.mockResolvedValue([CALC_ETE, CALC_HIVER]);
    mockGetCalcSnapshot.mockResolvedValue(null);

    await renderCalculs();
    const search = container.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      // PROJECT.name = 'RN2 — PK45' : recherche sur un fragment du mnémonique.
      saisir(search, 'PK45');
    });
    await flush();

    // Les deux calculs (aucun n'a de nom personnalisé) partagent le même nom
    // de projet dans leur mnémonique — les deux ressortent.
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });
});

describe('CalculsClient — pagination client (~12/page)', () => {
  const TREIZE_PIEUX: CalcResult[] = Array.from({ length: 13 }, (_, i) =>
    makeCalc({
      id: `pieu-${String(i).padStart(2, '0')}`,
      engineId: 'fondation-profonde-pieux',
    }),
  );

  it('given plus de 12 calculs, when rendu, then seuls les 12 premiers apparaissent et un indicateur de pagination affiche « Page 1 sur 2 », Précédent désactivé', async () => {
    mockListCalcResults.mockResolvedValue(TREIZE_PIEUX);
    mockGetCalcSnapshot.mockResolvedValue(null);

    await renderCalculs();

    expect(container.querySelectorAll('li')).toHaveLength(12);
    const pageStatus = container.querySelector('[role="status"]');
    expect(pageStatus?.textContent).toContain('1');
    expect(pageStatus?.textContent).toContain('2');

    const precedent = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Précédent'),
    ) as HTMLButtonElement;
    expect(precedent.disabled).toBe(true);
  });

  it('given la page 1, when on clique Suivant, then la page 2 affiche le calcul restant et Suivant devient désactivé', async () => {
    mockListCalcResults.mockResolvedValue(TREIZE_PIEUX);
    mockGetCalcSnapshot.mockResolvedValue(null);

    await renderCalculs();

    const suivant = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Suivant'),
    ) as HTMLButtonElement;

    await act(async () => {
      suivant.click();
    });
    await flush();

    expect(container.querySelectorAll('li')).toHaveLength(1);
    expect(container.textContent).toContain('pieu-12');
    expect(suivant.disabled).toBe(true);
  });

  it('given 12 calculs ou moins, when rendu, then AUCUN contrôle de pagination ne s’affiche', async () => {
    mockListCalcResults.mockResolvedValue(TREIZE_PIEUX.slice(0, 3));
    mockGetCalcSnapshot.mockResolvedValue(null);

    await renderCalculs();

    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(
      Array.from(container.querySelectorAll('button')).some((b) =>
        b.textContent?.includes('Suivant'),
      ),
    ).toBe(false);
  });

  it("given un changement de filtre alors qu'on est sur la page 2, when le filtre est appliqué, then la pagination REPART à la page 1 (pas un simple bornage qui laisserait la page 2)", async () => {
    // 13 pieux + 1 terzaghi = 14 (page 1 = 12 pieux, page 2 = 1 pieux + 1 terzaghi).
    const terzaghi = makeCalc({ id: 'terzaghi-seul', engineId: 'fondation-terzaghi' });
    mockListCalcResults.mockResolvedValue([...TREIZE_PIEUX, terzaghi]);
    mockGetCalcSnapshot.mockResolvedValue(null);

    await renderCalculs();

    const suivant = () =>
      Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Suivant'),
      ) as HTMLButtonElement;
    await act(async () => {
      suivant().click();
    });
    await flush();
    // Sur la page 2 : le pieu restant + le calcul terzaghi.
    expect(container.querySelectorAll('li')).toHaveLength(2);

    const casagrande = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.startsWith('CASAGRANDE'),
    ) as HTMLButtonElement;
    await act(async () => {
      casagrande.click();
    });
    await flush();

    // Filtré sur CASAGRANDE : 13 pieux, 2 pages. Si la page n'était pas remise
    // à 1, le bornage seul (min(2, 2)) laisserait la page 2 (1 seul résultat) :
    // ce test échouerait alors avec 1 <li>, pas 12.
    expect(container.querySelectorAll('li')).toHaveLength(12);
    const pageStatus = container.querySelector('[role="status"]');
    expect(pageStatus?.textContent).toContain('1');
  });

  it('given une sélection sur la page 1, when on change de page, then le panneau de détail conserve le calcul sélectionné (la sélection traverse la pagination)', async () => {
    mockListCalcResults.mockResolvedValue(TREIZE_PIEUX);
    mockGetCalcSnapshot.mockResolvedValue(null);

    await renderCalculs();

    // Sélectionne le dernier élément de la page 1 (pieu-11), différent du
    // premier sélectionné par défaut (pieu-00). Sélecteur d'enfant DIRECT
    // (`li > button`) : les boutons crayon/corbeille de chaque ligne sont
    // aussi des <button>, mais des SIBLINGS du bouton de sélection, jamais
    // des enfants imbriqués — `li button` (descendant) les compterait aussi
    // et décalerait l'index.
    const items = Array.from(container.querySelectorAll('li > button'));
    await act(async () => {
      (items[11] as HTMLButtonElement).click();
    });
    await flush();

    const heading = container.querySelector('section h2 + div') as HTMLElement;
    expect(heading.textContent).toContain('pieu-11');

    const suivant = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Suivant'),
    ) as HTMLButtonElement;
    await act(async () => {
      suivant.click();
    });
    await flush();

    // Toujours le même calcul dans le panneau, alors que pieu-11 n'est plus
    // dans la liste visible (page 2 ne montre que pieu-12).
    expect(container.querySelectorAll('li')).toHaveLength(1);
    const headingApres = container.querySelector('section h2 + div') as HTMLElement;
    expect(headingApres.textContent).toContain('pieu-11');
  });
});
