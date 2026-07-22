import type { PrismaService } from '../prisma/prisma.service';
import { tenantStorage } from '../tenant/tenant-context';

import { ProjectsService } from './projects.service';

/**
 * P0-3 — DERNIÈRE ACTIVITÉ RÉELLE d'un projet.
 *
 * LE DÉFAUT CORRIGÉ (mesuré en base de recette le 21/07)
 * -----------------------------------------------------
 * `projects.updated_at` est un `@updatedAt` Prisma : il ne bouge QUE si la ligne
 * `projects` est elle-meme ecrite (creation, renommage). Ajouter un calcul ou
 * sceller un PV ne le touche PAS. Or c'est ce champ qui triait la liste sous le
 * libelle « Modifie recemment » ET qui s'y affichait :
 *
 *   | Projet             | updated_at  | dernier calcul REEL | calculs |
 *   | Pont de Mbodiene   | 17/07 12:21 | 18/07 10:54         | 40      |
 *   | test               | 17/07 12:50 | 17/07 13:16         | 2       |
 *
 * « Pont de Mbodiene » (40 calculs, actif le 18/07) etait classe DERNIER, sous
 * « test » (2 calculs, rien depuis le 17/07). L'ecran de triage central du
 * produit induisait en erreur sur la fonction meme dont c'est le metier.
 *
 * CE QUE CE FICHIER VERROUILLE (given/when/then, esprit mutation)
 * --------------------------------------------------------------
 *  #1 `lastActivityAt` = MAX(updated_at du projet, dernier calcul, dernier PV) ;
 *  #2 un calcul plus recent que la ligne projet FAIT bouger la valeur — c'est
 *     exactement ce que l'ancien champ ne savait pas faire ;
 *  #3 le tri est fait SUR cette valeur, du plus recent au plus ancien : le
 *     projet actif remonte, quel que soit l'age de sa ligne `projects` ;
 *  #4 `lastActivityKind` dit DE QUOI il s'agit (`calcul` / `pv` / `projet`),
 *     pour que l'UI puisse ecrire « PV scelle il y a 2 j » plutot qu'une date
 *     muette ;
 *  #5 un projet SANS aucun contenu retombe sur son propre `updatedAt` — jamais
 *     `null`, sinon un `ORDER BY ... DESC` remonterait les NULL en tete sous
 *     Postgres et le projet vide passerait devant les projets actifs.
 *
 * CHOIX ASSUME : agregat EN LECTURE, pas de colonne materialisee ni de trigger.
 * Une colonne serait plus rapide et permettrait un tri index-only, mais elle
 * impose une migration, un backfill, et surtout un trigger sur le write-path du
 * SCELLEMENT — la zone la plus sensible du produit. A 4 projets et 55 calculs
 * c'est premature. L'agregat en lecture a en outre ZERO desynchronisation par
 * construction, ce qui est precisement la propriete qui manquait au champ fautif.
 */
const ORG_ID = '22222222-2222-2222-2222-222222222222';

function withOrg<T>(fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ orgId: ORG_ID, userId: 'user-1' }, fn);
}

/** Ligne projet ancienne (17/07) — l'activite reelle est ailleurs. */
const PONT = {
  id: 'pont',
  orgId: ORG_ID,
  name: 'Pont de Mbodiène — fondations',
  domain: 'FD',
  status: 'DRAFT',
  createdById: 'user-1',
  createdAt: new Date('2026-07-17T12:21:00Z'),
  updatedAt: new Date('2026-07-17T12:21:00Z'),
};
/** Ligne projet plus recente que Pont, mais SANS activite depuis. */
const TEST = {
  id: 'test',
  orgId: ORG_ID,
  name: 'test',
  domain: 'CH',
  status: 'DRAFT',
  createdById: 'user-1',
  createdAt: new Date('2026-07-17T12:50:00Z'),
  updatedAt: new Date('2026-07-17T12:50:00Z'),
};
/** Projet vierge : ni calcul ni PV. */
const VIERGE = {
  id: 'vierge',
  orgId: ORG_ID,
  name: 'Projet vierge',
  domain: 'CH',
  status: 'DRAFT',
  createdById: 'user-1',
  createdAt: new Date('2026-07-10T08:00:00Z'),
  updatedAt: new Date('2026-07-10T08:00:00Z'),
};

describe('ProjectsService.list — dernière activité réelle', () => {
  let tx: {
    project: { findMany: jest.Mock };
    calcResult: { groupBy: jest.Mock };
    officialPv: { groupBy: jest.Mock };
  };
  let prisma: { withTenant: jest.Mock };
  let service: ProjectsService;

  beforeEach(() => {
    tx = {
      project: { findMany: jest.fn().mockResolvedValue([PONT, TEST, VIERGE]) },
      calcResult: {
        groupBy: jest.fn().mockResolvedValue([
          // Pont : calcul du 18/07 — POSTERIEUR a sa ligne projet (17/07).
          {
            projectId: 'pont',
            _count: { _all: 40 },
            _max: { createdAt: new Date('2026-07-18T10:54:00Z') },
          },
          {
            projectId: 'test',
            _count: { _all: 2 },
            _max: { createdAt: new Date('2026-07-17T13:16:00Z') },
          },
        ]),
      },
      officialPv: {
        groupBy: jest.fn().mockResolvedValue([
          {
            projectId: 'test',
            _count: { _all: 1 },
            _max: { sealedAt: new Date('2026-07-17T13:00:00Z') },
          },
        ]),
      },
    };
    prisma = {
      withTenant: jest.fn((_orgId: string, cb: (t: typeof tx) => unknown) =>
        cb(tx),
      ),
    };
    service = new ProjectsService(prisma as unknown as PrismaService);
  });

  it('#1 GIVEN un calcul postérieur à la ligne projet — WHEN list — THEN lastActivityAt suit le calcul', async () => {
    const projets = await withOrg(() => service.list());
    const pont = projets.find((p) => p.id === 'pont');
    // 18/07 10:54 (le calcul), et NON 17/07 12:21 (la ligne projet) : c'est
    // exactement ce que l'ancien `updated_at` ne savait pas refleter.
    expect(pont?.lastActivityAt?.toISOString()).toBe(
      '2026-07-18T10:54:00.000Z',
    );
  });

  it('#2 GIVEN Pont (actif 18/07) et test (inactif depuis 17/07) — WHEN list — THEN Pont passe DEVANT', async () => {
    const projets = await withOrg(() => service.list());
    const rang = (id: string) => projets.findIndex((p) => p.id === id);
    // Le coeur du reproche : l'ancien tri classait Pont DERNIER alors qu'il
    // porte 40 calculs et de l'activite plus recente.
    expect(rang('pont')).toBeLessThan(rang('test'));
  });

  it('#3 GIVEN un PV plus récent que le dernier calcul — WHEN list — THEN lastActivityKind vaut « pv »', async () => {
    tx.officialPv.groupBy.mockResolvedValue([
      {
        projectId: 'pont',
        _count: { _all: 4 },
        _max: { sealedAt: new Date('2026-07-19T16:32:00Z') },
      },
    ]);
    const projets = await withOrg(() => service.list());
    const pont = projets.find((p) => p.id === 'pont');
    expect(pont?.lastActivityAt?.toISOString()).toBe(
      '2026-07-19T16:32:00.000Z',
    );
    // L'UI doit pouvoir ecrire « PV scelle il y a 2 j » : une date muette est
    // moins informative qu'une date QUALIFIEE.
    expect(pont?.lastActivityKind).toBe('pv');
  });

  it('#4 GIVEN un calcul plus récent qu’un PV — WHEN list — THEN lastActivityKind vaut « calcul »', async () => {
    const projets = await withOrg(() => service.list());
    expect(projets.find((p) => p.id === 'pont')?.lastActivityKind).toBe(
      'calcul',
    );
  });

  it('#5 GIVEN un projet SANS contenu — WHEN list — THEN repli sur son updatedAt, jamais null', async () => {
    const projets = await withOrg(() => service.list());
    const vierge = projets.find((p) => p.id === 'vierge');
    // `null` ferait remonter le projet vide EN TETE sous Postgres
    // (ORDER BY ... DESC place les NULL en premier). Repli obligatoire.
    expect(vierge?.lastActivityAt).not.toBeNull();
    expect(vierge?.lastActivityAt?.toISOString()).toBe(
      '2026-07-10T08:00:00.000Z',
    );
    expect(vierge?.lastActivityKind).toBe('projet');
  });

  it('#6 GIVEN la liste — WHEN list — THEN updatedAt reste INTACT (deux sens distincts)', async () => {
    const projets = await withOrg(() => service.list());
    const pont = projets.find((p) => p.id === 'pont');
    // `updatedAt` garde son sens (« metadonnees editees ») ; `lastActivityAt`
    // en est distinct (« du travail a eu lieu »). Les confondre reintroduirait
    // le defaut : on ne saurait plus dire si un projet a ete RENOMME ou CALCULE.
    expect(pont?.updatedAt.toISOString()).toBe('2026-07-17T12:21:00.000Z');
  });
});
