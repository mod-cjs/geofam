import type { PrismaService } from '../prisma/prisma.service';
import { tenantStorage } from '../tenant/tenant-context';

import { ProjectsService } from './projects.service';

/**
 * P0-8 — RESTAURATION D'UN PROJET ARCHIVÉ.
 *
 * LE DÉFAUT CORRIGÉ — une interface qui FAIT AGIR sur du faux
 * -----------------------------------------------------------
 * La modale de suppression affirme, mot pour mot :
 *
 *   « Cette action peut être annulée par un administrateur si besoin. »
 *
 * Verifie : il n'existait AUCUN endpoint de restauration, aucun endpoint admin
 * sur les projets, et TOUTES les lectures excluent `ARCHIVED` (list, getById,
 * rename). Un projet archive etait donc irrecuperable sans SQL manuel.
 *
 * C'est le plus grave des defauts du diagnostic : les autres AFFICHENT du faux
 * (tri, dates, description avalee), celui-ci FAIT AGIR sur du faux. L'ecran
 * rassure l'utilisateur pour lui faire franchir une action destructive, sur la
 * foi d'une garantie qui n'existe pas.
 *
 * CE QUE CE FICHIER VERROUILLE (given/when/then, esprit mutation)
 * --------------------------------------------------------------
 *  #1 restaurer un projet archive le repasse en ACTIVE et le rend a nouveau
 *     visible — la promesse de la modale devient vraie ;
 *  #2 l'ecriture PASSE PAR withTenant avec l'orgId du contexte ALS (jamais un
 *     parametre client). ATTENTION A LA PORTEE : ceci prouve la PLOMBERIE, pas
 *     l'isolation. La base est stubbee ici — ni SET LOCAL, ni RLS, ni WITH
 *     CHECK ne sont exerces. L'isolation REELLE (orgB restaure un projet
 *     d'orgA -> 404 ET la ligne d'orgA reste ARCHIVED) est prouvee contre
 *     Postgres reel dans test/projects-restore.e2e-spec.ts ;
 *  #3 restaurer un projet ACTIF, ABSENT ou HORS-TENANT renvoie `null`
 *     (updateMany -> count 0), traduit en 404 tenant-safe par le controleur :
 *     « n'existe pas » et « pas chez vous » restent indiscernables ;
 *  #4 IDEMPOTENCE : restaurer deux fois ne leve pas, la seconde renvoie null.
 */
const ORG_ID = '22222222-2222-2222-2222-222222222222';

function withOrg<T>(fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ orgId: ORG_ID, userId: 'user-1' }, fn);
}

describe('ProjectsService.restore — annuler un archivage', () => {
  let tx: {
    project: { updateMany: jest.Mock; findFirst: jest.Mock };
  };
  let prisma: { withTenant: jest.Mock };
  let service: ProjectsService;
  let orgVue: string | undefined;

  beforeEach(() => {
    orgVue = undefined;
    tx = {
      project: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'proj-1', orgId: ORG_ID, status: 'ACTIVE' }),
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

  it('#1 GIVEN un projet ARCHIVED — WHEN restore — THEN il repasse en ACTIVE', async () => {
    const out = await withOrg(() => service.restore('proj-1'));

    // La cible est bien un projet ARCHIVE : restaurer un projet actif n'a pas
    // de sens et doit rester un 404 (cf. #3).
    expect(tx.project.updateMany).toHaveBeenCalledWith({
      where: { id: 'proj-1', status: 'ARCHIVED' },
      // archivedAt remis a null (0026) : un projet redevenu actif ne conserve pas
      // la trace d'un archivage annule, sinon la vue « Archives » daterait un
      // geste qui n'a plus cours.
      data: { status: 'ACTIVE', archivedAt: null },
    });
    expect(out).toMatchObject({ id: 'proj-1', status: 'ACTIVE' });
  });

  it('#2 GIVEN un contexte tenant — WHEN restore — THEN l’écriture est scopée sur l’org du contexte', async () => {
    await withOrg(() => service.restore('proj-1'));
    // L'org vient de l'ALS, jamais d'un parametre client : sinon on pourrait
    // restaurer — donc rendre visible — le projet d'un autre bureau d'etudes.
    expect(orgVue).toBe(ORG_ID);
    expect(prisma.withTenant).toHaveBeenCalledWith(
      ORG_ID,
      expect.any(Function),
    );
  });

  it('#3 GIVEN un projet ACTIF, absent ou hors-tenant — WHEN restore — THEN null (404 tenant-safe)', async () => {
    tx.project.updateMany.mockResolvedValue({ count: 0 });
    const out = await withOrg(() => service.restore('proj-1'));
    // `null` et non une exception : le controleur le traduit en 404 identique
    // pour les trois cas — anti-enumeration.
    expect(out).toBeNull();
    // Aucune relecture inutile quand rien n'a ete restaure.
    expect(tx.project.findFirst).not.toHaveBeenCalled();
  });

  it('#4 IDEMPOTENCE — GIVEN un projet déjà restauré — WHEN restore à nouveau — THEN null, jamais d’exception', async () => {
    tx.project.updateMany.mockResolvedValue({ count: 0 });
    await expect(withOrg(() => service.restore('proj-1'))).resolves.toBeNull();
  });
});
