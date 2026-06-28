import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  RADIER_FIXTURES,
  runRadier,
  type RadierOutput,
} from '@roadsen/engines';
import type { EngineResultEnvelope } from '@roadsen/shared';
import request from 'supertest';
import type { App } from 'supertest/types';

import { configureApp } from './../src/app.config';
import { AppModule } from './../src/app.module';

/**
 * E2E `POST /calc/radier` (#54) — RECALCUL SERVEUR du radier/plaque sur sol multicouche
 * elastique (elements finis, GEOPLAQUE).
 *
 * Prouve la chaine module -> API et l'equivalence CLIENT(appel HTTP) <-> SERVEUR (module
 * @roadsen/engines) : un cas du jeu envoye via l'API renvoie EXACTEMENT la sortie que le
 * module calcule en direct. Le calcul (solveur EF dense) ne tourne que cote serveur.
 *
 * @science-unsigned : prouve le portage/la chaine, pas la justesse scientifique (kit
 * STARFIRE #36 indisponible).
 *
 * NB : l'AppModule bootstrappe PrismaModule -> Postgres requis (pnpm db:up +
 * apps/api/.env). L'endpoint lui-meme ne lit aucune donnee tenant (@Public).
 */
describe('POST /calc/radier (e2e)', () => {
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

  const nominal = RADIER_FIXTURES.find((f) => f.id === 'carre-charge-centree');

  it('un cas nominal renvoie la MEME sortie que le module (client<->serveur)', async () => {
    expect(nominal).toBeDefined();
    if (!nominal) return;
    const expected = runRadier(nominal.input);

    const res = await request(app.getHttpServer())
      .post('/calc/radier')
      .send(nominal.input)
      .expect(201);

    const body = res.body as EngineResultEnvelope<RadierOutput>;
    expect(body.ok).toBe(true);
    expect(body.meta.engineId).toBe('radier-plaque');
    expect(body.meta.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    // Egalite stricte de la sortie (recalcul deterministe identique).
    expect(body).toEqual(expected);
    // Aucun champ nodal ni topologie de maillage dans la reponse.
    expect(JSON.stringify(res.body)).not.toMatch(
      /"(w|p|Mx|My|Mxy|kr|nodeX|nodeY|blocks|loc|elements|Acell|sext)"\s*:/,
    );
  });

  it('une entree hors-schema renvoie 400 (validation Zod du contrat #56)', async () => {
    await request(app.getHttpServer())
      .post('/calc/radier')
      .send({ rafts: 'pas-un-tableau', layers: 42, opts: null })
      .expect(400);
  });

  it('une entree hors-domaine BORNEE (nu hors plage) renvoie 400', async () => {
    expect(nominal).toBeDefined();
    if (!nominal) return;
    // nu = 0.7 hors borne [0, 0.499) : rejete par le schema AVANT tout calcul.
    const pollue = {
      ...nominal.input,
      rafts: [{ ...nominal.input.rafts[0], nu: 0.7 }],
    };
    await request(app.getHttpServer())
      .post('/calc/radier')
      .send(pollue)
      .expect(400);
  });

  it('un cas hors-domaine (maillage trop fin) renvoie un resultat borne, sans intermediaire', async () => {
    const horsDomaine = RADIER_FIXTURES.find(
      (f) => f.id === 'hors-domaine-maillage-trop-fin',
    );
    expect(horsDomaine).toBeDefined();
    if (!horsDomaine) return;
    const res = await request(app.getHttpServer())
      .post('/calc/radier')
      .send(horsDomaine.input)
      .expect(201);
    const body = res.body as EngineResultEnvelope<RadierOutput>;
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(body.output.erreur).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(
      /"(w|p|Mx|My|Mxy|kr|nodeX|nodeY|blocks|elements)"\s*:/,
    );
  });
});
