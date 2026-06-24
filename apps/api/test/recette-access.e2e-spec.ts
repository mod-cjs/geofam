import type { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { configureApp } from './../src/app.config';
import { AppModule } from './../src/app.module';

/**
 * E2E — RecetteAccessGuard (porte de perimetre par cle d'API).
 *
 * Sur l'AppModule REEL (guard global RecetteAccessGuard cable en tete de la
 * chaine APP_GUARD), on prouve les TROIS comportements decides, sur une route
 * @Public NON tenant (/v1/health) pour isoler la barriere recette de l'auth JWT :
 *   (a) RECETTE_API_KEY posee + bon X-Recette-Key -> 200 ;
 *   (b) RECETTE_API_KEY posee + en-tete absent/faux -> 401 ;
 *   (c) RECETTE_API_KEY ABSENTE -> guard inerte -> 200.
 *
 * La cle est posee/retiree AVANT le bootstrap de chaque app, et restauree en
 * fin de suite : pas de fuite d'etat d'environnement entre cas/suites.
 *
 * NB : l'AppModule bootstrappe PrismaModule -> Postgres requis (pnpm db:up +
 * apps/api/.env), comme les autres e2e.
 */
const KEY = 'cle-recette-e2e-0123456789abcdef';

describe('RecetteAccessGuard (e2e)', () => {
  let savedKey: string | undefined;

  beforeAll(() => {
    savedKey = process.env.RECETTE_API_KEY;
  });

  afterAll(() => {
    if (savedKey === undefined) delete process.env.RECETTE_API_KEY;
    else process.env.RECETTE_API_KEY = savedKey;
  });

  /** Bootstrappe une app configuree comme en prod, etat d'env courant fige. */
  async function boot(): Promise<INestApplication<App>> {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app: INestApplication<App> = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    return app;
  }

  describe('given RECETTE_API_KEY posee', () => {
    let app: INestApplication<App>;
    beforeAll(async () => {
      process.env.RECETTE_API_KEY = KEY;
      app = await boot();
    });
    afterAll(async () => {
      await app.close();
      delete process.env.RECETTE_API_KEY;
    });

    it('(a) bon X-Recette-Key -> 200', async () => {
      await request(app.getHttpServer())
        .get('/v1/health')
        .set('X-Recette-Key', KEY)
        .expect(200);
    });

    it('(b) X-Recette-Key absent -> 401', async () => {
      await request(app.getHttpServer()).get('/v1/health').expect(401);
    });

    it('(b) X-Recette-Key faux -> 401', async () => {
      await request(app.getHttpServer())
        .get('/v1/health')
        .set('X-Recette-Key', 'mauvaise-cle')
        .expect(401);
    });
  });

  describe('given RECETTE_API_KEY absente (guard inerte)', () => {
    let app: INestApplication<App>;
    beforeAll(async () => {
      delete process.env.RECETTE_API_KEY;
      app = await boot();
    });
    afterAll(async () => {
      await app.close();
    });

    it('(c) aucune cle posee -> 200 sans en-tete (e2e existants non casses)', async () => {
      await request(app.getHttpServer()).get('/v1/health').expect(200);
    });
  });
});
