/**
 * Tests — écran 3 (onglet PV scellés), mise en conformité avec la maquette
 * finale (21/07/2026) :
 *  - lignes COMPACTES sur une rangée (pas de grandes cartes empilées) ;
 *  - numéro de PV + logiciel + date sur UNE ligne mono discrète, jamais coupée ;
 *  - hash de contenu retiré de l'affichage visible (discret en tooltip) ;
 *  - badge SCELLÉ toujours neutre (asphalte), jamais vert/rouge (ADR 0008),
 *    y compris pour un PV scellé NON CONFORME (piège déjà vécu) ;
 *  - tri interactif (Date de scellement défaut décroissant / Numéro) ;
 *  - pagination client (~12/page), remise à la page 1 au changement de tri.
 *
 * DoD §9 : given/when/then, zéro faux-vert (chaque assertion vérifie un
 * comportement observable, pas une présence triviale).
 *
 * Patron d'interaction : react-dom/client + act (cf. PvListClient.test.tsx).
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
} = vi.hoisted(() => ({
  mockListPvs: vi.fn(),
  mockVerifyPv: vi.fn(),
  mockDownloadPvPdf: vi.fn(),
  mockGetPvDocument: vi.fn(),
  mockGetProjectCached: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  listPvs: mockListPvs,
  verifyPv: mockVerifyPv,
  downloadPvPdf: mockDownloadPvPdf,
  getPvDocument: mockGetPvDocument,
  getProjectCached: mockGetProjectCached,
}));

vi.mock('@/lib/print-inert-html', () => ({
  printInertHtml: vi.fn(),
}));

import PvListClient from '../PvListClient';

import { ToastProvider } from '@/components/ui/Toast';
import type { OfficialPv } from '@/lib/api/types';

function makePv(overrides: Partial<OfficialPv>): OfficialPv {
  return {
    id: 'pv_base',
    number: 'PV-RDS-starfire-recette-2026-000001',
    orgId: 'org_01',
    projectId: 'proj_01',
    calcResultId: 'calc_01',
    engineId: 'pieux',
    hmacTruncated: 'e357f945',
    sealedAt: '2026-07-17T16:02:00.000Z',
    sealedBy: 'Amadou Diallo',
    params: {},
    output: { verdict: 'PASS' },
    verdict: 'PASS',
    ...overrides,
  };
}

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

describe('PvListClient — ligne compacte (maquette finale, écran 3)', () => {
  it("given un PV, when la liste s'affiche, then le numéro/logiciel/date tiennent dans UN seul bloc mono sans retour à la ligne (whiteSpace nowrap + ellipsis)", async () => {
    const pv = makePv({
      number: 'PV-RDS-starfire-recette-2026-000006',
      engineId: 'pieux',
      sealedAt: '2026-07-17T16:02:00.000Z',
    });
    mockListPvs.mockResolvedValue([pv]);

    await renderPvList();

    // Le numéro, le logiciel et la date sont dans le MÊME nœud texte (pas
    // éclatés sur plusieurs <span> séparés par un « · » orphelin) — identifié
    // par son tooltip discret d'intégrité (HMAC tronqué), unique à ce bloc.
    const metaNode = container.querySelector(
      '[title*="HMAC tronqué"]',
    ) as HTMLElement | null;
    expect(metaNode).toBeTruthy();
    expect(metaNode!.textContent).toBe(`${pv.number} · CASAGRANDE · 17/07/2026 16:02`);
    // Compacité : jamais de retour à la ligne au milieu du numéro (le bug
    // rapporté). Vérifiable en unité via la déclaration CSS anti-wrap.
    expect(metaNode!.style.whiteSpace).toBe('nowrap');
    expect(metaNode!.style.overflow).toBe('hidden');
    expect(metaNode!.style.textOverflow).toBe('ellipsis');
  });

  it("given un PV, when la liste s'affiche, then le titre est le TYPE DE NOTE sur une ligne (pas le numéro, pas le projet répété)", async () => {
    const pv = makePv({ engineId: 'radier' });
    mockListPvs.mockResolvedValue([pv]);

    await renderPvList();

    const title = container.querySelector('[role="listitem"] span') as HTMLSpanElement;
    expect(title.textContent).toBe('Note de calcul — Radier sur sol élastique');
    expect(title.style.whiteSpace).toBe('nowrap');
    expect(title.style.overflow).toBe('hidden');
    expect(title.style.textOverflow).toBe('ellipsis');
  });

  it("given un PV, when la liste s'affiche, then le hash HMAC tronqué n'apparaît PLUS dans le texte visible de la ligne (retiré, pas dans la maquette)", async () => {
    const pv = makePv({ hmacTruncated: 'e357f945' });
    mockListPvs.mockResolvedValue([pv]);

    await renderPvList();

    const row = container.querySelector('[role="listitem"]') as HTMLElement;
    // Le hash ne doit plus apparaître comme TEXTE VISIBLE de la ligne.
    expect(row.textContent).not.toContain('e357f945');
  });

  it("given un PV, when la liste s'affiche, then le hash HMAC tronqué reste accessible DISCRÈTEMENT (attribut title, pas dans le texte)", async () => {
    const pv = makePv({ hmacTruncated: 'e357f945' });
    mockListPvs.mockResolvedValue([pv]);

    await renderPvList();

    const withTitle = Array.from(container.querySelectorAll('[title]')).find((el) =>
      el.getAttribute('title')?.includes('e357f945'),
    );
    expect(withTitle).toBeTruthy();
  });
});

describe('PvListClient — badge SCELLÉ jamais vert (ADR 0008, contrôle croisé)', () => {
  it('given un PV scellé NON CONFORME, when la liste s’affiche, then le badge Scellé reste neutre (asphalte) — jamais vert/rouge, distinct du badge de verdict', async () => {
    const pvNonConforme = makePv({
      id: 'pv_nc',
      output: { verdict: 'FAIL' },
      verdict: 'FAIL',
    });
    mockListPvs.mockResolvedValue([pvNonConforme]);

    await renderPvList();

    expect(container.textContent).toContain('NON CONF.');
    const sealedBadge = Array.from(container.querySelectorAll('span')).find(
      (s) => s.textContent?.trim() === 'Scellé' || s.textContent?.includes('Scellé'),
    );
    expect(sealedBadge).toBeTruthy();
    expect(sealedBadge!.style.cssText).not.toContain('--status-fail');
    expect(sealedBadge!.style.cssText).not.toContain('--status-pass');
    expect(sealedBadge!.style.background).not.toBe('var(--status-pass-bg)');
    expect(sealedBadge!.style.background).not.toBe('var(--status-fail-bg)');
  });

  it('given un PV scellé CONFORME, when la liste s’affiche, then le badge Scellé porte la MÊME apparence neutre que pour un PV NON CONFORME (aucune divergence de couleur pilotée par le verdict)', async () => {
    const pvConforme = makePv({
      id: 'pv_ok',
      output: { verdict: 'PASS' },
      verdict: 'PASS',
    });
    mockListPvs.mockResolvedValue([pvConforme]);
    await renderPvList();
    const sealedOk = Array.from(container.querySelectorAll('span')).find((s) =>
      s.textContent?.includes('Scellé'),
    )!;
    const bgOk = sealedOk.style.background;

    root.unmount();
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);

    const pvNonConforme = makePv({
      id: 'pv_ko',
      output: { verdict: 'FAIL' },
      verdict: 'FAIL',
    });
    mockListPvs.mockResolvedValue([pvNonConforme]);
    await renderPvList();
    const sealedKo = Array.from(container.querySelectorAll('span')).find((s) =>
      s.textContent?.includes('Scellé'),
    )!;

    expect(sealedKo.style.background).toBe(bgOk);
  });
});

describe('PvListClient — tri interactif (P2 dégelé, maquette finale)', () => {
  const OLD = makePv({
    id: 'pv_old',
    number: 'PV-RDS-starfire-recette-2026-000001',
    sealedAt: '2026-07-17T12:26:00.000Z',
  });
  const NEW = makePv({
    id: 'pv_new',
    number: 'PV-RDS-starfire-recette-2026-000006',
    sealedAt: '2026-07-17T16:02:00.000Z',
  });

  it('given plusieurs PV, when la liste s’affiche, then le tri par défaut est "Date de scellement" décroissant (le plus récent en premier)', async () => {
    mockListPvs.mockResolvedValue([OLD, NEW]);

    await renderPvList();

    const chip = container.querySelector(
      '[aria-label*="Date de scellement"]',
    ) as HTMLButtonElement;
    expect(chip).toBeTruthy();
    expect(chip.getAttribute('aria-pressed')).toBe('true');

    const rows = Array.from(container.querySelectorAll('[role="listitem"]'));
    expect(rows[0].textContent).toContain(NEW.number);
    expect(rows[1].textContent).toContain(OLD.number);
  });

  it('given le tri par défaut, when on clique le chip "Date de scellement" actif, then le sens bascule (le plus ancien en premier)', async () => {
    mockListPvs.mockResolvedValue([OLD, NEW]);
    await renderPvList();

    const chip = container.querySelector(
      '[aria-label*="Date de scellement"]',
    ) as HTMLButtonElement;
    await act(async () => {
      chip.click();
    });
    await flush();

    const rows = Array.from(container.querySelectorAll('[role="listitem"]'));
    expect(rows[0].textContent).toContain(OLD.number);
    expect(rows[1].textContent).toContain(NEW.number);
  });

  it('given deux PV, when on clique le chip "Numéro", then la liste se trie par numéro (2e ordre disponible), et le chip devient actif', async () => {
    mockListPvs.mockResolvedValue([NEW, OLD]);
    await renderPvList();

    const numeroChip = container.querySelector(
      '[aria-label*="Numéro"]',
    ) as HTMLButtonElement;
    expect(numeroChip).toBeTruthy();
    await act(async () => {
      numeroChip.click();
    });
    await flush();

    expect(numeroChip.getAttribute('aria-pressed')).toBe('true');
    const dateChip = container.querySelector(
      '[aria-label*="Date de scellement"]',
    ) as HTMLButtonElement;
    expect(dateChip.getAttribute('aria-pressed')).toBe('false');

    const rows = Array.from(container.querySelectorAll('[role="listitem"]'));
    // 000001 avant 000006 (tri numéro croissant par défaut)
    expect(rows[0].textContent).toContain(OLD.number);
    expect(rows[1].textContent).toContain(NEW.number);
  });
});

describe('PvListClient — pagination client (P2 dégelé, ~12/page)', () => {
  function makeManyPvs(n: number): OfficialPv[] {
    return Array.from({ length: n }, (_, i) =>
      makePv({
        id: `pv_${i}`,
        number: `PV-RDS-starfire-recette-2026-${String(i + 1).padStart(6, '0')}`,
        sealedAt: new Date(2026, 6, 1 + i).toISOString(),
      }),
    );
  }

  it('given 15 PV, when la liste s’affiche, then seuls 12 sont affichés et la pagination indique "Page 1 sur 2"', async () => {
    mockListPvs.mockResolvedValue(makeManyPvs(15));

    await renderPvList();

    const rows = container.querySelectorAll('[role="listitem"]');
    expect(rows.length).toBe(12);
    expect(container.textContent).toContain('Page 1 sur 2');
  });

  it('given 15 PV en page 1, when on clique "Suivant", then la page 2 affiche les 3 PV restants', async () => {
    mockListPvs.mockResolvedValue(makeManyPvs(15));
    await renderPvList();

    const suivant = container.querySelector(
      '[aria-label="Page suivante"]',
    ) as HTMLButtonElement;
    await act(async () => {
      suivant.click();
    });
    await flush();

    const rows = container.querySelectorAll('[role="listitem"]');
    expect(rows.length).toBe(3);
    expect(container.textContent).toContain('Page 2 sur 2');
  });

  it('given 10 PV (une seule page), when la liste s’affiche, then aucun contrôle de pagination n’est rendu', async () => {
    mockListPvs.mockResolvedValue(makeManyPvs(10));

    await renderPvList();

    expect(container.querySelector('[aria-label="Page suivante"]')).toBeNull();
    expect(container.querySelector('[aria-label="Page précédente"]')).toBeNull();
    expect(container.textContent).not.toContain('Page 1 sur');
  });

  it('given la page 2 affichée, when on change le tri, then on revient à la page 1', async () => {
    mockListPvs.mockResolvedValue(makeManyPvs(15));
    await renderPvList();

    const suivant = container.querySelector(
      '[aria-label="Page suivante"]',
    ) as HTMLButtonElement;
    await act(async () => {
      suivant.click();
    });
    await flush();
    expect(container.textContent).toContain('Page 2 sur 2');

    const numeroChip = container.querySelector(
      '[aria-label*="Numéro"]',
    ) as HTMLButtonElement;
    await act(async () => {
      numeroChip.click();
    });
    await flush();

    expect(container.textContent).toContain('Page 1 sur 2');
  });
});
