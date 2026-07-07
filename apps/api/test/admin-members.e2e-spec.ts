/**
 * Test e2e — Accès contrôlés multi-membres (P1, admin-géré) contre la VRAIE base.
 *
 * Cf. docs/cadrage-acces-membres-p1.md §6 : les 6 SENTINELLES obligatoires,
 * prouvées via HTTP (supertest) sur l'app NestJS réelle branchée sur PostgreSQL
 * (seed/teardown via connexion SUPERUSER DATABASE_URL — même patron que
 * admin-onboarding.e2e / pv-emission.e2e) :
 *
 *   1) SUSPENSION IMMÉDIATE (le piège HAUTE) : membre actif -> 200 sur une route
 *      tenant ; PATCH isActive=false ; MÊME token -> 403 au prochain appel.
 *      Prouve que le patch du filtre is_active dans auth_user_has_membership MORD
 *      (sans lui, la suspension serait silencieusement inopérante).
 *   2) ISOLATION : un membre ajouté à l'org A ne voit JAMAIS l'org B (403) ; le
 *      provisioning dans A n'affecte pas B (compte de memberships de B inchangé).
 *   3) ANTI-LOCKOUT : suspendre le DERNIER OWNER actif -> 409.
 *   4) OWNER INTERDIT par la route : POST …/members { role:'OWNER' } -> 400 (Zod).
 *   5) QUOTA PARTAGÉ : le nouveau membre émet un calcul -> décrémente le quota DE
 *      L'ORG (même compteur), tracé à SON userId dans le ledger.
 *   6) RÉACTIVATION : isActive=true -> l'accès revient au prochain appel.
 *
 * ANTI-SKIP : DATABASE_URL absent ET CI -> échec dur. Hors CI sans base ->
 * non-exécuté (honnête), interdit en CI. Ces e2e s'exécutent au gate Docker.
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
interface AddMemberBody {
  membershipId?: unknown;
}
interface CalcBody {
  calcResultId?: unknown;
  ok?: unknown;
}

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const ENFORCE = process.env.CI === 'true' || ADMIN_URL.length > 0;

function loadPgClient(): PgClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pg') as { Client: PgClientCtor };
  return mod.Client;
}

describe('Accès contrôlés multi-membres (e2e)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  // Acteurs seedés.
  const superId = randomUUID(); // platform_role = SUPERADMIN
  const orgA = randomUUID();
  const slugA = `org-a-${orgA.slice(0, 8)}`;
  const orgB = randomUUID();
  const ownerA = randomUUID(); // OWNER de orgA (cible anti-lockout)
  const ownerB = randomUUID(); // OWNER de orgB
  const memberEng = randomUUID(); // provisionné dans A (suspension immédiate, test 1)
  const memberIso = randomUUID(); // provisionné dans A (isolation vers B, test 2)
  const memberCalc = randomUUID(); // provisionné dans A (quota partagé, test 5)
  const memberReact = randomUUID(); // provisionné dans A (réactivation, test 6 — DÉDIÉ,
  // pour que chaque test soit SELF-CONTAINED : aucun test ne dépend de l'état laissé par un autre.
  const memberXt = randomUUID(); // provisionné dans A (isolation écriture cross-tenant, test 7)
  const memberDual = randomUUID(); // membre de A ET B (isolation de l'UPDATE, test 10)
  const projectA = randomUUID();
  const subA = randomUUID();
  const PASSWORD = 'Sup3r-Secret-Members!';

  // Entrée burmister de référence (fixture non hors-domaine).
  const burmisterInput = BURMISTER_FIXTURES[0].input;

  jest.setTimeout(60_000);

  const emailSuper = () => `super-${superId.slice(0, 8)}@roadsen.test`;
  const emailEng = () => `eng-${memberEng.slice(0, 8)}@roadsen.test`;
  const emailIso = () => `iso-${memberIso.slice(0, 8)}@roadsen.test`;
  const emailCalc = () => `calc-${memberCalc.slice(0, 8)}@roadsen.test`;
  const emailReact = () => `react-${memberReact.slice(0, 8)}@roadsen.test`;
  const emailXt = () => `xt-${memberXt.slice(0, 8)}@roadsen.test`;
  const emailOwnerA = () => `owner-a-${ownerA.slice(0, 8)}@roadsen.test`;
  const emailDual = () => `dual-${memberDual.slice(0, 8)}@roadsen.test`;

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

    // Users : 1 SUPERADMIN, 2 OWNER, 3 futurs membres (sans membership au départ).
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, platform_role, updated_at)
       VALUES ($1,$2,$3,'Super Admin','SUPERADMIN',now())`,
      [superId, emailSuper(), hash],
    );
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES
        ($1,$2,$11,'Owner A',now()),
        ($3,$4,$11,'Owner B',now()),
        ($5,$6,$11,'Membre Eng',now()),
        ($7,$8,$11,'Membre Iso',now()),
        ($9,$10,$11,'Membre Calc',now())`,
      [
        ownerA,
        `owner-a-${ownerA.slice(0, 8)}@roadsen.test`,
        ownerB,
        `owner-b-${ownerB.slice(0, 8)}@roadsen.test`,
        memberEng,
        emailEng(),
        memberIso,
        emailIso(),
        memberCalc,
        emailCalc(),
        hash, // $11 : même hash pour tous les comptes seedés
      ],
    );
    // Membres dédiés aux tests 6 (réactivation), 7 (isolation écriture), 10 (isolation
    // de l'UPDATE : membre bi-org) — seedés à part pour garder l'INSERT principal lisible.
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES
        ($1,$2,$7,'Membre React',now()), ($3,$4,$7,'Membre Xt',now()), ($5,$6,$7,'Membre Dual',now())`,
      [
        memberReact,
        emailReact(),
        memberXt,
        emailXt(),
        memberDual,
        emailDual(),
        hash,
      ],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,'Org A',$2,now()), ($3,'Org B',$4,now())`,
      [orgA, slugA, orgB, `org-b-${orgB.slice(0, 8)}`],
    );
    // Memberships INITIAUX : les 2 OWNER + memberDual DANS B (ENGINEER). Les autres
    // membres sont ajoutés PAR L'API pendant les tests (c'est la fonctionnalité sous test) ;
    // memberDual sera aussi provisionné dans A en test 10 pour prouver l'isolation de l'UPDATE.
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES
        ($1,$2,$3,'OWNER'), ($4,$5,$6,'OWNER'), ($7,$5,$8,'ENGINEER')`,
      [
        randomUUID(),
        orgA,
        ownerA,
        randomUUID(),
        orgB,
        ownerB,
        randomUUID(),
        memberDual,
      ],
    );
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, updated_at) VALUES ($1,$2,'P-A',$3,now())`,
      [projectA, orgA, ownerA],
    );
    // Abonnement de orgA : quota fini + entitlement 'burmister' (slug d'URL du
    // calcul) -> le calcul consommant du membre décrémente ce compteur.
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
        // Backport 0014 : provision_member/set_member_active tracent desormais dans
        // admin_audit_log (append-only). Purge par acteur (le SUPERADMIN du test).
        await admin.query(`ALTER TABLE admin_audit_log DISABLE TRIGGER USER`);
        try {
          await admin.query(
            `DELETE FROM admin_audit_log WHERE actor_user_id = $1`,
            [superId],
          );
        } finally {
          await admin.query(`ALTER TABLE admin_audit_log ENABLE TRIGGER USER`);
        }
        // Ordre FK : ledger/calc -> subscriptions/projects -> memberships -> orgs -> users.
        // usage_ledger est APPEND-ONLY (trigger 0008 refuse DELETE) : on désactive les
        // triggers USER le temps du nettoyage (même patron que official_pvs dans
        // pv-emission.e2e), puis on les réactive.
        await admin.query(`ALTER TABLE usage_ledger DISABLE TRIGGER USER`);
        try {
          await admin.query(
            `DELETE FROM usage_ledger WHERE org_id IN ($1,$2)`,
            [orgA, orgB],
          );
        } finally {
          await admin.query(`ALTER TABLE usage_ledger ENABLE TRIGGER USER`);
        }
        await admin.query(`DELETE FROM calc_results WHERE org_id IN ($1,$2)`, [
          orgA,
          orgB,
        ]);
        await admin.query(`DELETE FROM subscriptions WHERE org_id IN ($1,$2)`, [
          orgA,
          orgB,
        ]);
        await admin.query(`DELETE FROM projects WHERE org_id IN ($1,$2)`, [
          orgA,
          orgB,
        ]);
        await admin.query(`DELETE FROM memberships WHERE org_id IN ($1,$2)`, [
          orgA,
          orgB,
        ]);
        await admin.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [
          orgA,
          orgB,
        ]);
        await admin.query(
          `DELETE FROM users WHERE id IN ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            superId,
            ownerA,
            ownerB,
            memberEng,
            memberIso,
            memberCalc,
            memberReact,
            memberXt,
            memberDual,
          ],
        );
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

  // Cache des tokens (1 login par user) : évite de rejouer argon2 et de saturer
  // le rate-limit (60 req/60 s/IP) quand la suite tourne en bloc.
  const tokenCache = new Map<string, string>();
  async function login(email: string): Promise<string> {
    const cached = tokenCache.get(email);
    if (cached) return cached;
    const res = await request(server())
      .post('/auth/login')
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    const token = String((res.body as AuthBody).accessToken);
    tokenCache.set(email, token);
    return token;
  }

  // Helpers HTTP.
  const addMember = (org: string, userId: string, role: string) =>
    request(server())
      .post(`/admin/orgs/${org}/members`)
      .set('authorization', `Bearer ${superToken}`)
      .send({ userId, role });
  const setActive = (org: string, userId: string, isActive: boolean) =>
    request(server())
      .patch(`/admin/orgs/${org}/members/${userId}`)
      .set('authorization', `Bearer ${superToken}`)
      .send({ isActive });
  // Route TENANT non-consommante : sonde d'accès (200 si membre actif, 403 sinon).
  const listProjects = (token: string, org: string) =>
    request(server())
      .get('/projects')
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', org);
  const calcBurmister = (token: string, org: string, project: string) =>
    request(server())
      .post(`/projects/${project}/calc/burmister`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', org)
      .send(burmisterInput);
  const listMembers = (org: string, token = superToken) =>
    request(server())
      .get(`/admin/orgs/${org}/members`)
      .set('authorization', `Bearer ${token}`);

  let superToken = '';

  // --- 1) SUSPENSION IMMÉDIATE (le piège HAUTE) -----------------------------

  it('1) suspension immédiate : membre actif 200 -> PATCH false -> MÊME token 403', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());

    // (a) provisionnement du membre (ENGINEER) dans orgA par le SUPERADMIN.
    const add = await addMember(orgA, memberEng, 'ENGINEER');
    expect(add.status).toBe(201);
    // POST /members renvoie desormais le DETAIL frais (fix W4), pas { membershipId } :
    // on verifie que le membre ajoute figure bien dans detail.members.
    expect(
      (add.body as { members?: Array<{ userId: string }> }).members?.some(
        (m) => m.userId === memberEng,
      ),
    ).toBe(true);

    // (b) le membre accède à une route tenant de orgA -> 200.
    const token = await login(emailEng());
    const before = await listProjects(token, orgA);
    expect(before.status).toBe(200);

    // (c) suspension.
    const patch = await setActive(orgA, memberEng, false);
    expect(patch.status).toBe(200);

    // (d) MÊME token, prochain appel -> 403 (le patch DEFINER mord, sans rotation).
    const after = await listProjects(token, orgA);
    expect(after.status).toBe(403);
  });

  // --- 2) ISOLATION ---------------------------------------------------------

  it('2) isolation : membre de A ne voit pas B (403) ; provisioning dans A n affecte pas B', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());

    const bBefore = await admin!.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM memberships WHERE org_id = $1`,
      [orgB],
    );

    const add = await addMember(orgA, memberIso, 'ENGINEER');
    expect(add.status).toBe(201);

    // Le provisioning dans A n'a rien créé dans B.
    const bAfter = await admin!.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM memberships WHERE org_id = $1`,
      [orgB],
    );
    expect(bAfter.rows[0].n).toBe(bBefore.rows[0].n);

    // Le membre de A qui vise B -> 403 (pas de membership dans B).
    const token = await login(emailIso());
    const inA = await listProjects(token, orgA);
    expect(inA.status).toBe(200);
    const inB = await listProjects(token, orgB);
    expect(inB.status).toBe(403);
  });

  // --- 3) ANTI-LOCKOUT ------------------------------------------------------

  it('3) anti-lockout : suspendre le dernier OWNER actif -> 409', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());
    const res = await setActive(orgA, ownerA, false);
    expect(res.status).toBe(409);
    // L'OWNER reste actif en base (aucune suspension appliquée).
    const { rows } = await admin!.query<{ is_active: boolean }>(
      `SELECT is_active FROM memberships WHERE org_id = $1 AND user_id = $2`,
      [orgA, ownerA],
    );
    expect(rows[0].is_active).toBe(true);
  });

  // --- 4) OWNER INTERDIT PAR LA ROUTE ---------------------------------------

  it('4) OWNER interdit : POST …/members { role:"OWNER" } -> 400', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());
    const res = await addMember(orgA, randomUUID(), 'OWNER');
    expect(res.status).toBe(400);
  });

  // --- 5) QUOTA PARTAGÉ -----------------------------------------------------

  it('5) quota partagé : le membre émet un calcul -> quota de l org -1, tracé à son userId', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());

    const add = await addMember(orgA, memberCalc, 'ENGINEER');
    expect(add.status).toBe(201);

    const before = await admin!.query<{ consommation: number }>(
      `SELECT consommation FROM subscriptions WHERE org_id = $1`,
      [orgA],
    );
    const consoBefore = Number(before.rows[0].consommation);

    const token = await login(emailCalc());
    const calc = await calcBurmister(token, orgA, projectA);
    expect(calc.status).toBe(201);
    expect((calc.body as CalcBody).ok).toBe(true);

    // Le compteur DE L'ORG a avancé d'exactement 1.
    const after = await admin!.query<{ consommation: number }>(
      `SELECT consommation FROM subscriptions WHERE org_id = $1`,
      [orgA],
    );
    expect(Number(after.rows[0].consommation)).toBe(consoBefore + 1);

    // L'unité est tracée au userId DU MEMBRE dans le ledger (non-répudiation).
    const led = await admin!.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM usage_ledger
       WHERE org_id = $1 AND user_id = $2 AND kind = 'CALC'`,
      [orgA, memberCalc],
    );
    expect(Number(led.rows[0].n)).toBeGreaterThanOrEqual(1);
  });

  // --- 6) RÉACTIVATION ------------------------------------------------------

  it('6) réactivation : PATCH false -> 403 ; PATCH true -> l accès revient (200)', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());

    // SELF-CONTAINED : membre DÉDIÉ (memberReact), provisionné ICI -> aucune dépendance
    // à l'état d'un autre test. On part d'un membre ACTIF.
    const add = await addMember(orgA, memberReact, 'ENGINEER');
    expect(add.status).toBe(201);
    const token = await login(emailReact());
    expect((await listProjects(token, orgA)).status).toBe(200); // actif -> 200

    // Suspend -> 403 au prochain appel (MÊME token).
    const off = await setActive(orgA, memberReact, false);
    expect(off.status).toBe(200);
    const suspended = await listProjects(token, orgA);
    expect(suspended.status).toBe(403);

    // Réactive -> l'accès revient (MÊME token, sans rotation).
    const on = await setActive(orgA, memberReact, true);
    expect(on.status).toBe(200);
    const back = await listProjects(token, orgA);
    expect(back.status).toBe(200);
  });

  // --- 7) ISOLATION CROSS-TENANT (écriture) — condition de merge sécurité -----
  // Sous le drapeau app.auth_bootstrap la RLS de memberships est neutralisée : le
  // `WHERE org_id = p_org_id` de set_member_active est l'UNIQUE cloisonnement. On le PROUVE :
  // suspendre un membre de A via le CHEMIN d'une autre org (orgB) ne le touche pas.

  it('7) isolation écriture : PATCH /orgs/{orgB}/members/{membreDeA} -> 404 ; ligne de A intacte', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());

    const add = await addMember(orgA, memberXt, 'ENGINEER'); // membre de A
    expect(add.status).toBe(201);

    // Tentative de suspension via le path d'une AUTRE org (orgB, dont il n'est pas membre).
    const res = await setActive(orgB, memberXt, false);
    expect(res.status).toBe(404); // set_member_active: introuvable (WHERE org_id=orgB)

    // Sa ligne dans A n'a PAS été touchée (aucune fuite d'écriture cross-tenant).
    const { rows } = await admin!.query<{ is_active: boolean }>(
      `SELECT is_active FROM memberships WHERE org_id = $1 AND user_id = $2`,
      [orgA, memberXt],
    );
    expect(rows[0].is_active).toBe(true);
  });

  // --- 8) ISOLATION CROSS-TENANT (lecture) — condition de merge sécurité ------
  // list_org_members (même drapeau) : le `WHERE org_id = p_org_id` doit exclure tout
  // membre d'une AUTRE org. ownerB est membre de B : GET des membres de A ne le liste jamais.

  it('8) isolation lecture : GET /orgs/{orgA}/members exclut un membre de B', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());

    const res = await listMembers(orgA);
    expect(res.status).toBe(200);
    const ids = (res.body as { userId: string }[]).map((m) => m.userId);
    expect(ids).toContain(ownerA); // membre de A -> listé
    expect(ids).not.toContain(ownerB); // membre de B -> JAMAIS listé pour A
  });

  // --- 9) RBAC : seul un SUPERADMIN gère les membres --------------------------

  it('9) RBAC : un non-SUPERADMIN (OWNER) sur les 3 routes -> 403', async () => {
    if (!ready()) return;
    const ownerToken = await login(emailOwnerA()); // OWNER de A, pas SUPERADMIN

    const post = await request(server())
      .post(`/admin/orgs/${orgA}/members`)
      .set('authorization', `Bearer ${ownerToken}`)
      .send({ userId: randomUUID(), role: 'ENGINEER' });
    const patch = await request(server())
      .patch(`/admin/orgs/${orgA}/members/${ownerA}`)
      .set('authorization', `Bearer ${ownerToken}`)
      .send({ isActive: false });
    const get = await listMembers(orgA, ownerToken);

    expect(post.status).toBe(403);
    expect(patch.status).toBe(403);
    expect(get.status).toBe(403);
  });

  // --- 10) ISOLATION DE L'UPDATE (revue adverse) : prouve DIRECTEMENT que set_member_active
  //     ne touche QUE la ligne de l'org ciblée, via un membre présent dans A ET B. ----------

  it('10) isolation UPDATE : suspendre via orgB un membre de A ET B -> B basculé, A INTACT', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());

    // memberDual est seedé membre de B ; on le provisionne AUSSI dans A via l'API.
    const add = await addMember(orgA, memberDual, 'ENGINEER');
    expect(add.status).toBe(201);

    // Suspendre via le path de orgB : l'UPDATE (WHERE org_id=orgB) ne doit toucher QUE B.
    const off = await setActive(orgB, memberDual, false);
    expect(off.status).toBe(200);

    const a = await admin!.query<{ is_active: boolean }>(
      `SELECT is_active FROM memberships WHERE org_id = $1 AND user_id = $2`,
      [orgA, memberDual],
    );
    const b = await admin!.query<{ is_active: boolean }>(
      `SELECT is_active FROM memberships WHERE org_id = $1 AND user_id = $2`,
      [orgB, memberDual],
    );
    expect(a.rows[0].is_active).toBe(true); // ligne de A INTACTE (pas de fuite d'écriture)
    expect(b.rows[0].is_active).toBe(false); // ligne de B basculée
  });

  // --- 11) BARRIÈRE DB (défense en profondeur) : provision_member refuse OWNER même en appel
  //     DIRECT (contourne la barrière Zod de la route). --------------------------------------

  it('11) barrière DB : provision_member(...,OWNER) direct -> rejeté (P0001)', async () => {
    if (!ready()) return;
    await expect(
      admin!.query(
        `SELECT provision_member($1::uuid, $2::uuid, 'OWNER'::"Role")`,
        [orgA, memberEng],
      ),
    ).rejects.toThrow(/OWNER interdit/i);
  });
});
