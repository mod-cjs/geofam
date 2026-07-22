/**
 * Test e2e — GET /me/entitlements (ADR 0011 §4) contre la VRAIE base.
 *
 * ORIGINE (incident prod 15/07) : l'endpoint renvoyait 500 « Erreur interne »
 * pour TOUT tenant valide — `loadState` fait `SELECT s.*` (colonnes snake_case,
 * `date_fin`) mais le code lit `sub.dateFin` (camelCase). Prisma $queryRaw ne
 * renomme JAMAIS les colonnes -> `dateFin` undefined -> `toISOString()` explose.
 * Symptôme : galerie GEOFAM entièrement verrouillée (« Impossible de charger
 * votre abonnement ») alors que les CALCULS marchaient (assertAccess ne lit
 * que des colonnes d'un seul mot + `expired` calculé en SQL).
 * Aucun e2e ne couvrait cet endpoint — cette suite est la sentinelle.
 *
 * ANTI-SKIP : hors CI sans base -> non-execute bruyant (jamais un faux vert).
 */
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/auth/password';

type PgClient = {
  connect: () => Promise<void>;
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  end: () => Promise<void>;
};
type PgClientCtor = new (cfg: { connectionString: string }) => PgClient;

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const ENFORCE = process.env.CI === 'true' || ADMIN_URL.length > 0;

function loadPgClient(): PgClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pg') as { Client: PgClientCtor };
  return mod.Client;
}

describe('GET /me/entitlements (e2e)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  const orgA = randomUUID();
  const userA = randomUUID();
  const emailA = `ent-${userA.slice(0, 8)}@roadsen.test`;
  const PASSWORD = 'Sup3r-Secret!';
  const DATE_FIN_DAYS = 365;

  jest.setTimeout(60_000);

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
       VALUES ($1,$2,$3,'Ent A',now())`,
      [userA, emailA, hash],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,'Ent Org',$2,now())`,
      [orgA, `ent-org-${orgA.slice(0, 8)}`],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES ($1,$2,$3,'OWNER')`,
      [randomUUID(), orgA, userA],
    );
    await admin.query(
      `INSERT INTO subscriptions
         (id, org_id, pack, entitlements, date_debut, date_fin, quota, consommation, created_at, updated_at)
       VALUES ($1,$2,'ROUTES', ARRAY['burmister','terzaghi'], now() - interval '1 day',
               now() + interval '${DATE_FIN_DAYS} days', 100, 7, now(), now())`,
      [randomUUID(), orgA],
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
        await admin.query(`DELETE FROM subscriptions WHERE org_id = $1`, [
          orgA,
        ]);
        await admin.query(`DELETE FROM memberships WHERE org_id = $1`, [orgA]);
        await admin.query(`DELETE FROM organizations WHERE id = $1`, [orgA]);
        await admin.query(`DELETE FROM users WHERE id = $1`, [userA]);
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
  const server = () => app!.getHttpServer() as Parameters<typeof request>[0];

  it('given un tenant valide (abonnement actif), then 200 avec pack/modules/expiration/quota coherents — JAMAIS 500', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const login = await request(server())
      .post('/auth/login')
      .send({ email: emailA, password: PASSWORD });
    expect(login.status).toBe(200);
    const token = String((login.body as { accessToken?: unknown }).accessToken);

    const res = await request(server())
      .get('/me/entitlements')
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', orgA);

    expect(res.status).toBe(200);
    const body = res.body as {
      orgId?: string;
      pack?: string;
      modules?: string[];
      expiresAt?: string;
      expired?: boolean;
      quota?: { limit?: number; used?: number; remaining?: number };
      serverTime?: string;
    };
    expect(body.orgId).toBe(orgA);
    expect(body.pack).toBe('ROUTES');
    expect(body.modules).toEqual(['burmister', 'terzaghi']);
    expect(body.expired).toBe(false);
    // expiresAt = date_fin REELLE (ISO parsable, ~+365 j) — le bug renvoyait 500
    // avant d'arriver ici (dateFin undefined).
    const expiresMs = Date.parse(String(body.expiresAt));
    expect(Number.isFinite(expiresMs)).toBe(true);
    const days = (expiresMs - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(360);
    expect(days).toBeLessThan(370);
    expect(body.quota).toEqual({ limit: 100, used: 7, remaining: 93 });
    expect(Number.isFinite(Date.parse(String(body.serverTime)))).toBe(true);
  });

  it('given un utilisateur NON membre de l org, then jamais de fuite (403/404, pas 500)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const login = await request(server())
      .post('/auth/login')
      .send({ email: emailA, password: PASSWORD });
    const token = String((login.body as { accessToken?: unknown }).accessToken);
    const res = await request(server())
      .get('/me/entitlements')
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', randomUUID());
    expect([403, 404]).toContain(res.status);
  });
});
