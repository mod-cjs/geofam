import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';

import { ROLES_KEY } from '../auth/decorators';
import type { AuthedRequest } from '../auth/request-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

import { ProjectsController } from './projects.controller';
import type { ProjectsService } from './projects.service';

/**
 * ProjectsController — POST /projects (F-03).
 *
 * EXIGENCE DE SECURITE HERITEE DE #42 (forcing du proprietaire) :
 * le createdById d'un projet est TOUJOURS le `sub` du JWT verifie
 * (req.auth.userId), JAMAIS une valeur fournie par le client. Ces tests le
 * prouvent en ROUGE-d'abord-esprit : si un futur refactor relisait un
 * owner_user_id du body, l'assertion casserait.
 *
 * (Le scope tenant lui-meme — RLS, WITH CHECK org_id — est prouve par les e2e
 * contre Postgres reel ; ici on couvre la couche controleur : l'identite forcee
 * et l'absence de tout chemin "owner cote client".)
 */
describe('ProjectsController.create — forcing du proprietaire (#42)', () => {
  let service: { create: jest.Mock; list: jest.Mock };
  let controller: ProjectsController;

  beforeEach(() => {
    jest.clearAllMocks();
    service = {
      create: jest.fn().mockResolvedValue({ id: 'p1', name: 'Projet' }),
      list: jest.fn().mockResolvedValue([]),
    };
    controller = new ProjectsController(service as unknown as ProjectsService);
  });

  /** Forge une requete authentifiee minimale portant l'identite JWT verifiee. */
  function reqWithSub(userId: string): AuthedRequest {
    return { auth: { userId } } as unknown as AuthedRequest;
  }

  it('given un body {name, domain} : passe name + domain + createdById = sub du JWT au service', async () => {
    await controller.create(
      { name: 'Forage A', domain: 'FD' },
      reqWithSub('user-jwt'),
    );

    expect(service.create).toHaveBeenCalledTimes(1);
    // Le domaine metier (CH/FD/LB) est propage tel quel ; le proprietaire reste
    // le sub du JWT (jamais une valeur cliente).
    expect(service.create).toHaveBeenCalledWith({
      name: 'Forage A',
      domain: 'FD',
      createdById: 'user-jwt',
    });
  });

  it('given un body QUI TENTE de fixer createdById/owner_user_id : ces cles sont IGNOREES (le sub JWT prime)', async () => {
    // Le pipe Zod STRIPPE par defaut les cles hors schema -> createdById /
    // owner_user_id n'atteignent jamais le body. On passe le payload pollue par
    // le MEME pipe que la route, puis on appelle le controleur. Le service ne
    // doit voir QUE le sub du JWT comme proprietaire, jamais la valeur cliente.
    const schema = z.object({
      name: z.string().trim().min(1).max(200),
      domain: z.enum(['CH', 'FD', 'LB']),
    });
    const pipe = new ZodValidationPipe(schema);
    const polluted = pipe.transform({
      name: 'Forage B',
      domain: 'FD',
      createdById: 'attaquant-uid',
      owner_user_id: 'attaquant-uid',
      ownerUserId: 'attaquant-uid',
    });
    // Preuve directe du stripping : la cle cliente n'a pas survecu a la validation.
    expect(polluted).toEqual({ name: 'Forage B', domain: 'FD' });
    expect((polluted as Record<string, unknown>).createdById).toBeUndefined();

    await controller.create(polluted, reqWithSub('user-jwt'));

    // Le service ne recoit QUE name+domain (du body strippe) + createdById = sub JWT.
    // Jamais la valeur cliente 'attaquant-uid'.
    expect(service.create).toHaveBeenCalledWith({
      name: 'Forage B',
      domain: 'FD',
      createdById: 'user-jwt',
    });
    expect(service.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ createdById: 'attaquant-uid' }),
    );
  });
});

/**
 * ProjectsController.getOne — GET /projects/:projectId (detail projet).
 *
 * Couvre la couche controleur : traduction du contrat service (null = absent ou
 * hors tenant) en 404 « introuvable » TENANT-SAFE (anti-enumeration : meme
 * reponse pour « n'existe pas » et « existe chez un autre org »). La preuve
 * d'isolation REELLE (RLS, cross-org -> 404) est portee par les e2e contre
 * Postgres reel (qa-test) ; ici on prouve qu'aucun chemin du controleur ne
 * transforme un null-service en autre chose qu'un 404 borne.
 */
describe('ProjectsController.getOne — detail projet + 404 tenant-safe', () => {
  let service: { getById: jest.Mock };
  let controller: ProjectsController;

  beforeEach(() => {
    jest.clearAllMocks();
    service = { getById: jest.fn() };
    controller = new ProjectsController(service as unknown as ProjectsService);
  });

  it('given un projet existant du tenant : renvoie le projet tel quel', async () => {
    const project = { id: 'proj-1', name: 'Forage A', orgId: 'org-1' };
    service.getById.mockResolvedValue(project);

    await expect(controller.getOne('proj-1')).resolves.toBe(project);
    expect(service.getById).toHaveBeenCalledWith('proj-1');
  });

  it('given un id absent : leve NotFound (404) — message borne, pas de detail', async () => {
    service.getById.mockResolvedValue(null);

    await expect(controller.getOne('proj-absent')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('given un projet d un AUTRE org (invisible sous RLS -> null) : MEME 404 que l absent (tenant-safe)', async () => {
    // Le service rend null quand la RLS masque la ligne d'un autre tenant : le
    // controleur ne doit PAS distinguer ce cas d'un id inexistant (sinon
    // enumeration cross-org possible). On verifie l'identite de comportement.
    service.getById.mockResolvedValue(null);

    await expect(controller.getOne('proj-autre-org')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

/**
 * ProjectsController.rename / remove — PATCH & DELETE /projects/:projectId.
 *
 * Couche controleur : le service rend `null` quand la ligne est absente, hors
 * tenant (RLS) ou deja archivee -> le controleur traduit en 404 tenant-safe (meme
 * message borne). La persistance/isolation REELLE est prouvee aux e2e (Postgres
 * reel). Ici : aucun chemin ne transforme un null-service en autre chose qu'un 404.
 */
describe('ProjectsController.rename / remove — 404 tenant-safe', () => {
  let service: { rename: jest.Mock; archive: jest.Mock };
  let controller: ProjectsController;

  beforeEach(() => {
    jest.clearAllMocks();
    service = { rename: jest.fn(), archive: jest.fn() };
    controller = new ProjectsController(service as unknown as ProjectsService);
  });

  it('rename : projet du tenant -> renvoie le projet a jour et passe (id, name) au service', async () => {
    const project = { id: 'proj-1', name: 'Nouveau' };
    service.rename.mockResolvedValue(project);

    await expect(
      controller.rename('proj-1', { name: 'Nouveau' }),
    ).resolves.toBe(project);
    expect(service.rename).toHaveBeenCalledWith('proj-1', 'Nouveau');
  });

  it('rename : service null (absent/hors-tenant/archive) -> 404 borne', async () => {
    service.rename.mockResolvedValue(null);
    await expect(
      controller.rename('proj-x', { name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove : soft-delete -> renvoie le projet archive', async () => {
    const archived = { id: 'proj-1', status: 'ARCHIVED' };
    service.archive.mockResolvedValue(archived);

    await expect(controller.remove('proj-1')).resolves.toBe(archived);
    expect(service.archive).toHaveBeenCalledWith('proj-1');
  });

  it('remove : service null (absent/hors-tenant/deja archive) -> 404 borne', async () => {
    service.archive.mockResolvedValue(null);
    await expect(controller.remove('proj-absent')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

/**
 * ProjectsController.removePermanently — SUPPRESSION DEFINITIVE.
 *
 * Verrouille la couche controleur : traduction `null` -> 404 tenant-safe, et
 * surtout le RBAC DECLARE. Detruire n'est pas archiver : la liste des roles est
 * une SENTINELLE — si quelqu'un y rajoute ENGINEER (ou pire), ce test rougit.
 * Le 403 REEL est prouve par les e2e (test/projects-permanent-delete.e2e-spec.ts).
 */
describe('ProjectsController.removePermanently — suppression définitive', () => {
  let service: { deletePermanently: jest.Mock };
  let controller: ProjectsController;

  beforeEach(() => {
    jest.clearAllMocks();
    service = { deletePermanently: jest.fn() };
    controller = new ProjectsController(service as unknown as ProjectsService);
  });

  it('given un projet du tenant : renvoie le projet détruit et passe l’id au service', async () => {
    const project = { id: 'proj-1', name: 'Chantier' };
    service.deletePermanently.mockResolvedValue(project);

    await expect(controller.removePermanently('proj-1')).resolves.toBe(project);
    expect(service.deletePermanently).toHaveBeenCalledWith('proj-1');
  });

  it('given service null (absent / hors-tenant / déjà détruit) : 404 tenant-safe', async () => {
    service.deletePermanently.mockResolvedValue(null);

    await expect(
      controller.removePermanently('proj-absent'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  /**
   * Rôles DÉCLARÉS sur un handler, lus là où le RolesGuard les lit : la
   * métadonnée posée par @Roles sur la fonction du handler. On passe par le
   * descripteur de propriété plutôt que par `prototype.methode` — c'est la même
   * fonction, sans la référence de méthode non liée que la règle `unbound-method`
   * interdit à juste titre ailleurs.
   */
  const rolesDeclares = (methode: string): string[] => {
    const descripteur = Object.getOwnPropertyDescriptor(
      ProjectsController.prototype,
      methode,
    );
    expect(descripteur).toBeDefined();
    return Reflect.getMetadata(ROLES_KEY, descripteur!.value) as string[];
  };

  it('RBAC DÉCLARÉ : OWNER/ADMIN/SUPERADMIN uniquement — ni ENGINEER, ni TECHNICIAN, ni VIEWER', () => {
    // Sentinelle d'élargissement : détruire est plus grave qu'archiver, la liste
    // est volontairement PLUS COURTE que celle de @Delete(':projectId').
    expect([...rolesDeclares('removePermanently')].sort()).toEqual([
      'ADMIN',
      'OWNER',
      'SUPERADMIN',
    ]);
  });

  it('RBAC COMPARÉ : l’archivage reste ouvert à ENGINEER, la destruction NON', () => {
    expect(rolesDeclares('remove')).toContain('ENGINEER');
    expect(rolesDeclares('removePermanently')).not.toContain('ENGINEER');
  });
});
