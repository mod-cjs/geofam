/**
 * P0-9 — SUPPRESSION DÉFINITIVE (interface).
 *
 * Distincte de l'archivage : IRRÉVERSIBLE, saisie du nom du projet exigée
 * (patron usuel pour une destruction irréversible). Sur 409 (PV scellé), le
 * message explique la cause et propose l'archivage à la place, plutôt que
 * d'insister.
 *
 * CONTRAT VERROUILLÉ (given/when/then)
 *  #1 la modale annonce explicitement l'irréversibilité ;
 *  #2 le bouton de confirmation reste désactivé tant que le nom saisi ne
 *     correspond PAS exactement au nom du projet ;
 *  #3 une fois le nom saisi correctement, valider appelle l'API et retire la
 *     ligne ;
 *  #4 sur 409, un message exploitable apparaît et propose l'archivage à la
 *     place (la modale d'archivage s'ouvre alors) ;
 *  #5 sur 404, un message clair apparaît (pas de crash, pas de toast muet).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ORG_ID, ORG_SLUG, PROJETS_ACTIFS } from './fixtures';

const { mockListProjects, mockListArchived, mockDeleteProjectPermanently } = vi.hoisted(
  () => ({
    mockListProjects: vi.fn(),
    mockListArchived: vi.fn(),
    mockDeleteProjectPermanently: vi.fn(),
  }),
);

vi.mock('@/lib/api/client', () => ({
  listProjects: mockListProjects,
  listArchivedProjects: mockListArchived,
  restoreProject: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  deleteProjectPermanently: mockDeleteProjectPermanently,
  renameProject: vi.fn(),
  getStoredOrgs: () => [{ id: ORG_ID, slug: ORG_SLUG, role: 'OWNER' }],
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/org-context', () => ({ useOrgId: () => ORG_ID }));
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import ProjetsClient from '../ProjetsClient';

let container: HTMLDivElement;
let root: Root;

async function monter() {
  mockListProjects.mockResolvedValue(PROJETS_ACTIFS);
  mockListArchived.mockResolvedValue([]);
  await act(async () => {
    root.render(<ProjetsClient orgSlug={ORG_SLUG} />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function ouvrirModaleSuppressionDefinitive(nomProjet: string) {
  const ligne = Array.from(
    container.querySelectorAll<HTMLElement>('[role="listitem"]'),
  ).find((el) => el.textContent?.includes(nomProjet))!;
  const boutonMenu = ligne.querySelector<HTMLButtonElement>(
    'button[aria-label^="Actions sur le projet"]',
  )!;
  await act(async () => boutonMenu.click());
  const items = Array.from(
    ligne.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  );
  const supprimer = items.find((i) =>
    i.textContent?.includes('Supprimer définitivement'),
  )!;
  await act(async () => supprimer.click());
}

function champConfirmation(): HTMLInputElement | null {
  return document.body.querySelector<HTMLInputElement>('#hard-delete-confirm');
}

function boutonConfirmer(): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === 'Supprimer définitivement',
  );
}

function saisir(input: HTMLInputElement, valeur: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )!.set!;
  setter.call(input, valeur);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('Liste des projets — suppression définitive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('#1 GIVEN le menu d’un projet — WHEN on clique « Supprimer définitivement » — THEN la modale annonce l’irréversibilité', async () => {
    await monter();
    await ouvrirModaleSuppressionDefinitive('Route Dakar-Thiès');
    expect(document.body.textContent).toMatch(/irr[ée]versible/i);
  });

  it('#2 GIVEN la modale ouverte — WHEN le nom saisi ne correspond PAS — THEN le bouton de confirmation reste désactivé', async () => {
    await monter();
    await ouvrirModaleSuppressionDefinitive('Route Dakar-Thiès');
    const input = champConfirmation()!;
    expect(input).not.toBeNull();

    const confirmer = boutonConfirmer()!;
    expect(confirmer.disabled).toBe(true);

    await act(async () => saisir(input, 'un nom quelconque'));
    expect(boutonConfirmer()!.disabled).toBe(true);

    await act(async () => saisir(input, 'Route Dakar-Thiès — dimensionnement'));
    expect(boutonConfirmer()!.disabled).toBe(false);

    expect(mockDeleteProjectPermanently).not.toHaveBeenCalled();
  });

  it('#3 GIVEN un nom saisi EXACT — WHEN on confirme — THEN l’API est appelée et la ligne disparaît', async () => {
    mockDeleteProjectPermanently.mockResolvedValue(PROJETS_ACTIFS[0]);
    await monter();
    await ouvrirModaleSuppressionDefinitive('Route Dakar-Thiès');
    const input = champConfirmation()!;
    await act(async () => saisir(input, 'Route Dakar-Thiès — dimensionnement'));
    await act(async () => boutonConfirmer()!.click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockDeleteProjectPermanently).toHaveBeenCalledWith(ORG_ID, 'p-ch1');
    expect(container.textContent).not.toContain('Route Dakar-Thiès');
  });

  it('#4 GIVEN un projet portant des PV scellés — WHEN le serveur refuse (409) — THEN un message explique la cause et propose l’archivage', async () => {
    mockDeleteProjectPermanently.mockRejectedValue({
      statusCode: 409,
      reason: 'SERVER_ERROR',
      message:
        'Ce projet porte au moins un PV scellé : suppression définitive impossible.',
    });
    await monter();
    await ouvrirModaleSuppressionDefinitive('Route Dakar-Thiès');
    const input = champConfirmation()!;
    await act(async () => saisir(input, 'Route Dakar-Thiès — dimensionnement'));
    await act(async () => boutonConfirmer()!.click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toMatch(/PV scell/i);
    const boutonArchiverPlutot = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => b.textContent?.includes('Archiver à la place'));
    expect(boutonArchiverPlutot).not.toBeUndefined();

    // La ligne n'a pas disparu : le refus serveur n'a rien changé côté liste.
    expect(container.textContent).toContain('Route Dakar-Thiès');
  });

  it('#5 GIVEN un projet déjà supprimé ailleurs — WHEN le serveur renvoie 404 — THEN un message clair apparaît, sans crash', async () => {
    mockDeleteProjectPermanently.mockRejectedValue({
      statusCode: 404,
      reason: 'NOT_FOUND',
      message: 'Projet introuvable',
    });
    await monter();
    await ouvrirModaleSuppressionDefinitive('Route Dakar-Thiès');
    const input = champConfirmation()!;
    await act(async () => saisir(input, 'Route Dakar-Thiès — dimensionnement'));
    await act(async () => boutonConfirmer()!.click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toMatch(/introuvable/i);
  });
});
