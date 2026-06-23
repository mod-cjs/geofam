import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import type { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from './decorators';
import { fakeReflector, httpContext } from './guard-test-utils';
import type { AuthedRequest } from './request-context';
import { TenantGuard } from './tenant.guard';

/**
 * Densification B — TenantGuard.
 *
 * Cle de l'isolation : l'org demandee (en-tete x-org-id / param :orgId) n'est
 * PAS crue ; on prouve l'appartenance via membershipRole. Fail-closed :
 *  - pas d'auth en amont -> 401 (config KO) ;
 *  - org absente -> 403 ; org non-uuid -> 403 ;
 *  - pas membre -> 403 et AUCUN req.tenant pose ;
 *  - membre -> pose req.tenant = { orgId, role }.
 * @Public() court-circuite (coherence inter-guards).
 */
const VALID_ORG = '11111111-1111-4111-8111-111111111111';

describe('TenantGuard', () => {
  function makeAuth(membershipImpl: jest.Mock): AuthService {
    return { membershipRole: membershipImpl } as unknown as AuthService;
  }

  describe('given une route @Public()', () => {
    it('autorise sans toucher au membership', async () => {
      const membership = jest.fn();
      const guard = new TenantGuard(
        fakeReflector({ [IS_PUBLIC_KEY]: true }),
        makeAuth(membership),
      );
      await expect(guard.canActivate(httpContext({}))).resolves.toBe(true);
      expect(membership).not.toHaveBeenCalled();
    });
  });

  describe('given une requete sans auth en amont', () => {
    it("rejette (401) : JwtAuthGuard aurait du s'executer avant", async () => {
      const guard = new TenantGuard(fakeReflector({}), makeAuth(jest.fn()));
      const ctx = httpContext({ headers: {} });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('given une org manquante ou invalide', () => {
    it("rejette (403) quand aucune org n'est fournie", async () => {
      const guard = new TenantGuard(fakeReflector({}), makeAuth(jest.fn()));
      const ctx = httpContext({
        auth: { userId: 'u1' },
        headers: {},
        params: {},
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejette (403) une org non-uuid SANS interroger le membership', async () => {
      const membership = jest.fn();
      const guard = new TenantGuard(fakeReflector({}), makeAuth(membership));
      const ctx = httpContext({
        auth: { userId: 'u1' },
        headers: { 'x-org-id': 'pas-un-uuid' },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(membership).not.toHaveBeenCalled();
    });
  });

  describe("given un user non membre de l'org demandee", () => {
    it('rejette (403) et ne pose AUCUN contexte tenant (fail-closed)', async () => {
      const membership = jest.fn().mockResolvedValue(null);
      const guard = new TenantGuard(fakeReflector({}), makeAuth(membership));
      const req = {
        auth: { userId: 'u1' },
        headers: { 'x-org-id': VALID_ORG },
      } as Partial<AuthedRequest>;
      const ctx = httpContext(req);

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(membership).toHaveBeenCalledWith('u1', VALID_ORG);
      expect(req.tenant).toBeUndefined();
    });
  });

  describe('given un user membre', () => {
    it('autorise et pose req.tenant = { orgId, role } a partir du membership verifie', async () => {
      const membership = jest.fn().mockResolvedValue('ENGINEER');
      const guard = new TenantGuard(fakeReflector({}), makeAuth(membership));
      const req = {
        auth: { userId: 'u1' },
        headers: { 'x-org-id': VALID_ORG },
      } as Partial<AuthedRequest>;
      const ctx = httpContext(req);

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.tenant).toEqual({ orgId: VALID_ORG, role: 'ENGINEER' });
    });

    it("lit l'org depuis le param :orgId quand l'en-tete est absent", async () => {
      const membership = jest.fn().mockResolvedValue('VIEWER');
      const guard = new TenantGuard(fakeReflector({}), makeAuth(membership));
      const req = {
        auth: { userId: 'u1' },
        headers: {},
        params: { orgId: VALID_ORG },
      } as unknown as Partial<AuthedRequest>;
      const ctx = httpContext(req);

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(membership).toHaveBeenCalledWith('u1', VALID_ORG);
    });
  });
});
