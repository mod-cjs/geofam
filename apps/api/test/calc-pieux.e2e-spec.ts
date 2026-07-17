import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PIEUX_FIXTURES, runPieux, type PieuxOutput } from '@roadsen/engines';
import type { EngineResultEnvelope } from '@roadsen/shared';
import request from 'supertest';
import type { App } from 'supertest/types';

import { configureApp } from './../src/app.config';
import { AppModule } from './../src/app.module';

/**
 * E2E `POST /calc/pieux` (#48) — RECALCUL SERVEUR de la portance de pieu /
 * fondations profondes (NF P 94-262, EC7).
 *
 * Prouve la chaine module -> API et l'equivalence CLIENT(appel HTTP) <-> SERVEUR
 * (module @roadsen/engines) : un cas du jeu envoye via l'API renvoie EXACTEMENT la
 * sortie que le module calcule en direct. Le calcul ne tourne que cote serveur.
 *
 * @science-unsigned : prouve le portage/la chaine, pas la justesse scientifique (kit
 * STARFIRE #36 indisponible).
 *
 * NB : l'AppModule bootstrappe PrismaModule -> Postgres requis (pnpm db:up +
 * apps/api/.env). L'endpoint lui-meme ne lit aucune donnee tenant (@Public).
 */
describe('POST /calc/pieux (e2e)', () => {
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

  const nominal = PIEUX_FIXTURES.find((f) => f.id === 'pmt-fore-da2-comp');

  it('un cas nominal renvoie la MEME sortie que le module (client<->serveur)', async () => {
    expect(nominal).toBeDefined();
    if (!nominal) return;
    // Reference : sortie du module appele EN DIRECT (server-only).
    const expected = runPieux(nominal.input);

    const res = await request(app.getHttpServer())
      .post('/calc/pieux')
      .send(nominal.input)
      .expect(201);

    const body = res.body as EngineResultEnvelope<PieuxOutput>;
    expect(body.ok).toBe(true);
    expect(body.meta.engineId).toBe('fondation-profonde-pieux');
    expect(body.meta.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    // Egalite stricte de la sortie (recalcul deterministe identique).
    expect(body).toEqual(expected);
    // Frontiere de confidentialite (decision 17/07, avis expert reco A + directive
    // titulaire) : les valeurs DISPLAY normatives (ple/qce/kfac/kmax/Def/fric/xi3/xi4,
    // courbes re-echantillonnees) sont whitelistees ; les INTERNES du solveur
    // (objets bruts, detail de pointe, discretisation t-z, combinaisons) restent
    // interdits dans la reponse.
    expect(JSON.stringify(res.body)).not.toMatch(
      /"(qb|qbDetail|qceDetail|settle|ktau|kq|comb|Rbf|Rsf|grd|baseLayer|layers|Ab|perim)"\s*:/,
    );
  });

  it('une entree hors-schema renvoie 400 (validation Zod du contrat #56)', async () => {
    await request(app.getHttpServer())
      .post('/calc/pieux')
      .send({ geom: 'pas-un-objet', g_D: 'NaN', layers: 'pas-un-tableau' })
      .expect(400);
  });

  it('une entree hors-domaine BORNEE (categorie hors plage) renvoie 400', async () => {
    // Categorie de pieu hors borne (99 > max 20) : rejete par le schema AVANT tout
    // calcul (defense en profondeur sur les bornes).
    expect(nominal).toBeDefined();
    if (!nominal) return;
    await request(app.getHttpServer())
      .post('/calc/pieux')
      .send({ ...nominal.input, cat: 99 })
      .expect(400);
  });

  it('un cas hors-domaine (D <= z0) renvoie un resultat borne, sans intermediaire', async () => {
    const horsDomaine = PIEUX_FIXTURES.find(
      (f) => f.id === 'hors-domaine-D-inferieur-z0',
    );
    expect(horsDomaine).toBeDefined();
    if (!horsDomaine) return;
    const res = await request(app.getHttpServer())
      .post('/calc/pieux')
      .send(horsDomaine.input)
      .expect(201);
    const body = res.body as EngineResultEnvelope<PieuxOutput>;
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    // Erreur bornee, message sans INTERNE de solveur (les cles display
    // whitelistees — decision 17/07 — peuvent apparaitre, a null).
    expect(body.output.erreur).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(
      /"(qb|qbDetail|qceDetail|settle|ktau|kq|comb|Rbf|Rsf|grd|baseLayer|layers)"\s*:/,
    );
  });
});
