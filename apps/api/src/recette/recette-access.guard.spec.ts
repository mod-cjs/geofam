import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RecetteAccessGuard } from './recette-access.guard';
import { RECETTE_EXEMPT_KEY } from './recette-exempt.decorator';
import { RECETTE_API_KEY_ENV } from './recette.config';

/**
 * RecetteAccessGuard — porte de perimetre par cle d'API.
 *
 * On couvre les comportements decides :
 *  (a) cle posee + bon en-tete         -> autorise (true) ;
 *  (b) cle posee + en-tete absent/faux -> 401 (UnauthorizedException) ;
 *  (c) cle ABSENTE                      -> guard INERTE -> autorise (true) ;
 *  (d) EXEMPTION par @RecetteExempt() sur la ROUTE (et non par URL) : une route
 *      exemptee passe sans cle ; une route NON exemptee (ex. /calc/*) reste fermee
 *      quelle que soit l'URL.
 *
 * #73 : l'exemption ne s'appuie PLUS sur req.url/originalUrl (manipulable par
 * dot-segments/encodage). Le Reflector decide sur le HANDLER reellement matche.
 * Les cas d'URL deguisee sont prouves en e2e (recette-access-bypass.e2e-spec) sur
 * le routeur reel ; ici on prouve la LOGIQUE de decision via le Reflector.
 *
 * La cle est lue a CHAQUE appel depuis l'environnement : on la pose/retire
 * autour de chaque cas (restauration garantie en afterEach) pour eviter toute
 * fuite d'etat entre les tests.
 */
describe('RecetteAccessGuard', () => {
  let reflector: Reflector;
  let guard: RecetteAccessGuard;
  let saved: string | undefined;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RecetteAccessGuard(reflector);
    saved = process.env[RECETTE_API_KEY_ENV];
    delete process.env[RECETTE_API_KEY_ENV];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[RECETTE_API_KEY_ENV];
    else process.env[RECETTE_API_KEY_ENV] = saved;
  });

  /**
   * ExecutionContext mocke. `exempt` controle ce que le Reflector renverra pour
   * la metadonnee @RecetteExempt() sur le handler — c'est ce qui distingue une
   * route ouverte (landing/health) d'une route gardee (ex. /calc/*).
   */
  function ctx(
    headers: Record<string, string | string[] | undefined>,
    exempt = false,
  ): ExecutionContext {
    const handler = (): void => undefined;
    class FakeController {}
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key) =>
        key === RECETTE_EXEMPT_KEY ? exempt : undefined,
      );
    return {
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
      getHandler: () => handler,
      getClass: () => FakeController,
    } as unknown as ExecutionContext;
  }

  describe('given RECETTE_API_KEY posee', () => {
    const KEY = 'cle-recette-secrete-de-test-0123456789';
    beforeEach(() => {
      process.env[RECETTE_API_KEY_ENV] = KEY;
    });

    it('when le bon X-Recette-Key est fourni then autorise (true)', () => {
      expect(guard.canActivate(ctx({ 'x-recette-key': KEY }))).toBe(true);
    });

    it('when X-Recette-Key est ABSENT then 401', () => {
      expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
    });

    it('when X-Recette-Key est FAUX then 401', () => {
      expect(() =>
        guard.canActivate(ctx({ 'x-recette-key': 'mauvaise-cle' })),
      ).toThrow(UnauthorizedException);
    });

    it('when X-Recette-Key a la BONNE longueur mais differe then 401 (comparaison temps constant)', () => {
      // Meme longueur que KEY mais contenu different : exerce le chemin
      // timingSafeEqual (et non le court-circuit de longueur).
      const sameLen = 'X'.repeat(KEY.length);
      expect(sameLen.length).toBe(KEY.length);
      expect(() =>
        guard.canActivate(ctx({ 'x-recette-key': sameLen })),
      ).toThrow(UnauthorizedException);
    });

    it('when X-Recette-Key est vide ("") then 401 (traite comme absent)', () => {
      expect(() => guard.canActivate(ctx({ 'x-recette-key': '' }))).toThrow(
        UnauthorizedException,
      );
    });

    it('when la route est @RecetteExempt (sans cle) then autorise (true) — landing / sonde de sante', () => {
      // Route decoree @RecetteExempt (ex. GET / ou GET /v1/health) : passe sans
      // en-tete, meme avec la cle configuree.
      expect(guard.canActivate(ctx({}, true))).toBe(true);
    });

    it('when la route N EST PAS exemptee (ex. /calc/*) sans cle then 401', () => {
      // Aucune metadonnee @RecetteExempt -> la cle reste exigee. C'est la
      // garantie #73 : seules les routes DECOREES sont ouvertes, l'URL ne joue
      // aucun role.
      expect(() => guard.canActivate(ctx({}, false))).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('given RECETTE_API_KEY ABSENTE (guard inerte)', () => {
    it('when aucun en-tete then autorise (true) — e2e existants non casses', () => {
      expect(guard.canActivate(ctx({}))).toBe(true);
    });

    it('when un X-Recette-Key traine quand meme then autorise (true) — toujours inerte', () => {
      expect(guard.canActivate(ctx({ 'x-recette-key': 'peu-importe' }))).toBe(
        true,
      );
    });
  });
});
