import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BURMISTER_FIXTURES,
  runBurmister,
  type BurmisterOutput,
} from '@roadsen/engines';
import type { EngineResultEnvelope } from '@roadsen/shared';
import request from 'supertest';
import type { App } from 'supertest/types';

import { configureApp } from './../src/app.config';
import { AppModule } from './../src/app.module';

/**
 * E2E `POST /calc/burmister` (#46) — RECALCUL SERVEUR du dimensionnement de
 * chaussees (AGEROUTE Senegal 2015).
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
describe('POST /calc/burmister (e2e)', () => {
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

  const nominal = BURMISTER_FIXTURES.find(
    (f) => f.id === 'bitumineuse-epaisse-defaut',
  );

  it('un cas nominal renvoie la MEME sortie que le module (client<->serveur)', async () => {
    expect(nominal).toBeDefined();
    if (!nominal) return;
    // Reference : sortie du module appele EN DIRECT (server-only).
    const expected = runBurmister(nominal.input);

    const res = await request(app.getHttpServer())
      .post('/calc/burmister')
      .send(nominal.input)
      .expect(201);

    const body = res.body as EngineResultEnvelope<BurmisterOutput>;
    expect(body.ok).toBe(true);
    expect(body.meta.engineId).toBe('chaussee-burmister');
    expect(body.meta.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    // Egalite stricte de la sortie (recalcul deterministe identique).
    expect(body).toEqual(expected);
    // ADR 0014 : `output.details` expose desormais 11 intermediaires NOMMES
    // (ktheta, sn, sh_cm, delta, kr, kc, ks, ub, adm_r50, sigmaZ_psc_kpa,
    // sigmaR_psc_kpa) — whitelist nominative fail-closed, verifiee champ a champ
    // par les tests moteur/adaptateur. On retire donc `output.details` de la
    // chaine testee, PUIS on applique le motif anti-fuite COMPLET (kr/ks/kc
    // inclus) au RESTE de la reponse : la garde continue de mordre sur toute
    // fuite d'un intermediaire (ex. RAW `_D`) HORS de la whitelist nominative.
    const sansDetails = JSON.parse(JSON.stringify(res.body)) as {
      output?: Record<string, unknown>;
    };
    if (sansDetails.output) delete sansDetails.output.details;
    expect(JSON.stringify(sansDetails)).not.toMatch(
      /"(sz|sr|sth|kr|ks|kc|s0|sd2|bz|et0|etM|lys)"\s*:/,
    );
    // Les symboles BRUTS internes restent interdits PARTOUT, `details` compris :
    // aucun ne coincide avec une cle whitelistee (motif ancre sur la cle exacte).
    expect(JSON.stringify(res.body)).not.toMatch(
      /"(sz|sr|sth|s0|sd2|bz|et0|etM|lys)"\s*:/,
    );
  });

  it('une entree hors-schema renvoie 400 (validation Zod du contrat #56)', async () => {
    await request(app.getHttpServer())
      .post('/calc/burmister')
      .send({ layers: 'pas-un-tableau', subgrade: 42 })
      .expect(400);
  });

  it('une entree hors-domaine BORNEE (module hors plage) renvoie 400', async () => {
    // Module d'Young de couche hors borne (200000 > max 60000) : rejete par le
    // schema AVANT tout calcul (defense en profondeur sur les bornes physiques).
    await request(app.getHttpServer())
      .post('/calc/burmister')
      .send({
        layers: [{ mat: 'BBSG1', h: 0.06, E: 200000, nu: 0.45 }],
        subgrade: { cls: 'PF2', E: 50, nu: 0.35 },
        traffic: { T: 150, C: 0.9, N: 20, tau: 4, dir: 1, tv: 1 },
        load: { p: 0.662, a: 0.125, d: 0.375 },
      })
      .expect(400);
  });

  it('un cas hors-domaine (materiau inconnu) renvoie un resultat borne, sans intermediaire', async () => {
    const horsDomaine = BURMISTER_FIXTURES.find(
      (f) => f.id === 'hors-domaine-materiau-inconnu',
    );
    expect(horsDomaine).toBeDefined();
    if (!horsDomaine) return;
    const res = await request(app.getHttpServer())
      .post('/calc/burmister')
      .send(horsDomaine.input)
      .expect(201);
    const body = res.body as EngineResultEnvelope<BurmisterOutput>;
    expect(body.ok).toBe(true);
    // ADR 0014 (cf. cas nominal) : `output.details` porte des intermediaires
    // NOMMES et whitelistes ; on l'ecarte de la chaine testee, puis on applique
    // le motif anti-fuite COMPLET (kr/ks/kc inclus) au RESTE de la reponse.
    const sansDetails = JSON.parse(JSON.stringify(res.body)) as {
      output?: Record<string, unknown>;
    };
    if (sansDetails.output) delete sansDetails.output.details;
    expect(JSON.stringify(sansDetails)).not.toMatch(
      /"(sz|sr|sth|kr|ks|kc|s0|sd2|bz|lys|rigL|ezL)"\s*:/,
    );
    // Symboles BRUTS internes : interdits PARTOUT, `details` compris.
    expect(JSON.stringify(res.body)).not.toMatch(
      /"(sz|sr|sth|s0|sd2|bz|lys|rigL|ezL)"\s*:/,
    );
  });
});
