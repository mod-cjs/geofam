import { Injectable } from '@nestjs/common';
import type { Project } from '@prisma/client';

// Import VALEUR (et non `import type`) : NestJS s'appuie sur la metadonnee de
// type du constructeur pour l'injection. Un `import type` est efface a la
// compilation -> la DI ne peut plus resoudre PrismaService (echec au boot).
import { PrismaService } from '../prisma/prisma.service';
import { requireOrgId } from '../tenant/tenant-context';

/**
 * ProjectsService — exemple de service metier multi-tenant.
 *
 * Aucune requete ne filtre `orgId` a la main : on s'appuie sur withTenant
 * (SET LOCAL + RLS). Le createdById/orgId a l'INSERT vient du contexte, et
 * WITH CHECK cote base refuse toute ecriture sur un autre org.
 */
@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<Project[]> {
    const orgId = requireOrgId();
    return this.prisma.withTenant(orgId, (tx) =>
      tx.project.findMany({ orderBy: { createdAt: 'desc' } }),
    );
  }

  create(input: { name: string; createdById: string }): Promise<Project> {
    const orgId = requireOrgId();
    return this.prisma.withTenant(orgId, (tx) =>
      tx.project.create({
        data: { orgId, name: input.name, createdById: input.createdById },
      }),
    );
  }

  /**
   * Lit un projet du tenant courant (RLS scope). Renvoie null si l'id est absent
   * OU appartient a un autre org : la RLS rend la ligne d'un autre tenant
   * INVISIBLE (findUnique -> null), donc le 404 « introuvable » est rendu a
   * l'identique pour « n'existe pas » et « existe mais pas chez vous »
   * (anti-enumeration : l'appelant ne distingue pas les deux cas). La
   * traduction null -> 404 est faite par le controleur.
   */
  getById(projectId: string): Promise<Project | null> {
    const orgId = requireOrgId();
    return this.prisma.withTenant(orgId, (tx) =>
      tx.project.findUnique({ where: { id: projectId } }),
    );
  }
}
