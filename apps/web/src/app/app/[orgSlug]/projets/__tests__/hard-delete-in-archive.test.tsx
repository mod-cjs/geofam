/**
 * BLOQUANT qa-challenger — suppression définitive INATTEIGNABLE en vue
 * Archivés, alors que c'est le cas d'usage PRINCIPAL côté serveur (on archive
 * un projet pour s'en débarrasser, puis on vide la corbeille — cf.
 * apps/api/test/projects-hard-delete.e2e-spec.ts qui verrouille ce chemin
 * pour un projet DÉJÀ archivé). Sans point d'entrée ici, la fonctionnalité
 * existe, est testée côté serveur, et reste inutilisable là où elle sert.
 *
 * En vue Archivés : Renommer/Archiver n'ont aucun sens sur une ligne déjà
 * archivée (pas proposés) ; seule la suppression définitive s'ajoute à
 * Restaurer, gatée sur le même droit qu'en vue Actifs (OWNER/ADMIN —
 * HARD_DELETE_ROLES).
 *
 * CONTRAT VERROUILLÉ (given/when/then)
 *  #1 GIVEN la vue Archivés — WHEN un OWNER consulte la ligne — THEN l'action
 *     de suppression définitive est proposée (bouton/menu Supprimer
 *     définitivement, distinct de Restaurer) ;
 *  #2 (contrôle négatif) GIVEN la vue Archivés — WHEN un rôle SANS le droit
 *     de suppression définitive (ENGINEER : peut écrire/restaurer mais pas
 *     détruire définitivement) consulte la ligne — THEN l'action de
 *     suppression définitive N'est PAS proposée (sans ce contrôle, un bug qui
 *     afficherait l'action à tout rôle ferait passer #1 à tort) ;
 *  #3 GIVEN la vue Archivés — WHEN la ligne s'affiche — THEN Renommer et
 *     Archiver n'y sont proposés pour aucun rôle (n'ont aucun sens sur une
 *     ligne déjà archivée) ;
 *  #4 GIVEN la vue Archivés — WHEN un OWNER clique l'action de suppression
 *     définitive — THEN la MÊME modale de confirmation irréversible s'ouvre
 *     (pas un chemin parallèle non testé).
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
  name: 'Projet archivé à purger',
  domain: 'CH',
});

let container: HTMLDivElement;
let root: Root;

async function monter(role: string) {
  mockGetStoredOrgs.mockReturnValue([{ id: ORG_ID, slug: ORG_SLUG, role }]);
  mockListProjects.mockResolvedValue(PROJETS_ACTIFS);
  mockListArchived.mockResolvedValue([PROJET_ARCHIVE]);
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

function ligneArchivee(): HTMLElement {
  const ligne = Array.from(
    container.querySelectorAll<HTMLElement>('[role="listitem"]'),
  ).find((el) => el.textContent?.includes('Projet archivé à purger'));
  if (!ligne) throw new Error('Ligne archivée introuvable');
  return ligne;
}

/** Cherche l'action « Supprimer définitivement » : bouton direct OU item de menu. */
async function actionSuppressionDefinitive(
  ligne: HTMLElement,
): Promise<HTMLElement | undefined> {
  const boutonDirect = Array.from(
    ligne.querySelectorAll<HTMLButtonElement>('button'),
  ).find((b) => b.textContent?.includes('Supprimer définitivement'));
  if (boutonDirect) return boutonDirect;

  // Repli : peut-être derrière un menu ⋮ (comme en vue Actifs).
  const boutonMenu = ligne.querySelector<HTMLButtonElement>(
    'button[aria-label^="Actions sur le projet"]',
  );
  if (!boutonMenu) return undefined;
  await act(async () => boutonMenu.click());
  return Array.from(ligne.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
    (i) => i.textContent?.includes('Supprimer définitivement'),
  );
}

describe('Vue Archivés — suppression définitive (cas d’usage principal côté serveur)', () => {
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

  it('#1 GIVEN la vue Archivés — WHEN un OWNER — THEN l’action de suppression définitive est proposée', async () => {
    await monter('OWNER');
    await basculerVersArchives();
    const ligne = ligneArchivee();

    const action = await actionSuppressionDefinitive(ligne);
    expect(action).not.toBeUndefined();

    // Distincte de Restaurer, qui doit rester présent à côté.
    expect(ligne.querySelector('button[aria-label^="Restaurer"]')).not.toBeNull();
  });

  it('#2 (contrôle négatif) GIVEN la vue Archivés — WHEN un ENGINEER (sans droit de suppression définitive) — THEN l’action n’est PAS proposée', async () => {
    await monter('ENGINEER');
    await basculerVersArchives();
    const ligne = ligneArchivee();

    const action = await actionSuppressionDefinitive(ligne);
    expect(action).toBeUndefined();

    // ENGINEER garde Restaurer (WRITE_ROLES) : seule la destruction définitive
    // est retirée, pas tout le confort d'écriture de la vue Archivés.
    expect(ligne.querySelector('button[aria-label^="Restaurer"]')).not.toBeNull();
  });

  it('#3 GIVEN la vue Archivés — WHEN la ligne s’affiche (OWNER) — THEN Renommer et Archiver n’y sont jamais proposés', async () => {
    await monter('OWNER');
    await basculerVersArchives();
    const ligne = ligneArchivee();

    expect(ligne.querySelector('button[aria-label^="Renommer"]')).toBeNull();
    expect(
      Array.from(ligne.querySelectorAll('button, [role="menuitem"]')).some(
        (el) => el.textContent?.trim() === 'Archiver',
      ),
    ).toBe(false);
  });

  it('#4 GIVEN la vue Archivés — WHEN un OWNER déclenche la suppression définitive — THEN la modale d’irréversibilité s’ouvre', async () => {
    await monter('OWNER');
    await basculerVersArchives();
    const ligne = ligneArchivee();

    const action = await actionSuppressionDefinitive(ligne);
    await act(async () => action!.click());

    expect(document.body.textContent).toMatch(/irr[ée]versible/i);
    expect(document.body.querySelector('#hard-delete-confirm')).not.toBeNull();
  });
});
