// @vitest-environment node
/**
 * P0-1 — l'adaptateur projet doit PROPAGER les compteurs servis par l'API.
 *
 * POURQUOI CE TEST EXISTE (bug réellement rencontré)
 * --------------------------------------------------
 * `adaptProject` reconstruit l'objet champ par champ. Quand l'API a commencé à
 * renvoyer `calcCount` / `pvCount`, l'adaptateur les a silencieusement laissés
 * tomber : l'API répondait bien `calcCount: 40`, et les pastilles d'onglet ont
 * malgré tout disparu de l'écran. Aucun test ne l'a vu — d'où celui-ci.
 *
 * C'est le risque structurel d'un adaptateur en liste blanche : il est sûr
 * (rien d'inattendu ne passe) mais il oublie en silence. La sentinelle ci-dessous
 * échoue dès qu'un compteur cesse d'être propagé.
 *
 * CONTRAT VERROUILLÉ (given/when/then)
 *  #1 les compteurs présents dans la réponse sont propagés tels quels ;
 *  #2 `0` est propagé comme `0` — et surtout PAS transformé en `undefined` :
 *     `undefined` signifie « pas encore connu » (aucune pastille affichée),
 *     `0` signifie « connu et vide ». Les confondre fait disparaître un
 *     compteur légitime ;
 *  #3 leur absence (backend plus ancien, mock) reste `undefined` — jamais 0,
 *     sinon on afficherait « projet vide » pour un projet non chargé.
 */

import { describe, it, expect } from 'vitest';

import { adaptProject, type PrismaProject } from '../adapters';

function brut(over: Partial<PrismaProject> = {}): PrismaProject {
  return {
    id: 'proj-1',
    orgId: 'org-1',
    name: 'Pont de Mbodiène — fondations',
    domain: 'FD',
    createdAt: '2026-07-17T12:21:00.000Z',
    updatedAt: '2026-07-17T12:21:00.000Z',
    createdById: 'user-1',
    ...over,
  } as PrismaProject;
}

describe('adaptProject — propagation des compteurs de contenu', () => {
  it('GIVEN une réponse avec 40 calculs et 4 PV — WHEN adaptProject — THEN les compteurs sont propagés', () => {
    const p = adaptProject(brut({ calcCount: 40, pvCount: 4 } as Partial<PrismaProject>));
    expect(p.calcCount).toBe(40);
    expect(p.pvCount).toBe(4);
  });

  it('GIVEN des compteurs à zéro — WHEN adaptProject — THEN 0 est propagé, jamais transformé en undefined', () => {
    const p = adaptProject(brut({ calcCount: 0, pvCount: 0 } as Partial<PrismaProject>));
    // Piège classique : un `|| undefined` ou un `?? undefined` ferait passer 0
    // pour « inconnu » et effacerait une pastille pourtant légitime.
    expect(p.calcCount).toBe(0);
    expect(p.pvCount).toBe(0);
  });

  it('GIVEN une réponse SANS compteur (backend ancien) — WHEN adaptProject — THEN undefined, jamais 0', () => {
    const p = adaptProject(brut());
    // `undefined` = pas encore connu -> l'UI n'affiche aucune pastille.
    // Mettre 0 ici ferait lire « projet vide » à tort.
    expect(p.calcCount).toBeUndefined();
    expect(p.pvCount).toBeUndefined();
  });

  it('GIVEN une réponse enrichie — WHEN adaptProject — THEN les champs historiques restent intacts', () => {
    const p = adaptProject(brut({ calcCount: 7, pvCount: 0 } as Partial<PrismaProject>));
    expect(p.id).toBe('proj-1');
    expect(p.name).toBe('Pont de Mbodiène — fondations');
    expect(p.domain).toBe('FD');
    // #8 — le champ réel du backend est `createdById`, exposé en `createdBy`.
    expect(p.createdBy).toBe('user-1');
  });
});
