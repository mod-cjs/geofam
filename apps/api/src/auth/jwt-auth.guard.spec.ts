import { UnauthorizedException } from '@nestjs/common';

import { IS_PUBLIC_KEY } from './decorators';
import { fakeReflector, httpContext } from './guard-test-utils';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthedRequest } from './request-context';
import type { TokenService } from './token.service';

/**
 * Densification B — JwtAuthGuard.
 *
 * Deny-by-default : route protegee sans token -> 401 ; token invalide -> 401 ;
 * @Public() honore (pas de verif) ; sur succes pose req.auth = { userId } a
 * partir du SUB verifie (jamais d'un en-tete brut).
 */
describe('JwtAuthGuard', () => {
  function makeTokens(verifyImpl: jest.Mock): TokenService {
    return { verify: verifyImpl } as unknown as TokenService;
  }

  describe('given une route @Public()', () => {
    it('autorise sans verifier de token', async () => {
      const verify = jest.fn();
      const guard = new JwtAuthGuard(
        fakeReflector({ [IS_PUBLIC_KEY]: true }),
        makeTokens(verify),
      );
      await expect(guard.canActivate(httpContext({}))).resolves.toBe(true);
      expect(verify).not.toHaveBeenCalled();
    });
  });

  describe('given une route protegee', () => {
    it("rejette (401) en l'absence d'en-tete Authorization", async () => {
      const guard = new JwtAuthGuard(fakeReflector({}), makeTokens(jest.fn()));
      const ctx = httpContext({ headers: {} });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejette (401) un schema non-bearer', async () => {
      const verify = jest.fn();
      const guard = new JwtAuthGuard(fakeReflector({}), makeTokens(verify));
      const ctx = httpContext({
        headers: { authorization: 'Basic abc' },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      // Pas meme tente de verifier un token absent.
      expect(verify).not.toHaveBeenCalled();
    });

    it('rejette (401) quand le token ne se verifie pas', async () => {
      const verify = jest.fn().mockResolvedValue(null);
      const guard = new JwtAuthGuard(fakeReflector({}), makeTokens(verify));
      const ctx = httpContext({
        headers: { authorization: 'Bearer mauvais.jwt' },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      // Verifie bien comme un token 'access' (pas refresh).
      expect(verify).toHaveBeenCalledWith('mauvais.jwt', 'access');
    });

    it('autorise et pose req.auth.userId = sub verifie sur un access valide', async () => {
      const verify = jest.fn().mockResolvedValue('user-9');
      const guard = new JwtAuthGuard(fakeReflector({}), makeTokens(verify));
      const req = {
        headers: { authorization: 'Bearer bon.jwt' },
      } as Partial<AuthedRequest>;
      const ctx = httpContext(req);

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.auth).toEqual({ userId: 'user-9' });
    });
  });
});
