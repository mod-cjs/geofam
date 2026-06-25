import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import { RecetteAccessGuard } from './recette-access.guard';
import { RECETTE_API_KEY_ENV } from './recette.config';

/**
 * RecetteAccessGuard — porte de perimetre par cle d'API.
 *
 * On couvre les TROIS comportements decides :
 *  (a) cle posee + bon en-tete         -> autorise (true) ;
 *  (b) cle posee + en-tete absent/faux -> 401 (UnauthorizedException) ;
 *  (c) cle ABSENTE                      -> guard INERTE -> autorise (true).
 *
 * La cle est lue a CHAQUE appel depuis l'environnement : on la pose/retire
 * autour de chaque cas (restauration garantie en afterEach) pour eviter toute
 * fuite d'etat entre les tests.
 */
describe('RecetteAccessGuard', () => {
  const guard = new RecetteAccessGuard();
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[RECETTE_API_KEY_ENV];
    delete process.env[RECETTE_API_KEY_ENV];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[RECETTE_API_KEY_ENV];
    else process.env[RECETTE_API_KEY_ENV] = saved;
  });

  /** ExecutionContext mocke autour des en-tetes HTTP fournis (+ url optionnelle). */
  function ctxWithHeaders(
    headers: Record<string, string | string[] | undefined>,
    url?: string,
  ): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ headers, url }) }),
    } as unknown as ExecutionContext;
  }

  describe('given RECETTE_API_KEY posee', () => {
    const KEY = 'cle-recette-secrete-de-test-0123456789';
    beforeEach(() => {
      process.env[RECETTE_API_KEY_ENV] = KEY;
    });

    it('when le bon X-Recette-Key est fourni then autorise (true)', () => {
      const ctx = ctxWithHeaders({ 'x-recette-key': KEY });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('when X-Recette-Key est ABSENT then 401', () => {
      const ctx = ctxWithHeaders({});
      expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('when X-Recette-Key est FAUX then 401', () => {
      const ctx = ctxWithHeaders({ 'x-recette-key': 'mauvaise-cle' });
      expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('when X-Recette-Key a la BONNE longueur mais differe then 401 (comparaison temps constant)', () => {
      // Meme longueur que KEY mais contenu different : exerce le chemin
      // timingSafeEqual (et non le court-circuit de longueur).
      const sameLen = 'X'.repeat(KEY.length);
      expect(sameLen.length).toBe(KEY.length);
      const ctx = ctxWithHeaders({ 'x-recette-key': sameLen });
      expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('when X-Recette-Key est vide ("") then 401 (traite comme absent)', () => {
      const ctx = ctxWithHeaders({ 'x-recette-key': '' });
      expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('when la sonde de sante /v1/health (sans cle) then autorise (true) — exemption Render', () => {
      // La sonde de l'hebergeur n'envoie pas d'en-tete : /v1/health doit passer.
      expect(guard.canActivate(ctxWithHeaders({}, '/v1/health'))).toBe(true);
      // Avec query string + slash final : meme exemption.
      expect(guard.canActivate(ctxWithHeaders({}, '/v1/health/?probe=1'))).toBe(
        true,
      );
    });

    it('when la doc Swagger (/docs, /docs-json, assets) sans cle then autorise (true) — UI chargeable au navigateur', () => {
      // L'UI Swagger doit se charger sans cle pour que l'utilisateur clique Authorize.
      expect(guard.canActivate(ctxWithHeaders({}, '/docs'))).toBe(true);
      expect(guard.canActivate(ctxWithHeaders({}, '/docs-json'))).toBe(true);
      expect(
        guard.canActivate(ctxWithHeaders({}, '/docs/swagger-ui-bundle.js')),
      ).toBe(true);
    });

    it('when /calc/* ou la racine / sans cle then 401 (les CALCULS restent fermes)', () => {
      expect(() =>
        guard.canActivate(ctxWithHeaders({}, '/calc/terzaghi')),
      ).toThrow(UnauthorizedException);
      // Un chemin qui ne fait que COMMENCER par "docs" sans slash n'est pas exempte.
      expect(() =>
        guard.canActivate(ctxWithHeaders({}, '/docs-secret')),
      ).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(ctxWithHeaders({}, '/'))).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('given RECETTE_API_KEY ABSENTE (guard inerte)', () => {
    it('when aucun en-tete then autorise (true) — e2e existants non casses', () => {
      const ctx = ctxWithHeaders({});
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('when un X-Recette-Key traine quand meme then autorise (true) — toujours inerte', () => {
      const ctx = ctxWithHeaders({ 'x-recette-key': 'peu-importe' });
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });
});
