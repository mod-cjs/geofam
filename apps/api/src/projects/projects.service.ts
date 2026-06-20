import { Injectable } from '@nestjs/common';
import type { Project } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';
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
}
