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
/** Nature de la dernière activité — permet à l'UI de qualifier la date. */
export type ActivityKind = 'calcul' | 'pv' | 'projet';

export type ProjectWithCounts = Project & {
  calcCount: number;
  pvCount: number;
  /**
   * Date de la dernière activité RÉELLE : max(ligne projet, dernier calcul,
   * dernier PV). Distincte de `updatedAt`, qui ne bouge que si la ligne
   * `projects` est écrite (création, renommage) — jamais quand on calcule ou
   * qu'on scelle. C'est cette confusion qui classait un projet à 40 calculs
   * derrière un projet à 2 calculs inactif.
   *
   * JAMAIS null : un projet sans contenu retombe sur son propre `updatedAt`,
   * sinon `ORDER BY ... DESC` remonterait les NULL en tête sous Postgres.
   */
  lastActivityAt: Date;
  lastActivityKind: ActivityKind;
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
        // Tri PROVISOIRE : l'ordre final est celui de `lastActivityAt`, qui ne
        // peut être calculé qu'après les agrégats ci-dessous (il dépend du
        // dernier calcul et du dernier PV). Le tri définitif est appliqué en
        // sortie — et c'est le serveur qui l'impose, pour qu'il n'existe plus
        // deux vérités d'ordre (le front retriait ce que le serveur avait déjà
        // trié, sur un champ encore différent).
        orderBy: { createdAt: 'desc' },
      });

      // Sequentiel et non Promise.all : deux agregats de quelques millisecondes
      // ne justifient pas de paralleliser DANS une transaction interactive
      // Prisma (patron deconseille — risque de P2028 « transaction already
      // closed » sous contention, donc 500 sur la liste des projets).
      const calcs = await tx.calcResult.groupBy({
        by: ['projectId'],
        _count: { _all: true },
        _max: { createdAt: true },
      });
      const pvs = await tx.officialPv.groupBy({
        by: ['projectId'],
        _count: { _all: true },
        _max: { sealedAt: true },
      });

      const nbCalcs = new Map(calcs.map((r) => [r.projectId, r._count._all]));
      const nbPvs = new Map(pvs.map((r) => [r.projectId, r._count._all]));
      const dernierCalcul = new Map(
        calcs.map((r) => [r.projectId, r._max?.createdAt ?? null]),
      );
      const dernierPv = new Map(
        pvs.map((r) => [r.projectId, r._max?.sealedAt ?? null]),
      );

      // `?? 0` et non `?? undefined` : un projet absent de l'agregat n'a
      // simplement aucun calcul — c'est une valeur CONNUE, pas une inconnue.
      return (
        projects
          .map((p) => {
            const calc = dernierCalcul.get(p.id) ?? null;
            const pv = dernierPv.get(p.id) ?? null;

            // Repli sur updatedAt : jamais null (cf. commentaire du type).
            let lastActivityAt: Date = p.updatedAt;
            let lastActivityKind: ActivityKind = 'projet';
            if (calc && calc.getTime() > lastActivityAt.getTime()) {
              lastActivityAt = calc;
              lastActivityKind = 'calcul';
            }
            // `>` strict : a egalite parfaite on garde le calcul, deterministe.
            if (pv && pv.getTime() > lastActivityAt.getTime()) {
              lastActivityAt = pv;
              lastActivityKind = 'pv';
            }

            return {
              ...p,
              calcCount: nbCalcs.get(p.id) ?? 0,
              pvCount: nbPvs.get(p.id) ?? 0,
              lastActivityAt,
              lastActivityKind,
            };
          })
          // Tri DÉFINITIF, du plus récent au plus ancien. C'est ici que « Pont de
          // Mbodiène » (40 calculs, actif la veille) repasse devant « test »
          // (2 calculs, inactif) — l'inverse de l'ordre que produisait
          // `updated_at`. Le front ne retrie plus : une seule vérité d'ordre.
          .sort(
            (a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime(),
          )
      );
    });
  }

  create(input: {
    name: string;
    domain: ProjectDomain;
    createdById: string;
    description?: string;
  }): Promise<Project> {
    const orgId = requireOrgId();
    return this.prisma.withTenant(orgId, (tx) =>
      tx.project.create({
        data: {
          orgId,
          name: input.name,
          domain: input.domain,
          createdById: input.createdById,
          // `?? null` et non `?? ''` : absence de description et description
          // vide sont deux choses differentes ; on n'invente pas une chaine.
          description: input.description ?? null,
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

      // `aggregate` (et non `findMany`) : c'est ce qui evite au shell du projet
      // de telecharger 2,5 Mo de lignes pour afficher deux nombres. Une seule
      // requete par table ramene le compte ET la date la plus recente. Le
      // filtre projectId reste DANS le withTenant, donc double barriere : RLS
      // (org) + predicat (projet). Sequentiel : pas de Promise.all dans une
      // transaction interactive Prisma (cf. list()).
      const calc = await tx.calcResult.aggregate({
        where: { projectId },
        _count: { _all: true },
        _max: { createdAt: true },
      });
      const pv = await tx.officialPv.aggregate({
        where: { projectId },
        _count: { _all: true },
        _max: { sealedAt: true },
      });

      // Même règle que dans list() : repli sur updatedAt, jamais null.
      let lastActivityAt: Date = project.updatedAt;
      let lastActivityKind: ActivityKind = 'projet';
      const dernierCalcul = calc._max?.createdAt ?? null;
      const dernierPv = pv._max?.sealedAt ?? null;
      if (dernierCalcul && dernierCalcul.getTime() > lastActivityAt.getTime()) {
        lastActivityAt = dernierCalcul;
        lastActivityKind = 'calcul';
      }
      if (dernierPv && dernierPv.getTime() > lastActivityAt.getTime()) {
        lastActivityAt = dernierPv;
        lastActivityKind = 'pv';
      }

      return {
        ...project,
        calcCount: calc._count._all,
        pvCount: pv._count._all,
        lastActivityAt,
        lastActivityKind,
      };
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
   * Liste les projets ARCHIVES du tenant (GET /projects?archived=1).
   *
   * Sans cette lecture, un projet archive est INTROUVABLE : `list()` et
   * `getById()` l'excluent tous deux. Il fallait donc pouvoir le voir pour
   * pouvoir le restaurer — sinon la promesse de reversibilite reste lettre
   * morte faute de point d'entree.
   */
  listArchived(): Promise<Project[]> {
    const orgId = requireOrgId();
    return this.prisma.withTenant(orgId, (tx) =>
      tx.project.findMany({
        where: { status: 'ARCHIVED' },
        orderBy: { updatedAt: 'desc' },
      }),
    );
  }

  /**
   * RESTAURE un projet archive (POST /projects/:id/restore) : ARCHIVED -> ACTIVE.
   *
   * POURQUOI CETTE METHODE EXISTE
   * La modale de suppression affirmait « Cette action peut etre annulee par un
   * administrateur si besoin » alors qu'AUCUN endpoint de restauration
   * n'existait, qu'il n'y avait aucun endpoint admin sur les projets, et que
   * toutes les lectures excluent ARCHIVED. Un projet archive etait donc
   * irrecuperable sans SQL manuel : l'interface faisait AGIR l'utilisateur sur
   * une garantie inexistante. C'est le defaut le plus grave du diagnostic.
   *
   * `updateMany` (et non `update`) : sur une ligne ABSENTE, HORS-TENANT (RLS
   * invisible) ou DEJA ACTIVE, il renvoie count=0 SANS lever -> `null`, traduit
   * en 404 tenant-safe par le controleur (« n'existe pas » et « pas chez vous »
   * indistinguables). Idempotent par construction.
   */
  async restore(projectId: string): Promise<Project | null> {
    const orgId = requireOrgId();
    return this.prisma.withTenant(orgId, async (tx) => {
      const res = await tx.project.updateMany({
        // `status: 'ARCHIVED'` en condition : restaurer un projet DEJA actif
        // n'a pas de sens et doit rester un 404, pas un succes silencieux.
        where: { id: projectId, status: 'ARCHIVED' },
        data: { status: 'ACTIVE' },
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
