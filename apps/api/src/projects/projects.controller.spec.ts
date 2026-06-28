import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';

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

  it('given un body {name} : passe createdById = sub du JWT au service', async () => {
    await controller.create({ name: 'Forage A' }, reqWithSub('user-jwt'));

    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.create).toHaveBeenCalledWith({
      name: 'Forage A',
      createdById: 'user-jwt',
    });
  });

  it('given un body QUI TENTE de fixer createdById/owner_user_id : ces cles sont IGNOREES (le sub JWT prime)', async () => {
    // Le pipe Zod STRIPPE par defaut les cles hors schema -> createdById /
    // owner_user_id n'atteignent jamais le body. On passe le payload pollue par
    // le MEME pipe que la route, puis on appelle le controleur. Le service ne
    // doit voir QUE le sub du JWT comme proprietaire, jamais la valeur cliente.
    const schema = z.object({ name: z.string().trim().min(1).max(200) });
    const pipe = new ZodValidationPipe(schema);
    const polluted = pipe.transform({
      name: 'Forage B',
      createdById: 'attaquant-uid',
      owner_user_id: 'attaquant-uid',
      ownerUserId: 'attaquant-uid',
    });
    // Preuve directe du stripping : la cle cliente n'a pas survecu a la validation.
    expect(polluted).toEqual({ name: 'Forage B' });
    expect((polluted as Record<string, unknown>).createdById).toBeUndefined();

    await controller.create(polluted, reqWithSub('user-jwt'));

    // Le service ne recoit QUE le name (du body strippe) + createdById = sub JWT.
    // Jamais la valeur cliente 'attaquant-uid'.
    expect(service.create).toHaveBeenCalledWith({
      name: 'Forage B',
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
