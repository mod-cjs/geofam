/**
 * Test e2e — Back-office SUPERADMIN, GESTION UTILISATEURS (identite + role plateforme)
 * contre la VRAIE base. HTTP (supertest) sur l'app NestJS reelle branchee sur PostgreSQL
 * (seed/teardown via connexion SUPERUSER DATABASE_URL — meme patron que admin-vague2.e2e).
 *
 * Couvre la migration 0018 (admin_update_user_identity + admin_set_platform_role) et les
 * routes PATCH /admin/users/:userId et PATCH /admin/users/:userId/platform-role.
 *
 * SENTINELLES (given/when/then) :
 *   1) UPDATE IDENTITE : PATCH {email,fullName} -> 200 ; la base porte l'email NORMALISE
 *      (lower/trim) + le nom ; audit USER_IDENTITY_UPDATED (before/after) SANS secret.
 *   2) UNICITE EMAIL : viser l'email d'un AUTRE user -> 409, base INCHANGEE. Re-viser son
 *      PROPRE email (idempotent d'identite) -> 200.
 *   3) IDENTITE : user inconnu -> 404 ; email invalide (Zod) -> 400.
 *   4) ROLE PLATEFORME : promouvoir un user -> SUPPORT (200, base SUPPORT, audit
 *      PLATFORM_ROLE_CHANGED before/after) ; revoquer (null) -> 200, base NULL.
 *   5) ANTI-LOCKOUT — DERNIER SUPERADMIN : quand l'acteur est le SEUL SUPERADMIN actif,
 *      se retrograder -> 409 (il reste SUPERADMIN, preuve : il peut encore agir).
 *   6) ANTI AUTO-RETROGRADATION : avec un 2e SUPERADMIN present, l'acteur qui se
 *      retrograde lui-meme -> 400 (on ne se retire pas son propre acces).
 *   7) RETROGRADER UN AUTRE SUPERADMIN (>=2 presents) -> 200 (pas de sur-blocage).
 *   8) ROLE INVALIDE -> 400 (Zod) ; user inconnu -> 404.
 *   9) ACTEUR = SUB JWT : un actorUserId injecte dans le corps est IGNORE (audit = sub super).
 *  10) RBAC : un non-SUPERADMIN (OWNER) sur chaque nouvelle route -> 403.
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

describe('Back-office : gestion utilisateurs (identite + role plateforme) (e2e)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  const superId = randomUUID(); // SUPERADMIN acteur
  const super2 = randomUUID(); // 2e SUPERADMIN (pivot anti-lockout / auto-retro)
  const normalUser = randomUUID(); // cible promote/revoke + update identite
  const otherUser = randomUUID(); // detient un email (cible du conflit d'unicite)

  // Org temoin : un OWNER non-SUPERADMIN pour le RBAC.
  const orgA = randomUUID();
  const slugA = `um-${orgA.slice(0, 8)}`;
  const ownerA = randomUUID();

  const PASSWORD = 'UM-Secret-Password!';

  jest.setTimeout(60_000);

  const email = (id: string, p: string) => `${p}-${id.slice(0, 8)}@roadsen.test`;
  const emailSuper = () => email(superId, 'umsuper');
  const emailSuper2 = () => email(super2, 'umsuper2');
  const emailNormal = () => email(normalUser, 'umnormal');
  const emailOther = () => email(otherUser, 'umother');
  const emailOwnerA = () => email(ownerA, 'umownera');

  const allUserIds = [superId, super2, normalUser, otherUser, ownerA];

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
      `INSERT INTO users (id, email, password_hash, full_name, platform_role, updated_at) VALUES
        ($1,$2,$9,'UM Super','SUPERADMIN',now()),
        ($3,$4,$9,'UM Super2','SUPERADMIN',now()),
        ($5,$6,$9,'UM Normal',NULL,now()),
        ($7,$8,$9,'UM Other',NULL,now())`,
      [
        superId,
        emailSuper(),
        super2,
        emailSuper2(),
        normalUser,
        emailNormal(),
        otherUser,
        emailOther(),
        hash,
      ],
    );
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at)
       VALUES ($1,$2,$3,'UM Owner A',now())`,
      [ownerA, emailOwnerA(), hash],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,'UM Org A',$2,now())`,
      [orgA, slugA],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES ($1,$2,$3,'OWNER')`,
      [randomUUID(), orgA, ownerA],
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
        await admin.query(`ALTER TABLE admin_audit_log DISABLE TRIGGER USER`);
        try {
          await admin.query(
            `DELETE FROM admin_audit_log WHERE target_user_id = ANY($1::uuid[])
               OR target_org_id = $2`,
            [allUserIds, orgA],
          );
        } finally {
          await admin.query(`ALTER TABLE admin_audit_log ENABLE TRIGGER USER`);
        }
        await admin.query(`DELETE FROM memberships WHERE org_id = $1`, [orgA]);
        await admin.query(`DELETE FROM organizations WHERE id = $1`, [orgA]);
        await admin.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
          allUserIds,
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

  const tokenCache = new Map<string, string>();
  async function token(mail: string, password = PASSWORD): Promise<string> {
    const cacheKey = `${mail}::${password}`;
    const cached = tokenCache.get(cacheKey);
    if (cached) return cached;
    const res = await request(server())
      .post('/auth/login')
      .send({ email: mail, password });
    expect(res.status).toBe(200);
    const tk = String((res.body as AuthBody).accessToken);
    tokenCache.set(cacheKey, tk);
    return tk;
  }

  let superToken = '';

  // Helpers HTTP (SUPERADMIN).
  const updateIdentity = (userId: string, body: object) =>
    request(server())
      .patch(`/admin/users/${userId}`)
      .set('authorization', `Bearer ${superToken}`)
      .send(body);
  const setPlatformRole = (
    userId: string,
    role: string | null,
    extra: object = {},
  ) =>
    request(server())
      .patch(`/admin/users/${userId}/platform-role`)
      .set('authorization', `Bearer ${superToken}`)
      .send({ role, ...extra });

  const dbUser = async (userId: string) => {
    const { rows } = await admin!.query<{
      email: string;
      full_name: string;
      platform_role: string | null;
    }>(`SELECT email, full_name, platform_role FROM users WHERE id=$1`, [userId]);
    return rows[0];
  };
  const auditRow = async (action: string, targetUser: string) => {
    const { rows } = await admin!.query<{
      actor_user_id: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT actor_user_id, payload FROM admin_audit_log
       WHERE action=$1 AND target_user_id=$2
       ORDER BY created_at DESC LIMIT 1`,
      [action, targetUser],
    );
    return rows[0];
  };

  // --- 1) UPDATE IDENTITE -----------------------------------------------------

  it('1) update identite : email normalise + nom ; audit before/after SANS secret', async () => {
    if (!ready()) return;
    superToken = await token(emailSuper());

    const before = await dbUser(normalUser);
    const res = await updateIdentity(normalUser, {
      email: '  UM-Renamed@Roadsen.TEST  ',
      fullName: 'Nom Corrige',
    });
    expect(res.status).toBe(200);

    const after = await dbUser(normalUser);
    expect(after.email).toBe('um-renamed@roadsen.test'); // lower + trim
    expect(after.full_name).toBe('Nom Corrige');

    const audit = await auditRow('USER_IDENTITY_UPDATED', normalUser);
    expect(audit.actor_user_id).toBe(superId);
    expect(audit.payload.email_before).toBe(before.email);
    expect(audit.payload.email_after).toBe('um-renamed@roadsen.test');
    // aucune fuite : pas de hash / mot de passe dans le payload d'identite.
    const serialized = JSON.stringify(audit.payload);
    expect(serialized).not.toContain('argon2');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('hash');
  });

  // --- 2) UNICITE EMAIL -------------------------------------------------------

  it('2) unicite : viser l email d un AUTRE user -> 409, base inchangee ; son propre email -> 200', async () => {
    if (!ready()) return;
    superToken = await token(emailSuper());

    const before = await dbUser(normalUser);
    const conflict = await updateIdentity(normalUser, {
      email: emailOther(), // deja porte par otherUser
      fullName: before.full_name,
    });
    expect(conflict.status).toBe(409);
    expect((await dbUser(normalUser)).email).toBe(before.email); // inchange

    // re-viser son PROPRE email (exclusion de soi) -> 200
    const same = await updateIdentity(normalUser, {
      email: before.email,
      fullName: 'Encore Corrige',
    });
    expect(same.status).toBe(200);
    expect((await dbUser(normalUser)).full_name).toBe('Encore Corrige');
  });

  // --- 3) IDENTITE : chemins negatifs ----------------------------------------

  it('3) identite : user inconnu -> 404 ; email invalide -> 400', async () => {
    if (!ready()) return;
    superToken = await token(emailSuper());
    expect(
      (await updateIdentity(randomUUID(), { email: 'a@b.io', fullName: 'X' }))
        .status,
    ).toBe(404);
    expect(
      (await updateIdentity(normalUser, { email: 'pas-un-email', fullName: 'X' }))
        .status,
    ).toBe(400);
  });

  // --- 4) ROLE PLATEFORME : promote / revoke ---------------------------------

  it('4) role plateforme : promote SUPPORT (200) puis revoke null (200) ; audit before/after', async () => {
    if (!ready()) return;
    superToken = await token(emailSuper());

    const up = await setPlatformRole(normalUser, 'SUPPORT');
    expect(up.status).toBe(200);
    expect((await dbUser(normalUser)).platform_role).toBe('SUPPORT');

    const audit = await auditRow('PLATFORM_ROLE_CHANGED', normalUser);
    expect(audit.actor_user_id).toBe(superId);
    expect(audit.payload.role_before).toBeNull();
    expect(audit.payload.role_after).toBe('SUPPORT');

    const down = await setPlatformRole(normalUser, null);
    expect(down.status).toBe(200);
    expect((await dbUser(normalUser)).platform_role).toBeNull();
  });

  // --- 5) ANTI-LOCKOUT : dernier SUPERADMIN actif ----------------------------

  it('5) anti-lockout : quand l acteur est le SEUL SUPERADMIN actif, se retrograder -> 409', async () => {
    if (!ready()) return;
    superToken = await token(emailSuper());

    // L invariant anti-lockout est GLOBAL (tous SUPERADMIN de la plateforme). Sur une base
    // partagee, d autres SUPERADMIN actifs (pollution inter-suites) peuvent exister : on les
    // NEUTRALISE temporairement pour rendre superId le DERNIER SUPERADMIN actif reel, puis on
    // RESTAURE en finally (execution serielle --runInBand). super2 est un des NOTRES : on le
    // retrograde par la voie normale (autorise, il en reste >=1, cf. sentinelle 7).
    expect((await setPlatformRole(super2, null)).status).toBe(200);
    expect((await dbUser(super2)).platform_role).toBeNull();

    const { rows: ext } = await admin!.query<{ id: string }>(
      `SELECT id FROM users
       WHERE platform_role='SUPERADMIN' AND is_active=true
         AND NOT (id = ANY($1::uuid[]))`,
      [allUserIds],
    );
    const extIds = ext.map((r) => r.id);
    if (extIds.length) {
      await admin!.query(
        `UPDATE users SET is_active=false WHERE id = ANY($1::uuid[])`,
        [extIds],
      );
    }
    try {
      // superId est desormais le SEUL SUPERADMIN actif : il ne peut plus se retrograder.
      const res = await setPlatformRole(superId, null);
      expect(res.status).toBe(409);
      expect((await dbUser(superId)).platform_role).toBe('SUPERADMIN'); // intact
      // preuve d acces : il peut encore agir en SUPERADMIN.
      expect((await setPlatformRole(normalUser, null)).status).toBe(200);
    } finally {
      if (extIds.length) {
        await admin!.query(
          `UPDATE users SET is_active=true WHERE id = ANY($1::uuid[])`,
          [extIds],
        );
      }
    }
  });

  // --- 6) ANTI AUTO-RETROGRADATION (avec un 2e SUPERADMIN) --------------------

  it('6) auto-retrogradation : avec un 2e SUPERADMIN present, se retrograder soi-meme -> 400', async () => {
    if (!ready()) return;
    superToken = await token(emailSuper());

    // re-promeut super2 : il y a de nouveau 2 SUPERADMIN.
    expect((await setPlatformRole(super2, 'SUPERADMIN')).status).toBe(200);

    // l acteur se retrograde : refuse (on ne retire pas son PROPRE acces), meme si un
    // autre SUPERADMIN existe.
    const res = await setPlatformRole(superId, null);
    expect(res.status).toBe(400);
    expect((await dbUser(superId)).platform_role).toBe('SUPERADMIN'); // intact
  });

  // --- 7) RETROGRADER UN AUTRE SUPERADMIN (pas de sur-blocage) ----------------

  it('7) retrograder un AUTRE SUPERADMIN quand >=2 presents -> 200', async () => {
    if (!ready()) return;
    superToken = await token(emailSuper());
    // etat : superId + super2 SUPERADMIN. On retrograde super2 -> autorise (superId reste).
    const res = await setPlatformRole(super2, null);
    expect(res.status).toBe(200);
    expect((await dbUser(super2)).platform_role).toBeNull();
  });

  // --- 8) ROLE INVALIDE / USER INCONNU ---------------------------------------

  it('8) role invalide -> 400 ; user inconnu -> 404', async () => {
    if (!ready()) return;
    superToken = await token(emailSuper());
    expect((await setPlatformRole(normalUser, 'ROOT')).status).toBe(400);
    expect((await setPlatformRole(randomUUID(), 'SUPPORT')).status).toBe(404);
  });

  // --- 9) ACTEUR = SUB JWT ----------------------------------------------------

  it('9) acteur = sub JWT : un actorUserId injecte dans le corps est IGNORE', async () => {
    if (!ready()) return;
    superToken = await token(emailSuper());
    const forged = randomUUID();
    const res = await setPlatformRole(normalUser, 'SUPPORT', {
      actorUserId: forged,
    });
    expect(res.status).toBe(200);
    const audit = await auditRow('PLATFORM_ROLE_CHANGED', normalUser);
    expect(audit.actor_user_id).toBe(superId);
    expect(audit.actor_user_id).not.toBe(forged);
    // remise a plat pour ne pas laisser normalUser SUPPORT.
    await setPlatformRole(normalUser, null);
  });

  // --- 10) RBAC ---------------------------------------------------------------

  it('10) RBAC : un non-SUPERADMIN (OWNER) sur chaque nouvelle route -> 403', async () => {
    if (!ready()) return;
    const ownerToken = await token(emailOwnerA());
    const auth = (r: request.Test) =>
      r.set('authorization', `Bearer ${ownerToken}`);

    const r1 = await auth(request(server()).patch(`/admin/users/${normalUser}`)).send(
      { email: 'x@y.io', fullName: 'X' },
    );
    expect(r1.status).toBe(403);

    const r2 = await auth(
      request(server()).patch(`/admin/users/${normalUser}/platform-role`),
    ).send({ role: 'SUPERADMIN' });
    expect(r2.status).toBe(403);
  });
});
