/**
 * P0 — barre d'outils de la liste des projets (écran 1, maquette validée
 * 21/07/2026, lignes 229-239) : recherche, compteurs Actifs/Archivés connus
 * SANS ouvrir la vue, chips de domaine avec effectif (multi-sélection
 * cumulative, domaine à 0 affiché mais désactivé — jamais masqué en
 * silence), indicateur de tri non retriable côté client.
 *
 * CONTRAT VERROUILLÉ (given/when/then)
 *  #1 le champ de recherche filtre par NOM et par DESCRIPTION, insensible à
 *     la casse et aux accents ;
 *  #2 les compteurs Actifs/Archivés sont connus dès le premier rendu, sans
 *     déclencher un second appel réseau au changement de vue ;
 *  #3 les chips de domaine portent l'effectif et sont cumulatifs ;
 *  #4 un domaine à effectif ZÉRO reste affiché, mais désactivé ;
 *  #5 l'indicateur de tri n'est PAS un bouton retriable côté client (le
 *     serveur fait foi sur l'ordre).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ORG_ID, ORG_SLUG, PROJETS_ACTIFS, PROJETS_ARCHIVES } from './fixtures';

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

async function monter(actifs = PROJETS_ACTIFS, archives = PROJETS_ARCHIVES) {
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

describe('Liste des projets — barre d’outils', () => {
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

  it('#1a GIVEN une recherche en MAJUSCULES — WHEN on tape un nom — THEN le filtrage est insensible à la casse', async () => {
    await monter();
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Filtrer les projets"]',
    );
    expect(input).not.toBeNull();
    expect(input?.placeholder).toBe('Filtrer par nom ou description');

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(input, 'MBODIENE');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const lignes = texteLignes();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toContain('Pont de Mbodiène');
  });

  it('#1b GIVEN une recherche SANS accent — WHEN le nom réel porte un accent — THEN il matche quand même', async () => {
    await monter();
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Filtrer les projets"]',
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(input, 'etude');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const lignes = texteLignes();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toContain('Étude');
  });

  it('#1c GIVEN une recherche qui ne matche QUE la description — WHEN on tape — THEN le projet ressort quand même', async () => {
    await monter();
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Filtrer les projets"]',
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(input, 'reconnaissance préalable');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const lignes = texteLignes();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toContain('Étude');
  });

  it('#2 GIVEN le premier rendu — WHEN on bascule sur Archivés — THEN les compteurs sont déjà connus et AUCUN second appel réseau n’est déclenché', async () => {
    await monter();
    expect(mockListProjects).toHaveBeenCalledTimes(1);
    expect(mockListArchived).toHaveBeenCalledTimes(1);

    const groupe = container.querySelector('[aria-label="Filtrer par état"]');
    expect(groupe?.textContent).toContain('Actifs');
    expect(groupe?.textContent).toContain('4');
    expect(groupe?.textContent).toContain('Archivés');
    expect(groupe?.textContent).toContain('0');

    const boutonArchives = Array.from(groupe?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.startsWith('Archivés'),
    );
    await act(async () => boutonArchives?.click());

    // Le passage à la vue Archivés ne doit PAS redéclencher les deux appels :
    // les compteurs étaient déjà connus au premier chargement.
    expect(mockListProjects).toHaveBeenCalledTimes(1);
    expect(mockListArchived).toHaveBeenCalledTimes(1);
  });

  it('#3 GIVEN les chips de domaine — WHEN on en sélectionne deux — THEN le filtrage est CUMULATIF (union)', async () => {
    await monter();
    const chips = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[aria-pressed]'),
    ).filter((b) => /Chaussées|Fondations|Laboratoire/.test(b.textContent ?? ''));
    const chipFd = chips.find((b) => b.textContent?.startsWith('Fondations'));
    const chipLb = chips.find((b) => b.textContent?.startsWith('Laboratoire'));
    expect(chipFd?.textContent).toContain('1');
    expect(chipLb?.textContent).toContain('1');

    await act(async () => chipFd?.click());
    expect(texteLignes()).toHaveLength(1);
    expect(chipFd?.getAttribute('aria-pressed')).toBe('true');

    await act(async () => chipLb?.click());
    expect(texteLignes()).toHaveLength(2);
    expect(texteLignes().some((t) => t.includes('Pont de Mbodiène'))).toBe(true);
    expect(texteLignes().some((t) => t.includes('Étude'))).toBe(true);
  });

  it('#4 GIVEN un domaine à effectif ZÉRO — WHEN la liste s’affiche — THEN le chip reste visible mais désactivé', async () => {
    // Jeu de données SANS aucun projet Laboratoire.
    const sansLb = PROJETS_ACTIFS.filter((p) => p.domain !== 'LB');
    await monter(sansLb, []);
    const chipLb = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => b.textContent?.startsWith('Laboratoire'));
    expect(chipLb).not.toBeUndefined();
    expect(chipLb?.textContent).toContain('0');
    expect(chipLb?.disabled).toBe(true);
  });

  it('#5 GIVEN l’indicateur de tri — WHEN la liste s’affiche — THEN ce N’EST PAS un bouton retriable côté client', async () => {
    await monter();
    expect(container.textContent).toContain('Dernière activité');
    const boutonTri = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Dernière activité'),
    );
    // Aucun bouton cliquable ne doit porter ce libellé : un vrai basculeur ne
    // pourrait proposer que des ordres que le serveur sait rendre, et le
    // serveur ne rend QUE l'activité décroissante aujourd'hui.
    expect(boutonTri).toBeUndefined();
  });
});
