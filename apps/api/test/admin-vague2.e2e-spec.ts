/**
 * Test e2e — Back-office SUPERADMIN, VAGUE 2 (comptes globaux + rattachement abo +
 * transfert d'OWNER) contre la VRAIE base. HTTP (supertest) sur l'app NestJS reelle
 * branchee sur PostgreSQL (seed/teardown via connexion SUPERUSER DATABASE_URL — meme
 * patron que admin-mutations.e2e).
 *
 * SENTINELLES (given/when/then) :
 *   1) DESACTIVATION / REACTIVATION GLOBALE : active=false -> le user ne peut plus se
 *      loguer (401) ; active=true -> le login revient (200). Audit USER_ACTIVE_SET trace.
 *   2) ANTI AUTO-DESACTIVATION : un SUPERADMIN qui se desactive lui-meme -> 400 (il reste actif).
 *   3) RESET MOT DE PASSE : POST reset-password -> l'ancien mdp echoue (401), le nouveau
 *      passe (200). Audit USER_PASSWORD_RESET dont le payload NE contient NI mdp NI hash.
 *   4) RESET MDP FAIBLE (<12) -> 400 (Zod). User inconnu -> 404.
 *   5) RATTACHER UN ABO a une org SANS abo -> 201 + abo cree (SUBSCRIPTION_ATTACHED).
 *      Rattacher a une org qui a DEJA un abo ACTIF -> 409. Org inconnue -> 404.
 *   6) TRANSFERT D'OWNER : promeut le nouveau (OWNER), retrograde l'ancien (ADMIN),
 *      trace OWNERSHIP_TRANSFERRED (before/after). Vers un NON-membre -> refus (400).
 *   7) ACTEUR = SUB JWT : un corps qui injecte actorUserId est IGNORE (l'audit porte le
 *      sub du SUPERADMIN, jamais la valeur du corps — lecon #42).
 *   8) ISOLATION : rattacher/transferer sur orgA ne touche PAS orgB (non-interference).
 *   9) RBAC : un non-SUPERADMIN (OWNER) sur chaque nouvelle route -> 403.
 *
 * ANTI-SKIP : DATABASE_URL absent ET CI -> echec dur. Hors CI sans base -> non-execute
 * (honnete), interdit en CI. Ces e2e s'executent au gate Docker.
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

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const ENFORCE = process.env.CI === 'true' || ADMIN_URL.length > 0;

function loadPgClient(): PgClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pg') as { Client: PgClientCtor };
  return mod.Client;
}

describe('Back-office Vague 2 : comptes globaux + abo + transfert OWNER (e2e)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  const superId = randomUUID(); // platform_role = SUPERADMIN

  // Org A : OWNER + ENGINEER + un user a basculer (VIEWER) + un abo ACTIF.
  const orgA = randomUUID();
  const slugA = `v2a-${orgA.slice(0, 8)}`;
  const ownerA = randomUUID(); // OWNER de A (retrograde par le transfert)
  const memberEng = randomUUID(); // ENGINEER de A (promu OWNER par le transfert)
  const userToggle = randomUUID(); // VIEWER de A : cible desactivation + reset mdp
  const subA = randomUUID();

  // Org B : sert de temoin d'isolation (ne doit jamais bouger).
  const orgB = randomUUID();
  const slugB = `v2b-${orgB.slice(0, 8)}`;
  const ownerB = randomUUID();
  const subB = randomUUID();

  // Org sans abo (cible du rattachement).
  const orgNoSub = randomUUID();
  const slugNoSub = `v2ns-${orgNoSub.slice(0, 8)}`;
  const ownerNoSub = randomUUID();

  // User qui n'est membre d'AUCUNE org (cible transfert vers non-membre).
  const outsider = randomUUID();

  const PASSWORD = 'V2-Secret-Password!';
  const NEW_PASSWORD = 'V2-New-Password-2026!';

  jest.setTimeout(60_000);

  const email = (id: string, p: string) =>
    `${p}-${id.slice(0, 8)}@roadsen.test`;
  const emailSuper = () => email(superId, 'v2super');
  const emailOwnerA = () => email(ownerA, 'v2ownera');
  const emailEng = () => email(memberEng, 'v2eng');
  const emailToggle = () => email(userToggle, 'v2toggle');

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
      `INSERT INTO users (id, email, password_hash, full_name, platform_role, updated_at)
       VALUES ($1,$2,$3,'V2 Super','SUPERADMIN',now())`,
      [superId, emailSuper(), hash],
    );
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES
        ($1,$2,$11,'Owner A',now()),
        ($3,$4,$11,'Membre Eng',now()),
        ($5,$6,$11,'User Toggle',now()),
        ($7,$8,$11,'Owner B',now()),
        ($9,$10,$11,'Owner NoSub',now())`,
      [
        ownerA,
        emailOwnerA(),
        memberEng,
        emailEng(),
        userToggle,
        emailToggle(),
        ownerB,
        email(ownerB, 'v2ownerb'),
        ownerNoSub,
        email(ownerNoSub, 'v2ownerns'),
        hash,
      ],
    );
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at)
       VALUES ($1,$2,$3,'Outsider',now())`,
      [outsider, email(outsider, 'v2outsider'), hash],
    );

    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES
        ($1,'Org A',$2,now()), ($3,'Org B',$4,now()), ($5,'Org NoSub',$6,now())`,
      [orgA, slugA, orgB, slugB, orgNoSub, slugNoSub],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES
        ($1,$2,$3,'OWNER'), ($4,$2,$5,'ENGINEER'), ($6,$2,$7,'VIEWER'),
        ($8,$9,$10,'OWNER'), ($11,$12,$13,'OWNER')`,
      [
        randomUUID(),
        orgA,
        ownerA,
        randomUUID(),
        memberEng,
        randomUUID(),
        userToggle,
        randomUUID(),
        orgB,
        ownerB,
        randomUUID(),
        orgNoSub,
        ownerNoSub,
      ],
    );
    // Abos ACTIFS pour A et B (orgNoSub reste volontairement SANS abo).
    await admin.query(
      `INSERT INTO subscriptions
         (id, org_id, pack, entitlements, date_debut, date_fin, quota, consommation, created_at, updated_at)
       VALUES
         ($1,$2,'ROUTES', ARRAY['burmister'], now() - interval '1 day', now() + interval '365 days', 100, 0, now(), now()),
         ($3,$4,'ROUTES', ARRAY['burmister'], now() - interval '1 day', now() + interval '365 days', 100, 0, now(), now())`,
      [subA, orgA, subB, orgB],
    );

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
        const orgs = [orgA, orgB, orgNoSub];
        await admin.query(`ALTER TABLE admin_audit_log DISABLE TRIGGER USER`);
        try {
          await admin.query(
            `DELETE FROM admin_audit_log WHERE target_org_id = ANY($1::uuid[])
               OR target_user_id = ANY($2::uuid[])`,
            [
              orgs,
              [
                ownerA,
                memberEng,
                userToggle,
                ownerB,
                ownerNoSub,
                outsider,
                superId,
              ],
            ],
          );
        } finally {
          await admin.query(`ALTER TABLE admin_audit_log ENABLE TRIGGER USER`);
        }
        await admin.query(
          `DELETE FROM subscriptions WHERE org_id = ANY($1::uuid[])`,
          [orgs],
        );
        await admin.query(
          `DELETE FROM memberships WHERE org_id = ANY($1::uuid[])`,
          [orgs],
        );
        await admin.query(
          `DELETE FROM organizations WHERE id = ANY($1::uuid[])`,
          [orgs],
        );
        await admin.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
          [
            superId,
            ownerA,
            memberEng,
            userToggle,
            ownerB,
            ownerNoSub,
            outsider,
          ],
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
        throw connectError ?? new Error('App/base indisponible en CI.');
      }
      console.warn('[NON EXECUTE] base/app indisponible (hors CI).');
      return false;
    }
    return true;
  };

  const server = (): import('http').Server =>
    app!.getHttpServer() as import('http').Server;

  async function loginWith(
    email: string,
    password: string,
  ): Promise<request.Response> {
    return request(server()).post('/auth/login').send({ email, password });
  }
  // Cache par (email+password) : evite de rejouer argon2 a chaque test (la suite en
  // enchaine beaucoup). La cle inclut le mdp -> un changement de mdp n'utilise pas un
  // token perime.
  const tokenCache = new Map<string, string>();
  async function token(email: string, password = PASSWORD): Promise<string> {
    const cacheKey = `${email}::${password}`;
    const cached = tokenCache.get(cacheKey);
    if (cached) return cached;
    const res = await loginWith(email, password);
    expect(res.status).toBe(200);
    const tk = String((res.body as AuthBody).accessToken);
    tokenCache.set(cacheKey, tk);
    return tk;
  }

  let superToken = '';

  // Helpers HTTP (SUPERADMIN).
  const setActive = (userId: string, active: boolean, extra: object = {}) =>
    request(server())
      .patch(`/admin/users/${userId}/active`)
      .set('authorization', `Bearer ${superToken}`)
      .send({ active, ...extra });
  const resetPassword = (userId: string, newPassword: string, motif?: string) =>
    request(server())
      .post(`/admin/users/${userId}/reset-password`)
      .set('authorization', `Bearer ${superToken}`)
      .send(motif === undefined ? { newPassword } : { newPassword, motif });
  const attachSub = (orgId: string, body: object) =>
    request(server())
      .post(`/admin/orgs/${orgId}/subscription`)
      .set('authorization', `Bearer ${superToken}`)
      .send(body);
  const transferOwner = (
    orgId: string,
    newOwnerUserId: string,
    extra: object = {},
  ) =>
    request(server())
      .patch(`/admin/orgs/${orgId}/owner`)
      .set('authorization', `Bearer ${superToken}`)
      .send({ newOwnerUserId, ...extra });

  const validSubBody = () => ({
    pack: 'ROUTES',
    entitlements: ['burmister'],
    dateDebut: new Date().toISOString(),
    dateFin: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    quota: 50,
  });

  const memberRole = async (org: string, userId: string) => {
    const { rows } = await admin!.query<{ role: string; is_active: boolean }>(
      `SELECT role, is_active FROM memberships WHERE org_id=$1 AND user_id=$2`,
      [org, userId],
    );
    return rows[0];
  };
  const auditRow = async (
    action: string,
    targetUser: string | null,
    targetOrg: string | null,
  ) => {
    const { rows } = await admin!.query<{
      actor_user_id: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT actor_user_id, payload FROM admin_audit_log
       WHERE action=$1
         AND ($2::uuid IS NULL OR target_user_id=$2)
         AND ($3::uuid IS NULL OR target_org_id=$3)
       ORDER BY created_at DESC LIMIT 1`,
      [action, targetUser, targetOrg],
    );
    return rows[0];
  };

  // --- 1) DESACTIVATION / REACTIVATION GLOBALE -------------------------------

  it('1) desactivation globale : active=false -> login 401 ; active=true -> login 200 ; audit trace', async () => {
    if (!ready()) return;
    superToken = await token(emailSuper());

    // le user peut se loguer au depart
    expect((await loginWith(emailToggle(), PASSWORD)).status).toBe(200);

    const off = await setActive(userToggle, false);
    expect(off.status).toBe(200);
    expect((await loginWith(emailToggle(), PASSWORD)).status).toBe(401); // desactive

    const audit = await auditRow('USER_ACTIVE_SET', userToggle, null);
    expect(audit.actor_user_id).toBe(superId);
    expect(audit.payload.is_active_after).toBe(false);

    const on = await setActive(userToggle, true);
    expect(on.status).toBe(200);
    expect((await loginWith(emailToggle(), PASSWORD)).status).toBe(200); // reactive
  });

  // --- 2) ANTI AUTO-DESACTIVATION --------------------------------------------

  it('2) anti auto-desactivation : un SUPERADMIN qui se desactive -> 400, reste actif', async () => {
    if (!ready()) return;
    superToken = await token(emailSuper());
    const res = await setActive(superId, false);
    expect(res.status).toBe(400);
    // preuve : il peut toujours se loguer
    expect((await loginWith(emailSuper(), PASSWORD)).status).toBe(200);
  });

  // --- 3) RESET MOT DE PASSE --------------------------------------------------

  it('3) reset mdp : nouveau mdp passe, ancien echoue ; audit SANS mdp/hash', async () => {
    if (!ready()) return;
    superToken = await token(emailSuper());

    const res = await resetPassword(userToggle, NEW_PASSWORD, 'oubli');
    expect(res.status).toBe(200);

    expect((await loginWith(emailToggle(), PASSWORD)).status).toBe(401); // ancien mdp KO
    expect((await loginWith(emailToggle(), NEW_PASSWORD)).status).toBe(200); // nouveau OK

    const audit = await auditRow('USER_PASSWORD_RESET', userToggle, null);
    expect(audit.actor_user_id).toBe(superId);
    // le payload ne fuit NI le mot de passe NI le hash : seule la cle 'motif' est admise.
    const serialized = JSON.stringify(audit.payload);
    expect(serialized).not.toContain(NEW_PASSWORD);
    expect(serialized).not.toContain('argon2');
    expect(serialized).not.toContain('password');
    expect(Object.keys(audit.payload).sort()).toEqual(['motif']);
    expect(audit.payload.motif).toBe('oubli');
  });

  // --- 4) RESET MDP : chemins negatifs ---------------------------------------

  it('4) reset mdp faible (<12) -> 400 ; user inconnu -> 404', async () => {
    if (!ready()) return;
    superToken = await token(emailSuper());
    expect((await resetPassword(userToggle, 'court')).status).toBe(400);
    expect((await resetPassword(randomUUID(), NEW_PASSWORD)).status).toBe(404);
  });

  // --- 5) RATTACHER UN ABO ----------------------------------------------------

  it('5) rattacher abo : org SANS abo -> 201 + cree ; org avec abo actif -> 409 ; inconnue -> 404', async () => {
    if (!ready()) return;
    superToken = await token(emailSuper());

    const created = await attachSub(orgNoSub, validSubBody());
    expect(created.status).toBe(201);
    const { rows } = await admin!.query<{ quota: number; pack: string }>(
      `SELECT quota, pack FROM subscriptions WHERE org_id=$1`,
      [orgNoSub],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].quota).toBe(50);

    const audit = await auditRow('SUBSCRIPTION_ATTACHED', null, orgNoSub);
    expect(audit.actor_user_id).toBe(superId);

    // org A a deja un abo ACTIF -> 409
    expect((await attachSub(orgA, validSubBody())).status).toBe(409);
    // org inconnue -> 404
    expect((await attachSub(randomUUID(), validSubBody())).status).toBe(404);
  });

  // --- 6) TRANSFERT D'OWNER ---------------------------------------------------

  it('6) transfert owner : promeut le nouveau (OWNER), retrograde l ancien (ADMIN), trace', async () => {
    if (!ready()) return;
    superToken = await token(emailSuper());

    // etat initial : ownerA=OWNER, memberEng=ENGINEER
    expect((await memberRole(orgA, ownerA)).role).toBe('OWNER');
    expect((await memberRole(orgA, memberEng)).role).toBe('ENGINEER');

    const res = await transferOwner(orgA, memberEng);
    expect(res.status).toBe(200);

    expect((await memberRole(orgA, memberEng)).role).toBe('OWNER'); // promu
    expect((await memberRole(orgA, ownerA)).role).toBe('ADMIN'); // retrograde

    const audit = await auditRow('OWNERSHIP_TRANSFERRED', memberEng, orgA);
    expect(audit.actor_user_id).toBe(superId);
    expect(audit.payload.new_owner_role_before).toBe('ENGINEER');
    expect(audit.payload.new_owner_role_after).toBe('OWNER');
  });

  it('6b) transfert vers un NON-membre -> 400, aucun changement', async () => {
    if (!ready()) return;
    superToken = await token(emailSuper());
    const before = await memberRole(orgA, memberEng); // OWNER (apres 6)
    const res = await transferOwner(orgA, outsider);
    expect(res.status).toBe(400);
    expect((await memberRole(orgA, memberEng)).role).toBe(before.role); // intact
  });

  // --- 7) ACTEUR = SUB JWT (injection de corps ignoree) ----------------------

  it('7) acteur = sub JWT : un actorUserId injecte dans le corps est IGNORE', async () => {
    if (!ready()) return;
    superToken = await token(emailSuper());
    const forged = randomUUID();
    const res = await setActive(userToggle, true, { actorUserId: forged });
    expect(res.status).toBe(200);
    const audit = await auditRow('USER_ACTIVE_SET', userToggle, null);
    expect(audit.actor_user_id).toBe(superId); // pas la valeur forgee
    expect(audit.actor_user_id).not.toBe(forged);
  });

  // --- 8) ISOLATION : orgB temoin ne bouge pas -------------------------------

  it('8) isolation : les mutations sur A/NoSub ne touchent PAS org B', async () => {
    if (!ready()) return;
    // B garde son unique OWNER et son abo ACTIF intacts.
    expect((await memberRole(orgB, ownerB)).role).toBe('OWNER');
    const { rows } = await admin!.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM subscriptions WHERE org_id=$1 AND quota=100`,
      [orgB],
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  // --- 9) RBAC ----------------------------------------------------------------

  it('9) RBAC : un non-SUPERADMIN (OWNER) sur chaque nouvelle route -> 403', async () => {
    if (!ready()) return;
    const ownerToken = await token(emailOwnerA()); // ADMIN de A depuis le transfert, non SUPERADMIN
    const auth = (r: request.Test) =>
      r.set('authorization', `Bearer ${ownerToken}`);

    // Chaque requete est construite ET awaited une par une (pas de pre-construction en
    // tableau : supertest dispatche a l'await -> on serialise proprement).
    const r1 = await auth(
      request(server()).patch(`/admin/users/${userToggle}/active`),
    ).send({ active: false });
    expect(r1.status).toBe(403);

    const r2 = await auth(
      request(server()).post(`/admin/users/${userToggle}/reset-password`),
    ).send({ newPassword: NEW_PASSWORD });
    expect(r2.status).toBe(403);

    const r3 = await auth(
      request(server()).post(`/admin/orgs/${orgNoSub}/subscription`),
    ).send(validSubBody());
    expect(r3.status).toBe(403);

    const r4 = await auth(
      request(server()).patch(`/admin/orgs/${orgA}/owner`),
    ).send({ newOwnerUserId: ownerA });
    expect(r4.status).toBe(403);
  });
});
