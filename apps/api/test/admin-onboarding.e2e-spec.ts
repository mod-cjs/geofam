/**
 * Test e2e — Onboarding SUPERADMIN (#41/#42, phases 1 & 2) contre la VRAIE base.
 *
 * DECISION TITULAIRE : creation d'utilisateurs ET d'organisations = ONBOARDING
 * SUPERADMIN (pas de self-service). Un SUPERADMIN plateforme cree les comptes,
 * puis les organisations, et DESIGNE l'OWNER (un user EXISTANT). Ce test prouve,
 * via HTTP (supertest) sur l'app NestJS reelle branchee sur PostgreSQL :
 *
 *   1) Un SUPERADMIN cree un user (POST /admin/users) puis une org
 *      (POST /admin/orgs) en designant ce user comme OWNER -> l'org existe et le
 *      user en est OWNER (verifie via les fonctions de lecture / la base).
 *   2) SENTINELLE D'ESCALADE : un user NON-SUPERADMIN (ici OWNER d'une autre org)
 *      qui tente POST /admin/orgs -> 403 (RolesGuard). Aucun non-SUPERADMIN ne
 *      cree d'org. Idem POST /admin/users.
 *   3) POST /admin/orgs avec ownerUserId INEXISTANT -> 400 borne, AUCUNE org creee.
 *   4) POST /admin/users avec un email DEJA pris -> 409 borne (pas de fuite de
 *      l'email en conflit ; message generique).
 *   5) GET /auth/me : renvoie le profil + les memberships de l'appelant, et ne
 *      fuite JAMAIS une org dont il n'est pas membre.
 *   6) /admin/* et /auth/me exigent une identite : sans token -> 401.
 *
 * Seed via connexion SUPERUSER (DATABASE_URL) — meme pattern qu'auth.e2e :
 * mots de passe haches via la fonction de prod (argon2id), pas en clair.
 * On bootstrape l'app EXACTEMENT comme la prod (configureApp) pour exercer le
 * filtre d'erreurs global (erreurs bornees) et la validation Zod.
 *
 * ANTI-SKIP : si DATABASE_URL absent ET CI -> echec dur. En dev local sans base,
 * on marque non-execute (honnetete d'ingenieur) — interdit en CI.
 */
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApp } from '../src/app.config';
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

interface AuthBody {
  accessToken?: unknown;
}
interface CreateUserBody {
  userId?: unknown;
}
interface CreateOrgBody {
  orgId?: unknown;
}
interface MeBody {
  userId?: unknown;
  email?: unknown;
  fullName?: unknown;
  platformRole?: unknown;
  memberships?: Array<{ orgId?: unknown; role?: unknown; orgSlug?: unknown }>;
}

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const ENFORCE = process.env.CI === 'true' || ADMIN_URL.length > 0;

function loadPgClient(): PgClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pg') as { Client: PgClientCtor };
  return mod.Client;
}

describe('Onboarding SUPERADMIN (e2e)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  // Acteurs seedes : un SUPERADMIN plateforme et un OWNER "ordinaire" (orgB).
  const superId = randomUUID(); // platform_role = SUPERADMIN
  const ownerBId = randomUUID(); // OWNER de orgB, AUCUN role plateforme
  const orgB = randomUUID();
  const PASSWORD = 'Sup3r-Secret-Onboarding!';

  // ids/slug crees PENDANT le test (nettoyes en teardown via like/slug).
  const createdEmails: string[] = [];
  const createdOrgSlugs: string[] = [];

  jest.setTimeout(60_000);

  const emailSuper = () => `super-${superId.slice(0, 8)}@roadsen.test`;
  const emailOwnerB = () => `ownerb-${ownerBId.slice(0, 8)}@roadsen.test`;

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

    // SUPERADMIN plateforme (platform_role posé ; pas de membership requis).
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, platform_role, updated_at)
       VALUES ($1,$2,$3,'Super Admin','SUPERADMIN',now())`,
      [superId, emailSuper(), hash],
    );
    // OWNER ordinaire d'une org B (sert de "non-SUPERADMIN" pour la sentinelle).
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at)
       VALUES ($1,$2,$3,'Owner B',now())`,
      [ownerBId, emailOwnerB(), hash],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,'Org B',$2,now())`,
      [orgB, `org-b-${orgB.slice(0, 8)}`],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES ($1,$2,$3,'OWNER')`,
      [randomUUID(), orgB, ownerBId],
    );

    // App reelle, configuree comme en prod. On NEUTRALISE la voie DEV par
    // en-tetes : on prouve le chemin JWT pur (RBAC plateforme reel).
    process.env.ROADSEN_DEV_HEADERS = '0';
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  }, 60_000);

  afterAll(async () => {
    if (admin) {
      try {
        // Nettoyage des objets crees pendant le test (orgs par slug, users par
        // email), puis du seed. Ordre FK : memberships -> projects -> orgs/users.
        if (createdOrgSlugs.length > 0) {
          await admin.query(
            `DELETE FROM memberships WHERE org_id IN (SELECT id FROM organizations WHERE slug = ANY($1))`,
            [createdOrgSlugs],
          );
          await admin.query(`DELETE FROM organizations WHERE slug = ANY($1)`, [
            createdOrgSlugs,
          ]);
        }
        if (createdEmails.length > 0) {
          await admin.query(`DELETE FROM users WHERE email = ANY($1)`, [
            createdEmails,
          ]);
        }
        await admin.query(`DELETE FROM memberships WHERE org_id = $1`, [orgB]);
        await admin.query(`DELETE FROM organizations WHERE id = $1`, [orgB]);
        await admin.query(`DELETE FROM users WHERE id IN ($1,$2)`, [
          superId,
          ownerBId,
        ]);
      } finally {
        await admin.end();
      }
    }
    if (app) await app.close();
  });

  const ready = () => {
    if (!app) {
      if (ENFORCE) {
        throw connectError ?? new Error('App/base non disponible en CI.');
      }
      console.warn('[NON EXECUTE] base/app indisponible (hors CI).');
      return false;
    }
    return true;
  };

  const server = (): import('http').Server =>
    app!.getHttpServer() as import('http').Server;

  async function login(email: string): Promise<string> {
    const res = await request(server())
      .post('/auth/login')
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    return String((res.body as AuthBody).accessToken);
  }

  // --- 1) Flux nominal : SUPERADMIN cree user puis org -> OWNER ---------------

  it('SUPERADMIN cree un user puis une org : le user designe devient OWNER', async () => {
    if (!ready()) return;
    const access = await login(emailSuper());

    const email = `newbe-${randomUUID().slice(0, 8)}@roadsen.test`;
    createdEmails.push(email);
    const slug = `new-be-${randomUUID().slice(0, 8)}`;
    createdOrgSlugs.push(slug);

    // (a) creation du user
    const ru = await request(server())
      .post('/admin/users')
      .set('authorization', `Bearer ${access}`)
      .send({ email, password: 'Initial-Passw0rd!', fullName: 'Nouveau BE' });
    expect(ru.status).toBe(201);
    const newUserId = String((ru.body as CreateUserBody).userId);
    expect(newUserId).toMatch(
      /^[0-9a-f-]{36}$/i, // uuid renvoye
    );

    // (b) creation de l'org en designant ce user comme OWNER
    const ro = await request(server())
      .post('/admin/orgs')
      .set('authorization', `Bearer ${access}`)
      .send({ name: 'Nouveau Bureau', slug, ownerUserId: newUserId });
    expect(ro.status).toBe(201);
    const orgId = String((ro.body as CreateOrgBody).orgId);
    expect(orgId).toMatch(/^[0-9a-f-]{36}$/i);

    // (c) PREUVE en base : l'org existe et le membership OWNER pointe le user.
    const { rows } = await admin!.query<{ role: string; user_id: string }>(
      `SELECT role, user_id FROM memberships WHERE org_id = $1`,
      [orgId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('OWNER');
    expect(rows[0].user_id).toBe(newUserId);

    // (d) le mot de passe stocke est un HASH argon2id, jamais le clair.
    const { rows: urows } = await admin!.query<{ password_hash: string }>(
      `SELECT password_hash FROM users WHERE id = $1`,
      [newUserId],
    );
    expect(urows[0].password_hash.startsWith('$argon2id$')).toBe(true);
    expect(urows[0].password_hash).not.toContain('Initial-Passw0rd!');
  });

  // --- 2) SENTINELLE : un NON-SUPERADMIN ne cree NI org NI user --------------

  it('SENTINELLE escalade : un OWNER (non-SUPERADMIN) -> 403 sur POST /admin/orgs', async () => {
    if (!ready()) return;
    const access = await login(emailOwnerB()); // OWNER de orgB, pas SUPERADMIN
    const before = await admin!.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM organizations`,
    );

    const res = await request(server())
      .post('/admin/orgs')
      .set('authorization', `Bearer ${access}`)
      // x-org-id de SA propre org : ne doit RIEN changer (RolesGuard plateforme).
      .set('x-org-id', orgB)
      .send({
        name: 'Org Pirate',
        slug: `pirate-${randomUUID().slice(0, 8)}`,
        ownerUserId: ownerBId,
      });
    expect(res.status).toBe(403);

    // Aucune org creee (deny-by-default prouve, pas juste le code HTTP).
    const after = await admin!.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM organizations`,
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('SENTINELLE escalade : un OWNER (non-SUPERADMIN) -> 403 sur POST /admin/users', async () => {
    if (!ready()) return;
    const access = await login(emailOwnerB());
    const res = await request(server())
      .post('/admin/users')
      .set('authorization', `Bearer ${access}`)
      .send({
        email: `pirate-${randomUUID().slice(0, 8)}@roadsen.test`,
        password: 'Initial-Passw0rd!',
        fullName: 'Pirate',
      });
    expect(res.status).toBe(403);
  });

  // --- 3) owner inexistant -> 400 borne, aucune org creee --------------------

  it('POST /admin/orgs avec ownerUserId INEXISTANT -> 400 borne, aucune org creee', async () => {
    if (!ready()) return;
    const access = await login(emailSuper());
    const ghost = randomUUID(); // user qui n'existe pas
    const slug = `ghost-org-${randomUUID().slice(0, 8)}`;

    const res = await request(server())
      .post('/admin/orgs')
      .set('authorization', `Bearer ${access}`)
      .send({ name: 'Org Fantome', slug, ownerUserId: ghost });
    expect(res.status).toBe(400);

    // Le slug ne doit PAS exister : la creation a ete refusee atomiquement.
    const { rows } = await admin!.query<{ id: string }>(
      `SELECT id FROM organizations WHERE slug = $1`,
      [slug],
    );
    expect(rows).toHaveLength(0);
  });

  // --- 4) email deja pris -> 409 borne (pas de fuite) ------------------------

  it('POST /admin/users avec un email DEJA pris -> 409 borne (message generique)', async () => {
    if (!ready()) return;
    const access = await login(emailSuper());
    const res = await request(server())
      .post('/admin/users')
      .set('authorization', `Bearer ${access}`)
      // email du SUPERADMIN seede : deja pris.
      .send({
        email: emailSuper(),
        password: 'Initial-Passw0rd!',
        fullName: 'Dup',
      });
    expect(res.status).toBe(409);
    // Anti-enumeration : le corps ne doit pas confirmer QUEL email est en conflit.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(emailSuper());
  });

  // --- 5) /auth/me : profil + memberships, sans fuite cross-org -------------

  it('GET /auth/me (OWNER de orgB) : renvoie SES memberships, jamais une autre org', async () => {
    if (!ready()) return;
    const access = await login(emailOwnerB());
    const res = await request(server())
      .get('/auth/me')
      .set('authorization', `Bearer ${access}`);
    expect(res.status).toBe(200);
    const body = res.body as MeBody;
    expect(body.userId).toBe(ownerBId);
    expect(body.email).toBe(emailOwnerB());
    expect(body.platformRole).toBeNull();
    const memberships = body.memberships ?? [];
    // Exactement SON org B, en role OWNER.
    expect(memberships).toHaveLength(1);
    expect(memberships[0].orgId).toBe(orgB);
    expect(memberships[0].role).toBe('OWNER');
    // AUCUNE org dont il n'est pas membre ne fuite (ex. une org creee plus haut).
    expect(memberships.some((m) => m.orgId !== orgB)).toBe(false);
  });

  it('GET /auth/me (SUPERADMIN sans org) : platformRole=SUPERADMIN, zero membership', async () => {
    if (!ready()) return;
    const access = await login(emailSuper());
    const res = await request(server())
      .get('/auth/me')
      .set('authorization', `Bearer ${access}`);
    expect(res.status).toBe(200);
    const body = res.body as MeBody;
    expect(body.userId).toBe(superId);
    expect(body.platformRole).toBe('SUPERADMIN');
    expect(body.memberships ?? []).toHaveLength(0);
    // Le hash ne doit jamais transiter par /auth/me.
    expect(JSON.stringify(res.body)).not.toContain('$argon2id$');
  });

  // --- 6) identite exigee sur les routes @NoTenant --------------------------

  it('routes @NoTenant exigent une identite : sans token -> 401', async () => {
    if (!ready()) return;
    const r1 = await request(server()).get('/auth/me');
    expect(r1.status).toBe(401);
    const r2 = await request(server()).post('/admin/users').send({
      email: 'x@roadsen.test',
      password: 'Initial-Passw0rd!',
      fullName: 'X',
    });
    expect(r2.status).toBe(401);
    const r3 = await request(server())
      .post('/admin/orgs')
      .send({ name: 'X', slug: 'x-org', ownerUserId: randomUUID() });
    expect(r3.status).toBe(401);
  });
});
