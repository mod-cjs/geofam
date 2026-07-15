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
    // GARDE ANTI-FUITE recadree ADR 0014 (14/07) : les STRUCTURES d'affichage
    // whitelistees (courbe corrigee, volumes, extrapolation A/B, synthese beta/mE)
    // et les scalaires normatifs (p0/pf/pE/sigmaH0) sont desormais EXPOSES —
    // l'outil client les affiche a ses utilisateurs. On retire ces blocs deja
    // verifies champ a champ (projection-equivalence.test.ts), puis on applique
    // le motif COMPLET au RESTE : toute fuite du RAW `_res` (C, ext, recip,
    // sigV0/u0 en decomposition, _slopes, iE, VsP2V1, cles brutes Pf/VE) hors de
    // la whitelist nominative reste detectee.
    const out = { ...(res.body as { output: Record<string, unknown> }).output };
    delete out.courbe;
    delete out.volumes;
    delete out.extrapolation;
    delete out.synthese;
    delete out.p0;
    delete out.pf;
    delete out.pE;
    delete out.sigmaH0;
    const reste = JSON.stringify({ ...(res.body as object), output: out });
    expect(reste).not.toMatch(
      /"(C|ext|recip|sigH0|sigV0|u0|mE|beta|fluage|pL_direct|p0|Pf|VsP2V1|_slopes|iE|VE|V0c|Vf)"\s*:/,
    );
    // Et les vrais internes restent absents PARTOUT, structures comprises.
    expect(JSON.stringify(res.body)).not.toMatch(
      /"(sigV0|sigVp|u0|_slopes|iE|VsP2V1|recip|ext)"\s*:/,
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
    // Chemin d'erreur : les structures d'affichage ne sont pas emises -> le motif
    // complet s'applique a la reponse entiere, sauf cles desormais whitelistees
    // si presentes (aucune ici : erreur = sortie bornee sans details).
    const outErr = {
      ...(res.body as { output: Record<string, unknown> }).output,
    };
    delete outErr.courbe;
    delete outErr.volumes;
    delete outErr.extrapolation;
    delete outErr.synthese;
    delete outErr.p0;
    delete outErr.pf;
    delete outErr.pE;
    delete outErr.sigmaH0;
    expect(
      JSON.stringify({ ...(res.body as object), output: outErr }),
    ).not.toMatch(/"(C|ext|recip|sigH0|sigV0|u0|mE|beta|fluage)"\s*:/);
  });
});
