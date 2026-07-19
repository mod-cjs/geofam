import { NotFoundException } from '@nestjs/common';
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
