/**
 * Tests — shell GEOFAM de la page ROADSENS (clone UI client, ADR 0015).
 *
 * DoD §9 : given/when/then, chemins négatifs (gate bloqué, erreur d'émission
 * PV) testés autant que le chemin heureux. `ToolFrame` est mocké ici — sa
 * boucle de bridge est testée en isolation dans
 * `lib/tool-bridge/__tests__/ToolFrame.test.tsx` ; ce fichier ne couvre QUE
 * le câblage du shell (projet, gate, bouton PV branché sur le dernier
 * calcResultId ET le statut de capture remontés par ToolFrame).
 *
 * M3 (revue adverse, chemin primaire) : le bouton « Émettre le PV scellé » ne
 * s'active plus sur le seul `onCalcResultId` — il attend `onSnapshotStatus`
 * ('confirmed' ou 'failed'). Le stub ToolFrame expose donc trois déclencheurs
 * distincts (calcul terminé / capture confirmée / capture en échec) pour
 * reproduire fidèlement les transitions réelles de `ToolFrame`.
 *
 * Patron d'interaction : react-dom/client + act (pas de @testing-library/react
 * dans ce dépôt — cf. terzaghi-page.test.tsx / PvEmittedActions.test.tsx).
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

// Stub — la boucle de bridge (ready/init/calc/store/pv/snapshot) est testée
// dans lib/tool-bridge/__tests__/ToolFrame.test.tsx. Ici on vérifie seulement
// le câblage : props reçues + remontée de calcResultId ET de statut de
// capture au shell (M3, revue adverse — trois déclencheurs distincts pour
// reproduire les transitions réelles awaiting→capturing→confirmed/failed).
vi.mock('@/lib/tool-bridge/ToolFrame', () => ({
  ToolFrame: (props: {
    toolId: string;
    engineId: string;
    orgId: string | null;
    orgSlug: string;
    projectId: string | null;
    projectLabel: string;
    accessToken: string | null;
    onCalcResultId?: (id: string | null) => void;
    onSnapshotStatus?: (event: { calcResultId: string; status: string }) => void;
  }) => (
    <div data-testid="tool-frame-stub" data-props={JSON.stringify(props)}>
      <button
        type="button"
        data-testid="simulate-calc-done"
        onClick={() => {
          props.onCalcResultId?.('calc_42');
          // ToolFrame réel émet TOUJOURS 'awaiting' juste après calc:response
          // (avant même que snapshot:capture n'arrive) — cf. ToolFrame.tsx.
          props.onSnapshotStatus?.({ calcResultId: 'calc_42', status: 'awaiting' });
        }}
      >
        Simuler calcul terminé
      </button>
      <button
        type="button"
        data-testid="simulate-capture-confirmed"
        onClick={() =>
          props.onSnapshotStatus?.({ calcResultId: 'calc_42', status: 'confirmed' })
        }
      >
        Simuler capture confirmée
      </button>
      <button
        type="button"
        data-testid="simulate-capture-failed"
        onClick={() =>
          props.onSnapshotStatus?.({ calcResultId: 'calc_42', status: 'failed' })
        }
      >
        Simuler capture en échec
      </button>
    </div>
  ),
}));

import RoadsensPage from '../page';

const PROJECT = {
  id: 'proj_ch_01',
  orgId: 'org_01',
  name: 'Route A12',
  domain: 'CH' as const,
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
    modules: overrides.modules ?? ['burmister'],
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
    root.render(<RoadsensPage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('Page ROADSENS — shell GEOFAM', () => {
  it('given un seul projet CH, when montage, then le projet est présélectionné et ToolFrame reçoit le contexte projet (toolId roadsens, engineId burmister)', async () => {
    await renderPage();
    const stub = container.querySelector('[data-testid="tool-frame-stub"]');
    expect(stub).not.toBeNull();
    const props = JSON.parse(stub!.getAttribute('data-props')!);
    expect(props).toMatchObject({
      toolId: 'roadsens',
      engineId: 'burmister',
      projectId: 'proj_ch_01',
      projectLabel: 'Route A12',
      accessToken: 'token-abc',
    });
  });

  it('given des projets CH, LEGACY(null) et FD, when montage, then le picker montre CH + legacy et EXCLUT le FD', async () => {
    // Même règle que terzaghi (bug swap mock->réel) : le filtre retient le
    // domaine du logiciel (CH) OU un domaine null (projet legacy, domaine
    // inconnu -> sélectionnable partout plutôt qu'invisible partout), et
    // écarte un domaine explicitement autre (FD).
    mockListProjects.mockResolvedValue([
      { ...PROJECT, id: 'p_ch', name: 'Route CH', domain: 'CH' },
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
    expect(labels).toContain('Route CH');
    expect(labels).toContain('Projet legacy');
    expect(labels).not.toContain('Fondation FD');
  });

  it('given aucun projet sélectionné (liste vide), when montage, then ToolFrame est AFFICHÉ quand même (fidélité UI, projectId null) et le bandeau montre un hint discret', async () => {
    // Correction UX 17/07 : l'outil client s'affiche dès l'ouverture, que la
    // sélection de projet ait eu lieu ou non (elle ne conditionne QUE le
    // calcul/PV) — le placeholder qui masquait l'outil a disparu.
    mockListProjects.mockResolvedValue([]);
    await renderPage();
    const stub = container.querySelector('[data-testid="tool-frame-stub"]');
    expect(stub).not.toBeNull();
    const props = JSON.parse(stub!.getAttribute('data-props')!);
    expect(props.projectId).toBeNull();
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

  // M3 (revue adverse, chemin primaire) — la course calcul-terminé vs
  // capture-encore-en-vol : le bouton ne s'active PAS sur le seul
  // calcResultId, il attend la confirmation de capture.
  it('given ToolFrame remonte un calcResultId SANS capture confirmée, when le calcul est "terminé", then le bouton PV reste DÉSACTIVÉ (en attente de la capture)', async () => {
    await renderPage();
    const simulate = container.querySelector(
      '[data-testid="simulate-calc-done"]',
    ) as HTMLButtonElement;
    await act(async () => {
      simulate.click();
    });
    const btn = container.querySelector(
      '[data-testid="btn-emettre-pv"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toMatch(/Capture du document/);
  });

  it("given un calcul terminé, when la capture du document est CONFIRMÉE, then le bouton PV s'active", async () => {
    await renderPage();
    await act(async () => {
      (
        container.querySelector('[data-testid="simulate-calc-done"]') as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        container.querySelector(
          '[data-testid="simulate-capture-confirmed"]',
        ) as HTMLButtonElement
      ).click();
    });
    const btn = container.querySelector(
      '[data-testid="btn-emettre-pv"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toMatch(/Émettre le PV scellé/);
  });

  it("given un calcul terminé et la capture CONFIRMÉE, when \"Émettre le PV\" cliqué et emitPv résout avec documentFormat='html', then la bannière annonce le document de l'outil scellé", async () => {
    mockEmitPv.mockResolvedValue({
      id: 'pv_01',
      number: 'PV-2026-0007',
      orgId: 'org_01',
      projectId: 'proj_ch_01',
      calcResultId: 'calc_42',
      engineId: 'burmister',
      hmacTruncated: 'a1b2c3d4',
      sealedAt: '2026-07-16T10:00:00.000Z',
      sealedBy: 'Amadou Diallo',
      params: {},
      output: null,
      documentFormat: 'html',
    });
    await renderPage();
    await act(async () => {
      (
        container.querySelector('[data-testid="simulate-calc-done"]') as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        container.querySelector(
          '[data-testid="simulate-capture-confirmed"]',
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
    expect(mockEmitPv).toHaveBeenCalledWith('org_01', 'proj_ch_01', {
      calcResultId: 'calc_42',
    });
    expect(container.textContent).toMatch(/PV-2026-0007/);
    const banner = container.querySelector('[data-testid="pv-success-banner"]');
    expect(banner!.textContent).toMatch(/document de l.outil scellé/i);
    // Wording honnête (décision titulaire M2 + revue adverse) : jamais
    // « garanti » ni « au mm près » — la portée réelle du sceau est
    // l'intégrité post-scellement, pas une preuve des valeurs affichées.
    expect(banner!.textContent).not.toMatch(/garanti/i);
    expect(banner!.textContent).not.toMatch(/mm près/i);
  });

  it('given un calcul terminé et la capture CONFIRMÉE, when emitPv résout avec documentFormat=null (repli backend), then la bannière annonce le format standard SANS jamais dire « garantis » sur le document', async () => {
    mockEmitPv.mockResolvedValue({
      id: 'pv_02',
      number: 'PV-2026-0008',
      orgId: 'org_01',
      projectId: 'proj_ch_01',
      calcResultId: 'calc_42',
      engineId: 'burmister',
      hmacTruncated: 'b2c3d4e5',
      sealedAt: '2026-07-16T10:05:00.000Z',
      sealedBy: 'Amadou Diallo',
      params: {},
      output: null,
      documentFormat: null,
    });
    await renderPage();
    await act(async () => {
      (
        container.querySelector('[data-testid="simulate-calc-done"]') as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        container.querySelector(
          '[data-testid="simulate-capture-confirmed"]',
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        container.querySelector('[data-testid="btn-emettre-pv"]') as HTMLButtonElement
      ).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const banner = container.querySelector('[data-testid="pv-success-banner"]');
    expect(banner!.textContent).toMatch(/format standard/i);
    expect(banner!.textContent).not.toMatch(/document de l.outil scellé/i);
    expect(banner!.textContent).not.toMatch(/garantis/i);
  });

  it("given un calcul terminé et la capture CONFIRMÉE, when emitPv échoue, then un message d'erreur explicite est affiché", async () => {
    mockEmitPv.mockRejectedValue({ message: 'Quota épuisé.' });
    await renderPage();
    await act(async () => {
      (
        container.querySelector('[data-testid="simulate-calc-done"]') as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        container.querySelector(
          '[data-testid="simulate-capture-confirmed"]',
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

  // M3 — capture en ÉCHEC définitif : jamais un scellement silencieux.
  it("given la capture du document ÉCHOUE définitivement, when le calcul est terminé, then le bouton PV s'active mais un clic affiche l'avertissement SANS appeler emitPv", async () => {
    await renderPage();
    await act(async () => {
      (
        container.querySelector('[data-testid="simulate-calc-done"]') as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        container.querySelector(
          '[data-testid="simulate-capture-failed"]',
        ) as HTMLButtonElement
      ).click();
    });
    const btn = container.querySelector(
      '[data-testid="btn-emettre-pv"]',
    ) as HTMLButtonElement;
    // 'failed' est un statut RÉSOLU (captureReady) → le bouton n'est plus grisé
    // en attente, mais il ne scelle jamais en un clic silencieux.
    expect(btn.disabled).toBe(false);

    await act(async () => {
      btn.click();
    });

    expect(mockEmitPv).not.toHaveBeenCalled();
    const warning = container.querySelector('[data-testid="capture-failed-warning"]');
    expect(warning).not.toBeNull();
    expect(warning!.textContent).toMatch(/n.a pas pu être capturé/);
    expect(
      container.querySelector('[data-testid="btn-emettre-pv"]')!.textContent,
    ).toMatch(/Confirmer l.émission sans document/);
  });

  it("given l'avertissement de capture en échec affiché, when on clique le bouton une seconde fois (confirmer), then emitPv est appelé", async () => {
    mockEmitPv.mockResolvedValue({
      id: 'pv_03',
      number: 'PV-2026-0009',
      orgId: 'org_01',
      projectId: 'proj_ch_01',
      calcResultId: 'calc_42',
      engineId: 'burmister',
      hmacTruncated: 'c3d4e5f6',
      sealedAt: '2026-07-16T10:10:00.000Z',
      sealedBy: 'Amadou Diallo',
      params: {},
      output: null,
      documentFormat: null,
    });
    await renderPage();
    await act(async () => {
      (
        container.querySelector('[data-testid="simulate-calc-done"]') as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        container.querySelector(
          '[data-testid="simulate-capture-failed"]',
        ) as HTMLButtonElement
      ).click();
    });
    // 1er clic → avertissement seulement.
    await act(async () => {
      (
        container.querySelector('[data-testid="btn-emettre-pv"]') as HTMLButtonElement
      ).click();
    });
    expect(mockEmitPv).not.toHaveBeenCalled();
    // 2e clic (« Confirmer… ») → émission réelle.
    await act(async () => {
      (
        container.querySelector('[data-testid="btn-emettre-pv"]') as HTMLButtonElement
      ).click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockEmitPv).toHaveBeenCalledWith('org_01', 'proj_ch_01', {
      calcResultId: 'calc_42',
    });
    expect(container.textContent).toMatch(/PV-2026-0009/);
  });

  it("given le module burmister n'est PAS inclus dans l'abonnement, when montage, then la bannière de gate est affichée", async () => {
    mockGetEntitlements.mockResolvedValue(entitlements({ modules: ['terzaghi'] }));
    await renderPage();
    const banner = container.querySelector('[data-testid="gate-banner"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toMatch(/non inclus/i);
  });

  it("given un abonnement actif AVEC le module, when montage, then aucune bannière de gate n'est affichée", async () => {
    await renderPage();
    expect(container.querySelector('[data-testid="gate-banner"]')).toBeNull();
  });
});
