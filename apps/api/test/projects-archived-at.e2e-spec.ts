/**
 * DATE D'ARCHIVAGE (`archivedAt`) — e2e contre Postgres REEL.
 *
 * POURQUOI CETTE COLONNE (dette tracee par les revues adverses)
 * ------------------------------------------------------------
 * La vue « Archives » listait les projets archives sans savoir QUAND ils
 * l'avaient ete : `updated_at` bouge a chaque renommage, il ne date pas
 * l'archivage. La liste ne pouvait donc ni dater ni trier honnetement — elle
 * affichait une date qui n'etait pas celle du geste.
 *
 * CE QUE CE FICHIER VERROUILLE (given/when/then)
 *  #1 Un projet ACTIF n'a PAS de date d'archivage (`archivedAt` = null) : on
 *     n'invente pas une date pour un geste qui n'a pas eu lieu.
 *  #2 ARCHIVER renseigne `archivedAt` (proche de l'instant du geste) et la
 *     reponse l'EXPOSE — sinon l'interface ne peut rien afficher.
 *  #3 La liste des archives PORTE la date et la trie du plus recent au plus
 *     ancien (le plus recemment archive en tete).
 *  #4 RESTAURER remet `archivedAt` a null : un projet actif ne conserve pas la
 *     trace d'un archivage annule, sinon la prochaine liste mentirait.
 *  #5 RE-ARCHIVER apres restauration pose une date NOUVELLE (plus recente que la
 *     premiere) : c'est la date du DERNIER archivage qui fait foi.
 *
 * ANTI-SKIP : DATABASE_URL absent ET CI -> echec dur. Hors CI sans base ->
 * non-execute (honnete). `expect.hasAssertions()` sur chaque cas conditionnel.
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

interface ProjetBody {
  id?: unknown;
  status?: unknown;
  archivedAt?: unknown;
}

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const ENFORCE = process.env.CI === 'true' || ADMIN_URL.length > 0;

function loadPgClient(): PgClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pg') as { Client: PgClientCtor };
  return mod.Client;
}

describe('Date d’archivage d’un projet (e2e Postgres réel)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  const orgA = randomUUID();
  const slugA = `paa-${orgA.slice(0, 8)}`;
  const ownerA = randomUUID();
  const projUn = randomUUID();
  const projDeux = randomUUID();
  const PASSWORD = 'Sup3r-Secret-ArchivedAt!';

  jest.setTimeout(60_000);

  const mailA = () => `paa-${ownerA.slice(0, 8)}@roadsen.test`;

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
      `INSERT INTO users (id, email, password_hash, full_name, updated_at)
       VALUES ($1,$2,$3,'PAA Owner',now())`,
      [ownerA, mailA(), hash],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,'PAA',$2,now())`,
      [orgA, slugA],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES ($1,$2,$3,'OWNER')`,
      [randomUUID(), orgA, ownerA],
    );
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, status, updated_at) VALUES
        ($1,$2,'PAA — un',$3,'ACTIVE',now()),
        ($4,$2,'PAA — deux',$3,'ACTIVE',now())`,
      [projUn, orgA, ownerA, projDeux],
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
        await admin.query(`DELETE FROM users WHERE id = $1`, [ownerA]);
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
      .send({ email: mailA(), password: PASSWORD });
    expect(res.status).toBe(200);
    token = String((res.body as { accessToken?: unknown }).accessToken);
    return token;
  }
  const auth = (t: string) => ({
    Authorization: `Bearer ${t}`,
    'X-Org-Id': orgA,
  });

  const archiver = (t: string, id: string) =>
    request(server()).delete(`/projects/${id}`).set(auth(t));
  const restaurer = (t: string, id: string) =>
    request(server()).post(`/projects/${id}/restore`).set(auth(t));
  const listerArchives = (t: string) =>
    request(server()).get('/projects/archived/list').set(auth(t));

  const dateEnBase = async (id: string): Promise<Date | null> => {
    const r = await admin!.query<{ archived_at: Date | null }>(
      `SELECT archived_at FROM projects WHERE id = $1`,
      [id],
    );
    return r.rows[0]?.archived_at ?? null;
  };

  it('#1 Un projet ACTIF n’a PAS de date d’archivage', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login();
    const res = await request(server()).get(`/projects/${projUn}`).set(auth(t));
    expect(res.status).toBe(200);
    expect((res.body as ProjetBody).archivedAt).toBeNull();
    expect(await dateEnBase(projUn)).toBeNull();
  });

  it('#2 ARCHIVER renseigne la date d’archivage, et la réponse l’EXPOSE', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login();
    const avant = Date.now();

    const res = await archiver(t, projUn);
    expect(res.status).toBe(200);
    expect((res.body as ProjetBody).status).toBe('ARCHIVED');

    const expose = (res.body as ProjetBody).archivedAt;
    expect(typeof expose).toBe('string');
    const horodatage = new Date(String(expose)).getTime();
    // Encadrement : la date est celle du GESTE, pas une valeur inventée.
    expect(horodatage).toBeGreaterThanOrEqual(avant - 5_000);
    expect(horodatage).toBeLessThanOrEqual(Date.now() + 5_000);

    // Contre-preuve en base (la réponse pourrait mentir).
    expect(await dateEnBase(projUn)).not.toBeNull();
  });

  it('#3 La liste des ARCHIVÉS porte la date et trie du plus récent au plus ancien', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login();

    // Deuxième archivage, postérieur au premier -> il doit passer EN TÊTE.
    const deux = await archiver(t, projDeux);
    expect(deux.status).toBe(200);

    const res = await listerArchives(t);
    expect(res.status).toBe(200);
    const lignes = (res.body as ProjetBody[]).filter(
      (p) => p.id === projUn || p.id === projDeux,
    );
    expect(lignes).toHaveLength(2);
    for (const l of lignes) expect(typeof l.archivedAt).toBe('string');

    // Le plus RÉCEMMENT archivé en tête : sans tri sur archivedAt, l'ordre
    // dépendrait d'updatedAt, qui ne date pas l'archivage.
    expect(lignes[0].id).toBe(projDeux);
    expect(lignes[1].id).toBe(projUn);
  });

  it('#4 RESTAURER remet la date d’archivage à null', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login();

    const res = await restaurer(t, projUn);
    expect(res.status).toBeLessThan(300);
    expect((res.body as ProjetBody).status).toBe('ACTIVE');
    // Un projet actif ne garde pas la trace d'un archivage annulé : sinon la
    // prochaine liste daterait un geste qui n'a plus cours.
    expect((res.body as ProjetBody).archivedAt).toBeNull();
    expect(await dateEnBase(projUn)).toBeNull();
  });

  it('#5 RE-ARCHIVER pose une date NOUVELLE (c’est le dernier archivage qui fait foi)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const t = await login();

    const premiere = await dateEnBase(projDeux); // archivé au cas #3
    expect(premiere).not.toBeNull();

    const res = await archiver(t, projUn);
    expect(res.status).toBe(200);
    const nouvelle = await dateEnBase(projUn);
    expect(nouvelle).not.toBeNull();
    expect(new Date(nouvelle!).getTime()).toBeGreaterThanOrEqual(
      new Date(premiere!).getTime(),
    );
  });
});
