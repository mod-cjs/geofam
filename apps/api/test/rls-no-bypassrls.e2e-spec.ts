/**
 * Test d'ISOLATION — MODELE SANS BYPASSRLS (migration 0007), PROD-LIKE Render.
 *
 * OBJET
 * -----
 * Prouver, sur une base PostgreSQL REELLE, que le modele 0007 (DEUX barrieres :
 * privilege de table par-role + drapeau fail-closed app.auth_bootstrap, AUCUN
 * BYPASSRLS) tient :
 *   (a) login / provisioning / membership-lookup fonctionnent SANS contexte tenant ;
 *   (b) un tenant A ne lit/ecrit JAMAIS chez B (SELECT/INSERT/UPDATE/DELETE) ;
 *   (c) fail-closed bruyant si app.current_org absent HORS chemin d'auth (donnees) ;
 *   (B2) NEGATIF — le runtime (sans privilege identite) qui POSE le drapeau ne lit
 *        AUCUN hash/identite d'un autre tenant : refus de privilege / 0 ligne ;
 *   (M1) le drapeau est tx-local : une DEFINER d'auth appelee dans une tx explicite
 *        ne laisse PAS le drapeau 'on' pour une requete metier suivante de la MEME tx ;
 *   (e) aucun role BYPASSRLS ; roadsen_auth (s'il existe) est NON-BYPASSRLS.
 *
 * SIMULATION RENDER — DEUX ROLES (correctif revue adverse B1)
 * ----------------------------------------------------------
 * Les e2e existants seedent en SUPERUSER, ce qui MASQUE le bug Render (un DEFINER
 * owned par un superuser bypasse la RLS gratuitement). ICI, fidele a Render et au
 * modele 0007, on cree DEUX roles NON-superuser, NON-BYPASSRLS :
 *   - OWNER `render_owner` : proprietaire des tables + des 6 DEFINER. SEUL a
 *     detenir le DML sur l'IDENTITE (users/memberships/organizations). C'est le
 *     role managed Render (CREATEROLE, mais ni superuser ni BYPASSRLS).
 *   - RUNTIME `render_app` : le role applicatif. DML sur les DONNEES (projects)
 *     SEULEMENT ; AUCUN privilege sur l'identite. EXECUTE sur les DEFINER.
 * TOUTES les assertions metier/fuite s'executent SOUS render_app (SET ROLE), le
 * role reellement soumis a la RLS et DEPOURVU de privilege identite — la seule
 * configuration qui prouve que le drapeau seul ne suffit pas (barriere 1).
 *
 * Schema de test DEDIE `rls0007` possede par render_owner : sous-ensemble minimal
 * reproduisant EXACTEMENT le modele 0007 (RLS FORCE, helpers, policies branche-
 * drapeau sur l'identite, org-scope strict sur les donnees, DEFINER owned par
 * render_owner, GRANTs separes). Autoportant et reproductible.
 *
 * SETUP_URL = RLS_SETUP_DATABASE_URL ?? DATABASE_URL : role d'amorcage (doit
 * pouvoir CREATE ROLE + SET ROLE vers render_owner/render_app). En local docker,
 * DATABASE_URL (superuser) convient pour l'AMORCAGE ; les ASSERTIONS, elles, ne
 * s'executent JAMAIS en superuser.
 *
 * ANTI-SKIP : en CI / des qu'une URL est fournie, base injoignable = ECHEC DUR.
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
type PgCtor = new (cfg: { connectionString: string }) => PgClient;

const SETUP_URL =
  process.env.RLS_SETUP_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
const ENFORCE = process.env.CI === 'true' || SETUP_URL.length > 0;

function loadPg(): PgCtor {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('pg') as { Client: PgCtor }).Client;
  } catch {
    throw new Error(
      "Dependance 'pg' introuvable (devDependency @roadsen/api).",
    );
  }
}

const SCHEMA = 'rls0007';
const OWNER = 'render_owner'; // DEFINER owner + privilege identite (BARRIERE 1)
const APP = 'render_app'; // runtime : DONNEES seulement, AUCUN privilege identite

/**
 * DDL du schema de test : modele 0007 en miniature, possede par render_owner.
 * GRANTs SEPARES : identite -> render_owner UNIQUEMENT ; donnees -> render_app.
 */
function ddl(): string {
  return `
    DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;
    CREATE SCHEMA ${SCHEMA} AUTHORIZATION ${OWNER};

    SET ROLE ${OWNER};
    SET search_path = ${SCHEMA}, pg_catalog;

    CREATE TABLE organizations (
      id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      slug text NOT NULL UNIQUE
    );
    CREATE TABLE users (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email         text NOT NULL UNIQUE,
      password_hash text,
      full_name     text
    );
    CREATE TABLE memberships (
      id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role    text NOT NULL,
      UNIQUE (org_id, user_id)
    );
    CREATE TABLE projects (
      id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name   text NOT NULL
    );

    -- helpers (0004 + 0007)
    CREATE FUNCTION app_current_org() RETURNS uuid
      LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $f$
      DECLARE v text := current_setting('app.current_org', true);
      BEGIN
        IF v IS NULL OR length(btrim(v)) = 0 THEN
          RAISE EXCEPTION 'app.current_org non defini' USING ERRCODE = 'R0001';
        END IF;
        RETURN v::uuid;
      END; $f$;
    CREATE FUNCTION app_current_org_or_null() RETURNS uuid
      LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $f$
      DECLARE v text := current_setting('app.current_org', true);
      BEGIN IF v IS NULL OR length(btrim(v)) = 0 THEN RETURN NULL; END IF; RETURN v::uuid; END; $f$;
    CREATE FUNCTION app_auth_bootstrap() RETURNS boolean
      LANGUAGE plpgsql STABLE SET search_path = pg_catalog AS $f$
      DECLARE v text := current_setting('app.auth_bootstrap', true);
      BEGIN RETURN v IS NOT NULL AND v = 'on'; END; $f$;

    ALTER TABLE organizations ENABLE ROW LEVEL SECURITY; ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
    ALTER TABLE users         ENABLE ROW LEVEL SECURITY; ALTER TABLE users         FORCE ROW LEVEL SECURITY;
    ALTER TABLE memberships   ENABLE ROW LEVEL SECURITY; ALTER TABLE memberships   FORCE ROW LEVEL SECURITY;
    ALTER TABLE projects      ENABLE ROW LEVEL SECURITY; ALTER TABLE projects      FORCE ROW LEVEL SECURITY;

    -- IDENTITE : org-scope (silencieux) OR drapeau d'auth
    CREATE POLICY ti ON organizations
      USING (id = app_current_org_or_null() OR app_auth_bootstrap())
      WITH CHECK (id = app_current_org_or_null() OR app_auth_bootstrap());
    CREATE POLICY ti ON memberships
      USING (org_id = app_current_org_or_null() OR app_auth_bootstrap())
      WITH CHECK (org_id = app_current_org_or_null() OR app_auth_bootstrap());
    CREATE POLICY ti ON users
      USING (app_auth_bootstrap() OR EXISTS (
        SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.org_id = app_current_org_or_null()))
      WITH CHECK (app_auth_bootstrap() OR EXISTS (
        SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.org_id = app_current_org_or_null()));
    -- DONNEES : org-scope BRUYANT SEUL (aucun drapeau)
    CREATE POLICY ti ON projects USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org());

    -- DEFINER owned par render_owner (qui DETIENT le DML identite) + drapeau.
    CREATE FUNCTION provision_user(p_email text, p_hash text) RETURNS uuid
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = ${SCHEMA}, pg_catalog AS $f$
      DECLARE v_id uuid := gen_random_uuid();
      BEGIN PERFORM set_config('app.auth_bootstrap','on',true);
        INSERT INTO users(id,email,password_hash,full_name)
        VALUES (v_id, lower(btrim(p_email)), p_hash, 'Nom ' || lower(btrim(p_email)));
        PERFORM set_config('app.auth_bootstrap','off',true); RETURN v_id;
      EXCEPTION WHEN OTHERS THEN PERFORM set_config('app.auth_bootstrap','off',true); RAISE; END; $f$;

    CREATE FUNCTION auth_find_user_by_email(p_email text)
      RETURNS TABLE(id uuid, password_hash text)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ${SCHEMA}, pg_catalog AS $f$
      BEGIN PERFORM set_config('app.auth_bootstrap','on',true);
        RETURN QUERY SELECT u.id, u.password_hash FROM users u WHERE u.email = lower(btrim(p_email)) LIMIT 1;
        PERFORM set_config('app.auth_bootstrap','off',true);
      EXCEPTION WHEN OTHERS THEN PERFORM set_config('app.auth_bootstrap','off',true); RAISE; END; $f$;

    CREATE FUNCTION auth_user_has_membership(p_user uuid, p_org uuid)
      RETURNS TABLE(role text)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ${SCHEMA}, pg_catalog AS $f$
      BEGIN PERFORM set_config('app.auth_bootstrap','on',true);
        RETURN QUERY SELECT m.role FROM memberships m WHERE m.user_id = p_user AND m.org_id = p_org LIMIT 1;
        PERFORM set_config('app.auth_bootstrap','off',true);
      EXCEPTION WHEN OTHERS THEN PERFORM set_config('app.auth_bootstrap','off',true); RAISE; END; $f$;

    CREATE FUNCTION provision_org(p_name text, p_slug text, p_owner uuid) RETURNS uuid
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = ${SCHEMA}, pg_catalog AS $f$
      DECLARE v_org uuid := gen_random_uuid(); v_prev text := COALESCE(current_setting('app.current_org', true), '');
      BEGIN PERFORM set_config('app.auth_bootstrap','on',true); PERFORM set_config('app.current_org', v_org::text, true);
        INSERT INTO organizations(id,name,slug) VALUES (v_org, p_name, p_slug);
        INSERT INTO memberships(org_id,user_id,role) VALUES (v_org, p_owner, 'OWNER');
        PERFORM set_config('app.current_org', v_prev, true);
        PERFORM set_config('app.auth_bootstrap','off',true); RETURN v_org;
      EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('app.current_org', v_prev, true);
        PERFORM set_config('app.auth_bootstrap','off',true); RAISE; END; $f$;

    -- pv_emitter_context : identite a sceller dans un PV (org slug/nom + nom emetteur).
    CREATE FUNCTION pv_emitter_context(p_org uuid, p_user uuid)
      RETURNS TABLE(org_slug text, org_name text, emitter_full_name text)
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ${SCHEMA}, pg_catalog AS $f$
      BEGIN PERFORM set_config('app.auth_bootstrap','on',true);
        RETURN QUERY SELECT o.slug, o.name, u.full_name FROM organizations o
                     CROSS JOIN users u WHERE o.id = p_org AND u.id = p_user LIMIT 1;
        PERFORM set_config('app.auth_bootstrap','off',true);
      EXCEPTION WHEN OTHERS THEN PERFORM set_config('app.auth_bootstrap','off',true); RAISE; END; $f$;

    -- ===== GRANTs SEPARES (coeur de la barriere par-role B1) =====
    GRANT USAGE ON SCHEMA ${SCHEMA} TO ${APP};
    -- render_app : DONNEES seulement, AUCUN privilege sur l'identite.
    GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO ${APP};
    -- EXECUTE des DEFINER pour render_app (le runtime appelle login/provision/PV).
    GRANT EXECUTE ON FUNCTION provision_user(text,text)          TO ${APP};
    GRANT EXECUTE ON FUNCTION auth_find_user_by_email(text)      TO ${APP};
    GRANT EXECUTE ON FUNCTION auth_user_has_membership(uuid,uuid) TO ${APP};
    GRANT EXECUTE ON FUNCTION provision_org(text,text,uuid)      TO ${APP};
    GRANT EXECUTE ON FUNCTION pv_emitter_context(uuid,uuid)      TO ${APP};
    GRANT EXECUTE ON FUNCTION app_current_org()                  TO ${APP};
    GRANT EXECUTE ON FUNCTION app_current_org_or_null()          TO ${APP};
    GRANT EXECUTE ON FUNCTION app_auth_bootstrap()               TO ${APP};
    -- NOTE : on n'accorde A render_app AUCUN droit sur users/memberships/
    -- organizations -> meme drapeau pose, il bute sur le manque de privilege.

    RESET ROLE;

    -- SCENARIO MONO-UTILISATEUR (#42 runtime) : render_owner (= la connexion qui
    -- POSSEDE les tables) est rendu MEMBRE de render_app pour pouvoir SET ROLE
    -- render_app au runtime (comme le user managed Render bascule en roadsen_app).
    -- PG16 : CREATEROLE ne confere plus l'ADMIN OPTION implicite -> ce GRANT de
    -- MEMBERSHIP doit s'executer sous la connexion d'AMORCAGE (qui a cree
    -- render_app et en detient l'admin : superuser local / owner Render), donc
    -- APRES RESET ROLE — sous SET ROLE render_owner il echoue en "permission
    -- denied to grant role" depuis postgres:16.
    GRANT ${APP} TO ${OWNER};
  `;
}

describe('Modele SANS BYPASSRLS — 2 barrieres prouvees sous owner+runtime NON-superuser (0007)', () => {
  let setup: PgClient | null = null;
  let connectError: Error | null = null;
  let passed = 0;

  beforeAll(async () => {
    if (!SETUP_URL) {
      if (ENFORCE)
        throw new Error(
          'RLS_SETUP_DATABASE_URL/DATABASE_URL requis (preuve 0007).',
        );
      return;
    }
    try {
      const Client = loadPg();
      setup = new Client({ connectionString: SETUP_URL });
      await setup.connect();

      for (const r of [OWNER, APP]) {
        const extra = r === OWNER ? 'CREATEROLE' : '';
        await setup.query(`DO $$
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${r}') THEN
              CREATE ROLE ${r} LOGIN ${extra} NOSUPERUSER NOBYPASSRLS;
            ELSE
              ALTER ROLE ${r} LOGIN NOSUPERUSER NOBYPASSRLS;
            END IF;
          END $$;`);
        await setup.query(
          `DO $$ BEGIN BEGIN GRANT ${r} TO CURRENT_USER; EXCEPTION WHEN OTHERS THEN NULL; END; END $$;`,
        );
      }
      await setup.query(ddl());
    } catch (err) {
      connectError = err as Error;
      if (ENFORCE) throw connectError;
      setup = null;
    }
  });

  afterAll(async () => {
    if (setup) {
      try {
        await setup.query(`RESET ROLE`);
        await setup.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      } finally {
        await setup.end();
      }
    }
  });

  /** Execute fn SOUS le role donne (SET ROLE), search_path sur le schema de test. */
  async function asRole(
    role: string,
    fn: (c: PgClient) => Promise<void>,
  ): Promise<void> {
    await setup!.query(`SET ROLE ${role}`);
    await setup!.query(`SET search_path = ${SCHEMA}, pg_catalog`);
    try {
      await fn(setup!);
    } finally {
      await setup!.query(`RESET ROLE`);
      await setup!.query(`RESET app.current_org`);
      await setup!.query(`RESET app.auth_bootstrap`);
    }
  }

  const guarded = (name: string, fn: () => Promise<void>) => {
    it(name, async () => {
      if (!setup) {
        if (ENFORCE)
          throw (
            connectError ??
            new Error(`Base non joignable : ${name} non prouve.`)
          );
        console.warn(`[NON EXECUTE] ${name} — aucune base (hors CI).`);
        return;
      }
      await fn();
      passed += 1;
    });
  };

  // ----- (e) aucun BYPASSRLS -------------------------------------------------
  guarded(
    'e) ni render_owner ni render_app ne bypassent/superusent ; roadsen_auth jamais bypass',
    async () => {
      const { rows } = await setup!.query<{
        rolname: string;
        rolbypassrls: boolean;
        rolsuper: boolean;
      }>(
        `SELECT rolname, rolbypassrls, rolsuper FROM pg_roles
       WHERE rolname IN ('${OWNER}','${APP}','roadsen_auth')`,
      );
      for (const r of rows) {
        expect(r.rolbypassrls).toBe(false);
        expect(r.rolsuper).toBe(false);
      }
      // render_owner et render_app DOIVENT exister et etre non-bypass (sinon faux-vert).
      expect(rows.some((r) => r.rolname === OWNER)).toBe(true);
      expect(rows.some((r) => r.rolname === APP)).toBe(true);
    },
  );

  // ----- (a) provisioning + login + membership-lookup a froid SOUS render_app -
  guarded(
    'a) provision/login/membership-lookup marchent SANS contexte, sous runtime non-privilegie',
    async () => {
      await asRole(APP, async (c) => {
        const uA = (
          await c.query<{ p: string }>(`SELECT provision_user($1,$2) AS p`, [
            'alice@x.test',
            'hash-A',
          ])
        ).rows[0].p;
        expect(uA).toMatch(/^[0-9a-f-]{36}$/);
        const orgA = (
          await c.query<{ p: string }>(`SELECT provision_org($1,$2,$3) AS p`, [
            'A',
            'org-a',
            uA,
          ])
        ).rows[0].p;
        expect(orgA).toMatch(/^[0-9a-f-]{36}$/);

        // login a froid via DEFINER (render_app n'a PAS de SELECT direct sur users).
        const found = await c.query<{ id: string; password_hash: string }>(
          `SELECT id, password_hash FROM auth_find_user_by_email($1)`,
          ['alice@x.test'],
        );
        expect(found.rows).toHaveLength(1);
        expect(found.rows[0].id).toBe(uA);
        expect(found.rows[0].password_hash).toBe('hash-A');

        // M2 : membership-lookup a froid (TenantGuard) via DEFINER.
        const mem = await c.query<{ role: string }>(
          `SELECT role FROM auth_user_has_membership($1::uuid,$2::uuid)`,
          [uA, orgA],
        );
        expect(mem.rows).toHaveLength(1);
        expect(mem.rows[0].role).toBe('OWNER');
        // cross : uA n'est pas membre d'une autre org -> 0 ligne (pas de fuite).
        const cross = await c.query(
          `SELECT role FROM auth_user_has_membership($1::uuid,$2::uuid)`,
          [uA, randomUUID()],
        );
        expect(cross.rows).toHaveLength(0);
      });
    },
  );

  // ----- (b) + (c) isolation stricte + fail-closed bruyant, SOUS render_app --
  guarded(
    'b/c) deux tenants : aucune fuite (SELECT/INSERT/UPDATE/DELETE) + fail-closed donnees',
    async () => {
      await asRole(APP, async (c) => {
        const uA = (
          await c.query<{ p: string }>(`SELECT provision_user($1,$2) AS p`, [
            'a2@x.test',
            'hA',
          ])
        ).rows[0].p;
        const uB = (
          await c.query<{ p: string }>(`SELECT provision_user($1,$2) AS p`, [
            'b2@x.test',
            'hB',
          ])
        ).rows[0].p;
        const orgA = (
          await c.query<{ p: string }>(`SELECT provision_org($1,$2,$3) AS p`, [
            'A2',
            'org-a2',
            uA,
          ])
        ).rows[0].p;
        const orgB = (
          await c.query<{ p: string }>(`SELECT provision_org($1,$2,$3) AS p`, [
            'B2',
            'org-b2',
            uB,
          ])
        ).rows[0].p;

        await c.query(`SELECT set_config('app.current_org',$1,false)`, [orgA]);
        await c.query(`INSERT INTO projects(org_id,name) VALUES ($1,'P-A')`, [
          orgA,
        ]);
        await c.query(`SELECT set_config('app.current_org',$1,false)`, [orgB]);
        await c.query(`INSERT INTO projects(org_id,name) VALUES ($1,'P-B')`, [
          orgB,
        ]);

        // (c) sans contexte -> RAISE bruyant (donnees)
        await c.query(`RESET app.current_org`);
        await expect(c.query(`SELECT * FROM projects`)).rejects.toThrow(
          /app\.current_org non defini/i,
        );

        // (b) SELECT : orgA ne voit que P-A
        await c.query(`SELECT set_config('app.current_org',$1,false)`, [orgA]);
        const selA = await c.query<{ org_id: string; name: string }>(
          `SELECT org_id,name FROM projects`,
        );
        expect(selA.rows.length).toBeGreaterThan(0);
        expect(selA.rows.every((r) => r.org_id === orgA)).toBe(true);
        expect(selA.rows.some((r) => r.name === 'P-B')).toBe(false);

        // (b) INSERT cross-org refuse
        await expect(
          c.query(`INSERT INTO projects(org_id,name) VALUES ($1,'fraude')`, [
            orgB,
          ]),
        ).rejects.toThrow();

        // (b) UPDATE aveugle ne touche que orgA
        const upd = await c.query<{ org_id: string }>(
          `UPDATE projects SET name='x' RETURNING org_id`,
        );
        expect(upd.rows.every((r) => r.org_id === orgA)).toBe(true);

        // (b) DELETE aveugle ne supprime que orgA (P-B survit)
        await c.query(`DELETE FROM projects`);
        await c.query(`SELECT set_config('app.current_org',$1,false)`, [orgB]);
        const survB = await c.query(`SELECT 1 FROM projects WHERE name='P-B'`);
        expect(survB.rows).toHaveLength(1);
      });
    },
  );

  // ----- (B2) NEGATIF anti-fuite identite : drapeau SANS privilege = RIEN -----
  guarded(
    'B2) runtime sans privilege identite : poser le drapeau ne lit AUCUN hash d autrui',
    async () => {
      // seed 2 users via DEFINER (render_app n'ecrit pas users en direct).
      let uOther = '';
      await asRole(APP, async (c) => {
        uOther = (
          await c.query<{ p: string }>(`SELECT provision_user($1,$2) AS p`, [
            'victim@x.test',
            'SECRET-HASH-VICTIM',
          ])
        ).rows[0].p;
      });

      await asRole(APP, async (c) => {
        // ATTAQUE : poser le drapeau a la main (set_config est PUBLIC) PUIS lire users.
        await c.query(`SELECT set_config('app.auth_bootstrap','on',false)`);
        // BARRIERE 1 : render_app n'a AUCUN privilege sur users -> ERREUR de privilege.
        // (Postgres verifie le privilege de table AVANT la RLS : 42501.)
        await expect(
          c.query(`SELECT email, password_hash FROM users`),
        ).rejects.toThrow(
          /permission denied|insufficient privilege|denied for (table|relation) users/i,
        );
        // meme constat sur memberships et organizations
        await expect(c.query(`SELECT * FROM memberships`)).rejects.toThrow(
          /denied|privilege/i,
        );
        await expect(c.query(`SELECT * FROM organizations`)).rejects.toThrow(
          /denied|privilege/i,
        );

        // le hash victime n'a JAMAIS pu etre lu par cette voie.
        expect(uOther).toMatch(/^[0-9a-f-]{36}$/);
      });
    },
  );

  // ----- (M1) drapeau tx-local : pas de fuite vers une requete metier suivante -
  guarded(
    'M1) drapeau tx-local : DEFINER d auth dans une tx ne laisse pas le drapeau on pour projects',
    async () => {
      await asRole(APP, async (c) => {
        // prepare un user/org pour avoir un projet a interroger.
        const u = (
          await c.query<{ p: string }>(`SELECT provision_user($1,$2) AS p`, [
            'm1@x.test',
            'h',
          ])
        ).rows[0].p;
        const org = (
          await c.query<{ p: string }>(`SELECT provision_org($1,$2,$3) AS p`, [
            'M1',
            'org-m1',
            u,
          ])
        ).rows[0].p;
        await c.query(`SELECT set_config('app.current_org',$1,false)`, [org]);
        await c.query(`INSERT INTO projects(org_id,name) VALUES ($1,'P-M1')`, [
          org,
        ]);

        // tx explicite : appel DEFINER d'auth, PUIS requete metier dans la MEME tx,
        // en RETIRANT le contexte tenant entre les deux. Si le drapeau avait fui en
        // 'on', projects deviendrait lisible/ouvert ; il doit RAISE (org-scope bruyant).
        await c.query(`BEGIN`);
        try {
          await c.query(`SELECT id FROM auth_find_user_by_email($1)`, [
            'm1@x.test',
          ]); // pose+ferme le drapeau
          await c.query(`SELECT set_config('app.current_org','',true)`); // retire le contexte (tx-local)
          await expect(c.query(`SELECT * FROM projects`)).rejects.toThrow(
            /app\.current_org non defini/i,
          );
        } finally {
          await c.query(`ROLLBACK`);
        }
      });
    },
  );

  // ----- (PV) SENTINELLE EMISSION : identite scellee via DEFINER, sous render_app -
  guarded(
    'PV) emission : pv_emitter_context fournit org+emetteur sous render_app SANS lecture identite directe',
    async () => {
      await asRole(APP, async (c) => {
        const u = (
          await c.query<{ p: string }>(`SELECT provision_user($1,$2) AS p`, [
            'emit@x.test',
            'h',
          ])
        ).rows[0].p;
        const org = (
          await c.query<{ p: string }>(`SELECT provision_org($1,$2,$3) AS p`, [
            'Bureau X',
            'org-pv',
            u,
          ])
        ).rows[0].p;

        // 1) la voie DEFINER (que pv.service utilise apres 0007) renvoie les 3
        //    champs scelles, a froid, sous render_app (aucun privilege identite direct).
        const ctx = await c.query<{
          org_slug: string;
          org_name: string;
          emitter_full_name: string;
        }>(
          `SELECT org_slug, org_name, emitter_full_name FROM pv_emitter_context($1::uuid,$2::uuid)`,
          [org, u],
        );
        expect(ctx.rows).toHaveLength(1);
        expect(ctx.rows[0].org_slug).toBe('org-pv');
        expect(ctx.rows[0].org_name).toBe('Bureau X');
        expect(ctx.rows[0].emitter_full_name).toBe('Nom emit@x.test');

        // 2) la lecture DIRECTE de l'identite (ce que faisait pv.service AVANT) reste
        //    REFUSEE sous render_app -> la fuite B1 ne se rouvre pas par cette voie.
        await c.query(`SELECT set_config('app.current_org',$1,false)`, [org]);
        await expect(
          c.query(`SELECT name FROM organizations WHERE id=$1`, [org]),
        ).rejects.toThrow(
          /permission denied|insufficient privilege|denied for (table|relation)/i,
        );
        await expect(
          c.query(`SELECT full_name FROM users WHERE id=$1`, [u]),
        ).rejects.toThrow(
          /permission denied|insufficient privilege|denied for (table|relation) users/i,
        );
      });
    },
  );

  // ----- (MONO) scenario VRAI mono-utilisateur : la connexion = PROPRIETAIRE qui
  //       fait SET ROLE render_app au runtime (== Render managed). C'est LE point a
  //       prouver : SET ROLE prive REELLEMENT le proprietaire de son privilege identite.
  guarded(
    'MONO) proprietaire qui SET ROLE render_app perd l acces identite direct ; DEFINER+isolation intacts',
    async () => {
      // bootstrap (sous render_app via DEFINER) : un user + une org a interroger.
      let u = '';
      let org = '';
      await asRole(APP, async (c) => {
        u = (
          await c.query<{ p: string }>(`SELECT provision_user($1,$2) AS p`, [
            'mono@x.test',
            'hM',
          ])
        ).rows[0].p;
        org = (
          await c.query<{ p: string }>(`SELECT provision_org($1,$2,$3) AS p`, [
            'Mono',
            'org-mono',
            u,
          ])
        ).rows[0].p;
      });

      // 1) SOUS render_owner (= la connexion proprietaire) : lecture identite DIRECTE
      //    REUSSIT (privilege owner). On pose le drapeau pour passer FORCE RLS.
      await setup!.query(`SET ROLE ${OWNER}`);
      await setup!.query(`SET search_path = ${SCHEMA}, pg_catalog`);
      try {
        await setup!.query(`SET app.auth_bootstrap = 'on'`);
        const asOwner = await setup!.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM users`,
        );
        expect(Number(asOwner.rows[0].n)).toBeGreaterThanOrEqual(1); // owner LIT l'identite
        await setup!.query(`RESET app.auth_bootstrap`);

        // 2) le PROPRIETAIRE bascule en render_app (== SET LOCAL ROLE du runtime).
        await setup!.query(`SET ROLE ${APP}`);

        // 2a) acces DIRECT a l'identite REFUSE meme si la session est le proprietaire :
        //     le role COURANT est render_app (sans privilege identite) -> 42501.
        await setup!.query(`SET app.auth_bootstrap = 'on'`);
        await expect(setup!.query(`SELECT * FROM users`)).rejects.toThrow(
          /permission denied|insufficient privilege|denied for (table|relation) users/i,
        );
        await setup!.query(`RESET app.auth_bootstrap`);

        // 2b) les DEFINER marchent sous render_app (DEFINER ignore le SET ROLE).
        const login = await setup!.query<{ id: string }>(
          `SELECT id FROM auth_find_user_by_email($1)`,
          ['mono@x.test'],
        );
        expect(login.rows).toHaveLength(1);
        expect(login.rows[0].id).toBe(u);
        const ctx = await setup!.query<{ org_slug: string }>(
          `SELECT org_slug FROM pv_emitter_context($1::uuid,$2::uuid)`,
          [org, u],
        );
        expect(ctx.rows[0].org_slug).toBe('org-mono');

        // 2c) isolation donnees sous render_app : ne voit que l'org courante.
        // set_config(..., is_local=TRUE) est LOCAL A LA TRANSACTION — hors
        // transaction explicite il meurt avec l'auto-commit du statement et
        // l'INSERT suivant leve « app.current_org non defini ». Le runtime reel
        // (withTenant) pose ce drapeau DANS une transaction : on reproduit.
        await setup!.query(`BEGIN`);
        try {
          await setup!.query(`SELECT set_config('app.current_org',$1,true)`, [
            org,
          ]);
          await setup!.query(
            `INSERT INTO projects(org_id,name) VALUES ($1,'P-MONO')`,
            [org],
          );
          const sel = await setup!.query<{ name: string }>(
            `SELECT name FROM projects`,
          );
          expect(sel.rows.every((r) => r.name === 'P-MONO')).toBe(true);
          await setup!.query(`COMMIT`);
        } catch (err) {
          await setup!.query(`ROLLBACK`);
          throw err;
        }
      } finally {
        await setup!.query(`RESET ROLE`);
        await setup!.query(`RESET app.current_org`);
        await setup!.query(`RESET app.auth_bootstrap`);
      }
    },
  );

  it('couverture : >= 6 cas reellement executes (en CI/avec URL)', () => {
    if (!ENFORCE) {
      console.warn('[NON EXECUTE] couverture ignoree hors CI et sans URL.');
      return;
    }
    expect(passed).toBeGreaterThanOrEqual(6);
  });
});
