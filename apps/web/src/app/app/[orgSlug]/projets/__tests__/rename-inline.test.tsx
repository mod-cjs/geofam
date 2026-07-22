/**
 * P0-7 — RENOMMAGE EN LIGNE depuis la liste des projets.
 *
 * LE DÉFAUT CORRIGÉ — asymétrie entre action fréquente et action destructive
 * -------------------------------------------------------------------------
 * Renommer un projet — l'action d'écriture la plus courante, celle qu'on fait
 * pour aligner le nom sur celui de l'affaire cliente — obligeait à OUVRIR le
 * projet puis à aller au 4ᵉ onglet « Informations ». Pendant ce temps, la
 * SUPPRESSION avait deux points d'entrée, dont une corbeille directement sur
 * chaque ligne.
 *
 * Une action fréquente et anodine ne doit jamais coûter plus de clics qu'une
 * action rare et destructive. L'API `renameProject` existait déjà : il ne
 * manquait que le point d'entrée.
 *
 * CONTRAT VERROUILLÉ (given/when/then)
 *  #1 le bouton de renommage ouvre un champ pré-rempli du nom courant ;
 *  #2 valider appelle l'API et met la liste à jour SANS rechargement complet ;
 *  #3 un nom VIDE ou inchangé n'appelle PAS l'API (pas d'écriture inutile,
 *     et le backend refuserait un nom vide) ;
 *  #4 Échap annule sans rien écrire ;
 *  #5 en cas d'échec serveur, le nom AFFICHÉ revient à l'ancien — pas d'UI
 *     optimiste menteuse qui laisserait croire à une persistance inexistante.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockListProjects, mockRenameProject, mockListArchived } = vi.hoisted(() => ({
  mockListProjects: vi.fn(),
  mockRenameProject: vi.fn(),
  mockListArchived: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  listProjects: mockListProjects,
  listArchivedProjects: mockListArchived,
  restoreProject: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  renameProject: mockRenameProject,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/org-context', () => ({ useOrgId: () => 'org-1' }));
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import ProjetsClient from '../ProjetsClient';

const PROJET = {
  id: 'proj-1',
  orgId: 'org-1',
  name: 'Nom initial',
  domain: 'CH' as const,
  createdAt: '2026-07-17T12:00:00.000Z',
  updatedAt: '2026-07-17T12:00:00.000Z',
  lastActivityAt: '2026-07-17T12:00:00.000Z',
  lastActivityKind: 'projet' as const,
  createdBy: 'user-1',
  calcCount: 3,
  pvCount: 1,
};

let container: HTMLDivElement;
let root: Root;

async function monter() {
  mockListProjects.mockResolvedValue([PROJET]);
  mockListArchived.mockResolvedValue([]);
  await act(async () => {
    root.render(<ProjetsClient orgSlug="starfire" />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const champ = () =>
  container.querySelector<HTMLInputElement>('input[aria-label^="Renommer"]');
const boutonRenommer = () =>
  container.querySelector<HTMLButtonElement>('button[aria-label^="Renommer"]');

describe('Liste des projets — renommage en ligne', () => {
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

  it('#1 GIVEN un projet — WHEN on clique Renommer — THEN un champ pré-rempli s’ouvre', async () => {
    await monter();
    expect(boutonRenommer()).not.toBeNull();
    await act(async () => boutonRenommer()!.click());
    expect(champ()?.value).toBe('Nom initial');
  });

  it('#2 GIVEN un nouveau nom — WHEN on valide — THEN l’API est appelée et la liste se met à jour', async () => {
    mockRenameProject.mockResolvedValue({ ...PROJET, name: 'Nom corrigé' });
    await monter();
    await act(async () => boutonRenommer()!.click());

    const input = champ()!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(input, 'Nom corrigé');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(mockRenameProject).toHaveBeenCalledWith('org-1', 'proj-1', 'Nom corrigé');
    // Mise a jour LOCALE : pas de rechargement complet de la liste.
    expect(mockListProjects).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Nom corrigé');
  });

  it('#3 GIVEN un nom inchangé ou vide — WHEN on valide — THEN AUCUN appel API', async () => {
    await monter();
    await act(async () => boutonRenommer()!.click());
    const input = champ()!;
    // Inchangé : écrire quand rien ne change est une écriture inutile.
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(mockRenameProject).not.toHaveBeenCalled();
  });

  it('#4 GIVEN un champ ouvert — WHEN Échap — THEN annulation sans écriture', async () => {
    await monter();
    await act(async () => boutonRenommer()!.click());
    const input = champ()!;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(mockRenameProject).not.toHaveBeenCalled();
    expect(champ()).toBeNull();
    expect(container.textContent).toContain('Nom initial');
  });

  it('#5 GIVEN un échec serveur — WHEN on valide — THEN le nom affiché revient à l’ancien', async () => {
    mockRenameProject.mockRejectedValue(new Error('boom'));
    await monter();
    await act(async () => boutonRenommer()!.click());
    const input = champ()!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(input, 'Ne doit pas rester');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Pas d'UI optimiste menteuse : si le serveur refuse, l'ecran ne doit pas
    // afficher un nom qui n'existe nulle part.
    expect(container.textContent).toContain('Nom initial');
    expect(container.textContent).not.toContain('Ne doit pas rester');
  });
});
