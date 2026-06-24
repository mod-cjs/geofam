import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  PRESSIOMETRE_FIXTURES,
  runPressiometre,
  type PressiometreOutput,
} from '@roadsen/engines';
import type { EngineResultEnvelope } from '@roadsen/shared';
import request from 'supertest';
import type { App } from 'supertest/types';

import { configureApp } from './../src/app.config';
import { AppModule } from './../src/app.module';

/**
 * E2E `POST /calc/pressiometre` (#47) — RECALCUL SERVEUR du depouillement
 * pressiometrique Menard (NF EN ISO 22476-4).
 *
 * Prouve la chaine module -> API et l'equivalence CLIENT(appel HTTP) <-> SERVEUR
 * (module @roadsen/engines) : un cas du jeu envoye via l'API renvoie EXACTEMENT la
 * sortie que le module calcule en direct. Le calcul ne tourne que cote serveur.
 *
 * @science-unsigned : prouve le portage/la chaine, pas la justesse scientifique
 * (kit STARFIRE #36 indisponible).
 *
 * NB : l'AppModule bootstrappe PrismaModule -> Postgres requis (pnpm db:up +
 * apps/api/.env). L'endpoint lui-meme ne lit aucune donnee tenant (@Public).
 */
describe('POST /calc/pressiometre (e2e)', () => {
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

  const nominal = PRESSIOMETRE_FIXTURES.find(
    (f) => f.id === 'demo-4m-seuils-manuels',
  );

  it('un cas nominal renvoie la MEME sortie que le module (client<->serveur)', async () => {
    expect(nominal).toBeDefined();
    if (!nominal) return;
    // Reference : sortie du module appele EN DIRECT (server-only).
    const expected = runPressiometre(nominal.input);

    const res = await request(app.getHttpServer())
      .post('/calc/pressiometre')
      .send(nominal.input)
      .expect(201);

    const body = res.body as EngineResultEnvelope<PressiometreOutput>;
    expect(body.ok).toBe(true);
    expect(body.meta.engineId).toBe('pressiometre-menard');
    expect(body.meta.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    // Egalite stricte de la sortie (recalcul deterministe identique).
    expect(body).toEqual(expected);
    // Aucun intermediaire (courbe corrigee, contrainte au repos, regression) dans la reponse.
    expect(JSON.stringify(res.body)).not.toMatch(
      /"(C|ext|recip|sigH0|sigV0|u0|mE|beta|fluage|pL_direct|p0|Pf|VsP2V1)"\s*:/,
    );
  });

  it('une entree hors-schema renvoie 400 (validation Zod du contrat #56)', async () => {
    await request(app.getHttpServer())
      .post('/calc/pressiometre')
      .send({ label: 42, params: 'pas-un-objet', rows: 'pas-un-tableau' })
      .expect(400);
  });

  it('une entree hors-domaine BORNEE (volume hors plage) renvoie 400', async () => {
    // Volume v60 hors borne (50000 > max 10000) : rejete par le schema AVANT tout
    // calcul (defense en profondeur sur les bornes physiques).
    await request(app.getHttpServer())
      .post('/calc/pressiometre')
      .send({
        label: '4.0 m',
        params: { a: 0.5, Ph: 0.5, Pe: 1.0, V0: 535, k0: 0.5 },
        gamma: 19,
        nappe: 3.0,
        rows: [
          { p: 1, v15: 82, v30: 83, v60: 50000 },
          { p: 2, v15: 100, v30: 101, v60: 103 },
          { p: 3, v15: 118, v30: 119, v60: 120 },
          { p: 4, v15: 133, v30: 134, v60: 135 },
        ],
      })
      .expect(400);
  });

  it('un cas hors-domaine (paliers insuffisants) renvoie un resultat borne, sans intermediaire', async () => {
    const horsDomaine = PRESSIOMETRE_FIXTURES.find(
      (f) => f.id === 'hors-domaine-paliers-insuffisants',
    );
    expect(horsDomaine).toBeDefined();
    if (!horsDomaine) return;
    const res = await request(app.getHttpServer())
      .post('/calc/pressiometre')
      .send(horsDomaine.input)
      .expect(201);
    const body = res.body as EngineResultEnvelope<PressiometreOutput>;
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    // Erreur bornee, message sans intermediaire.
    expect(body.output.erreur).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(
      /"(C|ext|recip|sigH0|sigV0|u0|mE|beta|fluage)"\s*:/,
    );
  });
});
