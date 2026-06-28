import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  TERZAGHI_FIXTURES,
  runTerzaghi,
  type TerzaghiOutput,
} from '@roadsen/engines';
import type { EngineResultEnvelope } from '@roadsen/shared';
import request from 'supertest';
import type { App } from 'supertest/types';

import { configureApp } from './../src/app.config';
import { AppModule } from './../src/app.module';

/**
 * E2E `POST /calc/terzaghi` (#45) — RECALCUL SERVEUR de la fondation superficielle.
 *
 * Prouve la chaine module -> API et l'equivalence CLIENT(appel HTTP) <-> SERVEUR
 * (module @roadsen/engines) : un cas du jeu envoye via l'API renvoie EXACTEMENT
 * la sortie que le module calcule en direct. Le calcul ne tourne que cote serveur.
 *
 * @science-unsigned : prouve le portage/la chaine, pas la justesse scientifique
 * (kit STARFIRE #36 indisponible).
 *
 * NB : l'AppModule bootstrappe PrismaModule -> Postgres requis (pnpm db:up +
 * apps/api/.env). L'endpoint lui-meme ne lit aucune donnee tenant (@Public).
 */
describe('POST /calc/terzaghi (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    // Configuration IDENTIQUE a la prod (pipe Zod, filtre, versionnage).
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const nominal = TERZAGHI_FIXTURES.find(
    (f) => f.id === 'nominal-pressio-rect',
  );

  it('un cas nominal renvoie la MEME sortie que le module (client<->serveur)', async () => {
    expect(nominal).toBeDefined();
    if (!nominal) return;
    // Reference : sortie du module appele EN DIRECT (server-only).
    const expected = runTerzaghi(nominal.input);

    const res = await request(app.getHttpServer())
      .post('/calc/terzaghi')
      .send(nominal.input)
      .expect(201);

    const body = res.body as EngineResultEnvelope<TerzaghiOutput>;
    expect(body.ok).toBe(true);
    expect(body.meta.engineId).toBe('fondation-superficielle');
    expect(body.meta.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    // Egalite stricte de la sortie (recalcul deterministe identique).
    expect(body).toEqual(expected);
  });

  it('une entree hors-schema renvoie 400 (validation Zod du contrat #56)', async () => {
    await request(app.getHttpServer())
      .post('/calc/terzaghi')
      .send({ forme: 'inconnue', sondage: 'pas-un-tableau' })
      .expect(400);
  });

  it('un cas hors-domaine (sondage vide) renvoie une erreur de saisie bornee, sans intermediaire', async () => {
    const horsDomaine = TERZAGHI_FIXTURES.find(
      (f) => f.id === 'hors-domaine-sondage-vide',
    );
    expect(horsDomaine).toBeDefined();
    if (!horsDomaine) return;
    const res = await request(app.getHttpServer())
      .post('/calc/terzaghi')
      .send(horsDomaine.input)
      .expect(201);
    const body = res.body as EngineResultEnvelope<TerzaghiOutput>;
    expect(body.ok).toBe(true);
    // Le moteur encode l'erreur de saisie dans output.erreur (chaine bornee).
    if (body.ok) expect(typeof body.output.erreur).toBe('string');
    // Aucun intermediaire de calcul ne doit apparaitre dans la reponse.
    expect(JSON.stringify(res.body)).not.toMatch(
      /"(kp|ple|De|Nq|Ap|rows|ctx)"\s*:/,
    );
  });
});
