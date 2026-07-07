/**
 * Test e2e — Back-office SUPERADMIN, console de LECTURE (Lot 1) contre la VRAIE base.
 *
 * Prouve, via HTTP (supertest) sur l'app NestJS reelle branchee sur PostgreSQL
 * (seed/teardown via connexion SUPERUSER DATABASE_URL — meme patron que
 * admin-members.e2e / pv-emission.e2e), les 4 sentinelles du Lot 1 :
 *
 *   1) LISTE CROSS-TENANT : GET /admin/orgs renvoie bien TOUTES les orgs seedees
 *      (A ET B), avec nb membres + resume d'abonnement — PAS filtre a 0 par la RLS
 *      (FORCE + roadsen_app NOBYPASSRLS). C'est le piege n°1 : identite lue via le
 *      DEFINER admin_list_orgs sous asAppRole, jamais withTenant.
 *   2) RECHERCHE USERS bornee : GET /admin/users?q= retrouve les comptes seedes,
 *      ne fuit jamais password_hash, et respecte la borne `limit`.
 *   3) DETAIL COMPOSITE : GET /admin/orgs/:id renvoie identite + membres + abo +
 *      usage (ventilation CALC/PV et par membre du mois courant). GET .../usage idem.
 *   4) RBAC : un token NON-SUPERADMIN (OWNER) sur les routes /admin/** -> 403 ;
 *      GET /admin/me sous SUPERADMIN -> { platformRole: 'SUPERADMIN' }.
 *
 * ANTI-SKIP : DATABASE_URL absent ET CI -> echec dur. Hors CI sans base ->
 * non-execute (honnete), interdit en CI. Ces e2e s'executent au gate Docker.
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

describe('Back-office lecture SUPERADMIN (e2e)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  // Acteurs seedes.
  const superId = randomUUID(); // platform_role = SUPERADMIN
  const orgA = randomUUID();
  const orgB = randomUUID();
  const ownerA = randomUUID(); // OWNER de A (token NON-SUPERADMIN pour le RBAC)
  const ownerB = randomUUID(); // OWNER de B
  const memberEng = randomUUID(); // membre ENGINEER de A (usage tracé)
  const subA = randomUUID();
  const PASSWORD = 'Sup3r-Secret-BackOffice!';

  // Marqueur commun aux 2 orgs -> un GET /admin/orgs?q=tag matche A ET B, de
  // maniere deterministe meme si d'autres orgs coexistent dans la base.
  const tag = randomUUID().slice(0, 8);
  const nameA = `BO Alpha ${tag}`;
  const nameB = `BO Beta ${tag}`;
  const slugA = `bo-a-${orgA.slice(0, 8)}`;
  const slugB = `bo-b-${orgB.slice(0, 8)}`;

  // Paire ANTI-ORACLE (echappement LIKE, test 7). Deux orgs au meme prefixe
  // (`BO Esc <tag> lot-50`) ne differant QUE par le caractere sensible :
  //   - orgPct  : nom contenant le JOKER LITTERAL `%` -> `...lot-50%off`
  //   - orgPlain: meme forme mais `X` a la place du `%` -> `...lot-50Xoff`
  // Une recherche `q=50%off` doit, si `%` est bien echappe, matcher SEULEMENT
  // orgPct (substring litterale « 50%off »). Si l'echappement sautait, `%`
  // deviendrait un joker et `50%off` matcherait AUSSI `50Xoff` (50<any>off) ->
  // orgPlain remonterait : c'est le test qui vire ROUGE en cas de regression.
  const orgPct = randomUUID();
  const orgPlain = randomUUID();
  const namePct = `BO Esc ${tag} lot-50%off`;
  const namePlain = `BO Esc ${tag} lot-50Xoff`;
  const slugPct = `bo-esc-pct-${orgPct.slice(0, 8)}`;
  const slugPlain = `bo-esc-plain-${orgPlain.slice(0, 8)}`;

  jest.setTimeout(60_000);

  const emailSuper = () => `bo-super-${superId.slice(0, 8)}@roadsen.test`;
  const emailOwnerA = () => `bo-owner-a-${ownerA.slice(0, 8)}@roadsen.test`;
  const emailEng = () => `bo-eng-${memberEng.slice(0, 8)}@roadsen.test`;

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

    // Users : 1 SUPERADMIN, 2 OWNER, 1 membre ENGINEER.
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, platform_role, updated_at)
       VALUES ($1,$2,$3,'BO Super','SUPERADMIN',now())`,
      [superId, emailSuper(), hash],
    );
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES
        ($1,$2,$7,'BO Owner A',now()),
        ($3,$4,$7,'BO Owner B',now()),
        ($5,$6,$7,'BO Eng',now())`,
      [
        ownerA,
        emailOwnerA(),
        ownerB,
        `bo-owner-b-${ownerB.slice(0, 8)}@roadsen.test`,
        memberEng,
        emailEng(),
        hash,
      ],
    );
    // 2 organisations (marqueur commun `tag` dans le nom).
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,$2,$3,now()), ($4,$5,$6,now())`,
      [orgA, nameA, slugA, orgB, nameB, slugB],
    );
    // Paire anti-oracle (test 7) : une org au `%` LITTERAL + une jumelle sans.
    // Aucun membre / abo / usage : purge = simple DELETE organizations.
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,$2,$3,now()), ($4,$5,$6,now())`,
      [orgPct, namePct, slugPct, orgPlain, namePlain, slugPlain],
    );
    // Memberships : ownerA + memberEng dans A ; ownerB dans B.
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES
        ($1,$2,$3,'OWNER'), ($4,$2,$5,'ENGINEER'), ($6,$7,$8,'OWNER')`,
      [
        randomUUID(),
        orgA,
        ownerA,
        randomUUID(),
        memberEng,
        randomUUID(),
        orgB,
        ownerB,
      ],
    );
    // Abonnement de A : pack ROUTES, quota 100, consommation 3 (pour le resume).
    await admin.query(
      `INSERT INTO subscriptions
         (id, org_id, pack, entitlements, date_debut, date_fin, quota, consommation, created_at, updated_at)
       VALUES ($1,$2,'ROUTES', ARRAY['burmister'], now() - interval '1 day', now() + interval '365 days', 100, 3, now(), now())`,
      [subA, orgA],
    );
    // Usage du mois courant tracé à memberEng : 2 CALC + 1 PV (ventilation testee).
    // id / ref_id générés en base (gen_random_uuid) -> pas de parametre inutilise.
    await admin.query(
      `INSERT INTO usage_ledger (id, org_id, subscription_id, kind, ref_id, user_id, created_at) VALUES
        (gen_random_uuid(),$1,$2,'CALC',gen_random_uuid(),$3,now()),
        (gen_random_uuid(),$1,$2,'CALC',gen_random_uuid(),$3,now()),
        (gen_random_uuid(),$1,$2,'PV',  gen_random_uuid(),$3,now())`,
      [orgA, subA, memberEng],
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
        // usage_ledger APPEND-ONLY (trigger 0008) : DISABLE TRIGGER USER pour purger.
        await admin.query(`ALTER TABLE usage_ledger DISABLE TRIGGER USER`);
        try {
          await admin.query(
            `DELETE FROM usage_ledger WHERE org_id IN ($1,$2)`,
            [orgA, orgB],
          );
        } finally {
          await admin.query(`ALTER TABLE usage_ledger ENABLE TRIGGER USER`);
        }
        await admin.query(`DELETE FROM subscriptions WHERE org_id IN ($1,$2)`, [
          orgA,
          orgB,
        ]);
        await admin.query(`DELETE FROM memberships WHERE org_id IN ($1,$2)`, [
          orgA,
          orgB,
        ]);
        await admin.query(
          `DELETE FROM organizations WHERE id IN ($1,$2,$3,$4)`,
          [orgA, orgB, orgPct, orgPlain],
        );
        await admin.query(`DELETE FROM users WHERE id IN ($1,$2,$3,$4)`, [
          superId,
          ownerA,
          ownerB,
          memberEng,
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

  const authGet = (path: string, token: string) =>
    request(server()).get(path).set('authorization', `Bearer ${token}`);

  // Lit une chaine de config de session (current_setting) en tolerant l'absence.
  const flagValue = async (db: PgClient): Promise<string | null> => {
    const r = await db.query<{ f: string | null }>(
      `SELECT current_setting('app.auth_bootstrap', true) AS f`,
    );
    return r.rows[0].f;
  };

  // --- 1) LISTE CROSS-TENANT (piege n°1) ------------------------------------

  it('1) GET /admin/orgs renvoie A ET B (pas filtre a 0 par la RLS), avec abo', async () => {
    if (!ready()) return;
    const superToken = await login(emailSuper());

    const res = await authGet(`/admin/orgs?q=${tag}&limit=50`, superToken);
    expect(res.status).toBe(200);
    const body = res.body as {
      id: string;
      name: string;
      nbMembres: number;
      subscription: {
        pack: string;
        quota: number;
        consommation: number;
      } | null;
    }[];
    const ids = body.map((o) => o.id);
    expect(ids).toContain(orgA);
    expect(ids).toContain(orgB);

    const a = body.find((o) => o.id === orgA)!;
    expect(a.nbMembres).toBe(2); // ownerA + memberEng
    expect(a.subscription).not.toBeNull();
    expect(a.subscription!.pack).toBe('ROUTES');
    expect(a.subscription!.quota).toBe(100);
    expect(a.subscription!.consommation).toBe(3);

    const b = body.find((o) => o.id === orgB)!;
    expect(b.nbMembres).toBe(1); // ownerB
    expect(b.subscription).toBeNull(); // B n'a pas d'abonnement
  });

  // --- 2) RECHERCHE USERS bornee + pas de fuite de hash ----------------------

  it('2) GET /admin/users?q= retrouve le compte, ne fuit pas le hash, borne limit', async () => {
    if (!ready()) return;
    const superToken = await login(emailSuper());

    const res = await authGet(
      `/admin/users?q=${encodeURIComponent(emailEng())}`,
      superToken,
    );
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>[];
    expect(body.length).toBeGreaterThanOrEqual(1);
    const eng = body.find((u) => u.userId === memberEng)!;
    expect(eng).toBeDefined();
    expect(eng.email).toBe(emailEng());
    expect(eng.nbOrgs).toBe(1);
    // Aucune fuite de secret : ni password_hash ni passwordHash dans la reponse.
    expect(eng.password_hash).toBeUndefined();
    expect(eng.passwordHash).toBeUndefined();

    // Borne `limit` : q large (marqueur tag partage par plusieurs comptes) + limit=1.
    const bounded = await authGet(`/admin/users?q=bo-&limit=1`, superToken);
    expect(bounded.status).toBe(200);
    expect((bounded.body as unknown[]).length).toBeLessThanOrEqual(1);

    // limit hors borne (>50) -> 400 Zod (borne cote frontiere ET cote SQL).
    const tooBig = await authGet(`/admin/users?q=bo-&limit=999`, superToken);
    expect(tooBig.status).toBe(400);
  });

  // --- 3) DETAIL COMPOSITE + USAGE ------------------------------------------

  it('3) GET /admin/orgs/:id renvoie identite + membres + abo + usage', async () => {
    if (!ready()) return;
    const superToken = await login(emailSuper());

    const res = await authGet(`/admin/orgs/${orgA}`, superToken);
    expect(res.status).toBe(200);
    const body = res.body as {
      org: { id: string; slug: string; status: string };
      members: { userId: string }[];
      subscription: { pack: string; remaining: number } | null;
      usage: {
        quota: number | null;
        consommation: number | null;
        byKind: { CALC: number; PV: number };
        byMember: { userId: string; count: number }[];
      };
    };
    expect(body.org.id).toBe(orgA);
    expect(body.org.slug).toBe(slugA);
    const memberIds = body.members.map((m) => m.userId);
    expect(memberIds).toContain(ownerA);
    expect(memberIds).toContain(memberEng);
    expect(body.subscription).not.toBeNull();
    expect(body.subscription!.remaining).toBe(97); // 100 - 3

    // Usage du mois courant : 2 CALC + 1 PV, tous tracés à memberEng.
    expect(body.usage.quota).toBe(100);
    expect(body.usage.consommation).toBe(3);
    expect(body.usage.byKind.CALC).toBe(2);
    expect(body.usage.byKind.PV).toBe(1);
    const eng = body.usage.byMember.find((m) => m.userId === memberEng)!;
    expect(eng).toBeDefined();
    expect(eng.count).toBe(3);
  });

  it('3bis) GET /admin/orgs/:id/usage renvoie l agregat du mois', async () => {
    if (!ready()) return;
    const superToken = await login(emailSuper());
    const res = await authGet(`/admin/orgs/${orgA}/usage`, superToken);
    expect(res.status).toBe(200);
    const usage = res.body as {
      byKind: { CALC: number; PV: number };
      consommation: number | null;
    };
    expect(usage.byKind.CALC).toBe(2);
    expect(usage.byKind.PV).toBe(1);
    expect(usage.consommation).toBe(3);
  });

  it('3ter) GET /admin/orgs/:id sur un orgId inconnu -> 404', async () => {
    if (!ready()) return;
    const superToken = await login(emailSuper());
    const res = await authGet(`/admin/orgs/${randomUUID()}`, superToken);
    expect(res.status).toBe(404);
  });

  // --- 3quater) ENTITLEMENTS REELS DANS LE DETAIL (BLOQUANT modal Modules) -----
  //
  // Le modal « Modules » lit GET /admin/orgs/:id.subscription.entitlements pour
  // pre-cocher les modules. Sans ce champ, l'UI re-approxime depuis le pack et
  // ECRASE les vrais entitlements a l'enregistrement (corruption). L'abo d'orgA
  // est seede avec la liste EXACTE ARRAY['burmister'] — DIFFERENTE de ce qu'un
  // pack ROUTES impliquerait naivement — pour prouver qu'on renvoie la valeur
  // STOCKEE, pas une derivation du pack. Mutation : retirer la colonne entitlements
  // du SELECT (ou la mapper depuis le pack) -> ce test vire ROUGE.
  it('3quater) GET /admin/orgs/:id -> subscription.entitlements = la liste REELLE stockee (pas une approximation du pack)', async () => {
    if (!ready()) return;
    const superToken = await login(emailSuper());
    const res = await authGet(`/admin/orgs/${orgA}`, superToken);
    expect(res.status).toBe(200);
    const body = res.body as {
      subscription: { pack: string; entitlements: string[] } | null;
    };
    expect(body.subscription).not.toBeNull();
    // Egalite EXACTE avec la valeur seedee (ARRAY['burmister']), pas un superset du pack.
    expect(body.subscription!.entitlements).toEqual(['burmister']);
  });

  // --- 4) RBAC + /admin/me ---------------------------------------------------

  it('4) RBAC : un OWNER (non-SUPERADMIN) sur /admin/** -> 403 ; me confirme SUPERADMIN', async () => {
    if (!ready()) return;
    const superToken = await login(emailSuper());
    const ownerToken = await login(emailOwnerA()); // OWNER de A, pas SUPERADMIN

    // GET /admin/me sous SUPERADMIN -> { platformRole: 'SUPERADMIN' }.
    const meSuper = await authGet('/admin/me', superToken);
    expect(meSuper.status).toBe(200);
    expect((meSuper.body as { platformRole: string }).platformRole).toBe(
      'SUPERADMIN',
    );

    // Toutes les routes de lecture refusent un non-SUPERADMIN (403).
    const routes = [
      '/admin/me',
      `/admin/orgs?q=${tag}`,
      `/admin/orgs/${orgA}`,
      `/admin/orgs/${orgA}/usage`,
      `/admin/users?q=bo-`,
    ];
    for (const path of routes) {
      const res = await authGet(path, ownerToken);
      expect(res.status).toBe(403);
    }
  });

  // --- 5) SCOPING DU N+1 — preuve POSITIVE de non-fuite usage_ledger ----------
  //
  // CRUX DE SURETE. La liste et le detail composent l'identite (DEFINER, cross-
  // tenant) avec l'usage (withTenant(orgId), scope RLS a l'org). C'est PRECISEMENT
  // au point withTenant(orgB) qu'un bug de scoping ferait remonter les lignes
  // usage_ledger d'orgA. On le prouve dans les DEUX sens :
  //   - orgB (SANS aucune ligne ledger)  -> byKind 0/0 ET byMember VIDE ;
  //   - orgA (AVEC 2 CALC + 1 Pup PV)    -> contre-preuve : il voit BIEN SES lignes.
  // Si withTenant(orgB) fuyait l'usage d'orgA, orgB/usage afficherait 2/1 (les
  // compteurs d'orgA) et byMember listerait memberEng -> ce test vire ROUGE.
  it('5) GIVEN orgA a de l usage et orgB n en a aucun WHEN GET /admin/orgs/:orgB/usage THEN 0/0 et byMember vide (aucune fuite d orgA)', async () => {
    if (!ready()) return;
    const superToken = await login(emailSuper());

    // orgB : withTenant(orgB) ne doit JAMAIS voir le ledger d'orgA.
    const resB = await authGet(`/admin/orgs/${orgB}/usage`, superToken);
    expect(resB.status).toBe(200);
    const usageB = resB.body as {
      quota: number | null;
      consommation: number | null;
      byKind: { CALC: number; PV: number };
      byMember: { userId: string; count: number }[];
    };
    expect(usageB.byKind.CALC).toBe(0);
    expect(usageB.byKind.PV).toBe(0);
    expect(usageB.byMember).toEqual([]);
    // orgB n'a pas d'abonnement -> quota/consommation null (pas 100/3 d'orgA).
    expect(usageB.quota).toBeNull();
    expect(usageB.consommation).toBeNull();
    // Aucune ligne de memberEng (membre d'orgA) ne doit apparaitre chez orgB.
    expect(usageB.byMember.some((m) => m.userId === memberEng)).toBe(false);

    // CONTRE-PREUVE : orgA voit BIEN ses propres lignes (2 CALC + 1 PV, memberEng).
    // Sans ce volet, un scoping qui renverrait TOUJOURS vide passerait aussi -> on
    // exige la presence positive cote orgA pour fermer ce faux-vert.
    const resA = await authGet(`/admin/orgs/${orgA}/usage`, superToken);
    expect(resA.status).toBe(200);
    const usageA = resA.body as {
      byKind: { CALC: number; PV: number };
      byMember: { userId: string; count: number }[];
    };
    expect(usageA.byKind.CALC).toBe(2);
    expect(usageA.byKind.PV).toBe(1);
    const engA = usageA.byMember.find((m) => m.userId === memberEng);
    expect(engA).toBeDefined();
    expect(engA!.count).toBe(3);
  });

  // --- 6) DRAPEAU REFERME — sentinelle SQL directe sous roadsen_app -----------
  //
  // Prouve, via la connexion superuser du harness bascule en roadsen_app (le role
  // runtime NOBYPASSRLS, sans privilege identite), qu'apres un appel DEFINER de
  // lecture il ne reste AUCUNE fenetre ouverte :
  //   (a) `app.auth_bootstrap` est referme (jamais 'on') apres admin_list_orgs ;
  //   (b) un SELECT DIRECT sur users echoue TOUJOURS en insufficient_privilege
  //       (42501) — la barriere de privilege de table tient meme drapeau pose,
  //       donc seule la voie DEFINER franchit l'identite.
  // Mutation : si la fonction oubliait son set_config('off'), (a) verrait 'on' ->
  // ROUGE ; si roadsen_app gagnait un GRANT SELECT sur users, (b) ne leverait plus
  // -> ROUGE.
  it('6) GIVEN un appel DEFINER admin_list_orgs sous roadsen_app WHEN il retourne THEN app.auth_bootstrap referme ET SELECT direct users refuse (insufficient_privilege)', async () => {
    if (!ready() || !admin) return;
    await admin.query('BEGIN');
    try {
      await admin.query('SET LOCAL ROLE "roadsen_app"');
      // Materialise reellement la fonction (FROM -> execution complete).
      await admin.query(
        'SELECT * FROM admin_list_orgs(50::int, 0::int, NULL::text)',
      );
      // (a) drapeau referme (jamais laisse 'on').
      expect(await flagValue(admin)).not.toBe('on');
      // (b) acces direct identite toujours refuse sous roadsen_app.
      await expect(admin.query('SELECT * FROM users')).rejects.toThrow(
        /permission denied|insufficient privilege|denied for (table|relation) users/i,
      );
    } finally {
      await admin.query('ROLLBACK'); // SET LOCAL ROLE meurt ici : pas de pollution.
    }
  });

  // --- 7) ANTI-ORACLE / ECHAPPEMENT LIKE -------------------------------------
  //
  // Le filtre `q` est un ILIKE dont les jokers %/_/\ sont ECHAPPES cote fonction
  // (litteraux). On prouve que :
  //   (a) `q=50%off` ne matche QUE l'org au `%` LITTERAL (orgPct), PAS sa jumelle
  //       orgPlain (`50Xoff`) : preuve que `%` n'est pas traite en joker (sinon
  //       `50<any>off` matcherait les deux) ;
  //   (b) un `q` contenant `'` (apostrophe, tentative d'injection) puis `\`
  //       (backslash) ne casse NI la requete (200, pas 500) NI n'ELARGIT le
  //       resultat (aucune de nos orgs seedees ne remonte).
  it('7) GIVEN une org au % litteral et sa jumelle sans WHEN GET /admin/orgs?q=50%off THEN seule l org au % litteral matche (joker echappe)', async () => {
    if (!ready()) return;
    const superToken = await login(emailSuper());

    // (a) `%` echappe -> substring litterale « 50%off » : orgPct seul.
    const resPct = await authGet(
      `/admin/orgs?q=${encodeURIComponent('50%off')}&limit=50`,
      superToken,
    );
    expect(resPct.status).toBe(200);
    const idsPct = (resPct.body as { id: string }[]).map((o) => o.id);
    expect(idsPct).toContain(orgPct);
    // Le catcher de regression : si `%` redevenait joker, orgPlain remonterait.
    expect(idsPct).not.toContain(orgPlain);

    // (b1) apostrophe (injection) : parametree -> matche rien, 200, pas d'elargissement.
    const resQuote = await authGet(
      `/admin/orgs?q=${encodeURIComponent("' OR 1=1 --")}&limit=50`,
      superToken,
    );
    expect(resQuote.status).toBe(200);
    const idsQuote = (resQuote.body as { id: string }[]).map((o) => o.id);
    for (const id of [orgA, orgB, orgPct, orgPlain]) {
      expect(idsQuote).not.toContain(id);
    }

    // (b2) backslash seul : echappe en `\\` -> pattern valide, 0 match, 200 (une
    // regression d'echappement produirait un pattern se terminant par `\` -> 500).
    const resBackslash = await authGet(
      `/admin/orgs?q=${encodeURIComponent('\\')}&limit=50`,
      superToken,
    );
    expect(resBackslash.status).toBe(200);
    const idsBackslash = (resBackslash.body as { id: string }[]).map(
      (o) => o.id,
    );
    for (const id of [orgA, orgB, orgPct, orgPlain]) {
      expect(idsBackslash).not.toContain(id);
    }
  });

  // --- 8) CHEMIN EXCEPTION — un appel DEFINER en ERREUR ne laisse pas de fenetre
  //
  // Condition sensible : un appel DEFINER qui echoue (ici argument de type
  // invalide, cas propose par la revue securite) ne doit laisser NI le drapeau
  // 'on' NI d'acces direct a l'identite. On declenche l'erreur sous roadsen_app,
  // dans une transaction, puis on verifie l'etat APRES rollback au savepoint.
  //   NB (honnetete) : l'erreur de type est levee a la conversion de l'ARGUMENT
  //   (avant le corps), donc c'est la sentinelle « aucune fenetre residuelle apres
  //   un appel admin echoue » — la garantie du handler EXCEPTION interne est par
  //   ailleurs assuree par le caractere tx-local du drapeau (chaque asAppRole =
  //   sa propre transaction, cf. prisma.service).
  it('8) GIVEN un appel DEFINER admin_get_org en erreur (type invalide) WHEN il echoue THEN app.auth_bootstrap n est pas on ET SELECT direct users reste refuse', async () => {
    if (!ready() || !admin) return;
    await admin.query('BEGIN');
    try {
      await admin.query('SET LOCAL ROLE "roadsen_app"');
      await admin.query('SAVEPOINT sp');
      await expect(
        admin.query(`SELECT * FROM admin_get_org('not-a-valid-uuid')`),
      ).rejects.toThrow(/invalid input syntax for type uuid|uuid/i);
      await admin.query('ROLLBACK TO SAVEPOINT sp'); // tx reutilisable, role conserve
      // Aucune fenetre residuelle : drapeau non 'on' et identite toujours fermee.
      expect(await flagValue(admin)).not.toBe('on');
      await expect(admin.query('SELECT * FROM users')).rejects.toThrow(
        /permission denied|insufficient privilege|denied for (table|relation) users/i,
      );
    } finally {
      await admin.query('ROLLBACK');
    }
  });

  // --- 9) BORNE OFFSET — hors int-range -> 400 (pas 500) ---------------------
  //
  // Le DTO plafonne offset a 1_000_000 (.max). Un offset > 2^31 doit etre rejete
  // a la FRONTIERE (400 Zod) et ne JAMAIS atteindre le `::int` cote SQL (qui
  // leverait « integer out of range » -> 500). Mutation : retirer le .max
  // laisserait passer Zod puis casser en 500 -> ce test vire ROUGE.
  it('9) GIVEN offset hors int-range WHEN GET /admin/orgs?offset=99999999999 THEN 400 (borne DTO, pas 500 SQL)', async () => {
    if (!ready()) return;
    const superToken = await login(emailSuper());
    const res = await authGet(`/admin/orgs?offset=99999999999`, superToken);
    expect(res.status).toBe(400);
  });
});
