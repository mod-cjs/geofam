import { ForbiddenException } from '@nestjs/common';

import type { AuthService } from './auth.service';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';
import { fakeReflector, httpContext } from './guard-test-utils';
import { RolesGuard } from './roles.guard';

/**
 * Non-regression A1 — RolesGuard.
 *
 * Defaut historique a verrouiller : une route @Public() qui porterait aussi un
 * @Roles(...) ne doit JAMAIS finir en 403. @Public court-circuite TOUS les
 * guards (sinon RolesGuard tournerait sans req.auth/req.tenant et leverait).
 */
describe('RolesGuard', () => {
  // AuthService non sollicite tant qu'aucun PlatformRole n'est requis. On garde
  // une reference typee au mock pour asserter sans deref de methode (lint).
  const platformRole = jest.fn();
  const authStub = { platformRole } as unknown as AuthService;

  beforeEach(() => jest.clearAllMocks());

  describe('given une route @Public()', () => {
    it('autorise (true) meme si un @Roles non satisfait traine -> jamais de 403', async () => {
      const guard = new RolesGuard(
        fakeReflector({
          [IS_PUBLIC_KEY]: true,
          // @Roles present mais aucun role tenant cote requete : sans le
          // court-circuit @Public, ce serait un 403.
          [ROLES_KEY]: ['ADMIN'],
        }),
        authStub,
      );
      const ctx = httpContext({});

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(platformRole).not.toHaveBeenCalled();
    });
  });

  describe('given aucune metadonnee @Roles', () => {
    it("autorise (true) : @Roles raffine, il n'est pas le seul rempart", async () => {
      const guard = new RolesGuard(fakeReflector({}), authStub);
      const ctx = httpContext({ auth: { userId: 'u1' } });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('autorise (true) si @Roles est une liste vide', async () => {
      const guard = new RolesGuard(
        fakeReflector({ [ROLES_KEY]: [] }),
        authStub,
      );
      const ctx = httpContext({ auth: { userId: 'u1' } });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('given un @Roles tenant', () => {
    it('autorise quand le role tenant courant figure dans la liste', async () => {
      const guard = new RolesGuard(
        fakeReflector({ [ROLES_KEY]: ['ADMIN', 'OWNER'] }),
        authStub,
      );
      const ctx = httpContext({
        auth: { userId: 'u1' },
        tenant: { orgId: 'o1', role: 'ADMIN' },
      });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('leve ForbiddenException quand le role tenant courant ne matche pas', async () => {
      const guard = new RolesGuard(
        fakeReflector({ [ROLES_KEY]: ['ADMIN'] }),
        authStub,
      );
      const ctx = httpContext({
        auth: { userId: 'u1' },
        tenant: { orgId: 'o1', role: 'VIEWER' },
      });

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      // Aucun role plateforme demande -> pas de requete DB inutile.
      expect(platformRole).not.toHaveBeenCalled();
    });
  });

  describe('given un @Roles plateforme (SUPERADMIN/SUPPORT)', () => {
    it('resout le platformRole paresseusement et autorise quand il matche', async () => {
      platformRole.mockResolvedValue('SUPERADMIN');
      const guard = new RolesGuard(
        fakeReflector({ [ROLES_KEY]: ['SUPERADMIN'] }),
        authStub,
      );
      const req = { auth: { userId: 'u1' } };
      const ctx = httpContext(req);

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(platformRole).toHaveBeenCalledWith('u1');
    });

    it('leve ForbiddenException quand le platformRole ne matche pas', async () => {
      platformRole.mockResolvedValue(null);
      const guard = new RolesGuard(
        fakeReflector({ [ROLES_KEY]: ['SUPPORT'] }),
        authStub,
      );
      const ctx = httpContext({ auth: { userId: 'u1' } });

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(platformRole).toHaveBeenCalledTimes(1);
    });
  });
});
