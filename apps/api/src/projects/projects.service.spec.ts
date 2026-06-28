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
  let tx: { project: { findUnique: jest.Mock } };
  let prisma: { withTenant: jest.Mock };
  let service: ProjectsService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx = { project: { findUnique: jest.fn() } };
    prisma = {
      withTenant: jest.fn(
        (_orgId: string, fn: (t: Prisma.TransactionClient) => unknown) =>
          fn(tx as unknown as Prisma.TransactionClient),
      ),
    };
    service = new ProjectsService(prisma as unknown as PrismaService);
  });

  it('given un projet existant : le renvoie via withTenant(orgId du contexte)', async () => {
    const project = { id: 'proj-1', orgId: ORG_ID } as unknown as Project;
    tx.project.findUnique.mockResolvedValue(project);

    const out = await withOrg(() => service.getById('proj-1'));
    expect(out).toBe(project);
    expect(prisma.withTenant).toHaveBeenCalledWith(
      ORG_ID,
      expect.any(Function),
    );
    expect(tx.project.findUnique).toHaveBeenCalledWith({
      where: { id: 'proj-1' },
    });
  });

  it('given un id absent / masque par la RLS : renvoie null (le 404 est rendu par le controleur)', async () => {
    tx.project.findUnique.mockResolvedValue(null);
    await expect(
      withOrg(() => service.getById('proj-autre-org')),
    ).resolves.toBeNull();
  });
});
