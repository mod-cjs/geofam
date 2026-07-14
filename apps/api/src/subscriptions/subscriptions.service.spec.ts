import type { Prisma, Subscription } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';

import {
  ModuleNotInPackException,
  NoSubscriptionException,
  QuotaExhaustedException,
  SubscriptionExpiredException,
} from './subscription.errors';
import { SubscriptionsService } from './subscriptions.service';

/**
 * SubscriptionsService (ADR 0011). Tests unitaires de la LOGIQUE de decision :
 * ordre des refus (hors pack avant expire/quota), distinction des codes (403 vs
 * 402 EXPIRED vs 402 QUOTA), decompte conditionnel et tracage du ledger. La base
 * est stubbee (le contexte tenant/RLS/atomicite reel est prouve par les e2e ; ici
 * on verifie que le SERVICE leve la bonne erreur selon ce que la base renvoie).
 *
 * STUB : withTenant(orgId, fn) execute `fn(tx)` ; `tx.$queryRaw` est un mock
 * pilote (la 1re reponse = ligne(s) subscriptions, etc.), `tx.usageLedger.create`
 * un espion. asAppRole(fn) idem pour le provisionnement.
 */
type Tx = {
  $queryRaw: jest.Mock;
  usageLedger: { create: jest.Mock };
};

function makeRow(over: Partial<Subscription & { expired: boolean }> = {}) {
  const base = {
    id: 'sub-1',
    org_id: 'o1',
    pack: 'ROUTES',
    entitlements: ['burmister', 'terzaghi'],
    date_debut: new Date('2026-01-01T00:00:00Z'),
    date_fin: new Date('2026-12-31T23:59:59Z'),
    quota: 500,
    consommation: 10,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    expired: false,
  };
  // Le service mappe snake_case -> objet ; pour les champs camelCase lus
  // (entitlements/consommation/quota/dateFin/pack) on garde les deux casings dans
  // l'objet renvoye par $queryRaw afin que le mapping `sub as Subscription`
  // expose ce dont getEntitlements a besoin.
  const merged = { ...base, ...over };
  return {
    ...merged,
    // alias camelCase pour le path getEntitlements (sub.dateFin, sub.consommation...)
    entitlements: merged.entitlements,
    consommation: merged.consommation,
    quota: merged.quota,
    pack: merged.pack,
    dateFin: merged.date_fin,
  } as unknown as Subscription & { expired: boolean };
}

describe('SubscriptionsService', () => {
  let tx: Tx;
  let prisma: { withTenant: jest.Mock; asAppRole: jest.Mock };
  let service: SubscriptionsService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx = {
      $queryRaw: jest.fn(),
      usageLedger: { create: jest.fn().mockResolvedValue({ id: 'led-1' }) },
    };
    prisma = {
      withTenant: jest.fn(
        (_orgId: string, fn: (t: Prisma.TransactionClient) => unknown) =>
          fn(tx as unknown as Prisma.TransactionClient),
      ),
      asAppRole: jest.fn((fn: (t: Prisma.TransactionClient) => unknown) =>
        fn(tx as unknown as Prisma.TransactionClient),
      ),
    };
    service = new SubscriptionsService(prisma as unknown as PrismaService);
  });

  describe('assertAccess (pre-check du guard)', () => {
    it('aucun abonnement -> 403 NoSubscription', async () => {
      tx.$queryRaw.mockResolvedValue([]);
      await expect(
        service.assertAccess('o1', 'burmister', 'CALC'),
      ).rejects.toBeInstanceOf(NoSubscriptionException);
    });

    it('module HORS PACK -> 403 ModuleNotInPack (verifie AVANT expiration/quota)', async () => {
      // Abo EXPIRE ET quota epuise, mais module hors pack : c'est le 403 hors pack
      // qui prime (un renouvellement ne debloquerait pas le module).
      tx.$queryRaw.mockResolvedValue([
        makeRow({ expired: true, consommation: 999, quota: 1 }),
      ]);
      await expect(
        service.assertAccess('o1', 'radier', 'CALC'),
      ).rejects.toBeInstanceOf(ModuleNotInPackException);
    });

    it('abonnement EXPIRE (module OK) -> 402 EXPIRED', async () => {
      tx.$queryRaw.mockResolvedValue([makeRow({ expired: true })]);
      await expect(
        service.assertAccess('o1', 'burmister', 'CALC'),
      ).rejects.toBeInstanceOf(SubscriptionExpiredException);
    });

    it('QUOTA epuise (module OK, non expire, route consommante) -> 402 QUOTA', async () => {
      tx.$queryRaw.mockResolvedValue([
        makeRow({ consommation: 500, quota: 500 }),
      ]);
      await expect(
        service.assertAccess('o1', 'burmister', 'CALC'),
      ).rejects.toBeInstanceOf(QuotaExhaustedException);
    });

    it('quota epuise mais route NON consommante (consumes undefined) -> passe (pas de pre-check quota)', async () => {
      tx.$queryRaw.mockResolvedValue([
        makeRow({ consommation: 500, quota: 500 }),
      ]);
      await expect(
        service.assertAccess('o1', 'burmister', undefined),
      ).resolves.toBeUndefined();
    });

    it('cas nominal (module OK, non expire, quota libre) -> passe', async () => {
      tx.$queryRaw.mockResolvedValue([makeRow()]);
      await expect(
        service.assertAccess('o1', 'burmister', 'CALC'),
      ).resolves.toBeUndefined();
    });
  });

  describe('reserveUnit (decompte atomique)', () => {
    it('1 ligne reservee -> insere le LEDGER (kind/refId/userId/orgId) et renvoie subId', async () => {
      // 1er $queryRaw = UPDATE ... RETURNING id (la reservation).
      tx.$queryRaw.mockResolvedValueOnce([{ id: 'sub-1' }]);

      const subId = await service.reserveUnit(
        tx as unknown as Prisma.TransactionClient,
        {
          orgId: 'o1',
          kind: 'CALC',
          refId: 'calc-1',
          userId: 'u1',
        },
      );

      expect(subId).toBe('sub-1');
      expect(tx.usageLedger.create).toHaveBeenCalledWith({
        data: {
          orgId: 'o1',
          subscriptionId: 'sub-1',
          kind: 'CALC',
          refId: 'calc-1',
          userId: 'u1',
        },
      });
    });

    it('0 ligne reservee + abo expire -> 402 EXPIRED, AUCUN ledger insere (rien consomme)', async () => {
      tx.$queryRaw
        .mockResolvedValueOnce([]) // UPDATE -> 0 ligne
        .mockResolvedValueOnce([makeRow({ expired: true })]); // loadState
      await expect(
        service.reserveUnit(tx as unknown as Prisma.TransactionClient, {
          orgId: 'o1',
          kind: 'PV',
          refId: null,
          userId: 'u1',
        }),
      ).rejects.toBeInstanceOf(SubscriptionExpiredException);
      expect(tx.usageLedger.create).not.toHaveBeenCalled();
    });

    it('0 ligne reservee + quota epuise -> 402 QUOTA, aucun ledger', async () => {
      tx.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([makeRow({ consommation: 500, quota: 500 })]);
      await expect(
        service.reserveUnit(tx as unknown as Prisma.TransactionClient, {
          orgId: 'o1',
          kind: 'CALC',
          refId: 'c1',
          userId: 'u1',
        }),
      ).rejects.toBeInstanceOf(QuotaExhaustedException);
      expect(tx.usageLedger.create).not.toHaveBeenCalled();
    });

    it('0 ligne reservee + aucun abonnement -> 403 NoSubscription', async () => {
      tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await expect(
        service.reserveUnit(tx as unknown as Prisma.TransactionClient, {
          orgId: 'o1',
          kind: 'CALC',
          refId: 'c1',
          userId: 'u1',
        }),
      ).rejects.toBeInstanceOf(NoSubscriptionException);
    });
  });

  describe('getEntitlements (contrat /me/entitlements)', () => {
    it('renvoie modules/expiresAt/expired/quota{limit,used,remaining}/serverTime', async () => {
      tx.$queryRaw
        .mockResolvedValueOnce([
          makeRow({ consommation: 137, quota: 500, expired: false }),
        ])
        .mockResolvedValueOnce([{ now: new Date('2026-06-27T10:00:00Z') }]);

      const view = await service.getEntitlements('o1');
      expect(view.modules).toEqual(['burmister', 'terzaghi']);
      expect(view.pack).toBe('ROUTES');
      expect(view.expired).toBe(false);
      expect(view.quota).toEqual({ limit: 500, used: 137, remaining: 363 });
      expect(view.expiresAt).toBe('2026-12-31T23:59:59.000Z');
      expect(view.serverTime).toBe('2026-06-27T10:00:00.000Z');
    });

    it('remaining ne descend jamais sous 0 (used > limit -> 0)', async () => {
      tx.$queryRaw
        .mockResolvedValueOnce([makeRow({ consommation: 600, quota: 500 })])
        .mockResolvedValueOnce([{ now: new Date('2026-06-27T10:00:00Z') }]);
      const view = await service.getEntitlements('o1');
      expect(view.quota.remaining).toBe(0);
    });

    it('aucun abonnement -> 403 NoSubscription', async () => {
      tx.$queryRaw.mockResolvedValueOnce([]);
      await expect(service.getEntitlements('o1')).rejects.toBeInstanceOf(
        NoSubscriptionException,
      );
    });
  });

  describe('provision (creation a la creation d org)', () => {
    it('appelle provision_subscription via asAppRole et renvoie l id', async () => {
      tx.$queryRaw.mockResolvedValue([{ provision_subscription: 'sub-new' }]);
      const id = await service.provision({
        orgId: 'o1',
        pack: 'ROUTES',
        entitlements: ['burmister'],
        dateDebut: new Date('2026-01-01T00:00:00Z'),
        dateFin: new Date('2026-12-31T00:00:00Z'),
        quota: 100,
      });
      expect(id).toBe('sub-new');
      expect(prisma.asAppRole).toHaveBeenCalledTimes(1);
    });
  });
});
