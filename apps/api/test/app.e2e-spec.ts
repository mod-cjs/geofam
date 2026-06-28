import type { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { configureApp } from './../src/app.config';
import { AppModule } from './../src/app.module';

/**
 * E2E — landing `GET /` (AppController).
 *
 * La racine sert une page d'accueil HTML sobre (orientation vers /docs et
 * /v1/health), PAS le stub « Hello World ». Elle est @RecetteExempt : accessible
 * SANS la cle X-Recette-Key meme quand le guard de recette est arme (#73) — c'est
 * une page d'orientation publique, sans donnee sensible. On boote avec
 * configureApp() (chaine de gardes reelle) et RECETTE_API_KEY posee pour prouver
 * que l'exemption de route tient avec le guard actif.
 *
 * NB : AppModule bootstrappe PrismaModule -> Postgres requis (pnpm db:up).
 */
describe('AppController — landing (e2e)', () => {
  let app: INestApplication<App>;
  let savedKey: string | undefined;

  beforeAll(async () => {
    savedKey = process.env.RECETTE_API_KEY;
    process.env.RECETTE_API_KEY = 'cle-recette-e2e-landing-0123456789';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (savedKey === undefined) delete process.env.RECETTE_API_KEY;
    else process.env.RECETTE_API_KEY = savedKey;
  });

  it('GET / sans cle -> 200 HTML (route @RecetteExempt, page d orientation)', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('<!doctype html>');
    // Oriente vers la doc et la sonde de sante ; pas de stub « Hello World ».
    expect(res.text).toContain('href="/docs"');
    expect(res.text).not.toContain('Hello World!');
  });
});
