/**
 * Tests — shell GEOFAM de la page GEOPLAQUE (clone UI client, ADR 0015).
 *
 * DoD §9 : given/when/then, chemins négatifs (gate bloqué, erreur d'émission
 * PV) testés autant que le chemin heureux. `ToolFrame` est mocké ici — sa
 * boucle de bridge (dont la logique `engineAllowlist` multi-engine) est
 * testée en isolation dans `lib/tool-bridge/__tests__/ToolFrame.test.tsx` ;
 * ce fichier ne couvre QUE le câblage du shell (projet, gate, bouton PV
 * branché sur le dernier calcResultId remonté par ToolFrame, quel que soit
 * le mode qui l'a produit) + le fait que le shell transmet bien la liste
 * fermée des 4 engineId multi-engine à ToolFrame.
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
// Stub multi-engine — chaque mode a son calcResultId. Comme le vrai ToolFrame, un
// « calcul terminé » émet onCalcResultId PUIS onSnapshotStatus('awaiting') ; la capture
// se résout ensuite ('confirmed'/'failed'). M3 (revue adverse) : le bouton PV attend
// cette résolution, quel que soit le mode d'origine.
vi.mock('@/lib/tool-bridge/ToolFrame', () => {
  type SnapEvt = { calcResultId: string; status: string };
  const ToolFrame = (props: {
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
      {(['radier', 'tri-raft'] as const).map((mode) => {
        const id = `calc_${mode.replace('-', '_')}`;
        return (
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
              data-testid={`simulate-confirm-${mode}`}
              onClick={() =>
                props.onSnapshotStatus?.({ calcResultId: id, status: 'confirmed' })
              }
            >
              Simuler capture confirmée {mode}
            </button>
            <button
              type="button"
              data-testid={`simulate-failed-${mode}`}
              onClick={() =>
                props.onSnapshotStatus?.({ calcResultId: id, status: 'failed' })
              }
            >
              Simuler capture en échec {mode}
            </button>
          </div>
        );
      })}
    </div>
  );
  return { ToolFrame };
});

import GeoplaquePage from '../page';

const PROJECT = {
  id: 'proj_fd_01',
  orgId: 'org_01',
  name: 'Radier R1',
  domain: 'FD' as const,
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
    modules: overrides.modules ?? ['radier'],
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
    root.render(<GeoplaquePage />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('Page GEOPLAQUE — shell GEOFAM', () => {
  it('given un seul projet FD, when montage, then le projet est présélectionné et ToolFrame reçoit le contexte projet (toolId geoplaque, engineId radier, engineAllowlist des 4 modes)', async () => {
    await renderPage();
    const stub = container.querySelector('[data-testid="tool-frame-stub"]');
    expect(stub).not.toBeNull();
    const props = JSON.parse(stub!.getAttribute('data-props')!);
    expect(props).toMatchObject({
      toolId: 'geoplaque',
      engineId: 'radier',
      engineAllowlist: ['radier', 'plane-strain', 'axi', 'tri-raft'],
      projectId: 'proj_fd_01',
      projectLabel: 'Radier R1',
      accessToken: 'token-abc',
    });
  });

  it('given des projets FD, LEGACY(null) et CH, when montage, then le picker montre FD + legacy et EXCLUT le CH', async () => {
    // Même règle que terzaghi/roadsens (bug swap mock->réel) : le filtre retient
    // le domaine du logiciel (FD) OU un domaine null (projet legacy, domaine
    // inconnu -> sélectionnable partout plutôt qu'invisible partout), et écarte
    // un domaine explicitement autre (CH).
    mockListProjects.mockResolvedValue([
      { ...PROJECT, id: 'p_fd', name: 'Radier FD', domain: 'FD' },
      { ...PROJECT, id: 'p_legacy', name: 'Projet legacy', domain: null },
      { ...PROJECT, id: 'p_ch', name: 'Chaussée CH', domain: 'CH' },
    ]);
    await renderPage();
    const select = container.querySelector(
      'select[aria-label="Projet"]',
    ) as HTMLSelectElement;
    expect(select).not.toBeNull();
    const labels = Array.from(select.querySelectorAll('option')).map(
      (o) => o.textContent,
    );
    expect(labels).toContain('Radier FD');
    expect(labels).toContain('Projet legacy');
    expect(labels).not.toContain('Chaussée CH');
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
    expect(props.engineAllowlist).toEqual(['radier', 'plane-strain', 'axi', 'tri-raft']);
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

  // M3 (backport patron roadsens) : le bouton PV attend la CONFIRMATION de capture —
  // pas le seul calcResultId — pour ne jamais sceller un PV sans la note capturée. La
  // course est fermée QUEL QUE SOIT le mode GEOPLAQUE qui a produit le calcul.
  it.each([
    ['radier', 'simulate-calc-radier', 'simulate-confirm-radier'],
    ['tri-raft', 'simulate-calc-tri-raft', 'simulate-confirm-tri-raft'],
  ])(
    'given un calcResultId produit par le mode %s SANS capture confirmée, then le bouton PV reste DÉSACTIVÉ ; il s\'active une fois la capture CONFIRMÉE',
    async (_mode, calcId, confirmId) => {
      await renderPage();
      await act(async () => {
        (container.querySelector(`[data-testid="${calcId}"]`) as HTMLButtonElement).click();
      });
      const btn = () =>
        container.querySelector('[data-testid="btn-emettre-pv"]') as HTMLButtonElement;
      // Capture encore en vol (awaiting) → bouton grisé.
      expect(btn().disabled).toBe(true);
      expect(btn().textContent).toMatch(/Capture du document/);
      await act(async () => {
        (
          container.querySelector(`[data-testid="${confirmId}"]`) as HTMLButtonElement
        ).click();
      });
      // Capture confirmée → bouton actif.
      expect(btn().disabled).toBe(false);
      expect(btn().textContent).toMatch(/Émettre le PV scellé/);
    },
  );

  it('given une capture en ÉCHEC (mode radier), when on clique « Émettre le PV », then avertissement puis confirmation requise (jamais de PV sans document en un clic)', async () => {
    await renderPage();
    await act(async () => {
      (
        container.querySelector('[data-testid="simulate-calc-radier"]') as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        container.querySelector('[data-testid="simulate-failed-radier"]') as HTMLButtonElement
      ).click();
    });
    const btn = container.querySelector(
      '[data-testid="btn-emettre-pv"]',
    ) as HTMLButtonElement;
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

  it('given un calcul terminé (mode tri-raft), when "Émettre le PV" cliqué et emitPv résout, then le PV scellé est affiché', async () => {
    mockEmitPv.mockResolvedValue({
      id: 'pv_01',
      number: 'PV-2026-0009',
      orgId: 'org_01',
      projectId: 'proj_fd_01',
      calcResultId: 'calc_tri_raft',
      engineId: 'radier',
      hmacTruncated: 'a1b2c3d4',
      sealedAt: '2026-07-16T10:00:00.000Z',
      sealedBy: 'Amadou Diallo',
      params: {},
      output: null,
    });
    await renderPage();
    await act(async () => {
      (
        container.querySelector('[data-testid="simulate-calc-tri-raft"]') as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        container.querySelector('[data-testid="simulate-confirm-tri-raft"]') as HTMLButtonElement
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
    expect(mockEmitPv).toHaveBeenCalledWith('org_01', 'proj_fd_01', {
      calcResultId: 'calc_tri_raft',
    });
    expect(container.textContent).toMatch(/PV-2026-0009/);
  });

  it('given emitPv échoue, when "Émettre le PV" cliqué, then un message d\'erreur explicite est affiché', async () => {
    mockEmitPv.mockRejectedValue({ message: 'Quota épuisé.' });
    await renderPage();
    await act(async () => {
      (
        container.querySelector('[data-testid="simulate-calc-radier"]') as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      (
        container.querySelector('[data-testid="simulate-confirm-radier"]') as HTMLButtonElement
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

  it("given le module radier n'est PAS inclus dans l'abonnement, when montage, then la bannière de gate est affichée (gate unique pour les 4 modes)", async () => {
    mockGetEntitlements.mockResolvedValue(entitlements({ modules: ['terzaghi'] }));
    await renderPage();
    const banner = container.querySelector('[data-testid="gate-banner"]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toMatch(/non inclus/i);
  });

  it("given un abonnement actif AVEC le module radier, when montage, then aucune bannière de gate n'est affichée", async () => {
    await renderPage();
    expect(container.querySelector('[data-testid="gate-banner"]')).toBeNull();
  });
});
