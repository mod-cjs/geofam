/**
 * P1 (22/07/2026) — pagination CLIENT de la liste des projets.
 *
 * Toute la liste est déjà chargée en mémoire (`listProjects` renvoie tout
 * l'org) : paginer côté client est un traitement d'affichage local, appliqué
 * APRÈS recherche + domaine + tri (l'ordre logique).
 *
 * CONTRAT VERROUILLÉ (given/when/then)
 *  #1 avec 25 projets, seuls 10 s'affichent sur la page 1, et les contrôles
 *     de pagination apparaissent ;
 *  #2 cliquer « Suivant » affiche la page 2 (éléments 11 à 20) ;
 *  #3 un filtre qui réduit la liste sous une page fait DISPARAÎTRE les
 *     contrôles de pagination ;
 *  #4 en dessous du seuil d'une page, les contrôles ne s'affichent pas du
 *     tout (ex. les 4 projets des fixtures usuelles) ;
 *  #5 un changement de recherche remet la page à 1.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ORG_ID, ORG_SLUG, PROJETS_ACTIFS, projet } from './fixtures';

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

async function monter(
  actifs: ReturnType<typeof projet>[],
  archives: ReturnType<typeof projet>[] = [],
) {
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

function texteLignes(): string[] {
  return Array.from(container.querySelectorAll('[role="listitem"]')).map(
    (el) => el.textContent ?? '',
  );
}

/** 25 projets, nommés « Projet 01 » à « Projet 25 » — noms triables lexicalement. */
function fabriquerVingtCinqProjets(): ReturnType<typeof projet>[] {
  return Array.from({ length: 25 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return projet({ id: `p-${n}`, name: `Projet ${n}`, domain: 'CH', calcCount: i });
  });
}

describe('Liste des projets — pagination', () => {
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

  it('#1 GIVEN 25 projets — WHEN la liste s’affiche — THEN seuls 10 sont visibles et les contrôles de pagination apparaissent', async () => {
    await monter(fabriquerVingtCinqProjets());

    // Tri par nom (A→Z) pour un ordre déterministe indépendant de l'activité.
    const groupe = container.querySelector('[aria-label="Trier les projets"]');
    const boutonNom = Array.from(groupe?.querySelectorAll('button') ?? []).find((b) =>
      b.textContent?.startsWith('Nom'),
    );
    await act(async () => boutonNom?.click());

    const lignes = texteLignes();
    expect(lignes).toHaveLength(10);
    expect(lignes[0]).toContain('Projet 01');
    expect(lignes[9]).toContain('Projet 10');

    expect(container.textContent).toContain('Page 1 sur 3');
    const suivant = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Page suivante"]',
    );
    const precedent = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Page précédente"]',
    );
    expect(suivant).not.toBeNull();
    expect(precedent?.disabled).toBe(true);
  });

  it('#2 GIVEN la page 1 — WHEN on clique Suivant — THEN la page 2 montre les projets 11 à 20', async () => {
    await monter(fabriquerVingtCinqProjets());
    const groupe = container.querySelector('[aria-label="Trier les projets"]');
    const boutonNom = Array.from(groupe?.querySelectorAll('button') ?? []).find((b) =>
      b.textContent?.startsWith('Nom'),
    );
    await act(async () => boutonNom?.click());

    const suivant = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Page suivante"]',
    );
    await act(async () => suivant?.click());

    const lignes = texteLignes();
    expect(lignes).toHaveLength(10);
    expect(lignes[0]).toContain('Projet 11');
    expect(lignes[9]).toContain('Projet 20');
    expect(container.textContent).toContain('Page 2 sur 3');

    const precedent = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Page précédente"]',
    );
    expect(precedent?.disabled).toBe(false);
  });

  it('#3 GIVEN la page 2 (25 projets) — WHEN un filtre de domaine réduit la liste sous une page — THEN les contrôles de pagination disparaissent et on revient à la page 1', async () => {
    const projets = fabriquerVingtCinqProjets();
    // Un seul projet FD parmi les 25 CH — le filtre par domaine réduira à 1 élément.
    projets[24] = projet({ id: 'p-fd', name: 'Projet FD unique', domain: 'FD' });
    await monter(projets);

    const suivant = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Page suivante"]',
    );
    await act(async () => suivant?.click());
    expect(container.textContent).toContain('Page 2 sur 3');

    const chipFd = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => b.textContent?.startsWith('Fondations'));
    await act(async () => chipFd?.click());

    expect(texteLignes()).toHaveLength(1);
    expect(texteLignes()[0]).toContain('Projet FD unique');
    // Sous le seuil d'une page : les contrôles ne doivent plus apparaître.
    expect(container.querySelector('button[aria-label="Page suivante"]')).toBeNull();
    expect(container.textContent).not.toMatch(/Page \d+ sur \d+/);
  });

  it('#4 GIVEN le jeu de données usuel (4 projets) — WHEN la liste s’affiche — THEN aucun contrôle de pagination n’apparaît', async () => {
    await monter(PROJETS_ACTIFS, []);
    expect(container.querySelector('button[aria-label="Page suivante"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Page précédente"]')).toBeNull();
    expect(container.textContent).not.toMatch(/Page \d+ sur \d+/);
  });

  it('#5 GIVEN la page 2 — WHEN on tape une recherche — THEN la page revient à 1', async () => {
    await monter(fabriquerVingtCinqProjets());
    const suivant = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Page suivante"]',
    );
    await act(async () => suivant?.click());
    expect(container.textContent).toContain('Page 2 sur 3');

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Filtrer les projets"]',
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(input, 'Projet 0');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // « Projet 0 » matche Projet 01..09 (9 résultats) → 1 seule page,
    // contrôles masqués — preuve indirecte que la page est repassée à 1
    // (sinon une page 2 vide serait affichée en silence).
    expect(texteLignes()).toHaveLength(9);
    expect(container.querySelector('button[aria-label="Page suivante"]')).toBeNull();
  });
});
