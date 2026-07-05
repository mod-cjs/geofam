/**
 * Test d'ISOLATION MONEY/PV — GATE PAR RÔLE de la lecture cross-tenant (migration 0014,
 * patch de durcissement). PostgreSQL REEL, sous le role applicatif roadsen_app
 * (NOBYPASSRLS), chemins NEGATIFS.
 *
 * CE QUE CE FICHIER VERROUILLE
 * ----------------------------
 * Le patch 0014 fait passer les policies PERMISSIVES `stats_bootstrap_read` (sur
 * subscriptions et official_pvs) de `USING (app_auth_bootstrap())` (drapeau, falsifiable
 * par set_config) a `USING (current_user = 'roadsen_auth')` (gate PAR RÔLE). Consequence :
 * la lecture cross-tenant money/PV n'est ouverte QUE dans le corps des fonctions SECURITY
 * DEFINER (qui s'executent comme leur owner roadsen_auth). Le runtime roadsen_app — NON
 * membre de roadsen_auth — ne peut PLUS lire cross-tenant, MÊME en posant lui-meme le
 * drapeau app.auth_bootstrap.
 *
 * SENTINELLE (esprit mutation, given/when/then)
 * ---------------------------------------------
 *   #1 given roadsen_app pose le drapeau + un app.current_org factice,
 *      when il lit subscriptions/official_pvs cross-tenant (org A, B seedes),
 *      then il voit 0 ligne.  <-- ROUGE avec l'ancienne policy (drapeau), VERT avec le
 *      gate par-role. Le CONTROLE POSITIF (#1b) prouve que le 0 est une VRAIE barriere :
 *      la MÊME requete, sous current_user='roadsen_auth', renvoie bien 2 (le role est le
 *      SEUL discriminant — si le gate etait casse/inversé, le controle positif tomberait).
 *   #2 given une session roadsen_app, when elle tente SET ROLE roadsen_auth, then refus
 *      42501 (roadsen_app n'est PAS membre de roadsen_auth) — l'escalade par-role est le
 *      seul moyen d'ouvrir la policy, et il est ferme.
 *   #6 given roadsen_app + drapeau + org factice, when il tente INSERT/UPDATE/DELETE
 *      cross-tenant sur subscriptions/official_pvs, then refus (WITH CHECK tenant / manque
 *      de privilege) : la policy bootstrap est FOR SELECT — les ECRITURES restent intactes.
 *
 * DEUX CONNEXIONS (fidele a Render / au modele 0007) :
 *   - admin  = DATABASE_URL (superuser) : SEED + teardown (bypasse RLS) et controle
 *              POSITIF via SET ROLE roadsen_auth (superuser autorise a SET ROLE).
 *   - app    = RLS_TEST_DATABASE_URL (roadsen_app, NOBYPASSRLS) : TOUTES les assertions
 *              negatives. session_user='roadsen_app' EXIGE (sinon un fallback superuser
 *              masquerait la RLS -> faux-vert) : precondition verrouillee en test 0.
 *
 * ANTI-SKIP : en CI / des qu'une URL est fournie, base injoignable ou role inattendu =
 * ECHEC DUR. Hors CI sans base = non-execute (honnete), jamais reussi.
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

// Assertions negatives : role applicatif NOBYPASSRLS. RLS_TEST_DATABASE_URL prime ;
// fallback DATABASE_URL en dernier ressort (mono-URL) — mais alors session_user sera
// superuser et la precondition du test 0 fera ECHOUER (pas de preuve sous superuser).
const APP_URL =
  process.env.RLS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
// Seed/teardown + controle positif : superuser qui bypasse RLS.
const ADMIN_URL = process.env.DATABASE_URL ?? '';

const ENFORCE =
  process.env.CI === 'true' || APP_URL.length > 0 || ADMIN_URL.length > 0;

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

async function connectAs(url: string, label: string): Promise<PgClient> {
  if (!url) {
    throw new Error(
      `${label} absent : impossible de prouver l'isolation money/PV. En CI, ` +
        'fournir DATABASE_URL (superuser) ET RLS_TEST_DATABASE_URL (roadsen_app).',
    );
  }
  const Client = loadPg();
  const client = new Client({ connectionString: url });
  await client.connect(); // base injoignable => ECHOUE, pas de masquage
  return client;
}

describe('Isolation money/PV — gate par-role de la lecture cross-tenant (0014, roadsen_app)', () => {
  let admin: PgClient | null = null; // seed/teardown + controle positif (superuser)
  let app: PgClient | null = null; // assertions negatives (roadsen_app)
  let connectError: Error | null = null;
  let appSessionUser = '';
  let passedCases = 0;

  const run = randomUUID().slice(0, 8);
  const orgA = randomUUID();
  const orgB = randomUUID();
  const orgs = [orgA, orgB];
  // marqueur unique de contenu de PV (64 hex) pour tracer une eventuelle fuite.
  const hashA = `${run}a`.padEnd(64, '0');
  const hashB = `${run}b`.padEnd(64, '0');

  jest.setTimeout(60_000);

  beforeAll(async () => {
    try {
      admin = await connectAs(ADMIN_URL, 'DATABASE_URL (seed/superuser)');
      app = await connectAs(APP_URL, 'RLS_TEST_DATABASE_URL (roadsen_app)');
    } catch (err) {
      connectError = err as Error;
      if (ENFORCE) throw connectError;
      return;
    }

    // Precondition : la connexion d'assertion DOIT etre roadsen_app (sinon un
    // superuser bypasserait la RLS et rendrait la preuve nulle). Capturee ici,
    // verrouillee en test 0.
    appSessionUser = (
      await app.query<{ u: string }>(`SELECT session_user AS u`)
    ).rows[0].u;

    // SEED via superuser (bypasse RLS). 2 orgs, chacune 1 subscription + 1 PV officiel.
    for (const [i, id] of orgs.entries()) {
      await admin.query(
        `INSERT INTO organizations (id, name, slug, status, "updatedAt")
         VALUES ($1,$2,$3,'ACTIVE'::"OrgStatus",now())`,
        [id, `money-iso ${run} ${i}`, `money-iso-${run}-${i}`],
      );
      await admin.query(
        `INSERT INTO subscriptions
           (id, org_id, pack, entitlements, date_debut, date_fin, quota, consommation, created_at, updated_at)
         VALUES ($1,$2,'ROUTES', ARRAY['burmister'], now() - interval '1 day',
                 now() + interval '365 days', 100, 10, now(), now())`,
        [randomUUID(), id],
      );
      await admin.query(
        `INSERT INTO official_pvs
           (id, org_id, calc_result_id, project_id, pv_number, user_id, project_name,
            engine_id, engine_version, input_canonical, output, science_status, verdict,
            content_hash, hmac, sealed_at)
         VALUES ($1,$2,$3,$4,$5,$6,'P-money-iso','burmister','1.0','{}','{}'::jsonb,'signed','CONFORME',
                 $7,$8,now())`,
        [
          randomUUID(),
          id,
          randomUUID(),
          randomUUID(),
          `PV-${run}-${i}`,
          randomUUID(),
          i === 0 ? hashA : hashB,
          i === 0 ? hashA : hashB,
        ],
      );
    }
  }, 60_000);

  afterAll(async () => {
    if (admin) {
      try {
        // official_pvs est APPEND-ONLY (triggers) : desactiver le temps du nettoyage.
        await admin.query(`ALTER TABLE official_pvs DISABLE TRIGGER USER`);
        try {
          await admin.query(
            `DELETE FROM official_pvs WHERE org_id = ANY($1::uuid[])`,
            [orgs],
          );
        } finally {
          await admin.query(`ALTER TABLE official_pvs ENABLE TRIGGER USER`);
        }
        await admin.query(
          `DELETE FROM subscriptions WHERE org_id = ANY($1::uuid[])`,
          [orgs],
        );
        await admin.query(
          `DELETE FROM organizations WHERE id = ANY($1::uuid[])`,
          [orgs],
        );
        await admin.query(`RESET ROLE`);
      } finally {
        await admin.end();
      }
    }
    if (app) {
      try {
        await app.query(`RESET app.current_org`);
        await app.query(`RESET app.auth_bootstrap`);
      } catch {
        /* connexion peut etre fermee : sans importance au teardown */
      }
      await app.end();
    }
  });

  const guarded = (name: string, fn: () => Promise<void>) => {
    it(name, async () => {
      if (!app || !admin) {
        if (ENFORCE) {
          throw (
            connectError ??
            new Error(`Base non joignable en CI : ${name} non prouve.`)
          );
        }
        console.warn(`[NON EXECUTE] ${name} — aucune base (hors CI).`);
        return;
      }
      await fn();
      passedCases += 1;
    });
  };

  /** Pose (session-level) drapeau + un app.current_org FACTICE sur la connexion app. */
  async function appSetBootstrapAndFakeOrg(): Promise<void> {
    await app!.query(`SELECT set_config('app.auth_bootstrap','on',false)`);
    await app!.query(
      `SELECT set_config('app.current_org', gen_random_uuid()::text, false)`,
    );
  }
  async function appReset(): Promise<void> {
    await app!.query(`RESET app.auth_bootstrap`);
    await app!.query(`RESET app.current_org`);
  }

  // --- 0) precondition : la connexion d'assertion est bien roadsen_app ----------

  guarded(
    '0) given la connexion d assertion when on lit session_user then c est roadsen_app NOBYPASSRLS non-membre de roadsen_auth',
    async () => {
      // session_user = roadsen_app (sinon un superuser masquerait la RLS -> faux-vert).
      expect(appSessionUser).toBe('roadsen_app');

      // roadsen_app est NOBYPASSRLS et n'est PAS membre de roadsen_auth (verifie via
      // le catalogue depuis la connexion admin).
      const { rows } = await admin!.query<{
        rolbypassrls: boolean;
        is_member: boolean;
      }>(
        `SELECT r.rolbypassrls,
                pg_has_role('roadsen_app','roadsen_auth','MEMBER') AS is_member
           FROM pg_roles r WHERE r.rolname='roadsen_app'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].rolbypassrls).toBe(false);
      expect(rows[0].is_member).toBe(false);
    },
  );

  // --- 1) SENTINELLE : roadsen_app + drapeau ne lit AUCUNE ligne cross-tenant ----

  guarded(
    '1) given roadsen_app pose le drapeau + org factice when il lit subscriptions cross-tenant then 0 ligne',
    async () => {
      await appSetBootstrapAndFakeOrg();
      try {
        const { rows } = await app!.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM subscriptions WHERE org_id = ANY($1::uuid[])`,
          [orgs],
        );
        // Cœur du patch : le drapeau ne suffit PLUS (gate par-role). ROUGE si policy=drapeau.
        expect(Number(rows[0].n)).toBe(0);
      } finally {
        await appReset();
      }
    },
  );

  guarded(
    '1) given roadsen_app pose le drapeau + org factice when il lit official_pvs cross-tenant then 0 ligne (et aucun content_hash ne fuite)',
    async () => {
      await appSetBootstrapAndFakeOrg();
      try {
        const { rows } = await app!.query<{
          n: string;
          leaked: string | null;
        }>(
          `SELECT count(*)::text AS n,
                  string_agg(content_hash, ',') AS leaked
             FROM official_pvs WHERE org_id = ANY($1::uuid[])`,
          [orgs],
        );
        expect(Number(rows[0].n)).toBe(0);
        // aucun marqueur de contenu de PV ne doit remonter par cette voie.
        expect(rows[0].leaked).toBeNull();
      } finally {
        await appReset();
      }
    },
  );

  // --- 1b) CONTROLE POSITIF : la MÊME requete, sous roadsen_auth, renvoie 2 ------
  //  Prouve que le 0 ci-dessus est une VRAIE barriere par-role et non une requete
  //  cassee (le role est le SEUL discriminant). Execute sur la connexion admin
  //  (superuser autorise a SET ROLE roadsen_auth), avec le MÊME drapeau + org factice.
  guarded(
    '1b) given la MÊME lecture sous current_user=roadsen_auth (via SET ROLE) when drapeau + org factice then 2 lignes (le gate par-role est porteur)',
    async () => {
      await admin!.query(`SET ROLE roadsen_auth`);
      try {
        await admin!.query(
          `SELECT set_config('app.auth_bootstrap','on',false)`,
        );
        await admin!.query(
          `SELECT set_config('app.current_org', gen_random_uuid()::text, false)`,
        );
        const subs = await admin!.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM subscriptions WHERE org_id = ANY($1::uuid[])`,
          [orgs],
        );
        const pvs = await admin!.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM official_pvs WHERE org_id = ANY($1::uuid[])`,
          [orgs],
        );
        // current_user='roadsen_auth' => la policy stats_bootstrap_read s'ouvre.
        expect(Number(subs.rows[0].n)).toBe(2);
        expect(Number(pvs.rows[0].n)).toBe(2);
      } finally {
        await admin!.query(`RESET app.auth_bootstrap`);
        await admin!.query(`RESET app.current_org`);
        await admin!.query(`RESET ROLE`);
      }
    },
  );

  // --- 2) ESCALADE : roadsen_app ne peut pas DEVENIR roadsen_auth ---------------

  guarded(
    '2) given une session roadsen_app when elle tente SET ROLE roadsen_auth then refus 42501',
    async () => {
      try {
        await expect(app!.query(`SET ROLE roadsen_auth`)).rejects.toMatchObject(
          {
            code: '42501',
          },
        );
      } finally {
        // si le SET ROLE avait (a tort) reussi, on remet l'etat propre.
        await app!.query(`RESET ROLE`);
      }
    },
  );

  // --- 6) ECRITURES cross-tenant refusees (policy bootstrap = FOR SELECT only) ---

  guarded(
    '6) given roadsen_app + drapeau + org factice when il tente d ECRIRE cross-tenant (subscriptions/official_pvs) then chaque INSERT/UPDATE/DELETE est refuse',
    async () => {
      await appSetBootstrapAndFakeOrg();
      try {
        // INSERT cross-tenant sur subscriptions : WITH CHECK tenant_isolation (org
        // factice != orgA) -> refus. La branche bootstrap est FOR SELECT : aucune
        // WITH CHECK ne l'ouvre.
        await expect(
          app!.query(
            `INSERT INTO subscriptions
               (id, org_id, pack, entitlements, date_debut, date_fin, quota, consommation, created_at, updated_at)
             VALUES ($1,$2,'ROUTES', ARRAY['burmister'], now(), now() + interval '1 day', 1, 0, now(), now())`,
            [randomUUID(), orgA],
          ),
        ).rejects.toThrow();

        // INSERT cross-tenant sur official_pvs : idem (WITH CHECK tenant).
        await expect(
          app!.query(
            `INSERT INTO official_pvs
               (id, org_id, calc_result_id, project_id, pv_number, user_id, project_name,
                engine_id, engine_version, input_canonical, output, science_status, verdict,
                content_hash, hmac, sealed_at)
             VALUES ($1,$2,$3,$4,$5,$6,'fraude','burmister','1.0','{}','{}'::jsonb,'signed','CONFORME',
                     $7,$8,now())`,
            [
              randomUUID(),
              orgA,
              randomUUID(),
              randomUUID(),
              `PV-fraude-${run}`,
              randomUUID(),
              `f${run}`.padEnd(64, '0'),
              `f${run}`.padEnd(64, '0'),
            ],
          ),
        ).rejects.toThrow();

        // UPDATE cross-tenant sur subscriptions : roadsen_app n'a pas le privilege
        // UPDATE (grant absent) -> refus (42501). Une eventuelle ligne A n'est de
        // toute facon jamais visible/modifiable.
        await expect(
          app!.query(
            `UPDATE subscriptions SET quota = 999999 WHERE org_id = ANY($1::uuid[])`,
            [orgs],
          ),
        ).rejects.toThrow();

        // DELETE cross-tenant sur official_pvs : privilege DELETE absent -> refus.
        await expect(
          app!.query(
            `DELETE FROM official_pvs WHERE org_id = ANY($1::uuid[])`,
            [orgs],
          ),
        ).rejects.toThrow();

        // Preuve d'INTEGRITE : depuis la connexion admin, les 2 subscriptions et 2
        // PV seedes sont TOUJOURS la (aucune ecriture de fraude n'a abouti).
        const subN = await admin!.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM subscriptions WHERE org_id = ANY($1::uuid[])`,
          [orgs],
        );
        const pvN = await admin!.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM official_pvs WHERE org_id = ANY($1::uuid[])`,
          [orgs],
        );
        expect(Number(subN.rows[0].n)).toBe(2);
        expect(Number(pvN.rows[0].n)).toBe(2);
      } finally {
        await appReset();
      }
    },
  );

  // --- couverture : au moins 6 cas REELLEMENT executes (anti faux-vert) ----------

  it('couverture : >= 6 cas reellement executes (en CI/avec URL)', () => {
    if (!ENFORCE) {
      console.warn('[NON EXECUTE] couverture ignoree hors CI et sans URL.');
      return;
    }
    // 0,1(x2),1b,2,6 = 6 cas.
    expect(passedCases).toBeGreaterThanOrEqual(6);
  });
});
