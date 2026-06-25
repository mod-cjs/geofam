import {
  assertCorsOriginsInProd,
  assertNoDevHeadersInProd,
  resolveCorsOrigins,
} from './app.config';

/**
 * Test unitaire du fail-fast securite (revue adverse MINEUR-2).
 *
 * La voie en-tetes de DEV (x-org-id / x-user-id) contourne le TenantGuard.
 * Si ROADSEN_DEV_HEADERS=1 fuit en prod, le boot DOIT etre refuse. On verifie
 * la matrice NODE_ENV x ROADSEN_DEV_HEADERS.
 */
describe('assertNoDevHeadersInProd — fail-fast au boot', () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevDevHeaders = process.env.ROADSEN_DEV_HEADERS;

  afterEach(() => {
    // restaure l'environnement pour ne pas polluer les autres tests
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevDevHeaders === undefined) delete process.env.ROADSEN_DEV_HEADERS;
    else process.env.ROADSEN_DEV_HEADERS = prevDevHeaders;
  });

  it('REFUSE le boot si NODE_ENV=production ET ROADSEN_DEV_HEADERS=1', () => {
    process.env.NODE_ENV = 'production';
    process.env.ROADSEN_DEV_HEADERS = '1';
    expect(() => assertNoDevHeadersInProd()).toThrow(
      /ROADSEN_DEV_HEADERS=1 avec NODE_ENV=production/i,
    );
  });

  it('AUTORISE le boot en production SANS dev-headers', () => {
    process.env.NODE_ENV = 'production';
    process.env.ROADSEN_DEV_HEADERS = '0';
    expect(() => assertNoDevHeadersInProd()).not.toThrow();
  });

  it('AUTORISE le boot en production si la var est absente', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ROADSEN_DEV_HEADERS;
    expect(() => assertNoDevHeadersInProd()).not.toThrow();
  });

  it('AUTORISE dev-headers hors production (dev/test)', () => {
    process.env.NODE_ENV = 'development';
    process.env.ROADSEN_DEV_HEADERS = '1';
    expect(() => assertNoDevHeadersInProd()).not.toThrow();
  });
});

/**
 * Test unitaire du fail-fast CORS (#73, MINEUR-2).
 *
 * En production, un defaut permissif (origin:true) est interdit : sans liste
 * d'origines declaree, le boot doit etre refuse. Hors prod (recette), le defaut
 * permissif est tolere (la cle X-Recette-Key reste la barriere).
 */
describe('assertCorsOriginsInProd — fail-fast au boot', () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevRoadsenEnv = process.env.ROADSEN_ENV;
  const prevOrigins = process.env.ROADSEN_CORS_ORIGINS;

  afterEach(() => {
    const restore = (k: string, v: string | undefined): void => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    };
    restore('NODE_ENV', prevNodeEnv);
    restore('ROADSEN_ENV', prevRoadsenEnv);
    restore('ROADSEN_CORS_ORIGINS', prevOrigins);
  });

  it('REFUSE le boot si NODE_ENV=production ET aucune origine declaree', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ROADSEN_ENV;
    delete process.env.ROADSEN_CORS_ORIGINS;
    expect(() => assertCorsOriginsInProd()).toThrow(/origine CORS/i);
  });

  it('REFUSE le boot si ROADSEN_ENV=production ET liste vide/blancs', () => {
    delete process.env.NODE_ENV;
    process.env.ROADSEN_ENV = 'production';
    process.env.ROADSEN_CORS_ORIGINS = '  ,  ,';
    expect(() => assertCorsOriginsInProd()).toThrow(/origine CORS/i);
  });

  it('AUTORISE le boot en production avec au moins une origine declaree', () => {
    process.env.NODE_ENV = 'production';
    process.env.ROADSEN_CORS_ORIGINS = 'https://app.roadsen.example';
    expect(() => assertCorsOriginsInProd()).not.toThrow();
    expect(resolveCorsOrigins()).toEqual(['https://app.roadsen.example']);
  });

  it('AUTORISE le defaut permissif hors production (recette), sans origine', () => {
    process.env.NODE_ENV = 'test';
    process.env.ROADSEN_ENV = 'recette';
    delete process.env.ROADSEN_CORS_ORIGINS;
    expect(() => assertCorsOriginsInProd()).not.toThrow();
  });
});
