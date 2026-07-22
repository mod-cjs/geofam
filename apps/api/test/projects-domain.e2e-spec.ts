/**
 * Test e2e — DOMAINE METIER D'UN PROJET (CH/FD/LB) contre la VRAIE base.
 *
 * Bug « swap mock->reel » : le front cree un projet avec {name, domain} et CHAQUE
 * logiciel filtre les projets par domaine ; or le backend ne persistait NI ne
 * renvoyait `domain` -> en mode reel toutes les listes de projets etaient VIDES.
 * Ce test prouve, via HTTP (supertest) sur l'app NestJS reelle branchee sur
 * PostgreSQL (seed/teardown via connexion SUPERUSER DATABASE_URL — meme patron
 * que projects-lifecycle.e2e), que :
 *
 *   1) POST /projects {name, domain:'FD'} -> 201 et la reponse PORTE domain='FD'
 *      (persistance reelle : un RE-GET liste le projet AVEC son domaine).
 *   2) POST /projects {name} SANS domain -> 400 (borne Zod : domain REQUIS, pas
 *      de domaine par defaut silencieusement faux).
 *   3) GET /projects renvoie `domain` pour chaque projet (y compris NULL pour un
 *      projet LEGACY seede sans domaine — le champ existe, valeur inconnue
 *      honnete, pas une valeur inventee).
 *
 * ANTI-SKIP : DATABASE_URL absent ET CI -> echec dur. Hors CI sans base ->
 * non-execute (honnete), interdit en CI.
 */
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/auth/password';

type PgClient = {
  connect: () => Promise<void>;
  query: <R = unknown>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: R[] }>;
  end: () => Promise<void>;
};
type PgClientCtor = new (cfg: { connectionString: string }) => PgClient;

interface ProjectBody {
  id?: unknown;
  name?: unknown;
  domain?: unknown;
  orgId?: unknown;
}

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const ENFORCE = process.env.CI === 'true' || ADMIN_URL.length > 0;

function loadPgClient(): PgClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pg') as { Client: PgClientCtor };
  return mod.Client;
}

describe('Domaine metier projet — persistance + validation (e2e)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  const orgA = randomUUID();
  const slugA = `pdm-a-${orgA.slice(0, 8)}`;
  const engineerA = randomUUID();
  const projLegacy = randomUUID(); // seede SANS domaine (domain NULL en base)
  const PASSWORD = 'Sup3r-Secret-Domain!';

  jest.setTimeout(60_000);

  const emailEng = () => `pdm-eng-${engineerA.slice(0, 8)}@roadsen.test`;

  beforeAll(async () => {
    try {
      const Client = loadPgClient();
      admin = new Client({ connectionString: ADMIN_URL });
      await admin.connect();
    } catch (err) {
      connectError = err as Error;
      if (ENFORCE) throw connectError;
      return;
    }

    const hash = await hashPassword(PASSWORD);
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1,$2,$3,'PDM Eng',now())`,
      [engineerA, emailEng(), hash],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,'PDM A',$2,now())`,
      [orgA, slugA],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES ($1,$2,$3,'ENGINEER')`,
      [randomUUID(), orgA, engineerA],
    );
    // Projet LEGACY : seede en base SANS domaine (colonne NULL) — simule les projets
    // crees avant l'ajout de la colonne. Il doit rester lisible avec domain=null.
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, updated_at) VALUES ($1,$2,'Legacy sans domaine',$3,now())`,
      [projLegacy, orgA, engineerA],
    );

    process.env.ROADSEN_DEV_HEADERS = '0';
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    if (admin) {
      try {
        await admin.query(`DELETE FROM projects WHERE org_id = $1`, [orgA]);
        await admin.query(`DELETE FROM memberships WHERE org_id = $1`, [orgA]);
        await admin.query(`DELETE FROM organizations WHERE id = $1`, [orgA]);
        await admin.query(`DELETE FROM users WHERE id = $1`, [engineerA]);
      } finally {
        await admin.end();
      }
    }
    if (app) await app.close();
  });

  const ready = () => {
    if (!app) {
      if (ENFORCE)
        throw connectError ?? new Error('App/base indisponible en CI.');
      console.warn('[NON EXECUTE] base/app indisponible (hors CI).');
      return false;
    }
    return true;
  };

  const server = (): import('http').Server =>
    app!.getHttpServer() as import('http').Server;

  let token = '';
  async function login(): Promise<string> {
    if (token) return token;
    const res = await request(server())
      .post('/auth/login')
      .send({ email: emailEng(), password: PASSWORD });
    expect(res.status).toBe(200);
    token = String((res.body as { accessToken?: unknown }).accessToken);
    return token;
  }

  // --- 1) POST avec domain -> persiste et renvoie domain ---------------------

  it('1) POST /projects {name, domain:FD} -> 201, domain persiste (re-GET liste le domaine)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login();
    const created = await request(server())
      .post('/projects')
      .set('authorization', `Bearer ${t}`)
      .set('x-org-id', orgA)
      .send({ name: 'Fondation superficielle A', domain: 'FD' });
    expect(created.status).toBe(201);
    const body = created.body as ProjectBody;
    expect(body.domain).toBe('FD');
    const newId = String(body.id);

    // PREUVE DE PERSISTANCE : une NOUVELLE lecture (liste) porte bien le domaine.
    const list = await request(server())
      .get('/projects')
      .set('authorization', `Bearer ${t}`)
      .set('x-org-id', orgA);
    expect(list.status).toBe(200);
    const found = (list.body as ProjectBody[]).find((p) => p.id === newId);
    expect(found).toBeDefined();
    expect(found!.domain).toBe('FD');
  });

  // --- 2) POST sans domain -> 400 --------------------------------------------

  it('2) POST /projects {name} SANS domain -> 400 (domain REQUIS, pas de defaut silencieux)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login();
    const res = await request(server())
      .post('/projects')
      .set('authorization', `Bearer ${t}`)
      .set('x-org-id', orgA)
      .send({ name: 'Sans domaine' });
    expect(res.status).toBe(400);
  });

  it('2b) POST /projects avec un domain HORS enum -> 400', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login();
    const res = await request(server())
      .post('/projects')
      .set('authorization', `Bearer ${t}`)
      .set('x-org-id', orgA)
      .send({ name: 'Domaine bidon', domain: 'ZZ' });
    expect(res.status).toBe(400);
  });

  // --- 3) GET liste renvoie domain (NULL pour un projet legacy) --------------

  it('3) GET /projects expose domain pour chaque projet ; le projet LEGACY a domain=null', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login();
    const list = await request(server())
      .get('/projects')
      .set('authorization', `Bearer ${t}`)
      .set('x-org-id', orgA);
    expect(list.status).toBe(200);
    const rows = list.body as ProjectBody[];
    // Le champ `domain` est present sur toutes les lignes (cle serialisee).
    for (const p of rows) {
      expect(p).toHaveProperty('domain');
    }
    // Le projet legacy est bien la, avec domain=null (valeur inconnue honnete).
    const legacy = rows.find((p) => p.id === projLegacy);
    expect(legacy).toBeDefined();
    expect(legacy!.domain).toBeNull();
  });
});
