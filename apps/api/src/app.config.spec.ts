import { assertNoDevHeadersInProd } from './app.config';

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
