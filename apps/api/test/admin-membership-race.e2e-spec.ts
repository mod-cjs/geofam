/**
 * Test e2e — DURCISSEMENT DES COURSES d'appartenance (migration 0021), contre la
 * VRAIE base PostgreSQL. Deux defauts de concurrence fermes par 0021 :
 *
 *   M2 (GARDE one-org SUR LA REACTIVATION) — prouve via HTTP (supertest) sur l'app
 *      NestJS reelle : la reactivation d'un membre suspendu ne doit PAS contourner
 *      « un user = une org ». Chemin : ajouter U a A, SUSPENDRE U dans A, ajouter U
 *      a B (OK car U n'est actif nulle part), puis REACTIVER U dans A -> 409 (R0015).
 *      Exerce le mapping R0015 -> ConflictException de members.service.setMemberActive.
 *
 *   M1 (VERROU DE LECTURE DU ROLE dans remove_member) — prouve par un ENTRELACEMENT
 *      DETERMINISTE de deux transactions explicites (2 clients pg), a ORDRE DE VERROUS
 *      controle (PAS une vraie course parallele, qui serait flaky) :
 *        - Tx1 : admin_transfer_ownership(R, N) promeut N OWNER + retrograde l'ancien
 *          owner ; le FOR UPDATE sur la ligne de N (0015) est TENU jusqu'au COMMIT.
 *        - Tx2 : remove_member(R, N) se SERIALISE sur cette meme ligne (FOR UPDATE
 *          ajoute par 0021) -> BLOQUE tant que Tx1 n'a pas commit.
 *        - Apres COMMIT de Tx1, Tx2 RE-LIT N = OWNER SOUS VERROU -> anti-lockout
 *          (dernier OWNER actif) -> R0008. Le retrait est REFUSE.
 *      SENTINELLE DE NON-REGRESSION : sans le FOR UPDATE (down.sql de 0021),
 *      remove_member lirait N = ENGINEER (snapshot pre-transfert), passerait
 *      l'anti-lockout, puis son DELETE (qui, lui, verrouille la ligne) supprimerait
 *      le SEUL OWNER apres le COMMIT de Tx1 -> ORG SANS OWNER. Ce test deviendrait
 *      alors ROUGE (removeErr null + zero OWNER actif). Il garde donc l'invariant
 *      « l'org conserve TOUJOURS >= 1 OWNER actif ».
 *
 * Les deux transactions de M1 basculent en roadsen_app via `SET LOCAL ROLE` — MEME
 * chemin runtime que PrismaService.asAppRole (barriere B1). Le seed/teardown se fait
 * via la connexion SUPERUSER DATABASE_URL (patron admin-one-org.e2e).
 *
 * ANTI-SKIP : DATABASE_URL absent ET CI -> echec dur. Hors CI sans base ->
 * non-execute (honnete), interdit en CI.
 */
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApp } from '../src/app.config';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/auth/password';

type PgError = Error & { code?: string };
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

const DB_URL = process.env.DATABASE_URL ?? '';
const ENFORCE = process.env.CI === 'true' || DB_URL.length > 0;

function loadPgClient(): PgClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pg') as { Client: PgClientCtor };
  return mod.Client;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Durcissement des courses d appartenance — migration 0021 (e2e)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  const superId = randomUUID();

  // --- Fixtures M2 (garde one-org sur la reactivation) ---
  const orgA = randomUUID();
  const orgB = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const userU = randomUUID(); // membre balade A -> (suspendu) -> B -> (reactive A refuse)

  // --- Fixtures M1 (verrou de lecture du role) ---
  const orgR = randomUUID();
  const ownerR = randomUUID(); // OWNER initial de R
  const memberN = randomUUID(); // membre ENGINEER, cible du transfert + du retrait

  const PASSWORD = 'Sup3r-Secret-Race!';

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
       VALUES ($1,$2,$3,'Super Race','SUPERADMIN',now())`,
      [superId, emailSuper(), hash],
    );
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES
        ($1,$2,$11,'Owner A',now()),
        ($3,$4,$11,'Owner B',now()),
        ($5,$6,$11,'User U',now()),
        ($7,$8,$11,'Owner R',now()),
        ($9,$10,$11,'Member N',now())`,
      [
        ownerA,
        email(ownerA, 'owa'),
        ownerB,
        email(ownerB, 'owb'),
        userU,
        email(userU, 'u'),
        ownerR,
        email(ownerR, 'owr'),
        memberN,
        email(memberN, 'n'),
        hash,
      ],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES
        ($1,'Org A',$2,now()), ($3,'Org B',$4,now()), ($5,'Org R',$6,now())`,
      [
        orgA,
        `race-a-${orgA.slice(0, 8)}`,
        orgB,
        `race-b-${orgB.slice(0, 8)}`,
        orgR,
        `race-r-${orgR.slice(0, 8)}`,
      ],
    );
    // OWNER par org. memberN est ajoute a R en ENGINEER ACTIF (cible du transfert).
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role, is_active) VALUES
        ($1,$2,$3,'OWNER',true),
        ($4,$5,$6,'OWNER',true),
        ($7,$8,$9,'OWNER',true),
        ($10,$8,$11,'ENGINEER',true)`,
      [
        randomUUID(),
        orgA,
        ownerA,
        randomUUID(),
        orgB,
        ownerB,
        randomUUID(),
        orgR,
        ownerR,
        randomUUID(),
        memberN,
      ],
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
        const orgIds = [orgA, orgB, orgR];
        await admin.query(`ALTER TABLE admin_audit_log DISABLE TRIGGER USER`);
        try {
          await admin.query(
            `DELETE FROM admin_audit_log WHERE actor_user_id = $1`,
            [superId],
          );
        } finally {
          await admin.query(`ALTER TABLE admin_audit_log ENABLE TRIGGER USER`);
        }
        await admin.query(
          `DELETE FROM memberships WHERE org_id = ANY($1::uuid[])`,
          [orgIds],
        );
        await admin.query(
          `DELETE FROM organizations WHERE id = ANY($1::uuid[])`,
          [orgIds],
        );
        await admin.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
          [superId, ownerA, ownerB, userU, ownerR, memberN],
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
  async function loginSuper(): Promise<string> {
    if (superToken) return superToken;
    const res = await request(server())
      .post('/auth/login')
      .send({ email: emailSuper(), password: PASSWORD });
    expect(res.status).toBe(200);
    superToken = String((res.body as AuthBody).accessToken);
    return superToken;
  }

  const addMember = (org: string, userId: string, role = 'ENGINEER') =>
    request(server())
      .post(`/admin/orgs/${org}/members`)
      .set('authorization', `Bearer ${superToken}`)
      .send({ userId, role });
  const setActive = (org: string, userId: string, isActive: boolean) =>
    request(server())
      .patch(`/admin/orgs/${org}/members/${userId}`)
      .set('authorization', `Bearer ${superToken}`)
      .send({ isActive });

  const activeMembershipCount = async (userId: string): Promise<number> => {
    const { rows } = await admin!.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM memberships WHERE user_id = $1 AND is_active = true`,
      [userId],
    );
    return Number(rows[0].n);
  };
  const activeOwners = async (org: string): Promise<string[]> => {
    const { rows } = await admin!.query<{ user_id: string }>(
      `SELECT user_id FROM memberships
       WHERE org_id = $1 AND role = 'OWNER' AND is_active = true`,
      [org],
    );
    return rows.map((r) => r.user_id);
  };

  // ===================================================================
  //  M2 — GARDE one-org SUR LA REACTIVATION (via HTTP, prioritaire)
  // ===================================================================

  it('M2) reactiver A un user devenu actif dans B -> 409 (un user = une org)', async () => {
    if (!ready()) return;
    await loginSuper();

    // 1) U rejoint A (actif).
    expect((await addMember(orgA, userU)).status).toBe(201);
    expect(await activeMembershipCount(userU)).toBe(1);

    // 2) U est SUSPENDU dans A -> il n'est plus actif nulle part.
    expect((await setActive(orgA, userU, false)).status).toBe(200);
    expect(await activeMembershipCount(userU)).toBe(0);

    // 3) U peut alors rejoindre B (provision_member : aucune appartenance ACTIVE
    //    ailleurs -> autorise). Desormais U est actif dans B.
    expect((await addMember(orgB, userU)).status).toBe(201);
    expect(await activeMembershipCount(userU)).toBe(1);

    // 4) REACTIVER U dans A doit etre REFUSE : U est deja actif dans B (une autre
    //    org). C'est le defaut M2 ferme par 0021 (set_member_active applique la
    //    garde one-org sur le SEUL chemin p_active=true) -> 409.
    const reactivate = await setActive(orgA, userU, true);
    expect(reactivate.status).toBe(409);

    // Aucun contournement : U reste actif dans B UNIQUEMENT (jamais 2 appartenances).
    expect(await activeMembershipCount(userU)).toBe(1);
    const { rows } = await admin!.query<{ org_id: string; is_active: boolean }>(
      `SELECT org_id, is_active FROM memberships WHERE user_id = $1 ORDER BY org_id`,
      [userU],
    );
    const activeOrgs = rows.filter((r) => r.is_active).map((r) => r.org_id);
    expect(activeOrgs).toEqual([orgB]);
  });

  it('M2 bis) la SUSPENSION n est jamais bloquee par la garde one-org', async () => {
    if (!ready()) return;
    await loginSuper();
    // U est actif dans B (etat de fin du test precedent). Le suspendre doit rester
    // permis (p_active=false n'applique aucune garde one-org) -> 200.
    expect((await setActive(orgB, userU, false)).status).toBe(200);
    expect(await activeMembershipCount(userU)).toBe(0);
  });

  // ===================================================================
  //  M1 — VERROU DE LECTURE DU ROLE (entrelacement deterministe, 2 tx)
  // ===================================================================

  it('M1) transfert(R,N) puis retrait(R,N) concurrent -> retrait refuse (R0008), org garde >= 1 OWNER', async () => {
    if (!ready()) return;

    const Client = loadPgClient();
    const c1 = new Client({ connectionString: DB_URL }); // Tx1 : transfert
    const c2 = new Client({ connectionString: DB_URL }); // Tx2 : retrait concurrent
    await c1.connect();
    await c2.connect();

    // Etat de depart : R a un seul OWNER (ownerR) ; N est ENGINEER actif.
    expect(await activeOwners(orgR)).toEqual([ownerR]);

    let removeErr: PgError | null = null;
    let blocked = false;
    try {
      // --- Tx1 : transfert d'OWNER vers N. Bascule roadsen_app (chemin asAppRole).
      await c1.query('BEGIN');
      await c1.query(`SET LOCAL ROLE "roadsen_app"`);
      await c1.query(
        `SELECT admin_transfer_ownership($1::uuid,$2::uuid,$3::uuid,$4)`,
        [orgR, memberN, superId, `xfer-${randomUUID()}`],
      );
      // Tx1 N'A PAS COMMIT : N est OWNER (non visible hors tx) et sa ligne est
      // VERROUILLEE (FOR UPDATE 0015) jusqu'au COMMIT.

      // --- Tx2 : retrait de N. Se serialise sur la MEME ligne (FOR UPDATE 0021).
      await c2.query('BEGIN');
      await c2.query(`SET LOCAL ROLE "roadsen_app"`);
      const p2 = c2
        .query(`SELECT remove_member($1::uuid,$2::uuid,$3::uuid,$4)`, [
          orgR,
          memberN,
          superId,
          `rm-${randomUUID()}`,
        ])
        .then(() => 'resolved' as const)
        .catch((e: PgError) => {
          removeErr = e;
          return 'rejected' as const;
        });

      // Prouve la SERIALISATION : Tx2 doit ATTENDRE un verrou tant que Tx1 est ouverte.
      // On sonde pg_stat_activity jusqu'a voir Tx2 en attente de verrou (borne dans le temps).
      for (let i = 0; i < 40 && !blocked; i++) {
        await sleep(50);
        const { rows } = await admin!.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_stat_activity
           WHERE state = 'active'
             AND wait_event_type = 'Lock'
             AND query ILIKE '%remove_member%'`,
        );
        blocked = Number(rows[0].n) > 0;
      }

      // Sanity : tant que Tx1 tient le verrou, remove_member n'a PAS pu se resoudre.
      const settledEarly = await Promise.race([
        p2,
        sleep(0).then(() => 'pending' as const),
      ]);
      expect(settledEarly).toBe('pending');

      // --- COMMIT de Tx1 : libere le verrou. Tx2 reprend, RE-LIT N = OWNER SOUS
      //     VERROU -> anti-lockout (dernier OWNER actif) -> R0008.
      await c1.query('COMMIT');

      const outcome = await p2;
      expect(outcome).toBe('rejected');
      await c2.query('ROLLBACK').catch(() => undefined);
    } finally {
      await c1.query('ROLLBACK').catch(() => undefined);
      await c2.query('ROLLBACK').catch(() => undefined);
      await c1.end();
      await c2.end();
    }

    // La SERIALISATION a bien eu lieu (Tx2 a attendu un verrou).
    expect(blocked).toBe(true);
    // Le retrait a ete REFUSE par l'anti-lockout (R0008), pas silencieusement passe.
    expect(removeErr).not.toBeNull();
    const err = removeErr as unknown as PgError;
    expect(err.code === 'R0008' || /anti-lockout/i.test(err.message)).toBe(true);

    // INVARIANT : l'org R conserve TOUJOURS >= 1 OWNER actif (jamais zero). Apres
    // le transfert, N est OWNER ; le retrait ayant echoue, N reste bien OWNER actif.
    const owners = await activeOwners(orgR);
    expect(owners.length).toBeGreaterThanOrEqual(1);
    expect(owners).toContain(memberN);
    // N n'a PAS ete supprime (le retrait a echoue).
    const { rows } = await admin!.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM memberships WHERE org_id = $1 AND user_id = $2`,
      [orgR, memberN],
    );
    expect(rows[0].n).toBe('1');
  });
});
