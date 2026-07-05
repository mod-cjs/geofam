/**
 * Test e2e — Back-office MUTATIONS money-adjacent (Lot 2) contre la VRAIE base.
 *
 * Cf. docs/cadrage-backoffice.md §2.5 : les SENTINELLES obligatoires, prouvees via
 * HTTP (supertest) sur l'app NestJS reelle branchee sur PostgreSQL (seed/teardown
 * via connexion SUPERUSER DATABASE_URL — meme patron que admin-members.e2e) :
 *
 *   1) IDEMPOTENCE TOP-UP : 2 appels MEME Idempotency-Key -> quota +delta UNE fois,
 *      1 seule ligne d'audit (anti double-credit).
 *   2) reserveUnit NON-REGRESSION : un calcul consomme toujours le quota APRES le
 *      re-scope colonne du GRANT UPDATE (le point qui casse si le GRANT est mal fait).
 *   3) QUOTA DIRECT INTERDIT : roadsen_app ne peut plus UPDATE subscriptions SET quota
 *      (insufficient_privilege 42501) — le chemin non trace est ferme.
 *   4) GARDE MONEY : quota resultant < consommation engagee -> 400.
 *   5) SUSPENSION ORG EFFECTIVE : membre d'une org SUSPENDED -> 403 au prochain appel
 *      tenant (prouve la redefinition de auth_user_has_membership) ; reactivation ->
 *      l'acces revient (auth NON-REGRESSION).
 *   6) ANTI-ESCALADE / ANTI-LOCKOUT : role OWNER par la route -> 400 (Zod) ; retrograder
 *      OU retirer le dernier OWNER actif -> 409.
 *   7) ROLE / RETRAIT (happy path) : changement de role 200 ; retrait SOFT 200 (is_active=false).
 *   8) RENOUVELLEMENT : reset consommation + nouvelle fenetre, trace.
 *   9) ENTITLEMENTS : edition pack + modules, trace.
 *  10) AUDIT IMMUABLE : UPDATE/DELETE sur admin_audit_log -> refuse (trigger).
 *  11) RBAC : un non-SUPERADMIN (OWNER) sur une route de mutation -> 403.
 *
 * ANTI-SKIP : DATABASE_URL absent ET CI -> echec dur. Hors CI sans base -> non-execute
 * (honnete), interdit en CI. Ces e2e s'executent au gate Docker.
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

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const ENFORCE = process.env.CI === 'true' || ADMIN_URL.length > 0;

function loadPgClient(): PgClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pg') as { Client: PgClientCtor };
  return mod.Client;
}

describe('Back-office mutations money-adjacent (e2e)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  const superId = randomUUID(); // platform_role = SUPERADMIN
  const orgA = randomUUID();
  const slugA = `mut-a-${orgA.slice(0, 8)}`;
  const ownerA = randomUUID(); // seul OWNER de A (cible anti-lockout)
  const memberSusp = randomUUID(); // ENGINEER de A (suspension d'org)
  const memberCalc = randomUUID(); // ENGINEER de A (reserveUnit + renouvellement)
  const memberRole = randomUUID(); // ENGINEER de A (changement de role + retrait soft)
  const wizardOwner = randomUUID(); // OWNER designe du wizard (test must-fix provision_subscription)
  let wizardOrgId = ''; // org creee PAR L'API dans le test wizard (nettoyee en afterAll)
  const projectA = randomUUID();
  const subA = randomUUID();
  const PASSWORD = 'Sup3r-Secret-Mutations!';

  const burmisterInput = BURMISTER_FIXTURES[0].input;

  jest.setTimeout(60_000);

  const emailSuper = () => `super-${superId.slice(0, 8)}@roadsen.test`;
  const emailOwnerA = () => `owner-a-${ownerA.slice(0, 8)}@roadsen.test`;
  const emailSusp = () => `susp-${memberSusp.slice(0, 8)}@roadsen.test`;
  const emailCalc = () => `calc-${memberCalc.slice(0, 8)}@roadsen.test`;

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
       VALUES ($1,$2,$3,'Super Admin','SUPERADMIN',now())`,
      [superId, emailSuper(), hash],
    );
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES
        ($1,$2,$9,'Owner A',now()),
        ($3,$4,$9,'Membre Susp',now()),
        ($5,$6,$9,'Membre Calc',now()),
        ($7,$8,$9,'Membre Role',now())`,
      [
        ownerA,
        emailOwnerA(),
        memberSusp,
        emailSusp(),
        memberCalc,
        emailCalc(),
        memberRole,
        `role-${memberRole.slice(0, 8)}@roadsen.test`,
        hash,
      ],
    );
    // OWNER designe du wizard (must-fix) : user EXISTANT, sans membership au depart.
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at)
       VALUES ($1,$2,$3,'Wizard Owner',now())`,
      [wizardOwner, `wiz-${wizardOwner.slice(0, 8)}@roadsen.test`, hash],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,'Org A',$2,now())`,
      [orgA, slugA],
    );
    // Memberships INITIAUX seedes directement (l'ajout de membres est teste ailleurs).
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES
        ($1,$2,$3,'OWNER'), ($4,$2,$5,'ENGINEER'), ($6,$2,$7,'ENGINEER'), ($8,$2,$9,'ENGINEER')`,
      [
        randomUUID(),
        orgA,
        ownerA,
        randomUUID(),
        memberSusp,
        randomUUID(),
        memberCalc,
        randomUUID(),
        memberRole,
      ],
    );
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, updated_at) VALUES ($1,$2,'P-A',$3,now())`,
      [projectA, orgA, ownerA],
    );
    // Abonnement : quota fini + entitlement 'burmister' (slug du calcul consommant).
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
        // orgA + l'org creee par le wizard (si le test a tourne). ANY(array) borne le nettoyage.
        const orgs = [orgA, wizardOrgId].filter((x) => x.length > 0);
        // Ordre FK. usage_ledger + admin_audit_log sont APPEND-ONLY (triggers) : on
        // desactive les triggers USER le temps du nettoyage, puis on les reactive.
        await admin.query(`ALTER TABLE usage_ledger DISABLE TRIGGER USER`);
        try {
          await admin.query(
            `DELETE FROM usage_ledger WHERE org_id = ANY($1::uuid[])`,
            [orgs],
          );
        } finally {
          await admin.query(`ALTER TABLE usage_ledger ENABLE TRIGGER USER`);
        }
        await admin.query(`ALTER TABLE admin_audit_log DISABLE TRIGGER USER`);
        try {
          await admin.query(
            `DELETE FROM admin_audit_log WHERE target_org_id = ANY($1::uuid[])`,
            [orgs],
          );
        } finally {
          await admin.query(`ALTER TABLE admin_audit_log ENABLE TRIGGER USER`);
        }
        await admin.query(
          `DELETE FROM calc_results WHERE org_id = ANY($1::uuid[])`,
          [orgs],
        );
        await admin.query(
          `DELETE FROM subscriptions WHERE org_id = ANY($1::uuid[])`,
          [orgs],
        );
        await admin.query(
          `DELETE FROM projects WHERE org_id = ANY($1::uuid[])`,
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
        await admin.query(`DELETE FROM users WHERE id IN ($1,$2,$3,$4,$5,$6)`, [
          superId,
          ownerA,
          memberSusp,
          memberCalc,
          memberRole,
          wizardOwner,
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

  let superToken = '';

  // Helpers HTTP (SUPERADMIN).
  const topup = (org: string, delta: number, motif: string, key?: string) => {
    const r = request(server())
      .post(`/admin/orgs/${org}/subscription/topup`)
      .set('authorization', `Bearer ${superToken}`);
    if (key) r.set('Idempotency-Key', key);
    return r.send({ delta, motif });
  };
  const renew = (
    org: string,
    dateDebut: string,
    dateFin: string,
    key?: string,
  ) => {
    const r = request(server())
      .post(`/admin/orgs/${org}/subscription/renew`)
      .set('authorization', `Bearer ${superToken}`);
    if (key) r.set('Idempotency-Key', key);
    return r.send({ dateDebut, dateFin });
  };
  const setEntitlements = (org: string, pack: string, entitlements: string[]) =>
    request(server())
      .patch(`/admin/orgs/${org}/subscription/entitlements`)
      .set('authorization', `Bearer ${superToken}`)
      .send({ pack, entitlements });
  const setRole = (org: string, userId: string, role: string) =>
    request(server())
      .patch(`/admin/orgs/${org}/members/${userId}/role`)
      .set('authorization', `Bearer ${superToken}`)
      .send({ role });
  const removeMember = (org: string, userId: string, key?: string) => {
    const r = request(server())
      .delete(`/admin/orgs/${org}/members/${userId}`)
      .set('authorization', `Bearer ${superToken}`);
    if (key) r.set('Idempotency-Key', key);
    return r.send();
  };
  const setStatus = (org: string, status: string) =>
    request(server())
      .patch(`/admin/orgs/${org}/status`)
      .set('authorization', `Bearer ${superToken}`)
      .send({ status });
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

  const subRow = async () => {
    const { rows } = await admin!.query<{
      quota: number;
      consommation: number;
    }>(`SELECT quota, consommation FROM subscriptions WHERE org_id = $1`, [
      orgA,
    ]);
    return rows[0];
  };
  const auditCount = async (key: string) => {
    const { rows } = await admin!.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM admin_audit_log WHERE idempotency_key = $1`,
      [key],
    );
    return Number(rows[0].n);
  };

  // --- 1) IDEMPOTENCE TOP-UP -------------------------------------------------

  it('1) idempotence top-up : 2 appels MEME cle -> quota +delta UNE fois, 1 audit', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());

    const before = await subRow(); // quota 100, conso 0
    const key = `topup-${randomUUID()}`;

    const first = await topup(orgA, 50, 'virement 05/07', key);
    expect(first.status).toBe(201);
    const second = await topup(orgA, 50, 'virement 05/07 (retry)', key);
    expect(second.status).toBe(201); // rejoue proprement (no-op cote base)

    const after = await subRow();
    expect(after.quota).toBe(before.quota + 50); // +50 UNE seule fois
    expect(after.consommation).toBe(before.consommation); // JAMAIS touchee
    expect(await auditCount(key)).toBe(1); // 1 seule ligne d'audit
  });

  // --- 2) reserveUnit NON-REGRESSION (le point qui casse si le GRANT est mal fait) --

  it('2) reserveUnit : un calcul consomme toujours le quota APRES le re-scope colonne', async () => {
    if (!ready()) return;
    const before = await subRow();

    const token = await login(emailCalc());
    const calc = await calcBurmister(token, orgA, projectA);
    expect(calc.status).toBe(201);
    expect((calc.body as CalcBody).ok).toBe(true);

    const after = await subRow();
    expect(after.consommation).toBe(before.consommation + 1); // decompte OK
    expect(after.quota).toBe(before.quota); // quota inchange par le calcul
  });

  // --- 3) QUOTA DIRECT INTERDIT (chemin non trace ferme) ---------------------

  it('3) quota direct interdit : roadsen_app ne peut plus UPDATE subscriptions SET quota', async () => {
    if (!ready()) return;
    // Sous le role applicatif roadsen_app + contexte tenant, l'UPDATE de la colonne
    // quota doit etre refuse (insufficient_privilege) : le GRANT n'accorde que
    // (consommation, updated_at). Statements SEPARES (pg n'accepte pas plusieurs
    // commandes parametrees dans une meme requete) sur une tx annulee.
    await admin!.query(`BEGIN`);
    await admin!.query(`SET LOCAL ROLE roadsen_app`);
    await admin!.query(`SELECT set_config('app.current_org', $1, true)`, [
      orgA,
    ]);
    await expect(
      admin!.query(`UPDATE subscriptions SET quota = 9999 WHERE org_id = $1`, [
        orgA,
      ]),
    ).rejects.toThrow(/permission denied|insufficient|42501/i);
    await admin!.query(`ROLLBACK`);

    // Preuve complementaire : le decompte reserveUnit (consommation, updated_at) PASSE
    // sous le meme role (non-regression du GRANT colonne-scope).
    await admin!.query(`BEGIN`);
    await admin!.query(`SET LOCAL ROLE roadsen_app`);
    await admin!.query(`SELECT set_config('app.current_org', $1, true)`, [
      orgA,
    ]);
    await admin!.query(
      `UPDATE subscriptions SET consommation = consommation, updated_at = now() WHERE org_id = $1`,
      [orgA],
    );
    await admin!.query(`ROLLBACK`);
  });

  // --- 4) GARDE MONEY : quota resultant < consommation -> 400 ----------------

  it('4) garde money : baisse rendant quota < consommation -> 400, aucun changement', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());
    const before = await subRow(); // conso = 1 (apres T2), quota = 150

    // delta qui ferait passer le quota SOUS la consommation deja engagee.
    const delta = -(before.quota - before.consommation + 1); // -> quota_after = conso - 1 < conso
    const res = await topup(
      orgA,
      delta,
      'baisse excessive',
      `guard-${randomUUID()}`,
    );
    expect(res.status).toBe(400);

    const after = await subRow();
    expect(after.quota).toBe(before.quota); // inchange (RAISE -> rollback)
  });

  // --- 5) SUSPENSION ORG EFFECTIVE + auth NON-REGRESSION ---------------------

  it('5) suspension org : membre 200 -> SUSPENDED -> 403 ; ACTIVE -> 200 revient', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());

    const token = await login(emailSusp());
    expect((await listProjects(token, orgA)).status).toBe(200); // org ACTIVE -> acces

    const susp = await setStatus(orgA, 'SUSPENDED');
    expect(susp.status).toBe(200);
    const blocked = await listProjects(token, orgA); // MEME token
    expect(blocked.status).toBe(403); // org suspendue -> plus de role (auth redefinie)

    const react = await setStatus(orgA, 'ACTIVE');
    expect(react.status).toBe(200);
    const back = await listProjects(token, orgA);
    expect(back.status).toBe(200); // auth NON-REGRESSION : l'acces revient
  });

  // --- 6) ANTI-ESCALADE / ANTI-LOCKOUT ---------------------------------------

  it('6a) anti-escalade : role OWNER par la route -> 400 (Zod)', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());
    const res = await setRole(orgA, memberRole, 'OWNER');
    expect(res.status).toBe(400);
  });

  it('6b) anti-lockout : retrograder le dernier OWNER actif -> 409', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());
    const res = await setRole(orgA, ownerA, 'ENGINEER');
    expect(res.status).toBe(409);
    const { rows } = await admin!.query<{ role: string }>(
      `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2`,
      [orgA, ownerA],
    );
    expect(rows[0].role).toBe('OWNER'); // intact
  });

  it('6c) anti-lockout : retirer le dernier OWNER actif -> 409', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());
    const res = await removeMember(orgA, ownerA);
    expect(res.status).toBe(409);
    const { rows } = await admin!.query<{ is_active: boolean }>(
      `SELECT is_active FROM memberships WHERE org_id = $1 AND user_id = $2`,
      [orgA, ownerA],
    );
    expect(rows[0].is_active).toBe(true); // intact
  });

  // --- 7) ROLE / RETRAIT (happy path) ----------------------------------------

  it('7) role happy path 200 (ENGINEER->ADMIN) puis retrait SOFT 200 (is_active=false)', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());

    const promote = await setRole(orgA, memberRole, 'ADMIN');
    expect(promote.status).toBe(200);
    let { rows } = await admin!.query<{ role: string; is_active: boolean }>(
      `SELECT role, is_active FROM memberships WHERE org_id = $1 AND user_id = $2`,
      [orgA, memberRole],
    );
    expect(rows[0].role).toBe('ADMIN');

    const removed = await removeMember(orgA, memberRole);
    expect(removed.status).toBe(200);
    ({ rows } = await admin!.query<{ role: string; is_active: boolean }>(
      `SELECT role, is_active FROM memberships WHERE org_id = $1 AND user_id = $2`,
      [orgA, memberRole],
    ));
    expect(rows[0].is_active).toBe(false); // SOFT : suspendu, pas supprime
  });

  // --- 8) RENOUVELLEMENT ------------------------------------------------------

  it('8) renouvellement : reset consommation a 0 + nouvelle fenetre, trace', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());
    const before = await subRow();
    expect(before.consommation).toBeGreaterThan(0); // conso engagee (calcul de T2)

    const debut = new Date().toISOString();
    const fin = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const key = `renew-${randomUUID()}`;
    const res = await renew(orgA, debut, fin, key);
    expect(res.status).toBe(201);

    const after = await subRow();
    expect(after.consommation).toBe(0); // reset
    expect(await auditCount(key)).toBe(1); // trace SUB_RENEW
  });

  // --- 9) ENTITLEMENTS --------------------------------------------------------

  it('9) entitlements : edition pack + modules, trace', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());
    const res = await setEntitlements(orgA, 'FONDATIONS', [
      'burmister',
      'terzaghi',
    ]);
    expect(res.status).toBe(200);

    const { rows } = await admin!.query<{
      pack: string;
      entitlements: string[];
    }>(`SELECT pack, entitlements FROM subscriptions WHERE org_id = $1`, [
      orgA,
    ]);
    expect(rows[0].pack).toBe('FONDATIONS');
    expect(rows[0].entitlements).toEqual(['burmister', 'terzaghi']);
  });

  // --- 10) AUDIT IMMUABLE -----------------------------------------------------

  it('10) audit immuable : UPDATE/DELETE sur admin_audit_log -> refuse (trigger)', async () => {
    if (!ready()) return;
    // Au moins une ligne existe (top-up de T1). On tente une mutation directe -> RAISE.
    await expect(
      admin!.query(
        `UPDATE admin_audit_log SET action = 'HACK' WHERE target_org_id = $1`,
        [orgA],
      ),
    ).rejects.toThrow(/APPEND-ONLY|R0004/i);
    await expect(
      admin!.query(`DELETE FROM admin_audit_log WHERE target_org_id = $1`, [
        orgA,
      ]),
    ).rejects.toThrow(/APPEND-ONLY|R0004/i);
  });

  // --- 11) RBAC ---------------------------------------------------------------

  it('11) RBAC : un non-SUPERADMIN (OWNER) sur une route de mutation -> 403', async () => {
    if (!ready()) return;
    const ownerToken = await login(emailOwnerA()); // OWNER de A, pas SUPERADMIN
    const res = await request(server())
      .post(`/admin/orgs/${orgA}/subscription/topup`)
      .set('authorization', `Bearer ${ownerToken}`)
      .send({ delta: 10, motif: 'tentative' });
    expect(res.status).toBe(403);
  });

  // --- 12) MUST-FIX : provision_subscription via le VRAI chemin applicatif ----
  //  Prouve le grant INSERT (0013 §2, forward-fix du bug 0008) : POST /admin/orgs AVEC
  //  body.subscription cree l'abonnement sous roadsen_app -> provision_subscription (DEFINER,
  //  owned roadsen_auth) INSERT. Sans le grant INSERT -> 42501/500. Chemin app, PAS un seed.

  it('12) MUST-FIX : POST /admin/orgs AVEC abonnement (chemin app) -> 201 + abo cree', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());
    const slug = `wiz-${randomUUID().slice(0, 8)}`;
    const debut = new Date().toISOString();
    const fin = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    const res = await request(server())
      .post('/admin/orgs')
      .set('authorization', `Bearer ${superToken}`)
      .send({
        name: 'Wizard Org',
        slug,
        ownerUserId: wizardOwner,
        subscription: {
          pack: 'ROUTES',
          entitlements: ['burmister'],
          dateDebut: debut,
          dateFin: fin,
          quota: 50,
        },
      });
    expect(res.status).toBe(201);
    wizardOrgId = String((res.body as { orgId: string }).orgId);
    expect(wizardOrgId).toMatch(/^[0-9a-f-]{36}$/i);

    // L'abonnement a bien ete cree (provision_subscription a franchi la RLS via le grant
    // INSERT roadsen_auth) — c'est le chemin qui 500ait avant le must-fix.
    const { rows } = await admin!.query<{ quota: number; pack: string }>(
      `SELECT quota, pack FROM subscriptions WHERE org_id = $1`,
      [wizardOrgId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].quota).toBe(50);
    expect(rows[0].pack).toBe('ROUTES');
  });

  // --- 13) IDEMPOTENCE MONEY NON DEGRADABLE : en-tete obligatoire sur topup/renew --

  it('13) money : topup / renew SANS Idempotency-Key -> 400 (pas d auto-generation)', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());
    const noKeyTopup = await request(server())
      .post(`/admin/orgs/${orgA}/subscription/topup`)
      .set('authorization', `Bearer ${superToken}`)
      .send({ delta: 10, motif: 'sans cle' });
    expect(noKeyTopup.status).toBe(400);

    const debut = new Date().toISOString();
    const fin = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const noKeyRenew = await request(server())
      .post(`/admin/orgs/${orgA}/subscription/renew`)
      .set('authorization', `Bearer ${superToken}`)
      .send({ dateDebut: debut, dateFin: fin });
    expect(noKeyRenew.status).toBe(400);
  });

  // --- 14) DELTA BORNE : anti-overflow int32 ---------------------------------

  it('14) delta borne : |delta| > 1_000_000 -> 400 (anti-overflow int)', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());
    const res = await topup(
      orgA,
      5_000_000_000,
      'delta enorme',
      `big-${randomUUID()}`,
    );
    expect(res.status).toBe(400);
  });

  // --- 15) F1 : idempotence AVANT garde — sentinelle du double-decompte ---------
  //  Rejeu a MEME cle d'un delta NEGATIF choisi pour que, sous l'ORDRE BUGGE (garde
  //  avant idempotence), le rejeu recalcule la garde contre le quota DEJA mute et
  //  RAISErait 400 (l'operateur rejoue via une nouvelle cle -> double-decompte). Avec
  //  l'ordre correct (idempotence d'abord), le rejeu est un NO-OP succes.

  it('15) F1 : rejeu MEME cle d un delta NEGATIF -> no-op succes (pas 400), decompte UNE fois', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());
    const before = await subRow();

    // delta negatif calibre : (1) la 1re application PASSE la garde ;
    // (2) sous l'ordre BUGGE, un rejeu ECHOUERAIT la garde (quota + 2*delta < conso).
    const margin = before.quota - before.consommation;
    expect(margin).toBeGreaterThanOrEqual(2); // fenetre de delta non vide
    const delta = -Math.floor(margin * 0.75); // dans [-margin, -margin/2)
    expect(before.quota + delta).toBeGreaterThanOrEqual(before.consommation); // 1re appli OK
    expect(before.quota + 2 * delta).toBeLessThan(before.consommation); // rejeu BUGGE -> 400

    const key = `neg-${randomUUID()}`;
    const first = await topup(orgA, delta, 'baisse tracee', key);
    expect(first.status).toBe(201);
    expect((await subRow()).quota).toBe(before.quota + delta); // applique UNE fois

    // REJEU meme cle : succes idempotent (PAS 400) — ROUGE avant le fix F1, VERT apres.
    const replay = await topup(orgA, delta, 'baisse tracee (rejeu)', key);
    expect(replay.status).toBe(201);
    const after = await subRow();
    expect(after.quota).toBe(before.quota + delta); // toujours UNE fois (pas 2*delta)
    expect(await auditCount(key)).toBe(1); // 1 seule ligne d'audit
  });
});
