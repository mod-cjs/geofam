/**
 * Test e2e — Back-office VAGUE 1 : tableau de bord + vues GLOBALES (migration 0014).
 *
 * Prouve, via HTTP (supertest) sur l'app NestJS reelle branchee sur PostgreSQL (seed via
 * connexion SUPERUSER DATABASE_URL — meme patron que admin-mutations.e2e), les SENTINELLES :
 *
 *   1) STATS (GET /admin/stats) : les AGREGATS reflegent EXACTEMENT les deltas seedes
 *      (baseline capturee AVANT seed -> robuste a des donnees concurrentes). AGREGATS
 *      SCALAIRES seulement (aucune ligne tenant brute dans la reponse).
 *   2) ORGS filtre/tri SQL (GET /admin/orgs?status=&sort=) : filtre par statut, tri par
 *      quota/expiration fait EN BASE (fin du client-side / pagination faussee).
 *   3) SUBSCRIPTIONS (GET /admin/subscriptions?filter=) : expired/expiring/noquota/nosub.
 *   4) AUDIT GLOBAL (GET /admin/audit?action=&actor=&from=) : filtres SQL ; + BACKPORT :
 *      createUser/createOrg/addMember/setMemberActive TRACENT desormais, acteur = sub JWT.
 *   5) ISOLATION : la DEFINER stats marche sous roadsen_app (NOBYPASSRLS) ; SANS le drapeau
 *      d'auth, roadsen_app ne lit AUCUNE subscription cross-tenant (org-scope strict).
 *   6) RBAC : un non-SUPERADMIN sur /stats /audit /subscriptions -> 403.
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

// Agregats bruts de admin_platform_stats (bigint -> string via pg ; on Number()).
interface StatsRaw {
  orgs_active: string;
  orgs_suspended: string;
  orgs_archived: string;
  users_total: string;
  memberships_active: string;
  pv_total: string;
  quota_alloue_total: string;
  quota_consomme_total: string;
  abos_expirant_30j: string;
  abos_expires: string;
  orgs_sans_abo: string;
  orgs_quota_90pct: string;
}

describe('Back-office tableau de bord + vues globales (e2e)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  const run = randomUUID().slice(0, 8);
  const PREFIX = `dash-${run}`;
  const PASSWORD = 'Sup3r-Secret-Dashboard!';

  const superId = randomUUID();
  // 6 orgs seedees + leurs owners. org1 ACTIVE quota epuise+>=90% ; org2 ACTIVE expirant ;
  // org3 ACTIVE expire ; org4 SUSPENDED ; org5 ACTIVE sans abo ; org6 ARCHIVED sans abo.
  const org = Array.from({ length: 6 }, () => randomUUID());
  const owner = Array.from({ length: 6 }, () => randomUUID());
  const suspMember = randomUUID(); // membre SUSPENDU d'org1 (ne compte pas dans memberships_active)

  // Donnees creees PAR L'API (backport audit) — nettoyees en afterAll.
  const apiEmails: string[] = [];
  const apiOrgIds: string[] = [];

  let baseline: StatsRaw | null = null;
  let superToken = '';

  jest.setTimeout(60_000);

  const emailSuper = () => `super-${run}@roadsen.test`;
  const emailOwner = (i: number) => `owner-${run}-${i}@roadsen.test`;
  const slug = (i: number) => `${PREFIX}-org${i}`;
  const name = (i: number) => `${PREFIX} Org ${i}`;

  const statsQuery = async (): Promise<StatsRaw> => {
    const { rows } = await admin!.query<StatsRaw>(
      `SELECT * FROM admin_platform_stats()`,
    );
    return rows[0];
  };

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

    // BASELINE avant tout seed : on comparera les DELTAS (robuste aux donnees concurrentes).
    baseline = await statsQuery();

    const hash = await hashPassword(PASSWORD);
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, platform_role, updated_at)
       VALUES ($1,$2,$3,'Super Dash','SUPERADMIN',now())`,
      [superId, emailSuper(), hash],
    );
    // 6 owners.
    for (let i = 0; i < 6; i++) {
      await admin.query(
        `INSERT INTO users (id, email, password_hash, full_name, updated_at)
         VALUES ($1,$2,$3,$4,now())`,
        [owner[i], emailOwner(i + 1), hash, `Owner ${i + 1}`],
      );
    }
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at)
       VALUES ($1,$2,$3,'Susp Member',now())`,
      [suspMember, `susp-${run}@roadsen.test`, hash],
    );

    // Orgs (statuts varies).
    const statuses = [
      'ACTIVE',
      'ACTIVE',
      'ACTIVE',
      'SUSPENDED',
      'ACTIVE',
      'ARCHIVED',
    ];
    for (let i = 0; i < 6; i++) {
      await admin.query(
        `INSERT INTO organizations (id, name, slug, status, "updatedAt") VALUES ($1,$2,$3,$4::"OrgStatus",now())`,
        [org[i], name(i + 1), slug(i + 1), statuses[i]],
      );
      await admin.query(
        `INSERT INTO memberships (id, org_id, user_id, role) VALUES ($1,$2,$3,'OWNER')`,
        [randomUUID(), org[i], owner[i]],
      );
    }
    // membre SUSPENDU d'org1 (is_active=false) -> exclu de memberships_active.
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role, is_active) VALUES ($1,$2,$3,'ENGINEER',false)`,
      [randomUUID(), org[0], suspMember],
    );

    // Abonnements : org1 quota epuise (100/100, >=90% ET noquota), org2 expirant (10j),
    // org3 expire (-1j), org4 futur (100j). org5/org6 SANS abo.
    const subs: [number, number, number, string][] = [
      [0, 100, 100, `now() + interval '365 days'`],
      [1, 50, 0, `now() + interval '10 days'`],
      [2, 20, 5, `now() - interval '1 day'`],
      [3, 30, 0, `now() + interval '100 days'`],
    ];
    for (const [i, quota, conso, dateFin] of subs) {
      await admin.query(
        `INSERT INTO subscriptions
           (id, org_id, pack, entitlements, date_debut, date_fin, quota, consommation, created_at, updated_at)
         VALUES ($1,$2,'ROUTES', ARRAY['burmister'], now() - interval '1 day', ${dateFin}, $3, $4, now(), now())`,
        [randomUUID(), org[i], quota, conso],
      );
    }

    // 2 PV officiels sur org1 (pv_total += 2). Autoportant : aucune FK vivante.
    for (let k = 0; k < 2; k++) {
      await admin.query(
        `INSERT INTO official_pvs
           (id, org_id, calc_result_id, project_id, pv_number, user_id, project_name,
            engine_id, engine_version, input_canonical, output, science_status, verdict,
            content_hash, hmac, sealed_at)
         VALUES ($1,$2,$3,$4,$5,$6,'P-dash','burmister','1.0','{}','{}'::jsonb,'signed','CONFORME',
            $7,$8,now())`,
        [
          randomUUID(),
          org[0],
          randomUUID(),
          randomUUID(),
          `PV-${run}-${k}`,
          owner[0],
          // content_hash / hmac : 64 hex (contraintes ^[0-9a-f]{64}$). run est deja hex.
          `${run}a${k}`.padEnd(64, '0'),
          `${run}b${k}`.padEnd(64, '0'),
        ],
      );
    }

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
        const allOrgs = [...org, ...apiOrgIds];
        // admin_audit_log APPEND-ONLY (triggers) : desactive le temps du nettoyage.
        await admin.query(`ALTER TABLE admin_audit_log DISABLE TRIGGER USER`);
        try {
          await admin.query(
            `DELETE FROM admin_audit_log WHERE actor_user_id = $1 OR target_org_id = ANY($2::uuid[])`,
            [superId, allOrgs],
          );
        } finally {
          await admin.query(`ALTER TABLE admin_audit_log ENABLE TRIGGER USER`);
        }
        await admin.query(`ALTER TABLE official_pvs DISABLE TRIGGER USER`);
        try {
          await admin.query(
            `DELETE FROM official_pvs WHERE org_id = ANY($1::uuid[])`,
            [allOrgs],
          );
        } finally {
          await admin.query(`ALTER TABLE official_pvs ENABLE TRIGGER USER`);
        }
        await admin.query(
          `DELETE FROM subscriptions WHERE org_id = ANY($1::uuid[])`,
          [allOrgs],
        );
        await admin.query(
          `DELETE FROM memberships WHERE org_id = ANY($1::uuid[])`,
          [allOrgs],
        );
        await admin.query(
          `DELETE FROM organizations WHERE id = ANY($1::uuid[])`,
          [allOrgs],
        );
        await admin.query(
          `DELETE FROM users WHERE id = $1 OR id = ANY($2::uuid[]) OR email = ANY($3::text[])`,
          [superId, [...owner, suspMember], apiEmails],
        );
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

  async function login(email: string): Promise<string> {
    const res = await request(server())
      .post('/auth/login')
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    return String((res.body as AuthBody).accessToken);
  }

  const asSuper = (path: string) =>
    request(server()).get(path).set('authorization', `Bearer ${superToken}`);

  // --- 1) STATS : deltas EXACTS vs baseline --------------------------------

  it('1) GET /admin/stats : agregats = baseline + deltas seedes (scalaires seulement)', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());

    const res = await asSuper('/admin/stats');
    expect(res.status).toBe(200);
    const b = baseline!;
    const s = res.body as {
      orgs: { active: number; suspended: number; archived: number };
      usersTotal: number;
      membershipsActive: number;
      pvTotal: number;
      quota: { allouTotal: number; consommeTotal: number };
      abonnements: {
        expirant30j: number;
        expires: number;
        orgsSansAbo: number;
        orgsQuota90pct: number;
      };
    };

    // Deltas exacts (baseline capturee AVANT seed).
    expect(s.orgs.active - Number(b.orgs_active)).toBe(4); // org1,2,3,5
    expect(s.orgs.suspended - Number(b.orgs_suspended)).toBe(1); // org4
    expect(s.orgs.archived - Number(b.orgs_archived)).toBe(1); // org6
    expect(s.usersTotal - Number(b.users_total)).toBe(8); // super + 6 owners + susp
    expect(s.membershipsActive - Number(b.memberships_active)).toBe(6); // 6 OWNER (susp exclu)
    expect(s.pvTotal - Number(b.pv_total)).toBe(2);
    expect(s.quota.allouTotal - Number(b.quota_alloue_total)).toBe(200); // 100+50+20+30
    expect(s.quota.consommeTotal - Number(b.quota_consomme_total)).toBe(105); // 100+0+5+0
    expect(s.abonnements.expirant30j - Number(b.abos_expirant_30j)).toBe(1); // org2
    expect(s.abonnements.expires - Number(b.abos_expires)).toBe(1); // org3
    expect(s.abonnements.orgsSansAbo - Number(b.orgs_sans_abo)).toBe(2); // org5,org6
    expect(s.abonnements.orgsQuota90pct - Number(b.orgs_quota_90pct)).toBe(1); // org1

    // Minimisation : la reponse ne porte AUCUNE cle de ligne tenant brute (id/email/slug).
    const flat = JSON.stringify(res.body);
    expect(flat).not.toContain(slug(1));
    expect(flat).not.toContain(emailOwner(1));

    // #5 minimisation ETENDUE (money/PV) : le tableau de bord n'expose que des SCALAIRES.
    // Aucune valeur brute d'abo (date_fin) ni de PV (content_hash / hmac) ne doit fuiter,
    // ni aucun uuid de ligne tenant, ni les noms de colonnes sensibles.
    const pvHash = `${run}a0`.padEnd(64, '0'); // content_hash ET hmac du 1er PV seede
    expect(flat).not.toContain(pvHash);
    expect(flat).not.toContain(org[0]); // uuid d'org (ligne tenant)
    expect(flat).not.toContain('date_fin');
    expect(flat).not.toContain('content_hash');
    expect(flat).not.toContain('hmac');
  });

  // --- 2) ORGS : filtre par statut + tri SQL (quota / expiration) ----------

  it('2a) GET /admin/orgs?q=&status=ACTIVE : ne renvoie que les orgs ACTIVE', async () => {
    if (!ready()) return;
    const res = await asSuper(
      `/admin/orgs?q=${PREFIX}&status=ACTIVE&limit=100`,
    );
    expect(res.status).toBe(200);
    const items = res.body as { slug: string; status: string }[];
    const mine = items.filter((i) => i.slug.startsWith(PREFIX));
    expect(mine.map((i) => i.slug).sort()).toEqual(
      [slug(1), slug(2), slug(3), slug(5)].sort(),
    );
    expect(mine.every((i) => i.status === 'ACTIVE')).toBe(true);
  });

  it('2b) GET /admin/orgs?q=&sort=quota : tri par quota DESC, orgs sans abo en dernier', async () => {
    if (!ready()) return;
    const res = await asSuper(`/admin/orgs?q=${PREFIX}&sort=quota&limit=100`);
    expect(res.status).toBe(200);
    const mine = (
      res.body as { slug: string; subscription: { quota: number } | null }[]
    ).filter((i) => i.slug.startsWith(PREFIX));
    expect(mine[0].slug).toBe(slug(1)); // quota 100 en tete
    // Les deux orgs SANS abo (org5, org6) sont en fin (NULLS LAST).
    const lastTwo = mine
      .slice(-2)
      .map((i) => i.slug)
      .sort();
    expect(lastTwo).toEqual([slug(5), slug(6)].sort());
    expect(mine.slice(-2).every((i) => i.subscription === null)).toBe(true);
  });

  it('2c) GET /admin/orgs?q=&sort=expiration : tri par date_fin ASC (expire en tete)', async () => {
    if (!ready()) return;
    const res = await asSuper(
      `/admin/orgs?q=${PREFIX}&sort=expiration&limit=100`,
    );
    expect(res.status).toBe(200);
    const mine = (res.body as { slug: string }[]).filter((i) =>
      i.slug.startsWith(PREFIX),
    );
    expect(mine[0].slug).toBe(slug(3)); // date_fin passee = plus proche echeance
  });

  // --- 3) SUBSCRIPTIONS : familles money ------------------------------------

  const subSlugs = async (filter: string): Promise<string[]> => {
    const res = await asSuper(
      `/admin/subscriptions?filter=${filter}&limit=100`,
    );
    expect(res.status).toBe(200);
    return (res.body as { slug: string }[])
      .map((i) => i.slug)
      .filter((s) => s.startsWith(PREFIX));
  };

  it('3a) filter=expired : inclut org3, exclut org1/org2', async () => {
    if (!ready()) return;
    const s = await subSlugs('expired');
    expect(s).toContain(slug(3));
    expect(s).not.toContain(slug(1));
    expect(s).not.toContain(slug(2));
  });

  it('3b) filter=expiring : inclut org2, exclut org1/org3', async () => {
    if (!ready()) return;
    const s = await subSlugs('expiring');
    expect(s).toContain(slug(2));
    expect(s).not.toContain(slug(1));
    expect(s).not.toContain(slug(3));
  });

  it('3c) filter=noquota : inclut org1 (100/100), exclut org2', async () => {
    if (!ready()) return;
    const s = await subSlugs('noquota');
    expect(s).toContain(slug(1));
    expect(s).not.toContain(slug(2));
  });

  it('3d) filter=nosub : inclut org5/org6, exclut org1', async () => {
    if (!ready()) return;
    const s = await subSlugs('nosub');
    expect(s).toContain(slug(5));
    expect(s).toContain(slug(6));
    expect(s).not.toContain(slug(1));
  });

  // --- 4) AUDIT GLOBAL + BACKPORT ------------------------------------------

  it('4) backport : createUser/createOrg/addMember/setMemberActive TRACENT (acteur=super), audit filtrable', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());
    const t0 = new Date(Date.now() - 1000).toISOString();

    const e1 = `api-u1-${run}@roadsen.test`;
    const e2 = `api-u2-${run}@roadsen.test`;
    apiEmails.push(e1, e2);

    const u1 = await request(server())
      .post('/admin/users')
      .set('authorization', `Bearer ${superToken}`)
      .send({ email: e1, password: PASSWORD, fullName: 'API U1' });
    expect(u1.status).toBe(201);
    const u1Id = String((u1.body as { userId: string }).userId);

    const u2 = await request(server())
      .post('/admin/users')
      .set('authorization', `Bearer ${superToken}`)
      .send({ email: e2, password: PASSWORD, fullName: 'API U2' });
    expect(u2.status).toBe(201);
    const u2Id = String((u2.body as { userId: string }).userId);

    const o = await request(server())
      .post('/admin/orgs')
      .set('authorization', `Bearer ${superToken}`)
      .send({
        name: `${PREFIX} API Org`,
        slug: `${PREFIX}-api`,
        ownerUserId: u1Id,
      });
    expect(o.status).toBe(201);
    const oId = String((o.body as { orgId: string }).orgId);
    apiOrgIds.push(oId);

    const add = await request(server())
      .post(`/admin/orgs/${oId}/members`)
      .set('authorization', `Bearer ${superToken}`)
      .send({ userId: u2Id, role: 'ENGINEER' });
    expect(add.status).toBe(201);

    const patch = await request(server())
      .patch(`/admin/orgs/${oId}/members/${u2Id}`)
      .set('authorization', `Bearer ${superToken}`)
      .send({ isActive: false });
    expect(patch.status).toBe(200);

    // Audit GLOBAL filtre par acteur + fenetre : contient les 4 actions backportees.
    const auditRes = await asSuper(
      `/admin/audit?actor=${superId}&from=${encodeURIComponent(t0)}&limit=100`,
    );
    expect(auditRes.status).toBe(200);
    const rows = auditRes.body as {
      action: string;
      actorUserId: string;
      targetOrgId: string | null;
      targetUserId: string | null;
    }[];
    expect(rows.every((r) => r.actorUserId === superId)).toBe(true); // acteur = sub JWT
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('USER_PROVISIONED');
    expect(actions).toContain('ORG_PROVISIONED');
    expect(actions).toContain('MEMBER_ADDED');
    expect(actions).toContain('MEMBER_ACTIVE_SET');

    // Filtre par action : USER_PROVISIONED capture les 2 users crees (target_user_id).
    const usersAudit = await asSuper(
      `/admin/audit?actor=${superId}&action=USER_PROVISIONED&from=${encodeURIComponent(t0)}&limit=100`,
    );
    const targets = (usersAudit.body as { targetUserId: string | null }[]).map(
      (r) => r.targetUserId,
    );
    expect(targets).toContain(u1Id);
    expect(targets).toContain(u2Id);
    expect(
      (usersAudit.body as { action: string }[]).every(
        (r) => r.action === 'USER_PROVISIONED',
      ),
    ).toBe(true);
  });

  // --- 7) ACTEUR = SUB JWT, jamais le corps (lecon #42) --------------------

  it('7) backport : un corps qui tente d imposer actorUserId est ignore -> audit = sub JWT', async () => {
    if (!ready()) return;
    superToken = await login(emailSuper());
    const t0 = new Date(Date.now() - 1000).toISOString();

    // Acteur FALSIFIE tente par le client dans le corps (uuid arbitraire distinct du sub).
    const forgedActor = randomUUID();
    const e = `api-forge-${run}@roadsen.test`;
    apiEmails.push(e);

    const created = await request(server())
      .post('/admin/users')
      .set('authorization', `Bearer ${superToken}`)
      // actorUserId injecte dans le corps : doit etre IGNORE (schema Zod le strip ;
      // le controleur derive l'acteur de req.auth.userId = sub JWT).
      .send({
        email: e,
        password: PASSWORD,
        fullName: 'API Forge',
        actorUserId: forgedActor,
      });
    expect(created.status).toBe(201);
    const forgedTargetId = String((created.body as { userId: string }).userId);

    // L'audit de cette creation porte l'acteur = super (sub JWT), JAMAIS le forgedActor.
    const auditRes = await asSuper(
      `/admin/audit?action=USER_PROVISIONED&from=${encodeURIComponent(t0)}&limit=100`,
    );
    expect(auditRes.status).toBe(200);
    const row = (
      auditRes.body as { actorUserId: string; targetUserId: string | null }[]
    ).find((r) => r.targetUserId === forgedTargetId);
    expect(row).toBeDefined();
    expect(row!.actorUserId).toBe(superId); // sub JWT
    expect(row!.actorUserId).not.toBe(forgedActor); // le corps n'a rien impose
  });

  // --- 5) ISOLATION ---------------------------------------------------------

  it('5) isolation : SANS le drapeau, roadsen_app ne lit AUCUNE subscription cross-tenant', async () => {
    if (!ready()) return;
    // Contexte tenant = org2 ; on tente de lire l'abo d'org1 -> 0 ligne (RLS org-scope).
    await admin!.query(`BEGIN`);
    await admin!.query(`SET LOCAL ROLE roadsen_app`);
    await admin!.query(`SELECT set_config('app.current_org', $1, true)`, [
      org[1],
    ]);
    const { rows } = await admin!.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM subscriptions WHERE org_id = $1`,
      [org[0]],
    );
    await admin!.query(`ROLLBACK`);
    expect(Number(rows[0].n)).toBe(0); // aucune fuite cross-tenant sous roadsen_app scope

    // SANS contexte du tout -> fail-closed DUR (RAISE R0001), preserve par 0014.
    await admin!.query(`BEGIN`);
    await admin!.query(`SET LOCAL ROLE roadsen_app`);
    await expect(
      admin!.query(`SELECT count(*) FROM subscriptions`),
    ).rejects.toThrow(/app\.current_org non defini|R0001/i);
    await admin!.query(`ROLLBACK`);

    // La DEFINER stats, elle, agrege bien cross-tenant sous roadsen_app (via le drapeau
    // qu'elle pose/ferme) — deja prouve par GET /admin/stats (test 1). Ici on confirme
    // le VOLET NEGATIF : la voie DIRECTE reste fermee.
  });

  // --- 6) RBAC --------------------------------------------------------------

  it('6) RBAC : un non-SUPERADMIN sur /stats /audit /subscriptions -> 403', async () => {
    if (!ready()) return;
    const ownerToken = await login(emailOwner(1)); // OWNER d'org1, pas SUPERADMIN
    for (const path of [
      '/admin/stats',
      '/admin/audit',
      '/admin/subscriptions',
    ]) {
      const res = await request(server())
        .get(path)
        .set('authorization', `Bearer ${ownerToken}`);
      expect(res.status).toBe(403);
    }
  });
});
