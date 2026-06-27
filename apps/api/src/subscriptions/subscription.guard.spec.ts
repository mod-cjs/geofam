import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY, NO_TENANT_KEY } from '../auth/decorators';
import type { AuthedRequest } from '../auth/request-context';

import {
  CONSUMES_KEY,
  REQUIRES_ENTITLEMENT_KEY,
  type ConsumeKind,
  type EntitlementRef,
} from './decorators';
import { NoSubscriptionException } from './subscription.errors';
import { SubscriptionGuard } from './subscription.guard';
import type { SubscriptionsService } from './subscriptions.service';

/**
 * SubscriptionGuard (ADR 0011 §2). Tests de la LOGIQUE de routage du guard :
 * quelles routes il verifie, quel engineId il resout, et qu'il delegue la
 * decision (403/402) au service (lecture EN BASE). On ne teste pas ici la base ;
 * le pre-check reel sous Postgres est couvert par les e2e (qa-test).
 */
describe('SubscriptionGuard', () => {
  let reflector: Reflector;
  let subscriptions: { assertAccess: jest.Mock };
  let guard: SubscriptionGuard;

  beforeEach(() => {
    reflector = new Reflector();
    subscriptions = { assertAccess: jest.fn().mockResolvedValue(undefined) };
    guard = new SubscriptionGuard(
      reflector,
      subscriptions as unknown as SubscriptionsService,
    );
  });

  /** Forge un ExecutionContext minimal portant la metadonnee de route + la requete. */
  function makeContext(opts: {
    isPublic?: boolean;
    noTenant?: boolean;
    entitlement?: EntitlementRef;
    consumes?: ConsumeKind;
    req: Partial<AuthedRequest>;
  }): ExecutionContext {
    const handler = () => undefined;
    const cls = class Ctrl {};
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: unknown) => {
        if (key === IS_PUBLIC_KEY) return opts.isPublic ?? false;
        if (key === NO_TENANT_KEY) return opts.noTenant ?? false;
        if (key === REQUIRES_ENTITLEMENT_KEY) return opts.entitlement;
        if (key === CONSUMES_KEY) return opts.consumes;
        return undefined;
      });
    return {
      getHandler: () => handler,
      getClass: () => cls,
      switchToHttp: () => ({ getRequest: () => opts.req as AuthedRequest }),
    } as unknown as ExecutionContext;
  }

  it('laisse passer une route NON consommante (ni entitlement, ni consumes) SANS toucher la base', async () => {
    const ctx = makeContext({
      req: { tenant: { orgId: 'o1', role: 'OWNER' } },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(subscriptions.assertAccess).not.toHaveBeenCalled();
  });

  it('laisse passer une route @Public sans verif', async () => {
    const ctx = makeContext({ isPublic: true, consumes: 'CALC', req: {} });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(subscriptions.assertAccess).not.toHaveBeenCalled();
  });

  it('laisse passer une route @NoTenant sans verif (pas d org -> pas d abo)', async () => {
    const ctx = makeContext({ noTenant: true, consumes: 'CALC', req: {} });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(subscriptions.assertAccess).not.toHaveBeenCalled();
  });

  it('resout l engineId depuis un PARAM de route et delegue a assertAccess (CALC)', async () => {
    const ctx = makeContext({
      entitlement: { kind: 'param', param: 'engine' },
      consumes: 'CALC',
      req: {
        tenant: { orgId: 'o1', role: 'ENGINEER' },
        params: { engine: 'burmister' },
      },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    // engineId = la valeur du param :engine (slug) ; consumes = 'CALC'.
    expect(subscriptions.assertAccess).toHaveBeenCalledWith(
      'o1',
      'burmister',
      'CALC',
    );
  });

  it('resout un engineId FIXE et delegue', async () => {
    const ctx = makeContext({
      entitlement: { kind: 'fixed', engineId: 'terzaghi' },
      req: { tenant: { orgId: 'o1', role: 'OWNER' } },
    });
    await guard.canActivate(ctx);
    expect(subscriptions.assertAccess).toHaveBeenCalledWith(
      'o1',
      'terzaghi',
      undefined,
    );
  });

  it('route @Consumes(PV) sans engine requis : engineId undefined, consumes PV', async () => {
    const ctx = makeContext({
      consumes: 'PV',
      req: { tenant: { orgId: 'o9', role: 'ADMIN' } },
    });
    await guard.canActivate(ctx);
    expect(subscriptions.assertAccess).toHaveBeenCalledWith(
      'o9',
      undefined,
      'PV',
    );
  });

  it('FAIL-CLOSED : route consommante mais req.tenant absent (config KO) -> 403 NoSubscription', async () => {
    const ctx = makeContext({ consumes: 'CALC', req: {} });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      NoSubscriptionException,
    );
    expect(subscriptions.assertAccess).not.toHaveBeenCalled();
  });

  it('propage le refus du service (ex. 402) sans le masquer', async () => {
    subscriptions.assertAccess.mockRejectedValue(new Error('402 QUOTA'));
    const ctx = makeContext({
      consumes: 'CALC',
      req: { tenant: { orgId: 'o1', role: 'OWNER' } },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow('402 QUOTA');
  });
});
