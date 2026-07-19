/**
 * Tests — Topbar, fil d'Ariane par défaut (FX-11).
 *
 * Avant correctif : sur une page projet, le fil d'Ariane affichait
 * « Projet c7cb67c3… » (id tronqué) faute d'avoir le nom du projet sous la
 * main dans ce composant (Topbar est un frère de la route projet dans
 * l'arbre — ProjetLayoutClient, qui charge déjà le projet, n'est ni un
 * ancêtre ni un descendant). Après correctif : `getProjectCached` (source
 * partagée avec ProjetLayoutClient/PvListClient) résout le nom, affiché dans
 * le segment breadcrumb à la place de l'id tronqué.
 *
 * DoD §9 : given/when/then, chemin "pas encore résolu" testé autant que le
 * chemin heureux (pas de flash définitif sur l'id, juste un état transitoire).
 *
 * Patron d'interaction : react-dom/client + act (pas de @testing-library/react
 * dans ce dépôt — cf. PvListClient.test.tsx).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGetProjectCached, mockGetEntitlements, mockGetStoredUser, mockUsePathname } =
  vi.hoisted(() => ({
    mockGetProjectCached: vi.fn(),
    mockGetEntitlements: vi.fn(),
    mockGetStoredUser: vi.fn(() => null),
    mockUsePathname: vi.fn(),
  }));

vi.mock('@/lib/api/client', () => ({
  getProjectCached: mockGetProjectCached,
  getEntitlements: mockGetEntitlements,
  getStoredUser: mockGetStoredUser,
}));

vi.mock('next/navigation', () => ({
  usePathname: mockUsePathname,
}));

import { Topbar } from '../Topbar';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  mockGetProjectCached.mockReset();
  mockGetEntitlements.mockReset();
  mockGetEntitlements.mockRejectedValue({ statusCode: 404 }); // fail-quiet — hors périmètre du test
  mockUsePathname.mockReset();
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

async function renderTopbar() {
  await act(async () => {
    root = createRoot(container);
    root.render(<Topbar orgSlug="be-routes-dakar" />);
  });
  await flush();
}

describe("Topbar — fil d'Ariane par défaut sur une page projet (FX-11)", () => {
  it('given une page projet et le projet résolu, when la Topbar s’affiche, then le segment breadcrumb montre le nom du projet (pas l’id tronqué)', async () => {
    mockUsePathname.mockReturnValue('/app/be-routes-dakar/projets/proj_01/overview');
    mockGetProjectCached.mockResolvedValue({
      name: 'Route Dakar-Thiès — dimensionnement',
    });

    await renderTopbar();

    expect(mockGetProjectCached).toHaveBeenCalledWith('org_01', 'proj_01');
    expect(container.textContent).toContain('Route Dakar-Thiès — dimensionnement');
    // L'ancien repli sur l'id tronqué a disparu une fois le nom résolu.
    expect(container.textContent).not.toContain('Projet proj_01…');
  });

  it('given une page projet dont le nom n’est pas encore résolu, when la Topbar s’affiche, then repli transitoire sur l’id tronqué (jamais une exception)', async () => {
    mockUsePathname.mockReturnValue('/app/be-routes-dakar/projets/proj_01/overview');
    mockGetProjectCached.mockReturnValue(new Promise(() => {})); // ne se résout jamais dans le test

    await renderTopbar();

    expect(container.textContent).toContain('Projet proj_01…');
  });

  it('given une page hors contexte projet (liste des projets), when la Topbar s’affiche, then aucun appel projet n’est déclenché', async () => {
    mockUsePathname.mockReturnValue('/app/be-routes-dakar/projets');

    await renderTopbar();

    expect(mockGetProjectCached).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Mes projets');
  });
});
