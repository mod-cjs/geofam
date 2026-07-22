import { Injectable } from '@nestjs/common';
import type { Project, ProjectDomain } from '@prisma/client';

// Import VALEUR (et non `import type`) : NestJS s'appuie sur la metadonnee de
// type du constructeur pour l'injection. Un `import type` est efface a la
// compilation -> la DI ne peut plus resoudre PrismaService (echec au boot).
import { PrismaService } from '../prisma/prisma.service';
import { requireOrgId } from '../tenant/tenant-context';

/**
 * Projet enrichi des compteurs de contenu (P0-1).
 *
 * `calcCount` / `pvCount` sont TOUJOURS definis (0 si vide) : cote front, la
 * pastille chiffree n'est rendue que si la valeur est CONNUE — `undefined`
 * signifierait « pas encore charge », et afficher « 0 » a la place ferait lire
 * « projet vide » a tort. La distinction est le contrat.
 */
export type ProjectWithCounts = Project & {
  calcCount: number;
  pvCount: number;
};

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

  /**
   * Liste les projets du tenant, chacun porteur de ses compteurs de contenu.
   *
   * REGLE D'API : une liste ne sert JAMAIS a compter. Le front affichait ces deux
   * nombres en telechargeant `listCalcResults` + `listPvs` — donc les lignes
   * entieres, `output` JSONB compris — pour n'en lire que la longueur. Mesure sur
   * la base de recette : 4,05 Mo pour ouvrir UN projet, dont ~2,5 Mo pour ces
   * seuls compteurs. Ici : DEUX agregations a cardinalite fixe pour tout le
   * tenant, quel que soit le nombre de projets (jamais de N+1).
   *
   * Les trois requetes sont dans le MEME withTenant : une seule transaction, un
   * seul SET LOCAL, donc la RLS scope l'agregation exactement comme la liste —
   * il est impossible de compter les calculs d'un autre bureau d'etudes.
   */
  list(): Promise<ProjectWithCounts[]> {
    const orgId = requireOrgId();
    return this.prisma.withTenant(orgId, async (tx) => {
      // Soft-delete : un projet ARCHIVED est « supprime » cote metier -> exclu de
      // la liste (il reste en base pour ne pas casser l'integrite des PV/calc qui
      // le referencent). Voir archive().
      const projects = await tx.project.findMany({
        where: { status: { not: 'ARCHIVED' } },
        orderBy: { createdAt: 'desc' },
      });

      const [calcs, pvs] = await Promise.all([
        tx.calcResult.groupBy({ by: ['projectId'], _count: { _all: true } }),
        tx.officialPv.groupBy({ by: ['projectId'], _count: { _all: true } }),
      ]);

      const parProjet = (
        rows: { projectId: string; _count: { _all: number } }[],
      ): Map<string, number> =>
        new Map(rows.map((r) => [r.projectId, r._count._all]));
      const nbCalcs = parProjet(calcs);
      const nbPvs = parProjet(pvs);

      // `?? 0` et non `?? undefined` : un projet absent de l'agregat n'a
      // simplement aucun calcul — c'est une valeur CONNUE, pas une inconnue.
      return projects.map((p) => ({
        ...p,
        calcCount: nbCalcs.get(p.id) ?? 0,
        pvCount: nbPvs.get(p.id) ?? 0,
      }));
    });
  }

  create(input: {
    name: string;
    domain: ProjectDomain;
    createdById: string;
  }): Promise<Project> {
    const orgId = requireOrgId();
    return this.prisma.withTenant(orgId, (tx) =>
      tx.project.create({
        data: {
          orgId,
          name: input.name,
          domain: input.domain,
          createdById: input.createdById,
        },
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
  getById(projectId: string): Promise<ProjectWithCounts | null> {
    const orgId = requireOrgId();
    return this.prisma.withTenant(orgId, async (tx) => {
      // findFirst (et non findUnique) : on ajoute le filtre status pour qu'un projet
      // ARCHIVED (soft-delete) soit invisible en lecture detail, comme dans la liste
      // — « supprime » = introuvable (404 tenant-safe rendu par le controleur).
      const project = await tx.project.findFirst({
        where: { id: projectId, status: { not: 'ARCHIVED' } },
      });
      if (!project) return null;

      // Deux `count` (et non deux `findMany`) : c'est ce qui evite au shell du
      // projet de telecharger 2,5 Mo de lignes pour afficher deux nombres. Le
      // filtre projectId reste DANS le withTenant, donc double barriere : RLS
      // (org) + predicat (projet).
      const [calcCount, pvCount] = await Promise.all([
        tx.calcResult.count({ where: { projectId } }),
        tx.officialPv.count({ where: { projectId } }),
      ]);
      return { ...project, calcCount, pvCount };
    });
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
