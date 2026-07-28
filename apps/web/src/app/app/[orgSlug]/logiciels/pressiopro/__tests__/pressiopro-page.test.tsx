/**
 * Tests — shell GEOFAM de la page PressioPro (clone UI client, ADR 0015).
 *
 * DoD §9 : given/when/then, chemins négatifs (gate bloqué, erreur d'émission
 * PV) testés autant que le chemin heureux. `ToolFrame` est mocké ici — sa
 * boucle de bridge (dont la logique `engineAllowlist` multi-engine) est
 * testée en isolation dans `lib/tool-bridge/__tests__/ToolFrame.test.tsx` ;
 * ce fichier ne couvre QUE le câblage du shell (projet, gate, bouton PV
 * branché sur le dernier calcResultId remonté par ToolFrame, quel que soit
 * le mode qui l'a produit) + le fait que le shell transmet bien la liste
 * fermée des 3 engineId multi-engine à ToolFrame (patron geoplaque-page.test.tsx
 * — PressioPro a, comme GEOPLAQUE, plusieurs moteurs internes : dépouillement/
 * étalonnage/calibrage).
 *
 * Patron d'interaction : react-dom/client + act (pas de @testing-library/react
 * dans ce dépôt — cf. terzaghi-page.test.tsx / roadsens-page.test.tsx).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockListProjects,
  mockGetEntitlements,
  mockEmitPv,
  mockDownloadPvPdf,
  mockCreateProject,
} = vi.hoisted(() => ({
  mockListProjects: vi.fn(),
  mockGetEntitlements: vi.fn(),
  mockEmitPv: vi.fn(),
  mockDownloadPvPdf: vi.fn(),
  mockCreateProject: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'be-routes-dakar' }),
}));

vi.mock('@/lib/api/client', () => ({
  listProjects: mockListProjects,
  getEntitlements: mockGetEntitlements,
  emitPv: mockEmitPv,
  downloadPvPdf: mockDownloadPvPdf,
  createProject: mockCreateProject,
  getStoredToken: () => 'token-abc',
}));

// Stub — la boucle de bridge (ready/init/calc/store/pv, dont le comportement
// engineAllowlist) est testée dans lib/tool-bridge/__tests__/ToolFrame.test.tsx.
// Ici on vérifie seulement le câblage : props reçues (dont engineAllowlist) +
// remontée de calcResultId au shell, quel que soit le mode déclarant.
// Comme le vrai ToolFrame, un « calcul terminé » émet onCalcResultId PUIS
// onSnapshotStatus('awaiting') ; la capture (note option-3) se résout ensuite
// ('confirmed'/'failed'). Le bouton PV attend cette résolution (gate captureReady,
// patron roadsens/fastlab/casagrande). Chaque mode PressioPro a son propre calcResultId.
vi.mock('@/lib/tool-bridge/ToolFrame', () => {
  type SnapEvt = { calcResultId: string; status: string };
  const MODES: Array<[string, string]> = [
    ['depouillement', 'calc_depouillement'],
    ['etalonnage', 'calc_etalonnage'],
    ['calibrage', 'calc_calibrage'],
  ];
  return {
    ToolFrame: (props: {
      toolId: string;
      engineId: string;
      engineAllowlist?: string[];
      orgId: string | null;
      orgSlug: string;
      projectId: string | null;
      projectLabel: string;
      accessToken: string | null;
      onCalcResultId?: (id: string | null) => void;
      onSnapshotStatus?: (event: SnapEvt) => void;
    }) => (
      <div data-testid="tool-frame-stub" data-props={JSON.stringify(props)}>
        {MODES.map(([mode, id]) => (
          <div key={mode}>
            <button
              type="button"
              data-testid={`simulate-calc-${mode}`}
              onClick={() => {
                props.onCalcResultId?.(id);
                props.onSnapshotStatus?.({ calcResultId: id, status: 'awaiting' });
              }}
            >
              Simuler calcul {mode} terminé
            </button>
            <button
              type="button"
              data-testid={`simulate-capture-confirmed-${mode}`}
              onClick={() =>
                props.onSnapshotStatus?.({ calcResultId: id, status: 'confirmed' })
              }
            >
              Simuler capture {mode} confirmée
            </button>
            <button
              type="button"
              data-testid={`simulate-capture-failed-${mode}`}
              onClick={() =>
                props.onSnapshotStatus?.({ calcResultId: id, status: 'failed' })
              }
            >
              Simuler capture {mode} en échec
            </button>
          </div>
        ))}
      </div>
    ),
  };
});

import PressioProPage from '../page';

const PROJECT = {
  id: 'proj_lb_01',
  orgId: 'org_01',
  name: 'Sondage SP1',
  domain: 'LB' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'u1',
};

function entitlements(
  overrides: Partial<{
    modules: string[];
    expired: boolean;
    quota: { limit: number; used: number; remaining: number };
  }> = {},
) {
  return {
    orgId: 'org_01',
    pack: 'COMPLETE' as const,
    modules: overrides.modules ?? ['pressiometre'],
    expiresAt: '2027-01-01T00:00:00.000Z',
    expired: overrides.expired ?? false,
    quota: overrides.quota ?? { limit: 500, used: 100, remaining: 400 },
    serverTime: '2026-07-16T00:00:00.000Z',
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  mockListProjects.mockReset().mockResolvedValue([PROJECT]);
  mockGetEntitlements.mockReset().mockResolvedValue(entitlements());
  mockEmitPv.mockReset();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container.remove();
});

async function renderPage() {
  await act(async () => {
    root = createRoot(container);
    root.render(<PressioProPage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('Page PressioPro — shell GEOFAM', () => {
  it('given un seul projet LB, when montage, then le projet est présélectionné et ToolFrame reçoit le contexte projet (toolId pressiopro, engineId pressiometre, engineAllowlist des 3 modes)', async () => {
    await renderPage();
    const stub = container.querySelector('[data-testid="tool-frame-stub"]');
    expect(stub).not.toBeNull();
    const props = JSON.parse(stub!.getAttribute('data-props')!);
    expect(props).toMatchObject({
      toolId: 'pressiopro',
      engineId: 'pressiometre',
      engineAllowlist: ['pressiometre', 'pressio-etalonnage', 'pressio-calibrage'],
      projectId: 'proj_lb_01',
      projectLabel: 'Sondage SP1',
      accessToken: 'token-abc',
    });
  });

  it('given des projets LB, LEGACY(null) et FD, when montage, then le picker montre LB + legacy et EXCLUT le FD', async () => {
    // Même règle que terzaghi/roadsens/geoplaque/fastlab/casagrande (bug swap
    // mock->réel) : le filtre retient le domaine du logiciel (LB) OU un
    // domaine null (projet legacy, domaine inconnu -> sélectionnable partout
    // plutôt qu'invisible partout), et écarte un domaine explicitement autre (FD).
    mockListProjects.mockResolvedValue([
      { ...PROJECT, id: 'p_lb', name: 'Sondage LB', domain: 'LB' },
      { ...PROJECT, id: 'p_legacy', name: 'Projet legacy', domain: null },
      { ...PROJECT, id: 'p_fd', name: 'Fondation FD', domain: 'FD' },
    ]);
    await renderPage();
    const select = container.querySelector(
      'select[aria-label="Projet"]',
    ) as HTMLSelectElement;
    expect(select).not.toBeNull();
    const labels = Array.from(select.querySelectorAll('option')).map(
      (o) => o.textContent,
    );
    expect(labels).toContain('Sondage LB');
    expect(labels).toContain('Projet legacy');
    expect(labels).not.toContain('Fondation FD');
  });

  it('given aucun projet sélectionné (liste vide), when montage, then ToolFrame est AFFICHÉ quand même (fidélité UI, projectId null, engineAllowlist toujours transmise) et le bandeau montre un hint discret', async () => {
    // Correction UX 17/07 : l'outil client s'affiche dès l'ouverture, que la
    // sélection de projet ait eu lieu ou non (elle ne conditionne QUE le
    // calcul/PV) — le placeholder qui masquait l'outil a disparu.
    mockListProjects.mockResolvedValue([]);
    await renderPage();
    const stub = container.querySelector('[data-testid="tool-frame-stub"]');
    expect(stub).not.toBeNull();
    const props = JSON.parse(stub!.getAttribute('data-props')!);
    expect(props.projectId).toBeNull();
    expect(props.engineAllowlist).toEqual([
      'pressiometre',
      'pressio-etalonnage',
      'pressio-calibrage',
    ]);
    expect(container.textContent).not.toMatch(
      /Sélectionnez ou créez un projet pour ouvrir/,
    );
    const hint = container.querySelector('[data-testid="no-project-hint"]');
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toMatch(
      /Sélectionnez un projet pour calculer et émettre un PV/,
    );
  });

  it('given un projet sélectionné, when rendu, then le hint de sélection de projet est ABSENT du bandeau', async () => {
    await renderPage();
    expect(container.querySelector('[data-testid="no-project-hint"]')).toBeNull();
  });

  it('given le bouton "Émettre le PV" n\'a pas encore de calcul, when rendu, then il est désactivé', async () => {
    await renderPage();
    const btn = container.querySelector(
      '[data-testid="btn-emettre-pv"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it.each([
    ['dépouillement', 'depouillement'],
    ['étalonnage', 'etalonnage'],
    ['calibrage', 'calibrage'],
  ])(
    "given ToolFrame remonte un calcResultId produit par le mode %s, when le calcul est terminé PUIS la capture confirmée, then le bouton PV s'active (quel que soit le mode PressioPro d'origine)",
    async (_mode, slug) => {
      await renderPage();
      const btn = () =>
        container.querySelector('[data-testid="btn-emettre-pv"]') as HTMLButtonElement;
      // 1. Calcul terminé (calcResultId + capture 'awaiting') : PV encore DÉSACTIVÉ
      //    (gate captureReady — on ne scelle pas un PV sans note capturée).
      await act(async () => {
        (
          container.querySelector(
            `[data-testid="simulate-calc-${slug}"]`,
          ) as HTMLButtonElement
        ).click();
      });
      expect(btn().disabled, 'PV activé AVANT résolution de la capture (gate KO)').toBe(
        true,
      );
      // 2. Capture confirmée : le PV s'active.
      await act(async () => {
        (
          container.querySelector(
            `[data-testid="simulate-capture-confirmed-${slug}"]`,
          ) as HTMLButtonElement
        ).click();
      });
      expect(btn().disabled).toBe(false);
    },
  );

  it('given un calcul terminé mais capture NON résolue (awaiting), when rendu, then le bouton PV reste DÉSACTIVÉ (gate captureReady)', async () => {
    await renderPage();
    await act(async () => {
      (
        container.querySelector(
          '[data-testid="simulate-calc-depouillement"]',
        ) as HTMLButtonElement
      ).click();
    });
    const btn = container.querySelector(
      '[data-testid="btn-emettre-pv"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toMatch(/Capture du document/);
  });

  it('given une capture en ÉCHEC, when 1er clic sur émettre, then avertissement affiché ; 2e clic (confirmer), then emitPv appelé (émission sans document assumée)', async () => {
    mockEmitPv.mockResolvedValue({
      id: 'pv_x',
      number: 'PV-2026-0099',
      orgId: 'org_01',
      projectId: 'proj_lb_01',
      calcResultId: 'calc_depouillement',
      engineId: 'pressiometre',
      hmacTruncated: 'ffff0000',
      sealedAt: '2026-07-16T10:00:00.000Z',
      sealedBy: 'Amadou Diallo',
    });
    await renderPage();
    await act(async () => {
      (
        container.querySelector(
          '[data-testid="simulate-calc-depouillement"]',
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        container.querySelector(
          '[data-testid="simulate-capture-failed-depouillement"]',
        ) as HTMLButtonElement
      ).click();
    });
    const btn = () =>
      container.querySelector('[data-testid="btn-emettre-pv"]') as HTMLButtonElement;
    // 1er clic : avertissement, PAS d'appel emitPv.
    await act(async () => {
      btn().click();
    });
    expect(
      container.querySelector('[data-testid="capture-failed-warning"]'),
      'avertissement absent après le 1er clic sur capture en échec',
    ).not.toBeNull();
    expect(mockEmitPv).not.toHaveBeenCalled();
    // 2e clic : confirmation -> emitPv appelé.
    await act(async () => {
      btn().click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockEmitPv).toHaveBeenCalledTimes(1);
  });

  it('given un calcul terminé (mode étalonnage), when "Émettre le PV" cliqué et emitPv résout, then le PV scellé est affiché', async () => {
    mockEmitPv.mockResolvedValue({
      id: 'pv_01',
      number: 'PV-2026-0021',
      orgId: 'org_01',
      projectId: 'proj_lb_01',
      calcResultId: 'calc_etalonnage',
      engineId: 'pressiometre',
      hmacTruncated: 'a1b2c3d4',
      sealedAt: '2026-07-16T10:00:00.000Z',
      sealedBy: 'Amadou Diallo',
      params: {},
      output: null,
    });
    await renderPage();
    await act(async () => {
      (
        container.querySelector(
          '[data-testid="simulate-calc-etalonnage"]',
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        container.querySelector(
          '[data-testid="simulate-capture-confirmed-etalonnage"]',
        ) as HTMLButtonElement
      ).click();
    });
    const btn = container.querySelector(
      '[data-testid="btn-emettre-pv"]',
    ) as HTMLButtonElement;
    await act(async () => {
      btn.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockEmitPv).toHaveBeenCalledWith('org_01', 'proj_lb_01', {
      calcResultId: 'calc_etalonnage',
    });
    expect(container.textContent).toMatch(/PV-2026-0021/);
  });

  it('given emitPv échoue, when "Émettre le PV" cliqué, then un message d\'erreur explicite est affiché', async () => {
    mockEmitPv.mockRejectedValue({ message: 'Quota épuisé.' });
    await renderPage();
    await act(async () => {
      (
        container.querySelector(
          '[data-testid="simulate-calc-depouillement"]',
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        container.querySelector(
          '[data-testid="simulate-capture-confirmed-depouillement"]',
        ) as HTMLButtonElement
      ).click();
    });
    const btn = container.querySelector(
      '[data-testid="btn-emettre-pv"]',
    ) as HTMLButtonElement;
    await act(async () => {
      btn.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(
      /Quota épuisé/,
    );
  });

  it("given le module pressiometre n'est PAS inclus dans l'abonnement, when montage, then la bannière de gate est affichée (gate unique pour les 3 modes)", async () => {
    mockGetEntitlements.mockResolvedValue(entitlements({ modules: ['terzaghi'] }));
    await renderPage();
    const banner = container.querySelector('[data-testid="gate-banner"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toMatch(/non inclus/i);
  });

  it("given un abonnement actif AVEC le module pressiometre, when montage, then aucune bannière de gate n'est affichée", async () => {
    await renderPage();
    expect(container.querySelector('[data-testid="gate-banner"]')).toBeNull();
  });
});
