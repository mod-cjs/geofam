/**
 * Tests — ancienne route /infos (maquette finale, écran 2/3).
 *
 * DÉCISION TITULAIRE : « Informations » disparaît en tant qu'onglet — cf.
 * ProjetLayoutClient (deux onglets : Calculs / PV scellés). Contenu RÉEL de
 * cette page (vérifié avant suppression) :
 *  - renommage du projet -> a DÉJÀ un autre point d'entrée (renommage en
 *    ligne depuis la liste des projets, P0-7 — cf.
 *    projets/__tests__/rename-inline.test.tsx) ;
 *  - archivage ("Supprimer ce projet") -> a DÉJÀ un autre point d'entrée
 *    (menu d'actions de la liste des projets, écran 1 — Archiver / Supprimer
 *    définitivement) ;
 *  - métadonnées en lecture (identifiant, domaine, dates) -> le domaine est
 *    déjà porté par la bande projet (DomainTag) ; identifiant et dates
 *    n'ont, eux, plus d'affichage dédié après cette suppression — signalé
 *    au commanditaire (pas une action, donc pas de blocage au sens du brief).
 *
 * Non-régression (même traitement que /overview, DoD §9) : cette route ne
 * doit PAS devenir un 404 — elle redirige vers l'onglet Calculs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRedirect = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));

import InfosPage from '../page';

beforeEach(() => {
  mockRedirect.mockReset();
  mockRedirect.mockImplementation(() => {
    throw new Error('NEXT_REDIRECT');
  });
});

describe('/infos — non-régression : ne devient jamais un 404', () => {
  it("given un lien ou signet vers l'ancienne route /infos, when la page est rendue, then elle redirige vers l'onglet Calculs du même projet", async () => {
    await expect(
      InfosPage({
        params: Promise.resolve({ orgSlug: 'starfire-recette', projetId: 'proj-1' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledWith(
      '/app/starfire-recette/projets/proj-1/calculs',
    );
  });

  it('given un autre orgSlug/projetId, when la page est rendue, then la redirection cible bien CE projet', async () => {
    await expect(
      InfosPage({
        params: Promise.resolve({ orgSlug: 'autre-org', projetId: 'proj-xyz' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledWith('/app/autre-org/projets/proj-xyz/calculs');
  });
});
