import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LABO_FIXTURES, runLabo, type LaboOutput } from '@roadsen/engines';
import type { EngineResultEnvelope } from '@roadsen/shared';
import request from 'supertest';
import type { App } from 'supertest/types';

import { configureApp } from './../src/app.config';
import { AppModule } from './../src/app.module';

/**
 * E2E `POST /calc/labo` (#49-53) — RECALCUL SERVEUR des essais de labo & classification
 * GTR (FASTLAB, NF P 11-300).
 *
 * Prouve la chaine module -> API et l'equivalence CLIENT(appel HTTP) <-> SERVEUR : un cas
 * du jeu envoye via l'API renvoie EXACTEMENT la sortie que le module calcule en direct.
 *
 * @science-unsigned : prouve le portage/la chaine, pas la justesse (kit STARFIRE #36).
 * NB : AppModule -> Postgres requis (pnpm db:up + apps/api/.env). Endpoint @Public.
 */
describe('POST /calc/labo (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const nominal = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon');

  it('un cas nominal renvoie la MEME sortie que le module (client<->serveur) + classe A2', async () => {
    expect(nominal).toBeDefined();
    if (!nominal) return;
    const expected = runLabo(nominal.input);

    const res = await request(app.getHttpServer())
      .post('/calc/labo')
      .send(nominal.input)
      .expect(201);

    const body = res.body as EngineResultEnvelope<LaboOutput>;
    expect(body.ok).toBe(true);
    expect(body.meta.engineId).toBe('labo-classification-gtr');
    expect(body.meta.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body).toEqual(expected);
    if (!body.ok) return;
    expect(body.output.classe.code).toBe('A2');
  });

  it('une entree hors-schema renvoie 400 (validation Zod du contrat #56)', async () => {
    // cle inconnue (pas un id de mesure declare) -> .strict() rejette -> 400.
    await request(app.getHttpServer())
      .post('/calc/labo')
      .send({ champ_bidon_inexistant: 12, prType: 'PAS_UN_MODE' })
      .expect(400);
  });

  it('une valeur de champ hors-type (objet la ou un nombre/chaine est attendu) renvoie 400', async () => {
    expect(nominal).toBeDefined();
    if (!nominal) return;
    await request(app.getHttpServer())
      .post('/calc/labo')
      .send({ ...nominal.input, gr_M: { malicieux: true } })
      .expect(400);
  });

  it('un echantillon non classable renvoie une sortie bornee (classe sans code)', async () => {
    const indet = LABO_FIXTURES.find((f) => f.id === 'indetermine-vide');
    expect(indet).toBeDefined();
    if (!indet) return;
    const res = await request(app.getHttpServer())
      .post('/calc/labo')
      .send(indet.input)
      .expect(201);
    const body = res.body as EngineResultEnvelope<LaboOutput>;
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(body.output.classe.code).toBeNull();
  });
});
