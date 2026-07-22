/**
 * Tests — ancienne route /overview (F-02 bis, maquette finale écran 2).
 *
 * DÉCISION TITULAIRE : « Vue d'ensemble » disparaît en tant qu'onglet — cf.
 * ProjetLayoutClient (deux onglets : Calculs / PV scellés). Cette route ne
 * doit PAS pour autant devenir un 404 : des liens et des signets existent.
 * Non-régression exigée par le brief (DoD §9) : elle redirige vers l'onglet
 * Calculs, sur le même patron que la racine /projets/:id (cf. ../../page.tsx,
 * F-02).
 *
 * L'ancien contenu de cette page (StatCards + derniers calculs/PV, FX-10) est
 * retiré avec elle : ses seules informations réelles (compteurs) sont déjà
 * portées par les pastilles d'onglet de ProjetLayoutClient — cf.
 * ProjetLayoutClient.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRedirect = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));

import OverviewPage from '../page';

beforeEach(() => {
  mockRedirect.mockReset();
  // `redirect()` réel interrompt le rendu en lançant — on reproduit ce
  // contrat pour vérifier qu'aucun code ne s'exécute après l'appel.
  mockRedirect.mockImplementation(() => {
    throw new Error('NEXT_REDIRECT');
  });
});

describe('/overview — non-régression : ne devient jamais un 404', () => {
  it("given un lien ou signet vers l'ancienne route /overview, when la page est rendue, then elle redirige vers l'onglet Calculs du même projet", async () => {
    await expect(
      OverviewPage({
        params: Promise.resolve({ orgSlug: 'starfire-recette', projetId: 'proj-1' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledWith(
      '/app/starfire-recette/projets/proj-1/calculs',
    );
  });

  it('given un autre orgSlug/projetId, when la page est rendue, then la redirection cible bien CE projet (pas une route en dur)', async () => {
    await expect(
      OverviewPage({
        params: Promise.resolve({ orgSlug: 'autre-org', projetId: 'proj-xyz' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(mockRedirect).toHaveBeenCalledWith('/app/autre-org/projets/proj-xyz/calculs');
  });
});
