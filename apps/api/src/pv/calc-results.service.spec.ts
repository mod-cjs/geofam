import { ConflictException, NotFoundException } from '@nestjs/common';
import type { CalcResult, Prisma } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';
import type { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { tenantStorage } from '../tenant/tenant-context';

import { CalcResultsService } from './calc-results.service';

/**
 * CalcResultsService — lecture master-detail (getForProject / listForProject).
 *
 * Cible la LOGIQUE de scope PROJET que la RLS seule ne couvre PAS : la RLS
 * masque deja un calcul d'un AUTRE org (findUnique -> null), mais un calcul d'un
 * AUTRE PROJET du MEME org passe la RLS. Le service doit alors lever un 404
 * « introuvable » IDENTIQUE (tenant-safe : aucune distinction observable entre
 * « absent », « hors tenant » et « autre projet du meme tenant »).
 *
 * La base est stubbee : on pilote ce que findUnique renvoie. L'isolation REELLE
 * (RLS cross-org) est prouvee par les e2e contre Postgres reel (qa-test) — on ne
 * fabrique ici AUCUN vert d'integration.
 */
type Tx = {
  calcResult: { findUnique: jest.Mock; findMany: jest.Mock };
  officialPv: { findMany: jest.Mock };
};

const ORG_ID = '11111111-1111-1111-1111-111111111111';

function withOrg<T>(fn: () => Promise<T>): Promise<T> {
  // Etablit le contexte tenant (ALS) que requireOrgId() lit dans le service.
  return tenantStorage.run({ orgId: ORG_ID, userId: 'user-1' }, fn);
}

describe('CalcResultsService — lecture master-detail', () => {
  let tx: Tx;
  let prisma: { withTenant: jest.Mock };
  let service: CalcResultsService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx = {
      calcResult: { findUnique: jest.fn(), findMany: jest.fn() },
      officialPv: { findMany: jest.fn() },
    };
    prisma = {
      withTenant: jest.fn(
        (_orgId: string, fn: (t: Prisma.TransactionClient) => unknown) =>
          fn(tx as unknown as Prisma.TransactionClient),
      ),
    };
    // SubscriptionsService non sollicite par les lectures : stub vide.
    const subs = {} as unknown as SubscriptionsService;
    service = new CalcResultsService(prisma as unknown as PrismaService, subs);
  });

  describe('getForProject — detail scope projet', () => {
    it('given un calcul du bon projet : le renvoie tel quel', async () => {
      const calc = {
        id: 'calc-1',
        projectId: 'proj-1',
        orgId: ORG_ID,
      } as unknown as CalcResult;
      tx.calcResult.findUnique.mockResolvedValue(calc);

      const out = await withOrg(() =>
        service.getForProject({ projectId: 'proj-1', calcResultId: 'calc-1' }),
      );
      expect(out).toBe(calc);
      // Le scope tenant passe par withTenant(orgId) : on prouve l'org lu (ALS).
      expect(prisma.withTenant).toHaveBeenCalledWith(
        ORG_ID,
        expect.any(Function),
      );
    });

    it('given un calcul absent (RLS masque un autre org -> null) : 404', async () => {
      tx.calcResult.findUnique.mockResolvedValue(null);

      await expect(
        withOrg(() =>
          service.getForProject({
            projectId: 'proj-1',
            calcResultId: 'calc-absent',
          }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('given un calcul d un AUTRE projet du MEME org (passe la RLS) : MEME 404 (tenant-safe)', async () => {
      // C'est le cas que la RLS ne barre PAS : le calcul existe dans le tenant,
      // mais sous un autre projet. Le service doit le rendre indistinguable d'un
      // calcul absent -> 404 identique, jamais le calcul d'un autre projet.
      const calcAutreProjet = {
        id: 'calc-1',
        projectId: 'proj-2',
        orgId: ORG_ID,
      } as unknown as CalcResult;
      tx.calcResult.findUnique.mockResolvedValue(calcAutreProjet);

      await expect(
        withOrg(() =>
          service.getForProject({
            projectId: 'proj-1',
            calcResultId: 'calc-1',
          }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listForProject — master scope projet', () => {
    it('given un projet : filtre par projectId, plus recent d abord, sous withTenant', async () => {
      const rows = [{ id: 'calc-2' }, { id: 'calc-1' }] as CalcResult[];
      tx.calcResult.findMany.mockResolvedValue(rows);
      // calc-1 est scelle (un PV le reference), calc-2 ne l'est pas.
      tx.officialPv.findMany.mockResolvedValue([
        { id: 'pv-9', calcResultId: 'calc-1' },
      ]);

      const out = await withOrg(() => service.listForProject('proj-1'));
      // Chaque calcul porte desormais pvId : l'id du PV s'il est scelle, sinon null.
      // C'est cette info qui permet au front d'afficher « Voir le PV »/« Imprimer »
      // (scelle) vs « Sceller cette version » (non scelle).
      expect(out).toEqual([
        { id: 'calc-2', pvId: null },
        { id: 'calc-1', pvId: 'pv-9' },
      ]);
      expect(tx.calcResult.findMany).toHaveBeenCalledWith({
        where: { projectId: 'proj-1' },
        orderBy: { createdAt: 'desc' },
      });
      // Jointure pvId : bornee aux ids du tenant, id + calcResultId SEULEMENT
      // (jamais document_html — bande passante, cf. B1-bis).
      expect(tx.officialPv.findMany).toHaveBeenCalledWith({
        where: { calcResultId: { in: ['calc-2', 'calc-1'] } },
        select: { id: true, calcResultId: true },
      });
      expect(prisma.withTenant).toHaveBeenCalledWith(
        ORG_ID,
        expect.any(Function),
      );
    });

    it('given un projet sans calcul (ou hors tenant) : renvoie [] (jamais d erreur, pas de requete PV)', async () => {
      tx.calcResult.findMany.mockResolvedValue([]);
      await expect(
        withOrg(() => service.listForProject('proj-vide')),
      ).resolves.toEqual([]);
      // Aucun calcul -> pas de 2e requete inutile.
      expect(tx.officialPv.findMany).not.toHaveBeenCalled();
    });
  });
});

/**
 * CalcResultsService — rename (etiquette) + deleteUnsealed (0027).
 *
 * On cible la LOGIQUE que la RLS seule ne porte pas : le scope PROJET (predicat
 * projectId) et le refus 409 quand un PV existe. La base est stubbee ; l'isolation
 * REELLE (cross-org, contre-preuve en base) est prouvee par calc-pv-naming.e2e.
 */
type MutTx = {
  calcResult: {
    updateMany: jest.Mock;
    findUnique: jest.Mock;
    deleteMany: jest.Mock;
  };
  calcSnapshot: { deleteMany: jest.Mock };
  officialPv: { count: jest.Mock };
  $queryRaw: jest.Mock;
};

describe('CalcResultsService — rename + deleteUnsealed', () => {
  let tx: MutTx;
  let prisma: { withTenant: jest.Mock };
  let service: CalcResultsService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx = {
      calcResult: {
        updateMany: jest.fn(),
        findUnique: jest.fn(),
        deleteMany: jest.fn(),
      },
      calcSnapshot: { deleteMany: jest.fn() },
      officialPv: { count: jest.fn() },
      $queryRaw: jest.fn(),
    };
    prisma = {
      withTenant: jest.fn(
        (_orgId: string, fn: (t: Prisma.TransactionClient) => unknown) =>
          fn(tx as unknown as Prisma.TransactionClient),
      ),
    };
    const subs = {} as unknown as SubscriptionsService;
    service = new CalcResultsService(prisma as unknown as PrismaService, subs);
  });

  describe('rename — etiquette scope projet', () => {
    it('given une ligne du bon projet : updateMany(where {id, projectId}) puis renvoie la ligne relue', async () => {
      tx.calcResult.updateMany.mockResolvedValue({ count: 1 });
      const relu = { id: 'calc-1', name: 'Variante' } as unknown as CalcResult;
      tx.calcResult.findUnique.mockResolvedValue(relu);

      const out = await withOrg(() =>
        service.rename({
          projectId: 'proj-1',
          calcResultId: 'calc-1',
          name: 'Variante',
        }),
      );
      expect(out).toBe(relu);
      // Le predicat projectId barre un calcul d'un AUTRE projet du meme org.
      expect(tx.calcResult.updateMany).toHaveBeenCalledWith({
        where: { id: 'calc-1', projectId: 'proj-1' },
        data: { name: 'Variante' },
      });
    });

    it('given count=0 (absent / hors tenant / autre projet) : renvoie null (404 en amont), sans relecture', async () => {
      tx.calcResult.updateMany.mockResolvedValue({ count: 0 });
      const out = await withOrg(() =>
        service.rename({
          projectId: 'proj-1',
          calcResultId: 'absent',
          name: 'x',
        }),
      );
      expect(out).toBeNull();
      // count=0 -> on n'inutilement PAS re-lire (pas de findUnique).
      expect(tx.calcResult.findUnique).not.toHaveBeenCalled();
    });

    it('given name=null : ecrit bien null (retour au mnemonique)', async () => {
      tx.calcResult.updateMany.mockResolvedValue({ count: 1 });
      tx.calcResult.findUnique.mockResolvedValue({
        id: 'calc-1',
      });
      await withOrg(() =>
        service.rename({
          projectId: 'proj-1',
          calcResultId: 'calc-1',
          name: null,
        }),
      );
      expect(tx.calcResult.updateMany).toHaveBeenCalledWith({
        where: { id: 'calc-1', projectId: 'proj-1' },
        data: { name: null },
      });
    });
  });

  describe('deleteUnsealed — refus 409 si scelle, sinon suppression scope projet', () => {
    const lockPresent = () =>
      tx.$queryRaw.mockResolvedValue([{ id: 'proj-1' }]);

    it('given une suppression : le SQL du verrou porte FOR UPDATE **et** le filtre de statut (revue ingenieur-securite B3/E1)', async () => {
      // Sans cette assertion, retirer `FOR UPDATE` ou `status <> ARCHIVED` de la
      // requete laissait TOUTE la suite verte : les tests mockent $queryRaw et
      // n'inspectaient jamais le SQL emis. Patron deja etabli dans le depot
      // (project-write-guard.spec.ts, projects-permanent-delete.service.spec.ts).
      lockPresent();
      tx.calcResult.findUnique.mockResolvedValue({
        id: 'calc-1',
        projectId: 'proj-1',
      });
      tx.officialPv.count.mockResolvedValue(0);
      tx.calcSnapshot.deleteMany.mockResolvedValue({ count: 0 });
      tx.calcResult.deleteMany.mockResolvedValue({ count: 1 });

      await withOrg(() =>
        service.deleteUnsealed({ projectId: 'proj-1', calcResultId: 'calc-1' }),
      );

      const sql = ((tx.$queryRaw.mock.calls as unknown[][])[0][0] as string[])
        .join('?')
        .replace(/\s+/g, ' ');
      // Le VERROU : sans lui, une emission de PV concurrente peut s'intercaler
      // entre le comptage et la suppression -> PV scelle orphelin.
      expect(sql).toContain('FOR UPDATE');
      // Le FILTRE DE STATUT : supprimer est une ecriture ; un projet archive est
      // « supprime » cote metier (defaut ferme en PR #120/#121).
      expect(sql).toContain("status <> 'ARCHIVED'");
    });

    it('given projet invisible (RLS) : verrou vide -> null (404), rien supprime', async () => {
      tx.$queryRaw.mockResolvedValue([]); // projet hors tenant -> 0 ligne
      const out = await withOrg(() =>
        service.deleteUnsealed({ projectId: 'proj-x', calcResultId: 'calc-1' }),
      );
      expect(out).toBeNull();
      expect(tx.calcResult.deleteMany).not.toHaveBeenCalled();
      expect(tx.officialPv.count).not.toHaveBeenCalled();
    });

    it('given calcul d un AUTRE projet du meme org : null (404), rien supprime', async () => {
      lockPresent();
      tx.calcResult.findUnique.mockResolvedValue({
        id: 'calc-1',
        projectId: 'AUTRE',
      });
      const out = await withOrg(() =>
        service.deleteUnsealed({ projectId: 'proj-1', calcResultId: 'calc-1' }),
      );
      expect(out).toBeNull();
      expect(tx.calcResult.deleteMany).not.toHaveBeenCalled();
    });

    it('given un PV existe pour ce calcul : 409, RIEN supprime (source d un livrable scelle)', async () => {
      lockPresent();
      tx.calcResult.findUnique.mockResolvedValue({
        id: 'calc-1',
        projectId: 'proj-1',
      });
      tx.officialPv.count.mockResolvedValue(1);
      await expect(
        withOrg(() =>
          service.deleteUnsealed({
            projectId: 'proj-1',
            calcResultId: 'calc-1',
          }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.calcResult.deleteMany).not.toHaveBeenCalled();
      expect(tx.calcSnapshot.deleteMany).not.toHaveBeenCalled();
    });

    it('given calcul NON scelle : supprime la capture PUIS le calcul, renvoie la ligne', async () => {
      lockPresent();
      const calc = {
        id: 'calc-1',
        projectId: 'proj-1',
      } as unknown as CalcResult;
      tx.calcResult.findUnique.mockResolvedValue(calc);
      tx.officialPv.count.mockResolvedValue(0);
      tx.calcSnapshot.deleteMany.mockResolvedValue({ count: 1 });
      tx.calcResult.deleteMany.mockResolvedValue({ count: 1 });

      const out = await withOrg(() =>
        service.deleteUnsealed({ projectId: 'proj-1', calcResultId: 'calc-1' }),
      );
      expect(out).toBe(calc);
      expect(tx.calcSnapshot.deleteMany).toHaveBeenCalledWith({
        where: { calcResultId: 'calc-1' },
      });
      expect(tx.calcResult.deleteMany).toHaveBeenCalledWith({
        where: { id: 'calc-1', projectId: 'proj-1' },
      });
    });
  });
});
