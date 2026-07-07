/**
 * Test e2e — « UN USER = UNE ORG » + RETRAIT = HARD-DELETE (migration 0020), contre
 * la VRAIE base. Décision titulaire (2026-07-07, réversible). Prouvé via HTTP
 * (supertest) sur l'app NestJS réelle branchée sur PostgreSQL (seed/teardown via
 * connexion SUPERUSER DATABASE_URL — même patron que admin-members.e2e).
 *
 * SENTINELLES :
 *   1) ONE-ORG : ajouter un user déjà membre actif d'une AUTRE org -> 409 ; il reste
 *      dans sa seule org (aucune 2e appartenance créée).
 *   2) LIBÉRÉ APRÈS RETRAIT : ajouté à A, retiré de A, puis ajouté à B -> OK (le
 *      retrait libère le user pour rejoindre une autre org).
 *   3) HARD DELETE + RÉ-AJOUT MÊME ORG + DONNÉES PRÉSERVÉES : ajouté à A, émet un
 *      calcul ; retrait -> l'appartenance est SUPPRIMÉE (absente de la liste) mais le
 *      calcul/ledger de l'org SUBSISTENT ; ré-ajout à A -> OK (re-addable).
 *   4) ANTI-LOCKOUT : retirer le dernier OWNER actif -> 409 ; l'OWNER reste.
 *   5) AUDIT : MEMBER_REMOVED tracé, payload {role, mode:'HARD'} SANS aucun secret.
 *   6) CRÉATION D'ORG AVEC OWNER DÉJÀ ENGAGÉ -> 409 ; un owner LIBRE -> 201.
 *
 * ANTI-SKIP : DATABASE_URL absent ET CI -> échec dur. Hors CI sans base ->
 * non-exécuté (honnête), interdit en CI.
 */
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BURMISTER_FIXTURES } from '@roadsen/engines';
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
interface CalcBody {
  ok?: unknown;
}

const DB_URL = process.env.DATABASE_URL ?? '';
const ENFORCE = process.env.CI === 'true' || DB_URL.length > 0;

function loadPgClient(): PgClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pg') as { Client: PgClientCtor };
  return mod.Client;
}

describe('Un user = une org + retrait hard-delete (e2e)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  const superId = randomUUID();
  const orgA = randomUUID();
  const slugA = `oo-a-${orgA.slice(0, 8)}`;
  const orgB = randomUUID();
  const orgC = randomUUID(); // org dont ownerC est déjà OWNER (owner « engagé »)
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const ownerC = randomUUID(); // owner déjà engagé (test 6)
  const memberOneOrg = randomUUID(); // test 1
  const memberFreed = randomUUID(); // test 2
  const memberReadd = randomUUID(); // test 3
  const freshOwner = randomUUID(); // owner LIBRE (test 6, contrôle positif)
  const projectA = randomUUID();
  const subA = randomUUID();
  const PASSWORD = 'Sup3r-Secret-OneOrg!';
  const burmisterInput = BURMISTER_FIXTURES[0].input;

  // Orgs créées PAR L'API pendant les tests (à nettoyer au teardown).
  const createdOrgs: string[] = [];

  jest.setTimeout(60_000);

  const email = (id: string, p: string) =>
    `${p}-${id.slice(0, 8)}@roadsen.test`;
  const emailSuper = () => email(superId, 'super');

  beforeAll(async () => {
    try {
      const Client = loadPgClient();
      admin = new Client({ connectionString: DB_URL });
      await admin.connect();
    } catch (err) {
      connectError = err as Error;
      if (ENFORCE) throw connectError;
      return;
    }

    const hash = await hashPassword(PASSWORD);

    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, platform_role, updated_at)
       VALUES ($1,$2,$3,'Super OneOrg','SUPERADMIN',now())`,
      [superId, emailSuper(), hash],
    );
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES
        ($1,$2,$11,'Owner A',now()),
        ($3,$4,$11,'Owner B',now()),
        ($5,$6,$11,'Owner C',now()),
        ($7,$8,$11,'Fresh Owner',now()),
        ($9,$10,$11,'Membre OneOrg',now())`,
      [
        ownerA,
        email(ownerA, 'owa'),
        ownerB,
        email(ownerB, 'owb'),
        ownerC,
        email(ownerC, 'owc'),
        freshOwner,
        email(freshOwner, 'fresh'),
        memberOneOrg,
        email(memberOneOrg, 'one'),
        hash,
      ],
    );
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES
        ($1,$2,$5,'Membre Freed',now()), ($3,$4,$5,'Membre Readd',now())`,
      [
        memberFreed,
        email(memberFreed, 'freed'),
        memberReadd,
        email(memberReadd, 'readd'),
        hash,
      ],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES
        ($1,'Org A',$2,now()), ($3,'Org B',$4,now()), ($5,'Org C',$6,now())`,
      [
        orgA,
        slugA,
        orgB,
        `oo-b-${orgB.slice(0, 8)}`,
        orgC,
        `oo-c-${orgC.slice(0, 8)}`,
      ],
    );
    // 3 OWNER (un par org). ownerC est ainsi « engagé » dans C (test 6).
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES
        ($1,$2,$3,'OWNER'), ($4,$5,$6,'OWNER'), ($7,$8,$9,'OWNER')`,
      [
        randomUUID(),
        orgA,
        ownerA,
        randomUUID(),
        orgB,
        ownerB,
        randomUUID(),
        orgC,
        ownerC,
      ],
    );
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, updated_at) VALUES ($1,$2,'P-A',$3,now())`,
      [projectA, orgA, ownerA],
    );
    await admin.query(
      `INSERT INTO subscriptions
         (id, org_id, pack, entitlements, date_debut, date_fin, quota, consommation, created_at, updated_at)
       VALUES ($1,$2,'ROUTES', ARRAY['burmister'], now() - interval '1 day', now() + interval '365 days', 100, 0, now(), now())`,
      [subA, orgA],
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
        const orgIds = [orgA, orgB, orgC, ...createdOrgs];
        await admin.query(`ALTER TABLE admin_audit_log DISABLE TRIGGER USER`);
        try {
          await admin.query(
            `DELETE FROM admin_audit_log WHERE actor_user_id = $1`,
            [superId],
          );
        } finally {
          await admin.query(`ALTER TABLE admin_audit_log ENABLE TRIGGER USER`);
        }
        await admin.query(`ALTER TABLE usage_ledger DISABLE TRIGGER USER`);
        try {
          await admin.query(
            `DELETE FROM usage_ledger WHERE org_id = ANY($1::uuid[])`,
            [orgIds],
          );
        } finally {
          await admin.query(`ALTER TABLE usage_ledger ENABLE TRIGGER USER`);
        }
        await admin.query(
          `DELETE FROM calc_results WHERE org_id = ANY($1::uuid[])`,
          [orgIds],
        );
        await admin.query(
          `DELETE FROM subscriptions WHERE org_id = ANY($1::uuid[])`,
          [orgIds],
        );
        await admin.query(
          `DELETE FROM projects WHERE org_id = ANY($1::uuid[])`,
          [orgIds],
        );
        await admin.query(
          `DELETE FROM memberships WHERE org_id = ANY($1::uuid[])`,
          [orgIds],
        );
        await admin.query(
          `DELETE FROM organizations WHERE id = ANY($1::uuid[])`,
          [orgIds],
        );
        await admin.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
          [
            superId,
            ownerA,
            ownerB,
            ownerC,
            freshOwner,
            memberOneOrg,
            memberFreed,
            memberReadd,
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
      if (ENFORCE)
        throw connectError ?? new Error('App/base indisponible en CI.');
      console.warn('[NON EXECUTE] base/app indisponible (hors CI).');
      return false;
    }
    return true;
  };

  const server = (): import('http').Server =>
    app!.getHttpServer() as import('http').Server;

  let superToken = '';
  const tokenCache = new Map<string, string>();
  async function login(mail: string): Promise<string> {
    const cached = tokenCache.get(mail);
    if (cached) return cached;
    const res = await request(server())
      .post('/auth/login')
      .send({ email: mail, password: PASSWORD });
    expect(res.status).toBe(200);
    const token = String((res.body as AuthBody).accessToken);
    tokenCache.set(mail, token);
    return token;
  }

  const addMember = (org: string, userId: string, role = 'ENGINEER') =>
    request(server())
      .post(`/admin/orgs/${org}/members`)
      .set('authorization', `Bearer ${superToken}`)
      .send({ userId, role });
  const removeMember = (org: string, userId: string) =>
    request(server())
      .delete(`/admin/orgs/${org}/members/${userId}`)
      .set('authorization', `Bearer ${superToken}`);
  const listMembers = (org: string) =>
    request(server())
      .get(`/admin/orgs/${org}/members`)
      .set('authorization', `Bearer ${superToken}`);
  const createOrg = (name: string, slug: string, ownerUserId: string) =>
    request(server())
      .post('/admin/orgs')
      .set('authorization', `Bearer ${superToken}`)
      .send({ name, slug, ownerUserId });
  const calcBurmister = (token: string, org: string, project: string) =>
    request(server())
      .post(`/projects/${project}/calc/burmister`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', org)
      .send(burmisterInput);

  const activeMembershipCount = async (userId: string): Promise<number> => {
    const { rows } = await admin!.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM memberships WHERE user_id = $1 AND is_active = true`,
      [userId],
    );
    return Number(rows[0].n);
  };

  // --- 1) ONE-ORG : refus d'une 2e org -------------------------------------

  it('1) un user déjà membre actif de A -> ajout à B refusé (409) ; il reste dans A seule', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());

    const addA = await addMember(orgA, memberOneOrg);
    expect(addA.status).toBe(201);
    expect(await activeMembershipCount(memberOneOrg)).toBe(1);

    const addB = await addMember(orgB, memberOneOrg);
    expect(addB.status).toBe(409); // un user = une org

    // Aucune 2e appartenance : toujours 1 (dans A), rien dans B.
    expect(await activeMembershipCount(memberOneOrg)).toBe(1);
    const inB = await admin!.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM memberships WHERE user_id = $1 AND org_id = $2`,
      [memberOneOrg, orgB],
    );
    expect(inB.rows[0].n).toBe('0');
  });

  // --- 2) LIBÉRÉ APRÈS RETRAIT ---------------------------------------------

  it('2) ajouté à A, retiré de A, puis ajouté à B -> OK (le retrait libère le user)', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());

    expect((await addMember(orgA, memberFreed)).status).toBe(201);
    // Tant qu'il est dans A, B est refusé.
    expect((await addMember(orgB, memberFreed)).status).toBe(409);

    // Retrait de A (hard) -> plus aucune appartenance.
    expect((await removeMember(orgA, memberFreed)).status).toBe(200);
    expect(await activeMembershipCount(memberFreed)).toBe(0);

    // Désormais libre : il peut rejoindre B.
    expect((await addMember(orgB, memberFreed)).status).toBe(201);
    expect(await activeMembershipCount(memberFreed)).toBe(1);
  });

  // --- 3) HARD DELETE + RÉ-AJOUT MÊME ORG + DONNÉES PRÉSERVÉES --------------

  it('3) retrait = appartenance SUPPRIMÉE (absente de la liste) ; calc/ledger préservés ; ré-ajout même org OK', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());

    expect((await addMember(orgA, memberReadd)).status).toBe(201);

    // Le membre émet un calcul -> calc_results + usage_ledger tracés à SON userId.
    const token = await login(email(memberReadd, 'readd'));
    const calc = await calcBurmister(token, orgA, projectA);
    expect(calc.status).toBe(201);
    expect((calc.body as CalcBody).ok).toBe(true);

    const calcBefore = await admin!.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM calc_results WHERE org_id = $1`,
      [orgA],
    );
    const ledgerBefore = await admin!.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM usage_ledger WHERE org_id = $1 AND user_id = $2`,
      [orgA, memberReadd],
    );
    expect(Number(calcBefore.rows[0].n)).toBeGreaterThanOrEqual(1);
    expect(Number(ledgerBefore.rows[0].n)).toBeGreaterThanOrEqual(1);

    // Retrait HARD.
    expect((await removeMember(orgA, memberReadd)).status).toBe(200);

    // (a) l'appartenance est SUPPRIMÉE : absente de la liste des membres de A.
    const list = await listMembers(orgA);
    expect(list.status).toBe(200);
    const ids = (list.body as { userId: string }[]).map((m) => m.userId);
    expect(ids).not.toContain(memberReadd);
    // et plus aucune ligne en base.
    expect(await activeMembershipCount(memberReadd)).toBe(0);

    // (b) DONNÉES DE L'ORG PRÉSERVÉES : le calcul/ledger ne sont PAS effacés par le retrait.
    const calcAfter = await admin!.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM calc_results WHERE org_id = $1`,
      [orgA],
    );
    const ledgerAfter = await admin!.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM usage_ledger WHERE org_id = $1 AND user_id = $2`,
      [orgA, memberReadd],
    );
    expect(calcAfter.rows[0].n).toBe(calcBefore.rows[0].n);
    expect(ledgerAfter.rows[0].n).toBe(ledgerBefore.rows[0].n);

    // (c) RÉ-ADDABLE dans LA MÊME org (le retrait n'a pas « grillé » le user).
    expect((await addMember(orgA, memberReadd)).status).toBe(201);
    expect(await activeMembershipCount(memberReadd)).toBe(1);
  });

  // --- 4) ANTI-LOCKOUT ------------------------------------------------------

  it('4) retirer le dernier OWNER actif -> 409 ; l OWNER reste', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());

    const res = await removeMember(orgA, ownerA);
    expect(res.status).toBe(409);
    const { rows } = await admin!.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM memberships WHERE org_id = $1 AND user_id = $2`,
      [orgA, ownerA],
    );
    expect(rows[0].n).toBe('1'); // intact
  });

  // --- 5) AUDIT MEMBER_REMOVED SANS SECRET ----------------------------------

  it('5) audit : MEMBER_REMOVED tracé, payload {role, mode:HARD} sans aucun secret', async () => {
    if (!ready()) return;
    // memberFreed a été retiré de A en test 2 -> une trace MEMBER_REMOVED existe.
    const { rows } = await admin!.query<{
      payload: { role?: string; mode?: string };
      target_user_id: string;
    }>(
      `SELECT payload, target_user_id FROM admin_audit_log
       WHERE action = 'MEMBER_REMOVED' AND target_org_id = $1 AND target_user_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [orgA, memberFreed],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].payload.mode).toBe('HARD');
    expect(rows[0].payload.role).toBe('ENGINEER');
    // Aucun secret (mot de passe / hash / email) dans la trace.
    const blob = JSON.stringify(rows[0].payload).toLowerCase();
    expect(blob).not.toContain('password');
    expect(blob).not.toContain('hash');
    expect(blob).not.toContain('@roadsen.test');
  });

  // --- 6) CRÉATION D'ORG AVEC OWNER DÉJÀ ENGAGÉ -----------------------------

  it('6) createOrg avec un owner déjà engagé (ownerC) -> 409 ; un owner LIBRE -> 201', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());

    // ownerC est déjà OWNER de C -> refus (un user = une org).
    const engaged = await createOrg(
      'Org D',
      `oo-d-${randomUUID().slice(0, 8)}`,
      ownerC,
    );
    expect(engaged.status).toBe(409);

    // freshOwner n'appartient à aucune org -> création OK, il en devient OWNER.
    const slug = `oo-e-${randomUUID().slice(0, 8)}`;
    const ok = await createOrg('Org E', slug, freshOwner);
    expect(ok.status).toBe(201);
    const newOrgId = String((ok.body as { orgId?: unknown }).orgId);
    createdOrgs.push(newOrgId);
    const { rows } = await admin!.query<{ role: string }>(
      `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2`,
      [newOrgId, freshOwner],
    );
    expect(rows[0].role).toBe('OWNER');
  });
});
