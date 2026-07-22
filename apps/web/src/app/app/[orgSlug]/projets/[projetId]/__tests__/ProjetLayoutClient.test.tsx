/**
 * P0-1 (suite de revue adverse) — COMPORTEMENT des pastilles de compteur.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * Le lot P0-1 revendiquait trois invariants d'affichage qui n'étaient couverts
 * par AUCUN test : la revue adverse l'a relevé (« la moitié du lot n'est
 * couverte par rien »). Une régression réintroduisant un `?? 0`, ou un appel de
 * liste dans le layout, serait passée au vert.
 *
 * CONTRAT VERROUILLÉ (given/when/then)
 *  #1 valeur CONNUE -> pastille affichée, et le compte est porté par
 *     l'`aria-label` de l'onglet (la pastille est décorative) ;
 *  #2 valeur INCONNUE (`undefined`, backend ancien / mock) -> AUCUNE pastille,
 *     et aucun `aria-label` chiffré : mieux vaut rien qu'un « 0 » qui se
 *     lirait « projet vide » pendant le chargement ;
 *  #3 valeur CONNUE et NULLE (`0`) -> pastille « 0 » bien affichée : c'est une
 *     information, pas une absence. C'est le piège que `?? 0` / `|| 0`
 *     inverserait silencieusement ;
 *  #4 SENTINELLE ANTI-RÉGRESSION : le layout ne doit appeler AUCUNE liste.
 *     Les compteurs déduits de `listCalcResults` + `listPvs` coûtaient 2,5 Mo
 *     par ouverture de projet — c'est la régression que P0-1 corrige.
 *
 * Patron d'interaction : react-dom/client + act (pas de @testing-library/react
 * dans ce dépôt — cf. PvListClient.test.tsx).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGetProjectCached, mockListCalcResults, mockListPvs } = vi.hoisted(() => ({
  mockGetProjectCached: vi.fn(),
  mockListCalcResults: vi.fn(),
  mockListPvs: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  getProjectCached: mockGetProjectCached,
  listCalcResults: mockListCalcResults,
  listPvs: mockListPvs,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/starfire/projets/proj-1/calculs',
}));
vi.mock('@/lib/org-context', () => ({ useOrgId: () => 'org-1' }));
vi.mock('next/link', () => ({
  default: ({ children, ...rest }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a {...(rest as Record<string, never>)}>{children}</a>
  ),
}));

import ProjetLayoutClient from '../ProjetLayoutClient';

const PROJET_BASE = {
  id: 'proj-1',
  orgId: 'org-1',
  name: 'Pont de Mbodiène — fondations',
  domain: 'FD' as const,
  createdAt: '2026-07-17T12:21:00.000Z',
  updatedAt: '2026-07-17T12:21:00.000Z',
  createdBy: 'user-1',
};

let container: HTMLDivElement;
let root: Root;

async function monter(projet: Record<string, unknown>) {
  mockGetProjectCached.mockResolvedValue(projet);
  await act(async () => {
    root.render(
      <ProjetLayoutClient orgSlug="starfire" projetId="proj-1">
        <div />
      </ProjetLayoutClient>,
    );
  });
}

/** Onglet par son identifiant stable, indépendant du libellé affiché. */
function onglet(id: string): HTMLElement | null {
  return container.querySelector(`#tab-${id}`);
}

describe('ProjetLayoutClient — pastilles de compteur', () => {
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

  it('#1 GIVEN des compteurs connus — WHEN rendu — THEN pastilles affichées et comptes portés par aria-label', async () => {
    await monter({ ...PROJET_BASE, calcCount: 40, pvCount: 4 });

    expect(onglet('calculs')?.textContent).toContain('40');
    expect(onglet('pv')?.textContent).toContain('4');
    // La pastille est décorative : sans aria-label, le compte serait perdu à l'oral.
    expect(onglet('calculs')?.getAttribute('aria-label')).toBe('Calculs (40)');
    expect(onglet('pv')?.getAttribute('aria-label')).toBe('PV scellés (4)');
  });

  it('#2 GIVEN des compteurs INCONNUS (backend ancien) — WHEN rendu — THEN aucune pastille, aucun aria-label chiffré', async () => {
    await monter({ ...PROJET_BASE }); // ni calcCount ni pvCount

    // Aucun chiffre ne doit apparaître : afficher « 0 » ferait lire
    // « projet vide » alors que la valeur n'est simplement pas connue.
    expect(onglet('calculs')?.textContent).toBe('Calculs');
    expect(onglet('pv')?.textContent).toBe('PV scellés');
    expect(onglet('calculs')?.getAttribute('aria-label')).toBeNull();
    expect(onglet('pv')?.getAttribute('aria-label')).toBeNull();
  });

  it('#3 GIVEN des compteurs à ZÉRO — WHEN rendu — THEN la pastille « 0 » est bien affichée', async () => {
    await monter({ ...PROJET_BASE, calcCount: 0, pvCount: 0 });

    // Piège inverse du #2 : `?? 0` / `|| 0` confondrait ce cas avec l'inconnu
    // et effacerait une pastille pourtant légitime.
    expect(onglet('calculs')?.textContent).toContain('0');
    expect(onglet('calculs')?.getAttribute('aria-label')).toBe('Calculs (0)');
    expect(onglet('pv')?.getAttribute('aria-label')).toBe('PV scellés (0)');
  });

  it('#4 SENTINELLE — WHEN rendu — THEN le layout n’appelle AUCUNE liste', async () => {
    await monter({ ...PROJET_BASE, calcCount: 40, pvCount: 4 });

    // Régression corrigée par P0-1 : ces deux appels téléchargeaient les lignes
    // entières (`output` JSONB compris) pour n'en lire que la longueur —
    // 2,5 Mo par ouverture de projet. Une liste ne sert jamais à compter.
    expect(mockListCalcResults).not.toHaveBeenCalled();
    expect(mockListPvs).not.toHaveBeenCalled();
    // Une seule lecture, celle du projet (partagée via le cache).
    expect(mockGetProjectCached).toHaveBeenCalledTimes(1);
  });

  it('#5 GIVEN la maquette finale (deux onglets) — WHEN rendu — THEN « Vue d’ensemble » et « Informations » ont disparu, seuls Calculs et PV scellés restent', async () => {
    await monter({ ...PROJET_BASE, calcCount: 40, pvCount: 4 });

    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(tabs).toHaveLength(2);
    expect(onglet('calculs')).not.toBeNull();
    expect(onglet('pv')).not.toBeNull();
    expect(onglet('overview')).toBeNull();
    expect(onglet('infos')).toBeNull();
    expect(container.textContent).not.toContain("Vue d'ensemble");
    expect(container.textContent).not.toContain('Informations');
  });
});
