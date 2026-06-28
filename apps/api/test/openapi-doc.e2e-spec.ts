import { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { configureApp } from './../src/app.config';
import { AppModule } from './../src/app.module';

/**
 * Vue MINIMALE et typee du corps de requete OpenAPI exploite par ce test.
 * `@nestjs/swagger` n'exporte pas les sous-types (RequestBodyObject…) depuis son
 * entree publique ; on declare donc localement la forme STRICTE qu'on inspecte
 * (schema + un exemple « demo » a valeur d'objet), au lieu de naviguer sur `any`.
 */
interface RequestBodyShape {
  content?: {
    'application/json'?: {
      schema?: unknown;
      examples?: { demo?: { value?: Record<string, unknown> } };
    };
  };
}

/**
 * E2E du DOCUMENT OpenAPI EXPOSE sur `/docs-json` — prouve que la recette STARFIRE
 * peut REELLEMENT tester l'API via Swagger « Try it out » :
 *   (1) un schema de SECURITE apiKey `recette-key` (en-tete X-Recette-Key) existe
 *       et est exige globalement -> bouton « Authorize » fonctionnel ;
 *   (2) chaque `POST /calc/*` porte un requestBody NON VIDE (schema $ref derive du
 *       contrat Zod) AVEC au moins un exemple valide -> corps pre-rempli ;
 *   (3) les reponses 201/400/401 sont documentees ;
 *   (4) la sonde versionnee /v1/health reste documentee.
 *
 * On interroge l'ENDPOINT REEL (/docs-json) bootstrappe par configureApp() —
 * exactement ce que la recette telecharge. ROADSEN_EXPOSE_DOCS=1 force l'exposition.
 *
 * NB : AppModule bootstrappe PrismaModule -> Postgres requis (pnpm db:up). La
 * generation du document Swagger sur des DTO Zod volumineux est CPU-lourde ->
 * timeout du hook releve a 180 s.
 */
describe('OpenAPI /docs-json (e2e)', () => {
  let app: INestApplication<App>;
  let doc: OpenAPIObject;
  let savedSkipDocs: string | undefined;
  let savedExposeDocs: string | undefined;

  beforeAll(async () => {
    savedSkipDocs = process.env.ROADSEN_SKIP_DOCS;
    savedExposeDocs = process.env.ROADSEN_EXPOSE_DOCS;
    process.env.ROADSEN_EXPOSE_DOCS = '1';
    // Cette suite TESTE le document : on annule le defaut e2e (skip docs) pour
    // que configureApp() construise et expose reellement /docs-json.
    delete process.env.ROADSEN_SKIP_DOCS;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    // configureApp() construit ET expose le document (meme chemin que la prod).
    configureApp(app);
    await app.init();
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    doc = res.body as OpenAPIObject;
  }, 180_000);

  afterAll(async () => {
    await app.close();
    // Restaure l'etat d'env : ne pas re-exposer les docs aux suites suivantes
    // (sinon leurs beforeAll repayent la generation et risquent le timeout).
    if (savedSkipDocs === undefined) delete process.env.ROADSEN_SKIP_DOCS;
    else process.env.ROADSEN_SKIP_DOCS = savedSkipDocs;
    if (savedExposeDocs === undefined) delete process.env.ROADSEN_EXPOSE_DOCS;
    else process.env.ROADSEN_EXPOSE_DOCS = savedExposeDocs;
  });

  it('expose un schema de securite apiKey `recette-key` sur l en-tete X-Recette-Key', () => {
    const schemes = doc.components?.securitySchemes ?? {};
    expect(schemes['recette-key']).toEqual(
      expect.objectContaining({
        type: 'apiKey',
        in: 'header',
        name: 'X-Recette-Key',
      }),
    );
  });

  it('exige la cle recette globalement (securite au niveau document)', () => {
    const security = doc.security ?? [];
    // Au moins une exigence de securite au niveau document porte sur `recette-key`
    // (scopes en tableau, vide ici : apiKey). Sans elle, /docs n'enverrait pas la
    // cle et chaque essai ferait 401.
    const hasRecetteRequirement = security.some((req) =>
      Array.isArray(req['recette-key']),
    );
    expect(hasRecetteRequirement).toBe(true);
  });

  const calcPaths = [
    '/calc/terzaghi',
    '/calc/burmister',
    '/calc/pressiometre',
    '/calc/pieux',
    '/calc/radier',
    '/calc/labo',
  ];

  it.each(calcPaths)(
    'POST %s porte un requestBody NON VIDE avec schema et exemple valide',
    (path) => {
      const op = doc.paths[path]?.post;
      expect(op).toBeDefined();
      const requestBody = op?.requestBody as RequestBodyShape | undefined;
      const media = requestBody?.content?.['application/json'];
      // Le corps doit referencer un schema (champs/bornes du contrat).
      expect(media?.schema).toBeDefined();
      // Et fournir un exemple AVEC une valeur non vide (« Try it out » pre-rempli).
      const value = media?.examples?.demo?.value;
      expect(value).toBeDefined();
      expect(Object.keys(value ?? {}).length).toBeGreaterThan(0);
    },
  );

  it('documente les reponses 201/400/401 sur chaque POST /calc/*', () => {
    // NB : POST renvoie 201 par defaut sous NestJS (cf. e2e calc-*) — on
    // documente le STATUT REEL, pas un 200 hypothetique.
    for (const path of calcPaths) {
      const responses = doc.paths[path]?.post?.responses ?? {};
      expect(responses['201']).toBeDefined();
      expect(responses['400']).toBeDefined();
      expect(responses['401']).toBeDefined();
    }
  });

  it('documente la sonde versionnee /v1/health', () => {
    expect(doc.paths['/v1/health']?.get).toBeDefined();
  });
});
