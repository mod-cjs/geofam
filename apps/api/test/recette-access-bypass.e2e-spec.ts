import type { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { configureApp } from './../src/app.config';
import { AppModule } from './../src/app.module';

/**
 * E2E — ANTI-CONTOURNEMENT du RecetteAccessGuard (#73, MAJEUR-2).
 *
 * On prouve sur le ROUTEUR REEL (Express 5 + path-to-regexp 8) qu'aucune URL
 * deguisee en chemin EXEMPTE (`/`, `/v1/health`, `/docs`, `/docs-json`) ne permet
 * d'atteindre un endpoint de CALCUL `/calc/*` sans presenter la cle X-Recette-Key.
 *
 * Vecteurs testes : dot-segments (`..`), `/` encode (`%2f`), double-encodage,
 * slashs multiples, casse, segment vide. Le critere est STRICT :
 *   - JAMAIS 200/201 sans cle (un 200/201 == le calcul a tourne == BYPASS) ;
 *   - on attend 401 (guard) ou 404 (route inexistante apres normalisation).
 *
 * Pourquoi e2e et pas unit : l'unit mocke `req.url`, ce qui ne reproduit PAS ce
 * qu'Express met reellement dans `req.url`/`req.originalUrl` pour une URL encodee
 * ou contenant des dot-segments. Seul le routeur reel revele un eventuel bypass.
 *
 * NB : l'AppModule bootstrappe PrismaModule -> Postgres requis (pnpm db:up +
 * apps/api/.env), comme les autres e2e.
 */
const KEY = 'cle-recette-e2e-bypass-0123456789abcdef';

describe('RecetteAccessGuard — anti-contournement par path (e2e)', () => {
  let savedKey: string | undefined;
  let savedSkipDocs: string | undefined;
  let app: INestApplication<App>;

  beforeAll(async () => {
    savedKey = process.env.RECETTE_API_KEY;
    savedSkipDocs = process.env.ROADSEN_SKIP_DOCS;
    process.env.RECETTE_API_KEY = KEY;
    // On ne teste pas /docs ici -> on evite la generation du doc OpenAPI (boot
    // rapide, pas de timeout). Cf. recette-access.e2e pour la meme bascule.
    process.env.ROADSEN_SKIP_DOCS = '1';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  }, 180000);

  afterAll(async () => {
    await app.close();
    if (savedKey === undefined) delete process.env.RECETTE_API_KEY;
    else process.env.RECETTE_API_KEY = savedKey;
    if (savedSkipDocs === undefined) delete process.env.ROADSEN_SKIP_DOCS;
    else process.env.ROADSEN_SKIP_DOCS = savedSkipDocs;
  });

  /**
   * Reference : la cible LEGITIME `POST /calc/terzaghi` SANS cle -> 401. Si ce
   * controle de base ne tient pas, tous les cas de contournement sont vides de sens.
   */
  it('controle de reference : /calc/terzaghi sans cle -> 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/calc/terzaghi')
      .send({});
    expect(res.status).toBe(401);
  });

  /**
   * Vecteurs de contournement. Chaque entree tente de masquer `/calc/terzaghi`
   * derriere un prefixe exempt. On envoie sur la METHODE de la cible (POST), et
   * aussi un GET (au cas ou la normalisation reposerait sur une route GET exempte).
   *
   * `.get(path)` / `.post(path)` de supertest envoient le path BRUT (deja encode) :
   * c'est exactement ce qu'on veut pour exercer la normalisation cote serveur.
   */
  const bypassVectors: ReadonlyArray<{ name: string; path: string }> = [
    { name: 'dot-segment /docs/../calc', path: '/docs/../calc/terzaghi' },
    {
      name: 'dot-segment encode /docs/..%2fcalc',
      path: '/docs/..%2fcalc%2fterzaghi',
    },
    {
      name: 'tout encode /docs%2f..%2fcalc',
      path: '/docs%2f..%2fcalc%2fterzaghi',
    },
    {
      name: 'slashs multiples //docs/../calc',
      path: '//docs/../calc/terzaghi',
    },
    {
      name: 'health dot-segment /v1/health/../calc',
      path: '/v1/health/../calc/terzaghi',
    },
    { name: 'racine dot-segment /../calc', path: '/../calc/terzaghi' },
    { name: 'casse /DOCS/../calc', path: '/DOCS/../calc/terzaghi' },
    { name: 'casse cible /docs/../CALC', path: '/docs/../CALC/terzaghi' },
    {
      name: 'double-encodage /docs/%2e%2e/calc',
      path: '/docs/%2e%2e/calc/terzaghi',
    },
    {
      name: 'double-encodage profond /docs/%252e%252e/calc',
      path: '/docs/%252e%252e/calc/terzaghi',
    },
    {
      name: 'prefixe exact + suffixe /docs-json/../calc',
      path: '/docs-json/../calc/terzaghi',
    },
  ];

  /** Un statut de "calcul execute" (succes) est un BYPASS. On l'interdit. */
  function assertNoCalc(status: number): void {
    // 200/201 == le handler terzaghi a repondu (enveloppe { ok, ... }) sans cle.
    expect([200, 201]).not.toContain(status);
    // On attend une fermeture franche : 401 (guard) ou 404 (route absente).
    expect([401, 404]).toContain(status);
  }

  for (const v of bypassVectors) {
    it(`POST ${v.name} sans cle -> pas de calcul (401/404)`, async () => {
      const res = await request(app.getHttpServer()).post(v.path).send({});
      assertNoCalc(res.status);
    });

    it(`GET ${v.name} sans cle -> pas de calcul (401/404)`, async () => {
      const res = await request(app.getHttpServer()).get(v.path);
      assertNoCalc(res.status);
    });
  }

  /**
   * Renfort : meme si une URL exempte etait acceptee, le handler /calc ne doit
   * JAMAIS s'executer. On verifie qu'aucune reponse de contournement ne porte la
   * signature d'une enveloppe moteur (`"ok":` + `"engineId":`).
   */
  it('aucune reponse de contournement ne porte la signature d une enveloppe moteur', async () => {
    for (const v of bypassVectors) {
      const res = await request(app.getHttpServer()).post(v.path).send({});
      const body = JSON.stringify(res.body ?? {});
      expect(body).not.toMatch(/"engineId"\s*:/);
    }
  });
});
