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
      // Soft-delete : un projet ARCHIVED est « supprime » cote metier -> exclu de
      // la liste (il reste en base pour ne pas casser l'integrite des PV/calc qui
      // le referencent). Voir archive().
      tx.project.findMany({
        where: { status: { not: 'ARCHIVED' } },
        orderBy: { createdAt: 'desc' },
      }),
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
      // findFirst (et non findUnique) : on ajoute le filtre status pour qu'un projet
      // ARCHIVED (soft-delete) soit invisible en lecture detail, comme dans la liste
      // — « supprime » = introuvable (404 tenant-safe rendu par le controleur).
      tx.project.findFirst({
        where: { id: projectId, status: { not: 'ARCHIVED' } },
      }),
    );
  }

  /**
   * Renomme un projet du tenant courant (PATCH /projects/:id). updateMany (et non
   * update) : sur une ligne ABSENTE, HORS-TENANT (RLS invisible) ou DEJA ARCHIVED,
   * updateMany renvoie count=0 SANS lever (update leverait P2025) -> on rend `null`,
   * traduit en 404 tenant-safe par le controleur (anti-enumeration : « n'existe pas »
   * et « pas chez vous » indistinguables). WITH CHECK cote base interdit tout
   * deplacement d'org. Renvoie le projet a jour (findFirst re-lit sous RLS).
   */
  async rename(projectId: string, name: string): Promise<Project | null> {
    const orgId = requireOrgId();
    return this.prisma.withTenant(orgId, async (tx) => {
      const res = await tx.project.updateMany({
        where: { id: projectId, status: { not: 'ARCHIVED' } },
        data: { name },
      });
      if (res.count === 0) return null;
      return tx.project.findFirst({ where: { id: projectId } });
    });
  }

  /**
   * SOFT-DELETE d'un projet (DELETE /projects/:id) : passe le status a ARCHIVED.
   *
   * CHOIX (documente) : soft-delete plutot que hard delete. Un projet peut porter
   * des calc_results et surtout des PV OFFICIELS scelles ; un DELETE physique
   * casserait l'integrite (les calc_results sont en CASCADE sur projects). Les
   * official_pvs sont AUTOPORTANTS/immuables (aucune FK vivante) et survivent de
   * toute facon — mais on protege aussi la chaine calc. Le soft-delete rend le
   * projet invisible (liste + detail) sans rien detruire : reversible, integrite
   * preservee. Idempotence : archiver un projet absent/hors-tenant/deja archive
   * renvoie `null` (count=0) -> 404 par le controleur.
   */
  async archive(projectId: string): Promise<Project | null> {
    const orgId = requireOrgId();
    return this.prisma.withTenant(orgId, async (tx) => {
      const res = await tx.project.updateMany({
        where: { id: projectId, status: { not: 'ARCHIVED' } },
        data: { status: 'ARCHIVED' },
      });
      if (res.count === 0) return null;
      return tx.project.findFirst({ where: { id: projectId } });
    });
  }
}
