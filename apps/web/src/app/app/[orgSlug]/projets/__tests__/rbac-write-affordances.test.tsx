/**
 * M5 — les affordances d'ÉCRITURE de la liste des projets suivent le rôle
 * courant (créer, renommer, archiver, supprimer définitivement, restaurer).
 *
 * ⚠️ CECI N'EST PAS UNE MESURE DE SÉCURITÉ. Masquer un bouton n'autorise
 * rien : la seule barrière réelle est le RBAC serveur (@Roles sur
 * ProjectsController — OWNER/ADMIN/ENGINEER pour créer/renommer/archiver/
 * restaurer, OWNER/ADMIN pour la suppression définitive). C'est du confort
 * d'usage : éviter un clic qui se solde par un 403 prévisible (cf.
 * apps/api/test/projects-restore.e2e-spec.ts cas #4, qui prouve déjà le
 * refus serveur pour un VIEWER). Le rôle est lu depuis `getStoredOrgs()`
 * (claims JWT stockés au login) — PAS déduit ni fabriqué côté navigateur.
 *
 * CONTRAT VERROUILLÉ (given/when/then)
 *  #1 GIVEN un membre VIEWER — WHEN la liste (et la vue Archivés) s'affiche
 *     — THEN la liste est visible ET aucun bouton d'écriture n'est rendu
 *     (Nouveau projet, crayon, menu ⋮, Restaurer) ;
 *  #2 (contrôle positif) GIVEN un membre OWNER — WHEN la liste s'affiche —
 *     THEN ces boutons SONT rendus. Sans ce cas, un bug qui masquerait tout
 *     ferait passer le premier à tort.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ORG_ID, ORG_SLUG, PROJETS_ACTIFS, projet } from './fixtures';

const { mockListProjects, mockListArchived, mockGetStoredOrgs } = vi.hoisted(() => ({
  mockListProjects: vi.fn(),
  mockListArchived: vi.fn(),
  mockGetStoredOrgs: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  listProjects: mockListProjects,
  listArchivedProjects: mockListArchived,
  restoreProject: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  deleteProjectPermanently: vi.fn(),
  renameProject: vi.fn(),
  getStoredOrgs: mockGetStoredOrgs,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/org-context', () => ({ useOrgId: () => ORG_ID }));
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import ProjetsClient from '../ProjetsClient';

const PROJET_ARCHIVE = projet({
  id: 'p-archive-1',
  name: 'Ancien projet archivé',
  domain: 'CH',
});

let container: HTMLDivElement;
let root: Root;

async function monter(actifs = PROJETS_ACTIFS, archives = [PROJET_ARCHIVE]) {
  mockListProjects.mockResolvedValue(actifs);
  mockListArchived.mockResolvedValue(archives);
  await act(async () => {
    root.render(<ProjetsClient orgSlug={ORG_SLUG} />);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function basculerVersArchives() {
  const groupe = container.querySelector('[aria-label="Filtrer par état"]');
  const boutonArchives = Array.from(groupe?.querySelectorAll('button') ?? []).find((b) =>
    b.textContent?.startsWith('Archivés'),
  );
  await act(async () => boutonArchives?.click());
}

describe('Liste des projets — affordances d’écriture selon le rôle (confort, pas sécurité)', () => {
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

  it('#1 GIVEN un membre VIEWER — WHEN la liste s’affiche — THEN aucun bouton d’écriture n’est rendu', async () => {
    mockGetStoredOrgs.mockReturnValue([{ id: ORG_ID, slug: ORG_SLUG, role: 'VIEWER' }]);
    await monter();

    expect(
      Array.from(container.querySelectorAll('button')).some((b) =>
        b.textContent?.includes('Nouveau projet'),
      ),
    ).toBe(false);
    expect(container.querySelector('button[aria-label^="Renommer"]')).toBeNull();
    expect(
      container.querySelector('button[aria-label^="Actions sur le projet"]'),
    ).toBeNull();

    await basculerVersArchives();
    // La liste des archivés reste VISIBLE (lecture autorisée à tout rôle tenant).
    expect(container.textContent).toContain('Ancien projet archivé');
    expect(container.querySelector('button[aria-label^="Restaurer"]')).toBeNull();
  });

  it('#2 (contrôle positif) GIVEN un membre OWNER — WHEN la liste s’affiche — THEN les boutons d’écriture SONT rendus', async () => {
    mockGetStoredOrgs.mockReturnValue([{ id: ORG_ID, slug: ORG_SLUG, role: 'OWNER' }]);
    await monter();

    expect(
      Array.from(container.querySelectorAll('button')).some((b) =>
        b.textContent?.includes('Nouveau projet'),
      ),
    ).toBe(true);
    expect(container.querySelector('button[aria-label^="Renommer"]')).not.toBeNull();
    expect(
      container.querySelector('button[aria-label^="Actions sur le projet"]'),
    ).not.toBeNull();

    await basculerVersArchives();
    expect(container.querySelector('button[aria-label^="Restaurer"]')).not.toBeNull();
  });
});
