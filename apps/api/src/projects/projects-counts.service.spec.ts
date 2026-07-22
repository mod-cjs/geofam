import type { PrismaService } from '../prisma/prisma.service';
import { tenantStorage } from '../tenant/tenant-context';

import { ProjectsService } from './projects.service';

/**
 * P0-1 — COMPTEURS SERVIS PAR L'API (calculs / PV) sur la liste des projets.
 *
 * POURQUOI CE TEST EXISTE
 * -----------------------
 * Le front affichait ces deux nombres en appelant `listCalcResults` +
 * `listPvs`, c'est-a-dire en telechargeant les LIGNES ENTIERES (`output` JSONB
 * compris) uniquement pour en compter la longueur. Mesure reelle sur la base de
 * recette : ouvrir UN projet transferait 4,05 Mo, dont ~2,5 Mo pour ces seuls
 * compteurs, la liste des calculs etant meme telechargee DEUX fois.
 *
 * Regle d'API que ce test verrouille : **une liste ne sert jamais a compter.**
 *
 * CE QUE CE FICHIER VERROUILLE (given/when/then, esprit mutation)
 * --------------------------------------------------------------
 *  #1 les compteurs sont AGREGES en base (groupBy), jamais deduits d'un
 *     findMany : si quelqu'un revient a un findMany + .length, le test tombe.
 *  #2 l'agregation est TENANT-SCOPEE : elle passe par withTenant(orgId), et
 *     l'orgId vient du contexte (ALS), jamais d'un parametre client — sinon un
 *     appelant pourrait compter les calculs d'un autre bureau d'etudes.
 *  #3 le nombre de requetes est CONSTANT (2 agregations pour tout le tenant),
 *     pas proportionnel au nombre de projets : pas de N+1 a 200 projets.
 *  #4 un projet SANS calcul ni PV renvoie 0 et 0 — pas `undefined`, pour que le
 *     front distingue « zero » de « pas encore connu » (il n'affiche la pastille
 *     que si la valeur est connue).
 *
 * L'isolation REELLE (RLS, cross-org invisible) est prouvee par les e2e contre
 * Postgres reel ; ici la base est stubbee — aucun vert d'integration fabrique.
 */
const ORG_ID = '22222222-2222-2222-2222-222222222222';
const AUTRE_ORG = '33333333-3333-3333-3333-333333333333';

function withOrg<T>(fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ orgId: ORG_ID, userId: 'user-1' }, fn);
}

const PROJET_A = {
  id: 'proj-a',
  orgId: ORG_ID,
  name: 'Pont de Mbodiène — fondations',
  domain: 'FD',
  status: 'DRAFT',
  createdById: 'user-1',
  createdAt: new Date('2026-07-17T12:21:00Z'),
  updatedAt: new Date('2026-07-17T12:21:00Z'),
};
const PROJET_B = {
  id: 'proj-b',
  orgId: ORG_ID,
  name: 'Projet sans aucun calcul',
  domain: 'CH',
  status: 'DRAFT',
  createdById: 'user-1',
  createdAt: new Date('2026-07-18T09:00:00Z'),
  updatedAt: new Date('2026-07-18T09:00:00Z'),
};

describe('ProjectsService.list — compteurs calculs/PV servis par l’API', () => {
  let tx: {
    project: { findMany: jest.Mock };
    calcResult: { groupBy: jest.Mock; findMany: jest.Mock };
    officialPv: { groupBy: jest.Mock; findMany: jest.Mock };
  };
  let prisma: { withTenant: jest.Mock };
  let service: ProjectsService;
  let orgVue: string | undefined;

  beforeEach(() => {
    orgVue = undefined;
    tx = {
      project: { findMany: jest.fn().mockResolvedValue([PROJET_A, PROJET_B]) },
      calcResult: {
        // 40 calculs sur le projet A, aucun sur le projet B.
        groupBy: jest
          .fn()
          .mockResolvedValue([{ projectId: 'proj-a', _count: { _all: 40 } }]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      officialPv: {
        groupBy: jest
          .fn()
          .mockResolvedValue([{ projectId: 'proj-a', _count: { _all: 4 } }]),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    prisma = {
      withTenant: jest.fn((orgId: string, cb: (t: typeof tx) => unknown) => {
        orgVue = orgId;
        return cb(tx);
      }),
    };
    service = new ProjectsService(prisma as unknown as PrismaService);
  });

  it('GIVEN un projet à 40 calculs et 4 PV — WHEN list — THEN les compteurs sont renvoyés', async () => {
    const projets = await withOrg(() => service.list());
    const a = projets.find((p) => p.id === 'proj-a');
    expect(a?.calcCount).toBe(40);
    expect(a?.pvCount).toBe(4);
  });

  it('GIVEN un projet sans calcul ni PV — WHEN list — THEN 0 et 0, jamais undefined', async () => {
    const projets = await withOrg(() => service.list());
    const b = projets.find((p) => p.id === 'proj-b');
    // `undefined` signifierait « inconnu » cote front (pas de pastille) : ici la
    // valeur EST connue et vaut zero. La distinction est le contrat.
    expect(b?.calcCount).toBe(0);
    expect(b?.pvCount).toBe(0);
  });

  it('GIVEN la liste — WHEN list — THEN les compteurs viennent d’une AGRÉGATION, pas d’un findMany', async () => {
    await withOrg(() => service.list());
    expect(tx.calcResult.groupBy).toHaveBeenCalledTimes(1);
    expect(tx.officialPv.groupBy).toHaveBeenCalledTimes(1);
    // Sentinelle anti-regression : revenir a « telecharger la liste puis
    // compter » est precisement la regression de 2,5 Mo que ce lot corrige.
    expect(tx.calcResult.findMany).not.toHaveBeenCalled();
    expect(tx.officialPv.findMany).not.toHaveBeenCalled();
  });

  it('GIVEN 2 projets — WHEN list — THEN le nombre de requêtes reste CONSTANT (pas de N+1)', async () => {
    await withOrg(() => service.list());
    // 2 agregations pour TOUT le tenant, quel que soit le nombre de projets.
    const total =
      tx.calcResult.groupBy.mock.calls.length +
      tx.officialPv.groupBy.mock.calls.length;
    expect(total).toBe(2);
  });

  it('GIVEN un contexte tenant — WHEN list — THEN l’agrégation est scopée sur l’org du contexte', async () => {
    await withOrg(() => service.list());
    // L'org vient de l'ALS, jamais d'un parametre client : sans cela, un
    // appelant pourrait compter les calculs d'un autre bureau d'etudes.
    expect(orgVue).toBe(ORG_ID);
    expect(orgVue).not.toBe(AUTRE_ORG);
    expect(prisma.withTenant).toHaveBeenCalledWith(
      ORG_ID,
      expect.any(Function),
    );
  });
});
