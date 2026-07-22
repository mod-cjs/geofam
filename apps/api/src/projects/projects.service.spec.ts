import type { Prisma, Project } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';
import { tenantStorage } from '../tenant/tenant-context';

import { ProjectsService } from './projects.service';

/**
 * ProjectsService.getById — lecture detail d'un projet, scope tenant.
 *
 * Prouve que la lecture passe TOUJOURS par withTenant(orgId) (RLS scope) et que
 * l'org provient du contexte tenant (ALS), jamais d'un parametre client. Le
 * comportement « null pour absent/hors tenant » est preserve (le controleur le
 * traduit en 404 tenant-safe). L'isolation REELLE (RLS, cross-org -> invisible)
 * est prouvee par les e2e contre Postgres reel (qa-test) ; ici la base est
 * stubbee — aucun vert d'integration fabrique.
 */
const ORG_ID = '22222222-2222-2222-2222-222222222222';

function withOrg<T>(fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ orgId: ORG_ID, userId: 'user-1' }, fn);
}

describe('ProjectsService.getById', () => {
  let tx: {
    project: {
      findFirst: jest.Mock;
      updateMany: jest.Mock;
    };
    // P0-1 : la lecture detail porte desormais les compteurs de contenu
    // (calculs / PV), agreges par `count` et non par un findMany —
    // cf. projects-counts.service.spec.ts.
    // P0-1/P0-3 : getById ramene compte ET date la plus recente via `aggregate`.
    calcResult: { aggregate: jest.Mock };
    officialPv: { aggregate: jest.Mock };
  };
  let prisma: { withTenant: jest.Mock };
  let service: ProjectsService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx = {
      project: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      calcResult: {
        aggregate: jest.fn().mockResolvedValue({
          _count: { _all: 0 },
          _max: { createdAt: null },
        }),
      },
      officialPv: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _count: { _all: 0 }, _max: { sealedAt: null } }),
      },
    };
    prisma = {
      withTenant: jest.fn(
        (_orgId: string, fn: (t: Prisma.TransactionClient) => unknown) =>
          fn(tx as unknown as Prisma.TransactionClient),
      ),
    };
    service = new ProjectsService(prisma as unknown as PrismaService);
  });

  it('given un projet existant : le renvoie via withTenant(orgId du contexte), en excluant les archives', async () => {
    const project = { id: 'proj-1', orgId: ORG_ID } as unknown as Project;
    tx.project.findFirst.mockResolvedValue(project);

    const out = await withOrg(() => service.getById('proj-1'));
    // P0-1 : la lecture detail ne renvoie plus la ligne BRUTE mais une copie
    // enrichie des compteurs de contenu — d'ou toMatchObject et non toBe.
    // Les champs de la ligne restent rendus a l'identique.
    expect(out).toMatchObject({ id: 'proj-1', orgId: ORG_ID });
    expect(out).toMatchObject({ calcCount: 0, pvCount: 0 });
    expect(prisma.withTenant).toHaveBeenCalledWith(
      ORG_ID,
      expect.any(Function),
    );
    // findFirst filtre l'id ET exclut les projets ARCHIVED (soft-delete invisible).
    expect(tx.project.findFirst).toHaveBeenCalledWith({
      where: { id: 'proj-1', status: { not: 'ARCHIVED' } },
    });
  });

  it('given un id absent / masque par la RLS : renvoie null (le 404 est rendu par le controleur)', async () => {
    tx.project.findFirst.mockResolvedValue(null);
    await expect(
      withOrg(() => service.getById('proj-autre-org')),
    ).resolves.toBeNull();
  });
});

/**
 * ProjectsService.rename / archive — mutations de cycle de vie, scope tenant.
 *
 * Prouve (base stubbee : pas de vrai vert d'integration ici, l'isolation reelle
 * est aux e2e) que :
 *  - rename/archive passent par withTenant(orgId du contexte) ;
 *  - updateMany (et non update) est utilise pour rester tenant-safe (count=0 ->
 *    null -> 404, jamais un P2025) et exclure les projets deja ARCHIVED ;
 *  - archive ecrit status=ARCHIVED (soft-delete), sans DELETE physique.
 */
describe('ProjectsService.create — persiste le domaine metier', () => {
  let tx: { project: { create: jest.Mock } };
  let prisma: { withTenant: jest.Mock };
  let service: ProjectsService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx = { project: { create: jest.fn() } };
    prisma = {
      withTenant: jest.fn(
        (_orgId: string, fn: (t: Prisma.TransactionClient) => unknown) =>
          fn(tx as unknown as Prisma.TransactionClient),
      ),
    };
    service = new ProjectsService(prisma as unknown as PrismaService);
  });

  it('given {name, domain, createdById} : INSERT porte orgId du contexte + domain (jamais un domaine par defaut silencieux)', async () => {
    const created = {
      id: 'p1',
      name: 'Forage',
      domain: 'FD',
    } as unknown as Project;
    tx.project.create.mockResolvedValue(created);

    const out = await withOrg(() =>
      service.create({ name: 'Forage', domain: 'FD', createdById: 'user-1' }),
    );
    expect(out).toBe(created);
    expect(prisma.withTenant).toHaveBeenCalledWith(
      ORG_ID,
      expect.any(Function),
    );
    // Le domaine est persiste tel quel ; l'orgId vient du contexte (jamais du client).
    expect(tx.project.create).toHaveBeenCalledWith({
      data: {
        orgId: ORG_ID,
        name: 'Forage',
        domain: 'FD',
        createdById: 'user-1',
        // P0-5 : `null` explicite et non `''` — absence de description et
        // description vide sont deux choses differentes.
        description: null,
      },
    });
  });
});

describe('ProjectsService.rename / archive', () => {
  let tx: {
    project: {
      findFirst: jest.Mock;
      updateMany: jest.Mock;
    };
    // P0-1 : la lecture detail porte desormais les compteurs de contenu
    // (calculs / PV), agreges par `count` et non par un findMany —
    // cf. projects-counts.service.spec.ts.
    // P0-1/P0-3 : getById ramene compte ET date la plus recente via `aggregate`.
    calcResult: { aggregate: jest.Mock };
    officialPv: { aggregate: jest.Mock };
  };
  let prisma: { withTenant: jest.Mock };
  let service: ProjectsService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx = {
      project: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      calcResult: {
        aggregate: jest.fn().mockResolvedValue({
          _count: { _all: 0 },
          _max: { createdAt: null },
        }),
      },
      officialPv: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _count: { _all: 0 }, _max: { sealedAt: null } }),
      },
    };
    prisma = {
      withTenant: jest.fn(
        (_orgId: string, fn: (t: Prisma.TransactionClient) => unknown) =>
          fn(tx as unknown as Prisma.TransactionClient),
      ),
    };
    service = new ProjectsService(prisma as unknown as PrismaService);
  });

  it('rename : updateMany scope (id + non archive) puis relit le projet a jour', async () => {
    tx.project.updateMany.mockResolvedValue({ count: 1 });
    const renamed = {
      id: 'proj-1',
      name: 'Nouveau',
    } as unknown as Project;
    tx.project.findFirst.mockResolvedValue(renamed);

    const out = await withOrg(() => service.rename('proj-1', 'Nouveau'));
    expect(out).toBe(renamed);
    expect(tx.project.updateMany).toHaveBeenCalledWith({
      where: { id: 'proj-1', status: { not: 'ARCHIVED' } },
      data: { name: 'Nouveau' },
    });
  });

  it('rename : rien affecte (absent/hors-tenant/archive) -> null (404 par le controleur)', async () => {
    tx.project.updateMany.mockResolvedValue({ count: 0 });
    const out = await withOrg(() => service.rename('proj-x', 'X'));
    expect(out).toBeNull();
    // Aucune relecture inutile si rien n'a ete modifie.
    expect(tx.project.findFirst).not.toHaveBeenCalled();
  });

  it('archive : soft-delete via status=ARCHIVED (jamais de DELETE physique)', async () => {
    tx.project.updateMany.mockResolvedValue({ count: 1 });
    const archived = {
      id: 'proj-1',
      status: 'ARCHIVED',
    } as unknown as Project;
    tx.project.findFirst.mockResolvedValue(archived);

    const out = await withOrg(() => service.archive('proj-1'));
    expect(out).toBe(archived);
    const appels = tx.project.updateMany.mock.calls as Array<
      [{ where: unknown; data: { status: string; archivedAt: unknown } }]
    >;
    expect(appels).toHaveLength(1);
    const appel = appels[0][0];
    expect(appel.where).toEqual({ id: 'proj-1', status: { not: 'ARCHIVED' } });
    expect(appel.data.status).toBe('ARCHIVED');
    // archivedAt (0026) : la date du geste est posee ICI et nulle part ailleurs.
    // Sans elle, la vue « Archives » ne peut ni dater ni trier.
    expect(appel.data.archivedAt).toBeInstanceOf(Date);
  });

  it('archive : deja archive / absent -> null (404 par le controleur)', async () => {
    tx.project.updateMany.mockResolvedValue({ count: 0 });
    const out = await withOrg(() => service.archive('proj-x'));
    expect(out).toBeNull();
    expect(tx.project.findFirst).not.toHaveBeenCalled();
  });
});
