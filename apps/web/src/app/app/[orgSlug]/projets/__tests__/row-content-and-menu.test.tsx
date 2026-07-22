/**
 * P0 — colonne « Contenu » + description + menu d'actions par ligne
 * (écran 1, maquette validée 21/07/2026, lignes 244-263).
 *
 * CONTRAT VERROUILLÉ (given/when/then)
 *  #1 la colonne Contenu affiche « N calculs » ; « N PV » n'apparaît QUE si
 *     pvCount > 0 ;
 *  #2 la ligne de description affiche la description si elle existe, sinon
 *     « Aucune description. » atténué ;
 *  #3 le bouton ⋮ ouvre un menu role="menu" avec Renommer / Archiver /
 *     séparateur / Supprimer définitivement ;
 *  #4 Échap ferme le menu ;
 *  #5 un clic à l'extérieur ferme le menu.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ORG_ID, ORG_SLUG, PROJETS_ACTIFS } from './fixtures';

const { mockListProjects, mockListArchived } = vi.hoisted(() => ({
  mockListProjects: vi.fn(),
  mockListArchived: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  listProjects: mockListProjects,
  listArchivedProjects: mockListArchived,
  restoreProject: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  deleteProjectPermanently: vi.fn(),
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

function ligneDe(nomPartiel: string): HTMLElement {
  const ligne = Array.from(
    container.querySelectorAll<HTMLElement>('[role="listitem"]'),
  ).find((el) => el.textContent?.includes(nomPartiel));
  if (!ligne) throw new Error(`Ligne introuvable pour ${nomPartiel}`);
  return ligne;
}

describe('Liste des projets — colonne Contenu, description, menu d’actions', () => {
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

  it('#1a GIVEN un projet avec des PV — WHEN la ligne s’affiche — THEN « N calculs » et « N PV » apparaissent', async () => {
    await monter();
    const ligne = ligneDe('Pont de Mbodiène');
    expect(ligne.textContent).toContain('40');
    expect(ligne.textContent).toContain('calculs');
    expect(ligne.textContent).toContain('4');
    expect(ligne.textContent).toContain('PV');
  });

  it('#1b GIVEN un projet SANS aucun PV (pvCount=0) — WHEN la ligne s’affiche — THEN « PV » n’apparaît PAS', async () => {
    await monter();
    const ligne = ligneDe('Étude');
    expect(ligne.textContent).toContain('7');
    expect(ligne.textContent).toContain('calculs');
    expect(ligne.textContent).not.toMatch(/\bPV\b/);
  });

  it('#2a GIVEN un projet avec description — WHEN la ligne s’affiche — THEN la description est visible', async () => {
    await monter();
    const ligne = ligneDe('Route Dakar-Thiès');
    expect(ligne.textContent).toContain('Chaussée neuve, section courante.');
  });

  it('#2b GIVEN un projet SANS description — WHEN la ligne s’affiche — THEN « Aucune description. » apparaît', async () => {
    await monter();
    const ligne = ligneDe('Essai brut');
    expect(ligne.textContent).toContain('Aucune description.');
  });

  it('#3 GIVEN une ligne de projet — WHEN on clique le bouton ⋮ — THEN un menu role="menu" s’ouvre avec les 3 actions', async () => {
    await monter();
    const ligne = ligneDe('Route Dakar-Thiès');
    const boutonMenu = ligne.querySelector<HTMLButtonElement>(
      'button[aria-label^="Actions sur le projet"]',
    );
    expect(boutonMenu).not.toBeNull();
    await act(async () => boutonMenu!.click());

    const menu = ligne.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    const items = Array.from(menu!.querySelectorAll('[role="menuitem"]'));
    expect(items.map((i) => i.textContent?.trim())).toEqual([
      'Renommer',
      'Archiver',
      'Supprimer définitivement',
    ]);
    // Séparateur entre Archiver et Supprimer définitivement.
    expect(menu!.querySelector('hr')).not.toBeNull();
  });

  it('#4 GIVEN un menu ouvert — WHEN on presse Échap — THEN le menu se ferme', async () => {
    await monter();
    const ligne = ligneDe('Route Dakar-Thiès');
    const boutonMenu = ligne.querySelector<HTMLButtonElement>(
      'button[aria-label^="Actions sur le projet"]',
    );
    await act(async () => boutonMenu!.click());
    expect(ligne.querySelector('[role="menu"]')).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(ligne.querySelector('[role="menu"]')).toBeNull();
  });

  it('#5 GIVEN un menu ouvert — WHEN on clique à l’extérieur — THEN le menu se ferme', async () => {
    await monter();
    const ligne = ligneDe('Route Dakar-Thiès');
    const boutonMenu = ligne.querySelector<HTMLButtonElement>(
      'button[aria-label^="Actions sur le projet"]',
    );
    await act(async () => boutonMenu!.click());
    expect(ligne.querySelector('[role="menu"]')).not.toBeNull();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(ligne.querySelector('[role="menu"]')).toBeNull();
  });
});
