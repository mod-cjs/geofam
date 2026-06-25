import type { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TERZAGHI_FIXTURES, type TerzaghiOutput } from '@roadsen/engines';
import type { EngineResultEnvelope } from '@roadsen/shared';
import request from 'supertest';
import type { App } from 'supertest/types';

import { configureApp } from './../src/app.config';
import { AppModule } from './../src/app.module';

/**
 * E2E — RecetteAccessGuard (porte de perimetre par cle d'API).
 *
 * Sur l'AppModule REEL (guard global RecetteAccessGuard cable en tete de la
 * chaine APP_GUARD), on prouve les comportements decides. On vise une route
 * REELLEMENT GARDEE : `POST /calc/terzaghi` (la landing `/` et la sonde
 * `/v1/health` sont EXEMPTEES via @RecetteExempt -> inutilisables pour prouver le
 * 401). Le guard s'execute AVANT la validation du corps :
 *   (a) RECETTE_API_KEY posee + bon X-Recette-Key -> PASSE le guard ; on PROUVE
 *       que le calcul est REELLEMENT atteint : corps vide -> 400 (rejet Zod APRES
 *       le guard) ; corps VALIDE (fixture) -> 201 (l'enveloppe moteur revient) ;
 *   (b) RECETTE_API_KEY posee + en-tete absent/faux -> 401 (avant la validation) ;
 *   (c) RECETTE_API_KEY ABSENTE -> guard inerte -> passe (≠ 401).
 *
 * La cle est posee/retiree AVANT le bootstrap de chaque app, et restauree en
 * fin de suite : pas de fuite d'etat d'environnement entre cas/suites.
 *
 * PERF : ces cas ne touchent PAS /docs -> on pose ROADSEN_SKIP_DOCS=1 pour EVITER
 * la generation (CPU-lourde, ~dizaines de s) du document OpenAPI au boot, qui
 * faisait timeout le beforeAll (30 s). openapi-doc.e2e, lui, NE pose PAS ce flag.
 *
 * NB : l'AppModule bootstrappe PrismaModule -> Postgres requis (pnpm db:up +
 * apps/api/.env), comme les autres e2e.
 */
const KEY = 'cle-recette-e2e-0123456789abcdef';

/** Entree VALIDE (contrat #56) : un cas du jeu de fixtures du moteur terzaghi. */
const VALID_TERZAGHI_INPUT =
  TERZAGHI_FIXTURES.find((f) => f.id === 'nominal-pressio-rect')?.input ??
  TERZAGHI_FIXTURES[0]?.input;

describe('RecetteAccessGuard (e2e)', () => {
  let savedKey: string | undefined;
  let savedSkipDocs: string | undefined;

  beforeAll(() => {
    savedKey = process.env.RECETTE_API_KEY;
    savedSkipDocs = process.env.ROADSEN_SKIP_DOCS;
    process.env.ROADSEN_SKIP_DOCS = '1';
  });

  afterAll(() => {
    if (savedKey === undefined) delete process.env.RECETTE_API_KEY;
    else process.env.RECETTE_API_KEY = savedKey;
    if (savedSkipDocs === undefined) delete process.env.ROADSEN_SKIP_DOCS;
    else process.env.ROADSEN_SKIP_DOCS = savedSkipDocs;
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

    it('(a) bon X-Recette-Key + corps VIDE -> passe le guard puis 400 (validation Zod APRES le guard)', async () => {
      // Le 400 (et non 401) PROUVE que la cle a fait passer le guard et qu'on a
      // atteint la validation d'entree : la barriere de perimetre est franchie.
      await request(app.getHttpServer())
        .post('/calc/terzaghi')
        .set('X-Recette-Key', KEY)
        .send({})
        .expect(400);
    });

    it('(a) bon X-Recette-Key + corps VALIDE -> 201 (le calcul est REELLEMENT atteint)', async () => {
      expect(VALID_TERZAGHI_INPUT).toBeDefined();
      const res = await request(app.getHttpServer())
        .post('/calc/terzaghi')
        .set('X-Recette-Key', KEY)
        .send(VALID_TERZAGHI_INPUT)
        .expect(201);
      // L'enveloppe moteur revient -> la cle a bien donne acces au calcul.
      const body = res.body as EngineResultEnvelope<TerzaghiOutput>;
      expect(body.ok).toBe(true);
      expect(body.meta.engineId).toBe('fondation-superficielle');
    });

    it('(b) X-Recette-Key absent -> 401', async () => {
      await request(app.getHttpServer())
        .post('/calc/terzaghi')
        .send({})
        .expect(401);
    });

    it('(b) X-Recette-Key faux -> 401', async () => {
      await request(app.getHttpServer())
        .post('/calc/terzaghi')
        .set('X-Recette-Key', 'mauvaise-cle')
        .send({})
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

    it('(c) aucune cle posee -> guard inerte, passe sans en-tete (statut != 401)', async () => {
      await request(app.getHttpServer())
        .post('/calc/terzaghi')
        .send({})
        .expect((res) => {
          if (res.status === 401) {
            throw new Error('guard non inerte alors qu aucune cle n est posee');
          }
        });
    });
  });
});
