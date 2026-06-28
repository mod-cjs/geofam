import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Project } from '@prisma/client';
import { z } from 'zod';

// Import VALEUR (DI NestJS).
import { Roles } from '../auth/decorators';
import type { AuthedRequest } from '../auth/request-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

import { ProjectsService } from './projects.service';

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
});
type CreateProjectDto = z.infer<typeof createProjectSchema>;

// UUID du parametre de chemin (defense en profondeur : un id malforme -> 400,
// jamais une requete base avec une valeur non-uuid). Meme garde que PvController.
const uuidParam = z.string().uuid();

/**
 * ProjectsController — route d'exemple protegee de bout en bout :
 *  - JwtAuthGuard : token verifie obligatoire.
 *  - TenantGuard  : appartenance a l'org (x-org-id) prouvee -> contexte tenant.
 *  - RolesGuard   : @Roles ci-dessous applique le RBAC tenant/plateforme.
 *  - Interceptor  : execute dans l'ALS tenant -> ProjectsService.withTenant.
 *
 * RBAC choisi :
 *  - lecture : tous les roles tenant (y compris VIEWER) — consultation.
 *  - creation : reservee a OWNER/ADMIN/ENGINEER (un VIEWER/TECHNICIAN ne cree
 *    pas de projet). SUPERADMIN autorise (back-office). Deny-by-default sinon.
 */
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @Roles('OWNER', 'ADMIN', 'ENGINEER', 'TECHNICIAN', 'VIEWER', 'SUPERADMIN')
  list(): Promise<Project[]> {
    return this.projects.list();
  }

  /**
   * GET /projects/:projectId — detail d'un projet du tenant courant.
   *
   * Lecture : tous les roles tenant (consultation), comme la liste. Isolation :
   * RLS scope la lecture au tenant courant ; un projet d'un AUTRE org est
   * INVISIBLE (service -> null) et rendu en 404 « introuvable » a l'identique
   * d'un id qui n'existe pas (404 tenant-safe, anti-enumeration : pas de 403
   * revelateur). La preuve d'isolation reelle (cross-org -> 404) est portee par
   * les e2e contre Postgres reel (qa-test).
   */
  @Get(':projectId')
  @Roles('OWNER', 'ADMIN', 'ENGINEER', 'TECHNICIAN', 'VIEWER', 'SUPERADMIN')
  async getOne(
    @Param('projectId', new ZodValidationPipe(uuidParam)) projectId: string,
  ): Promise<Project> {
    const project = await this.projects.getById(projectId);
    if (!project) {
      throw new NotFoundException(
        'Projet introuvable dans cette organisation.',
      );
    }
    return project;
  }

  @Post()
  @Roles('OWNER', 'ADMIN', 'ENGINEER', 'SUPERADMIN')
  create(
    @Body(new ZodValidationPipe(createProjectSchema)) body: CreateProjectDto,
    @Req() req: AuthedRequest,
  ): Promise<Project> {
    // createdById = identite JWT verifiee (jamais une valeur fournie par le client).
    return this.projects.create({
      name: body.name,
      createdById: req.auth!.userId,
    });
  }
}
