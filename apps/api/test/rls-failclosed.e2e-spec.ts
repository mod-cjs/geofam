/**
 * Test d'ISOLATION — durcissement #42 : fail-closed BRUYANT + non-fuite pool +
 * preuve PROD-LIKE que le RAISE ne casse ni le login ni le provisioning.
 *
 * Complete rls-isolation.e2e-spec.ts (cas de base inchanges). Ici on prouve le
 * DELTA de la migration 0004 :
 *
 *   #42.2  RLS SEULE bloque le cross-tenant — on opere via le role applicatif
 *          roadsen_app (NOBYPASSRLS) en pg BRUT (aucun guard applicatif present) :
 *          ce qui bloque ici est UNIQUEMENT la RLS base. (Le test confirme aussi
 *          que sans le helper, le cross-org est impossible meme en requete nue.)
 *   #42.3  SET LOCAL absent -> la requete tenant ECHOUE (RAISE app_current_org),
 *          au lieu de renvoyer "0 ligne" trompeur (changement 0004).
 *   #42.4  Non-fuite entre transactions du POOL : SET LOCAL pose en transaction A
 *          ne fuit pas vers la transaction B (org differente) sur la MEME
 *          connexion physique reutilisee.
 *   #42.5  Assert role DB : roadsen_app a rolbypassrls=false ET rolsuper=false.
 *   PIEGE  PROD-LIKE (modele 0007, SANS BYPASSRLS) : login (auth_find_user_by_email)
 *          et provisioning (provision_org) fonctionnent SANS app.current_org pose,
 *          car les fonctions DEFINER posent le drapeau fail-closed
 *          app.auth_bootstrap qui ouvre la branche RLS d'IDENTITE — plus aucun
 *          role BYPASSRLS. On prouve aussi qu'aucun role auth dedie ne bypasse la
 *          RLS (roadsen_auth supprime). Preuve sous owner NON-superuser SIMULE :
 *          voir rls-no-bypassrls.e2e-spec.ts.
 *
 * Connexions (cf. rls-isolation.e2e-spec.ts) :
 *   - ADMIN_URL  = DATABASE_URL (superuser roadsen) : seed/teardown uniquement.
 *   - APP_URL    = RLS_TEST_DATABASE_URL (roadsen_app, NOBYPASSRLS) : assertions.
 *
 * ANTI-SKIP identique aux autres specs : en CI / des qu'une URL est fournie,
 * une base injoignable = ECHEC DUR (pas de faux-vert).
 */
import { randomUUID } from 'node:crypto';

type PgClient = {
  connect: () => Promise<void>;
  query: <R = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: R[] }>;
  end: () => Promise<void>;
};

const APP_URL =
  process.env.RLS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
const ADMIN_URL = process.env.DATABASE_URL ?? '';
const ENFORCE =
  process.env.CI === 'true' || APP_URL.length > 0 || ADMIN_URL.length > 0;

function loadPgClient(): new (cfg: { connectionString: string }) => PgClient {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pg = require('pg') as {
      Client: new (cfg: { connectionString: string }) => PgClient;
    };
    return pg.Client;
  } catch {
    throw new Error(
      "Dependance 'pg' introuvable : le test fail-closed ne peut pas se connecter.",
    );
  }
}

async function connectAs(url: string, label: string): Promise<PgClient> {
  if (!url) {
    throw new Error(
      `${label} absent : impossible de prouver le fail-closed. En CI, fournir ` +
        'DATABASE_URL (superuser) ET RLS_TEST_DATABASE_URL (roadsen_app).',
    );
  }
  const Client = loadPgClient();
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

describe('Durcissement isolation #42 — fail-closed bruyant + non-fuite pool', () => {
  let admin: PgClient | null = null; // seed/teardown : superuser
  let app: PgClient | null = null; // assertions : roadsen_app, NOBYPASSRLS
  let connectError: Error | null = null;
  let passedCases = 0;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const emailA = `fc-a-${userA.slice(0, 8)}@roadsen.test`;
  // Users SANS appartenance pour les tests provision_org : depuis la migration
  // 0020 (« un utilisateur = une org », decision titulaire 07/07), provisionner
  // une org pour un user DEJA membre est refuse — chaque test prend le sien.
  const userFreeP = randomUUID(); // #42.PIEGE
  const userFreeL = randomUUID(); // CRITIQUE-1 (transactions rollback)

  beforeAll(async () => {
    try {
      admin = await connectAs(ADMIN_URL, 'DATABASE_URL (seed/superuser)');
      app = await connectAs(APP_URL, 'RLS_TEST_DATABASE_URL (roadsen_app)');
    } catch (err) {
      connectError = err as Error;
      if (ENFORCE) throw connectError;
      return;
    }

    // Seed via superuser (bypasse RLS) : graphe 2 tenants.
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at)
       VALUES ($1,$2,'hash-A','User A',now())`,
      [userA, emailA],
    );
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at)
       VALUES ($1,$2,'hash-B','User B',now())`,
      [userB, `fc-b-${userB.slice(0, 8)}@roadsen.test`],
    );
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at)
       VALUES ($1,$2,'hash-P','User Free P',now()), ($3,$4,'hash-L','User Free L',now())`,
      [
        userFreeP,
        `fc-p-${userFreeP.slice(0, 8)}@roadsen.test`,
        userFreeL,
        `fc-l-${userFreeL.slice(0, 8)}@roadsen.test`,
      ],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,'Org A',$2,now())`,
      [orgA, `fc-org-a-${orgA.slice(0, 8)}`],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,'Org B',$2,now())`,
      [orgB, `fc-org-b-${orgB.slice(0, 8)}`],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES ($1,$2,$3,'OWNER')`,
      [randomUUID(), orgA, userA],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES ($1,$2,$3,'OWNER')`,
      [randomUUID(), orgB, userB],
    );
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, updated_at) VALUES ($1,$2,'P-A',$3,now())`,
      [randomUUID(), orgA, userA],
    );
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, updated_at) VALUES ($1,$2,'P-B',$3,now())`,
      [randomUUID(), orgB, userB],
    );
  });

  afterAll(async () => {
    if (admin) {
      try {
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
        await admin.query(`DELETE FROM users WHERE id IN ($1,$2,$3,$4)`, [
          userA,
          userB,
          userFreeP,
          userFreeL,
        ]);
      } finally {
        await admin.end();
      }
    }
    if (app) await app.end();
  });

  const guarded = (name: string, fn: () => Promise<void>) => {
    it(name, async () => {
      if (!app || !admin) {
        if (ENFORCE) {
          throw (
            connectError ?? new Error(`Base RLS non joignable en CI : ${name}.`)
          );
        }
        console.warn(`[NON EXECUTE] ${name} — aucune base RLS joignable.`);
        return;
      }
      await fn();
      passedCases += 1;
    });
  };

  // --- #42.5 — assertions sur les attributs des roles DB ---------------------

  guarded(
    '#42.5 roadsen_app : rolbypassrls=false ET rolsuper=false',
    async () => {
      // Le role qui pose les assertions DOIT etre soumis a la RLS. S'il bypassait
      // ou etait superuser, tous les autres tests seraient des faux-verts.
      const { rows } = await admin!.query<{
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'roadsen_app'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].rolsuper).toBe(false);
      expect(rows[0].rolbypassrls).toBe(false);
    },
  );

  guarded(
    '#42.PIEGE (0007) roadsen_auth existe mais NON-BYPASSRLS, NON super, NOLOGIN',
    async () => {
      // MODELE 0007 (correctif B1) : roadsen_auth est CONSERVE comme owner des
      // DEFINER et SEUL detenteur du DML identite, mais il N'A PLUS BYPASSRLS
      // (l'attribut incompatible avec le Postgres managed Render). Le bypass de la
      // RLS d'identite vient desormais du drapeau app.auth_bootstrap + du privilege
      // de table de roadsen_auth, JAMAIS de BYPASSRLS.
      const { rows } = await admin!.query<{
        rolcanlogin: boolean;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(
        `SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'roadsen_auth'`,
      );
      expect(rows).toHaveLength(1); // le role existe (owner des DEFINER)
      expect(rows[0].rolbypassrls).toBe(false); // CLE : plus aucun BYPASSRLS
      expect(rows[0].rolsuper).toBe(false);
      expect(rows[0].rolcanlogin).toBe(false); // NOLOGIN : pas une surface
    },
  );

  guarded(
    '#42.PIEGE (0007) DEFINER owned par roadsen_auth (NON-bypass) ; roadsen_app SANS DML identite',
    async () => {
      // 1) les 6 DEFINER sont owned par roadsen_auth, dont l'owner N'EST PAS bypass.
      const { rows } = await admin!.query<{
        proname: string;
        owner: string;
        owner_bypassrls: boolean;
      }>(
        `SELECT p.proname, r.rolname AS owner, r.rolbypassrls AS owner_bypassrls
         FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
         WHERE p.proname IN (
           'provision_org','provision_user','auth_find_user_by_email',
           'auth_user_has_membership','auth_get_platform_role','auth_get_user_profile'
         )
         ORDER BY p.proname`,
      );
      // Depuis 0014, provision_org / provision_user ont une SURCHARGE 4-args auditee (en
      // plus de la 3-args) : la requete par NOM renvoie donc >= 6 lignes. On verifie que
      // les 6 fonctions attendues sont TOUTES presentes (au moins une surcharge) ET que
      // CHAQUE surcharge (toutes arites) est owned roadsen_auth NON-bypass — c'est la
      // propriete de securite, insensible au nombre de surcharges.
      const distinctNames = [...new Set(rows.map((r) => r.proname))].sort();
      expect(distinctNames).toEqual(
        [
          'auth_find_user_by_email',
          'auth_get_platform_role',
          'auth_get_user_profile',
          'auth_user_has_membership',
          'provision_org',
          'provision_user',
        ].sort(),
      );
      expect(rows.length).toBeGreaterThanOrEqual(6);
      for (const row of rows) {
        expect(row.owner).toBe('roadsen_auth');
        expect(row.owner_bypassrls).toBe(false); // owner NON-bypass : barriere reelle
      }

      // 2) BARRIERE 1 : roadsen_app n'a AUCUN privilege DML sur les 3 tables
      //    d'identite (sinon poser le drapeau lui suffirait a lire les hashes).
      const { rows: priv } = await admin!.query<{ tbl: string; has: boolean }>(
        `SELECT t.tbl,
                bool_or(
                  has_table_privilege('roadsen_app', t.tbl, 'SELECT') OR
                  has_table_privilege('roadsen_app', t.tbl, 'INSERT') OR
                  has_table_privilege('roadsen_app', t.tbl, 'UPDATE') OR
                  has_table_privilege('roadsen_app', t.tbl, 'DELETE')
                ) AS has
         FROM (VALUES ('users'),('memberships'),('organizations')) AS t(tbl)
         GROUP BY t.tbl`,
      );
      expect(priv).toHaveLength(3);
      for (const p of priv) {
        expect(p.has).toBe(false); // roadsen_app : zero DML sur l'identite
      }
    },
  );

  // --- #42.3 — SET LOCAL absent -> RAISE (fail-closed BRUYANT) ----------------

  guarded(
    '#42.3 projects : SANS app.current_org -> ECHOUE (RAISE), pas "0 ligne"',
    async () => {
      await app!.query(`RESET app.current_org`);
      // Comportement 0004 : la policy appelle app_current_org() qui RAISE.
      await expect(app!.query('SELECT * FROM projects')).rejects.toThrow(
        /app\.current_org non defini/i,
      );
    },
  );

  guarded(
    '#42.3 app_current_org() seule : RAISE explicite si GUC vide',
    async () => {
      await app!.query(`SET app.current_org = ''`);
      await expect(app!.query('SELECT app_current_org()')).rejects.toThrow(
        /app\.current_org non defini/i,
      );
      await app!.query(`RESET app.current_org`);
    },
  );

  // --- #42.2 — RLS SEULE bloque le cross-tenant (aucun guard applicatif) ------

  guarded(
    '#42.2 RLS seule : sous org A, jamais une ligne de B (SELECT)',
    async () => {
      // En pg brut, AUCUN guard NestJS n'intervient : seul l'effet est la RLS.
      await app!.query(`SET app.current_org = '${orgA}'`);
      const { rows } = await app!.query<{ org_id: string }>(
        'SELECT org_id FROM projects',
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.org_id === orgA)).toBe(true);
    },
  );

  guarded(
    '#42.2 RLS seule : INSERT cross-org refuse (WITH CHECK), aucun guard',
    async () => {
      await app!.query(`SET app.current_org = '${orgA}'`);
      await expect(
        app!.query(
          `INSERT INTO projects (id, org_id, name, created_by_id, updated_at) VALUES ($1,$2,'fraude',$3,now())`,
          [randomUUID(), orgB, userA],
        ),
      ).rejects.toThrow();
      await app!.query(`RESET app.current_org`);
    },
  );

  // --- #42.4 — non-fuite SET LOCAL entre transactions du POOL -----------------

  guarded(
    '#42.4 pool : SET LOCAL org A en tx A ne fuit pas vers tx B (org B) — meme connexion',
    async () => {
      // Une connexion physique unique (app), reutilisee sequentiellement par 2
      // transactions. SET LOCAL est borne a la transaction : apres COMMIT de A,
      // le contexte ne doit PAS persister dans B.
      //
      // Modele PgBouncer (transaction pooling) : chaque transaction recoit une
      // connexion potentiellement deja utilisee. La garantie repose sur SET LOCAL
      // (portee transaction) + le RAISE de 0004 si une tx oublie de poser le GUC.
      // Ici on teste sur le pool pg natif : meme connexion, transactions
      // successives. (PgBouncer reel : documente en commentaire, non installe.)

      // Transaction A : pose org A, lit ses projets.
      await app!.query('BEGIN');
      await app!.query(`SET LOCAL app.current_org = '${orgA}'`);
      const a = await app!.query<{ org_id: string }>(
        'SELECT org_id FROM projects',
      );
      expect(a.rows.every((r) => r.org_id === orgA)).toBe(true);
      await app!.query('COMMIT');

      // Transaction B sur la MEME connexion : SI le contexte de A avait fuite,
      // B verrait encore A. Mais SET LOCAL est borne a A -> sans nouveau SET LOCAL,
      // B n'a AUCUN contexte -> RAISE (fail-closed bruyant 0004). C'est la preuve
      // forte de non-fuite : B ne "herite" pas de A, et l'absence est detectee.
      await app!.query('BEGIN');
      await expect(app!.query('SELECT org_id FROM projects')).rejects.toThrow(
        /app\.current_org non defini/i,
      );
      await app!.query('ROLLBACK');

      // Et avec un SET LOCAL explicite vers B en tx B : on ne voit QUE B, jamais A.
      await app!.query('BEGIN');
      await app!.query(`SET LOCAL app.current_org = '${orgB}'`);
      const b = await app!.query<{ org_id: string }>(
        'SELECT org_id FROM projects',
      );
      expect(b.rows.length).toBeGreaterThan(0);
      expect(b.rows.every((r) => r.org_id === orgB)).toBe(true);
      expect(b.rows.some((r) => r.org_id === orgA)).toBe(false);
      await app!.query('COMMIT');
    },
  );

  // --- #42.PIEGE — login & provisioning OK malgre le RAISE (prod-safe) --------

  guarded(
    '#42.PIEGE login : auth_find_user_by_email marche SANS app.current_org',
    async () => {
      // Le coeur du piege : cette lecture a lieu AVANT tout contexte tenant.
      // Sous roadsen_app (NOBYPASSRLS), elle marche parce que la fonction DEFINER
      // pose le drapeau fail-closed app.auth_bootstrap (modele 0007), qui ouvre la
      // branche RLS d'identite — SANS aucun role BYPASSRLS. Si le RAISE / le
      // drapeau avait casse l'auth, ce test echouerait (0 ligne ou exception).
      await app!.query(`RESET app.current_org`);
      const { rows } = await app!.query<{ id: string }>(
        `SELECT id FROM auth_find_user_by_email($1)`,
        [emailA],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(userA);
    },
  );

  guarded(
    '#42.PIEGE membership lookup : auth_user_has_membership marche SANS contexte',
    async () => {
      await app!.query(`RESET app.current_org`);
      const { rows } = await app!.query<{ role: string }>(
        `SELECT role FROM auth_user_has_membership($1::uuid, $2::uuid)`,
        [userA, orgA],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].role).toBe('OWNER');
      // cross : userA n'est PAS membre de orgB -> aucune ligne (pas de fuite)
      const cross = await app!.query(
        `SELECT role FROM auth_user_has_membership($1::uuid, $2::uuid)`,
        [userA, orgB],
      );
      expect(cross.rows).toHaveLength(0);
    },
  );

  guarded(
    '#42.PIEGE provision_org : creation org+OWNER marche SANS app.current_org',
    async () => {
      // provision_org pose lui-meme app.current_org (SET LOCAL interne) ET le
      // drapeau app.auth_bootstrap (modele 0007) : il fonctionne a froid SANS
      // BYPASSRLS. Preuve que le bootstrap tient sous owner non-bypass.
      //
      // NB (durcissement 0014 §7) : la surcharge 3-args de provision_org n'est PLUS
      // EXECUTABLE par roadsen_app (REVOKE) — le runtime passe par la 4-args AUDITEE.
      // On teste donc la 4-args, qui delegue au MEME corps 3-args (comportement de
      // contexte identique) et trace un ORG_PROVISIONED (nettoye ci-dessous).
      await app!.query(`RESET app.current_org`);
      const slug = `fc-prov-${randomUUID().slice(0, 8)}`;
      const { rows } = await app!.query<{ provision_org: string }>(
        `SELECT provision_org('Org Provisionnee', $1, $2::uuid, $3::uuid) AS provision_org`,
        [slug, userFreeP, userFreeP],
      );
      expect(rows).toHaveLength(1);
      const newOrg = rows[0].provision_org;
      expect(typeof newOrg).toBe('string');

      // Verifie cote superuser que l'org ET le membership OWNER existent bien.
      const check = await admin!.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM memberships WHERE org_id = $1 AND role = 'OWNER'`,
        [newOrg],
      );
      expect(check.rows[0].n).toBe('1');

      // teardown de l'org provisionnee + sa trace d'audit (admin_audit_log APPEND-ONLY :
      // desactiver les triggers le temps du nettoyage, cf. patron admin-dashboard).
      await admin!.query(`ALTER TABLE admin_audit_log DISABLE TRIGGER USER`);
      try {
        await admin!.query(
          `DELETE FROM admin_audit_log WHERE target_org_id = $1`,
          [newOrg],
        );
      } finally {
        await admin!.query(`ALTER TABLE admin_audit_log ENABLE TRIGGER USER`);
      }
      await admin!.query(`DELETE FROM memberships WHERE org_id = $1`, [newOrg]);
      await admin!.query(`DELETE FROM organizations WHERE id = $1`, [newOrg]);
    },
  );

  // --- CRITIQUE-1 (revue adverse) — provision_org ne FUIT PAS le contexte -----

  guarded(
    "CRITIQUE-1 provision_org : dans UNE transaction, ne fuit PAS le contexte de l'org creee",
    async () => {
      // set_config(..., is_local=true) est TRANSACTION-local, PAS function-local :
      // avant le fix, le GUC pose par provision_org restait actif pour le reste de
      // la transaction appelante -> les requetes suivantes voyaient l'org fabriquee
      // (cross-tenant hors TenantGuard). Le fix capture/restaure le contexte.
      //
      // CAS A : aucun contexte prealable -> apres provision_org, une requete tenant
      // DOIT RAISE (contexte restaure a vide), et surtout NE PAS retourner les
      // lignes de l'org creee.
      // 4-args AUDITEE (la 3-args n'est plus EXECUTABLE par roadsen_app, cf. 0014 §7) ;
      // meme corps 3-args -> meme semantique de contexte. Transaction ROLLBACK -> la
      // trace d'audit est annulee avec le reste (aucun nettoyage requis).
      await app!.query('BEGIN');
      const slug = `fc-leak-${randomUUID().slice(0, 8)}`;
      const created = await app!.query<{ provision_org: string }>(
        `SELECT provision_org('Org Leak', $1, $2::uuid, $3::uuid) AS provision_org`,
        [slug, userFreeL, userFreeL],
      );
      const newOrg = created.rows[0].provision_org;
      // Le contexte ne doit PAS avoir fui : app_current_org() RAISE (restaure vide).
      await expect(app!.query('SELECT app_current_org()')).rejects.toThrow(
        /app\.current_org non defini/i,
      );
      await app!.query('ROLLBACK');

      // CAS B : un contexte prealable (orgA) est pose AVANT l'appel. Apres
      // provision_org, le contexte DOIT etre restaure a orgA (et NON la nouvelle
      // org). On le prouve en lisant les projets : on revoit ceux de orgA.
      await app!.query('BEGIN');
      await app!.query(`SET LOCAL app.current_org = '${orgA}'`);
      const slugB = `fc-leak-b-${randomUUID().slice(0, 8)}`;
      await app!.query(
        `SELECT provision_org('Org Leak B', $1, $2::uuid, $3::uuid)`,
        [slugB, userFreeL, userFreeL],
      );
      // Contexte restaure a orgA : app_current_org() == orgA, pas la nouvelle org.
      const ctx = await app!.query<{ app_current_org: string }>(
        'SELECT app_current_org()',
      );
      expect(ctx.rows[0].app_current_org).toBe(orgA);
      // Et une lecture tenant ne voit QUE orgA (jamais l'org fabriquee).
      const proj = await app!.query<{ org_id: string }>(
        'SELECT org_id FROM projects',
      );
      expect(proj.rows.every((r) => r.org_id === orgA)).toBe(true);
      await app!.query('ROLLBACK');

      // teardown des orgs creees (le ROLLBACK ci-dessus annule CAS B ; CAS A a
      // aussi ete rollback -> rien a nettoyer cote orgs, mais on s'assure par
      // securite que rien ne subsiste si la semantique evoluait).
      await admin!.query(`DELETE FROM memberships WHERE org_id = $1`, [newOrg]);
      await admin!.query(`DELETE FROM organizations WHERE id = $1`, [newOrg]);
    },
  );

  // GARDE-FOU ANTI-FAUX-VERT : on EXIGE qu'au moins 11 cas aient reellement passe
  // (2 roles + 1 owner + 2 RAISE + 2 RLS-seule + 1 pool + 3 piege + 1 critique-1
  // = 12 ; seuil 11 = marge).
  it('couverture #42 : >= 11 cas reellement executes (en CI/avec URL)', () => {
    if (!ENFORCE) {
      console.warn('[NON EXECUTE] couverture #42 ignoree hors CI et sans URL.');
      return;
    }
    expect(passedCases).toBeGreaterThanOrEqual(11);
  });
});
