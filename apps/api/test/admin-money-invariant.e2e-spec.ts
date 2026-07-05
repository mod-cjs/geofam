/**
 * SENTINELLE de l'INVARIANT « WHERE org_id OBLIGATOIRE » (lectures per-tenant) + fermeture
 * des 3-args non auditees (migration 0014, patch de durcissement). PostgreSQL REEL, sous
 * le role applicatif roadsen_app (NOBYPASSRLS) + role owner roadsen_auth, chemins NEGATIFS.
 *
 * POURQUOI CE FICHIER (revue adverse qa-challenger)
 * -------------------------------------------------
 * Depuis 0014, la policy stats_bootstrap_read (FOR SELECT, `current_user='roadsen_auth'`)
 * ouvre subscriptions/official_pvs en LECTURE PLEINE (cross-tenant) a TOUTE fonction
 * SECURITY DEFINER (owned roadsen_auth). Une lecture NON-verrouillante (plain SELECT) dans
 * une DEFINER n'est donc PLUS scopee par la RLS au tenant : le SEUL cloisonnement restant
 * est le predicat EXPLICITE `WHERE org_id = <param>` du corps.
 *
 * NUANCE MESUREE (defense en profondeur, pas theorie) : les 4 lecteurs money DEPLOYES
 * (0008 provision_subscription ; 0013 adjust_quota / renew_subscription /
 * set_subscription_entitlements) posent AUSSI `app.current_org = p_org_id` ET lisent en
 * `SELECT ... FOR UPDATE`. Or `FOR UPDATE` RE-APPLIQUE la policy tenant_isolation (UPDATE)
 * — que stats_bootstrap_read (FOR SELECT) N'ouvre PAS. Chez eux, l'isolation tient donc a
 * DEUX barrieres (contexte tenant + FOR UPDATE) EN PLUS du WHERE : retirer le seul WHERE
 * n'y suffit PAS a fuiter (mesure empirique — cf. rapport). Le WHERE reste NEANMOINS
 * l'invariant a graver, car il est la SEULE barriere des lectures NON-verrouillantes
 * per-tenant (tout futur lecteur ; toute lecture hors FOR UPDATE).
 *
 * CE QUE CE FICHIER VERROUILLE
 * ---------------------------
 *   A) BEHAVIORAL (cas 1-3) : les fonctions money DEPLOYEES, appelees sur une org CIBLE
 *      SANS abonnement (une org VICTIME en ayant un), levent « introuvable » et NE lisent
 *      NI ne mutent la ligne de la VICTIME (ni trace d'audit) -> aucun bug vivant.
 *   B) MECANISME / SENTINELLE FLIP (cas 4-5) : sous le contexte EXACT d'un corps DEFINER
 *      (role roadsen_auth + drapeau + app.current_org FACTICE), une lecture SANS WHERE voit
 *      des lignes CROSS-TENANT (fuite) tandis que `WHERE org_id = <cible>` scope. C'EST le
 *      corps-sans-WHERE : il DEMONTRE, sans editer aucune fonction, qu'un corps qui perdrait
 *      son WHERE fuiterait. Le contexte tenant SEUL (factice) ne scope PAS (cas 4d).
 *   C) DURCISSEMENT 3-args (cas 7-8) : roadsen_app ne peut plus EXECUTER les 3-args non
 *      tracees (42501) ; la 4-arg auditee delegue toujours au corps 3-args (owner garde X).
 *
 * DEUX CONNEXIONS (fidele a Render / au modele 0007) :
 *   - admin = DATABASE_URL (superuser) : SEED + teardown (bypasse RLS) + lecture d'etat +
 *             SET ROLE roadsen_auth (mime un corps DEFINER pour le cas 4-5).
 *   - app   = RLS_TEST_DATABASE_URL (roadsen_app, NOBYPASSRLS) : appels DEFINER + negatifs.
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

const APP_URL =
  process.env.RLS_TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
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
      `${label} absent : impossible de prouver l'invariant money. En CI, fournir ` +
        'DATABASE_URL (superuser) ET RLS_TEST_DATABASE_URL (roadsen_app).',
    );
  }
  const Client = loadPg();
  const client = new Client({ connectionString: url });
  await client.connect(); // base injoignable => ECHOUE, pas de masquage
  return client;
}

describe('Invariant WHERE org_id + fermeture 3-args (0014, roadsen_app)', () => {
  let admin: PgClient | null = null; // seed/teardown + lecture d'etat + SET ROLE (superuser)
  let app: PgClient | null = null; // appels DEFINER + negatifs (roadsen_app)
  let connectError: Error | null = null;
  let appSessionUser = '';
  let passedCases = 0;

  const run = randomUUID().slice(0, 8);
  const orgVictim = randomUUID(); // a un abonnement + un PV
  const orgTarget = randomUUID(); // SANS abonnement
  const actor = randomUUID(); // acteur d'audit (uuid arbitraire, pas de FK)

  // Etat de reference de l'abonnement VICTIME (a retrouver INTACT apres les appels cibles).
  const VICTIM_QUOTA = 500;
  const VICTIM_CONSO = 7;
  const VICTIM_PACK = 'FONDATIONS';
  const VICTIM_ENT = ['terzaghi', 'pieux'];
  const victimPvHash = `${run}a`.padEnd(64, '0');

  // Provisionnement par la 4-arg audit (test positif) : a nettoyer.
  const provEmail = `inv-prov-${run}@roadsen.test`;

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

    appSessionUser = (
      await app.query<{ u: string }>(`SELECT session_user AS u`)
    ).rows[0].u;

    // SEED via superuser (bypasse RLS).
    // org VICTIME : ACTIVE, abonnement + 1 PV officiel (marqueur de contenu).
    await admin.query(
      `INSERT INTO organizations (id, name, slug, status, "updatedAt")
       VALUES ($1,$2,$3,'ACTIVE'::"OrgStatus",now())`,
      [orgVictim, `inv-victim ${run}`, `inv-victim-${run}`],
    );
    await admin.query(
      `INSERT INTO subscriptions
         (id, org_id, pack, entitlements, date_debut, date_fin, quota, consommation, created_at, updated_at)
       VALUES ($1,$2,$3,$4, now() - interval '1 day', now() + interval '365 days', $5, $6, now(), now())`,
      [
        randomUUID(),
        orgVictim,
        VICTIM_PACK,
        VICTIM_ENT,
        VICTIM_QUOTA,
        VICTIM_CONSO,
      ],
    );
    await admin.query(
      `INSERT INTO official_pvs
         (id, org_id, calc_result_id, project_id, pv_number, user_id, project_name,
          engine_id, engine_version, input_canonical, output, science_status, verdict,
          content_hash, hmac, sealed_at)
       VALUES ($1,$2,$3,$4,$5,$6,'P-inv-victim','burmister','1.0','{}','{}'::jsonb,'signed','CONFORME',
               $7,$7,now())`,
      [
        randomUUID(),
        orgVictim,
        randomUUID(),
        randomUUID(),
        `PV-inv-${run}`,
        randomUUID(),
        victimPvHash,
      ],
    );

    // org CIBLE : ACTIVE, SANS abonnement (ni PV).
    await admin.query(
      `INSERT INTO organizations (id, name, slug, status, "updatedAt")
       VALUES ($1,$2,$3,'ACTIVE'::"OrgStatus",now())`,
      [orgTarget, `inv-target ${run}`, `inv-target-${run}`],
    );
  }, 60_000);

  afterAll(async () => {
    if (admin) {
      const orgs = [orgVictim, orgTarget];
      try {
        await admin.query(`RESET ROLE`);
        await admin.query(`RESET app.current_org`);
        await admin.query(`RESET app.auth_bootstrap`);
        // admin_audit_log + official_pvs = APPEND-ONLY (triggers) : desactiver pour nettoyer.
        await admin.query(`ALTER TABLE admin_audit_log DISABLE TRIGGER USER`);
        try {
          await admin.query(
            `DELETE FROM admin_audit_log
               WHERE target_org_id = ANY($1::uuid[]) OR actor_user_id = $2
                  OR target_user_id IN (SELECT id FROM users WHERE email = $3)`,
            [orgs, actor, provEmail],
          );
        } finally {
          await admin.query(`ALTER TABLE admin_audit_log ENABLE TRIGGER USER`);
        }
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
        await admin.query(`DELETE FROM users WHERE email = $1`, [provEmail]);
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

  /** Lit l'etat courant de l'abonnement VICTIME (via superuser, bypasse RLS). */
  async function victimSub(): Promise<{
    quota: number;
    consommation: number;
    pack: string;
    entitlements: string[];
  } | null> {
    const { rows } = await admin!.query<{
      quota: number;
      consommation: number;
      pack: string;
      entitlements: string[];
    }>(
      `SELECT quota, consommation, pack, entitlements
         FROM subscriptions WHERE org_id = $1`,
      [orgVictim],
    );
    return rows[0] ?? null;
  }

  /** Compte les lignes d'audit visant l'org CIBLE (aucune ne doit apparaitre). */
  async function auditRowsForTarget(): Promise<number> {
    const { rows } = await admin!.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM admin_audit_log WHERE target_org_id = $1`,
      [orgTarget],
    );
    return Number(rows[0].n);
  }

  /** Pose le contexte EXACT d'un corps DEFINER sur la connexion admin : role roadsen_auth
   *  + drapeau bootstrap + app.current_org FACTICE (ne matche aucune org seedee). */
  async function enterDefinerContext(): Promise<void> {
    await admin!.query(`SET ROLE roadsen_auth`);
    await admin!.query(`SELECT set_config('app.auth_bootstrap','on',false)`);
    await admin!.query(
      `SELECT set_config('app.current_org', gen_random_uuid()::text, false)`,
    );
  }
  async function leaveDefinerContext(): Promise<void> {
    await admin!.query(`RESET app.auth_bootstrap`);
    await admin!.query(`RESET app.current_org`);
    await admin!.query(`RESET ROLE`);
  }

  // --- 0) precondition : la connexion app est bien roadsen_app ----------

  guarded(
    '0) given la connexion app when on lit session_user then c est roadsen_app NOBYPASSRLS',
    async () => {
      expect(appSessionUser).toBe('roadsen_app');
      const { rows } = await admin!.query<{ rolbypassrls: boolean }>(
        `SELECT rolbypassrls FROM pg_roles WHERE rolname='roadsen_app'`,
      );
      expect(rows[0].rolbypassrls).toBe(false);
    },
  );

  // --- 1-3) BEHAVIORAL : les fonctions money DEPLOYEES sont org-scopees ----------
  //  Appel sur l'org CIBLE (sans abo) -> « introuvable » ; la VICTIME reste intacte et
  //  aucune trace d'audit n'est posee (le SELECT ne remonte pas la ligne victime).

  guarded(
    '1) given org CIBLE sans abo (VICTIME en a un) when adjust_quota vise la CIBLE then introuvable, victime intacte, aucun audit',
    async () => {
      await expect(
        app!.query(
          `SELECT adjust_quota($1::uuid, $2::int, $3::text, $4::uuid, $5::text)`,
          [orgTarget, 5, `motif-${run}`, actor, `inv-topup-${run}`],
        ),
      ).rejects.toThrow(/introuvable/i);

      const v = await victimSub();
      expect(v).not.toBeNull();
      expect(v!.quota).toBe(VICTIM_QUOTA);
      expect(v!.consommation).toBe(VICTIM_CONSO);
      expect(await auditRowsForTarget()).toBe(0);
    },
  );

  guarded(
    '2) given org CIBLE sans abo when renew_subscription vise la CIBLE then introuvable, victime intacte',
    async () => {
      await expect(
        app!.query(
          `SELECT renew_subscription($1::uuid, now(), now() + interval '30 days', $2::uuid, $3::text)`,
          [orgTarget, actor, `inv-renew-${run}`],
        ),
      ).rejects.toThrow(/introuvable/i);

      const v = await victimSub();
      expect(v!.consommation).toBe(VICTIM_CONSO); // pas de reset cross-tenant
      expect(await auditRowsForTarget()).toBe(0);
    },
  );

  guarded(
    '3) given org CIBLE sans abo when set_subscription_entitlements vise la CIBLE then introuvable, victime intacte',
    async () => {
      await expect(
        app!.query(
          `SELECT set_subscription_entitlements($1::uuid, $2::text, $3::text[], $4::uuid, $5::text)`,
          [orgTarget, 'HACK', ['exfiltre'], actor, `inv-ent-${run}`],
        ),
      ).rejects.toThrow(/introuvable/i);

      const v = await victimSub();
      expect(v!.pack).toBe(VICTIM_PACK); // pack de la victime NON reecrit
      expect(v!.entitlements).toEqual(VICTIM_ENT);
      expect(await auditRowsForTarget()).toBe(0);
    },
  );

  // --- 4) SENTINELLE FLIP (subscriptions) : le corps-sans-WHERE FUIT cross-tenant ------
  //  Sous le contexte EXACT d'une DEFINER (role roadsen_auth + drapeau + org FACTICE) :
  //   (b) une lecture SANS WHERE voit des lignes HORS tenant courant -> FUITE ;
  //   (c) `WHERE org_id = victime` scope (c'est le predicat, PAS la RLS, qui selectionne) ;
  //   (d) le contexte tenant SEUL (factice) ne scope PAS a la victime.
  //  => si un corps de fonction perdait son WHERE, il lirait EXACTEMENT ces lignes (b).
  guarded(
    '4) given role roadsen_auth + drapeau + org factice when lecture subscriptions SANS WHERE then cross-tenant (fuite) ; WHERE org_id scope',
    async () => {
      await enterDefinerContext();
      try {
        // (b) SANS WHERE : au moins une ligne, et au moins une HORS du tenant courant.
        const noWhere = await admin!.query<{ n: string; cross: boolean }>(
          `SELECT count(*)::text AS n,
                  bool_or(org_id::text <> current_setting('app.current_org')) AS cross
             FROM subscriptions`,
        );
        expect(Number(noWhere.rows[0].n)).toBeGreaterThanOrEqual(1);
        expect(noWhere.rows[0].cross).toBe(true); // <-- FUITE cross-tenant sans predicat

        // La ligne VICTIME est bien parmi celles vues sans WHERE (org != contexte factice).
        const victimVisible = await admin!.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM subscriptions WHERE org_id = $1`,
          [orgVictim],
        );
        expect(Number(victimVisible.rows[0].n)).toBe(1); // (c) le WHERE explicite la surface

        // (d) le contexte tenant factice SEUL ne matche pas la victime.
        const ctxOnly = await admin!.query<{ n: string }>(
          `SELECT count(*)::text AS n
             FROM subscriptions WHERE org_id = current_setting('app.current_org')::uuid`,
        );
        expect(Number(ctxOnly.rows[0].n)).toBe(0);
      } finally {
        await leaveDefinerContext();
      }
    },
  );

  // --- 5) SENTINELLE FLIP (official_pvs) : le content_hash victime fuit sans WHERE ------
  guarded(
    '5) given role roadsen_auth + drapeau + org factice when lecture official_pvs SANS WHERE then le content_hash victime fuit ; WHERE org_id scope',
    async () => {
      await enterDefinerContext();
      try {
        // SANS filtre d'org : le hash de contenu du PV victime est LISIBLE (cross-tenant).
        const leak = await admin!.query<{ h: string | null }>(
          `SELECT string_agg(content_hash, ',') AS h
             FROM official_pvs WHERE content_hash = $1`,
          [victimPvHash],
        );
        expect(leak.rows[0].h).toBe(victimPvHash); // <-- FUITE : PV d'une autre org lisible

        // Le MEME PV, filtre sur le tenant courant (factice), est INVISIBLE : seul un
        // `WHERE org_id = <cible reelle>` ramenerait la bonne org — jamais la RLS seule.
        const scopedToCtx = await admin!.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM official_pvs
             WHERE content_hash = $1 AND org_id = current_setting('app.current_org')::uuid`,
          [victimPvHash],
        );
        expect(Number(scopedToCtx.rows[0].n)).toBe(0);
      } finally {
        await leaveDefinerContext();
      }
    },
  );

  // --- 6) INTEGRITE PV : le PV de la victime est intact apres les appels cibles --------

  guarded(
    '6) given les appels cibles when on relit le PV de la VICTIME then il est intact',
    async () => {
      const { rows } = await admin!.query<{ n: string; hash: string | null }>(
        `SELECT count(*)::text AS n, string_agg(content_hash, ',') AS hash
           FROM official_pvs WHERE org_id = $1`,
        [orgVictim],
      );
      expect(Number(rows[0].n)).toBe(1);
      expect(rows[0].hash).toBe(victimPvHash);
    },
  );

  // --- 7) FERMETURE 3-args : roadsen_app ne peut PLUS executer les 3-args non tracees --

  guarded(
    '7) given roadsen_app when il tente les surcharges 3-args (onboarding non trace) then 42501 permission denied',
    async () => {
      await expect(
        app!.query(`SELECT provision_user($1::text, $2::text, $3::text)`, [
          `blocked-${run}@roadsen.test`,
          'x',
          'Blocked',
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        app!.query(`SELECT provision_org($1::text, $2::text, $3::uuid)`, [
          `blk ${run}`,
          `blk-${run}`,
          randomUUID(),
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        app!.query(`SELECT provision_member($1::uuid, $2::uuid, $3::"Role")`, [
          randomUUID(),
          randomUUID(),
          'ADMIN',
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        app!.query(
          `SELECT set_member_active($1::uuid, $2::uuid, $3::boolean)`,
          [randomUUID(), randomUUID(), true],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    },
  );

  // --- 8) NON-REGRESSION : la 4-arg auditee delegue toujours au corps 3-args ----------

  guarded(
    '8) given la surcharge 4-args auditee when roadsen_app l appelle then elle reussit (delegue au corps 3-args en tant qu owner)',
    async () => {
      const { rows } = await app!.query<{ provision_user: string }>(
        `SELECT provision_user($1::text, $2::text, $3::text, $4::uuid) AS provision_user`,
        [provEmail, 'hash-placeholder', 'Inv Prov', actor],
      );
      expect(rows[0].provision_user).toMatch(/^[0-9a-f-]{36}$/i);
      const { rows: check } = await admin!.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM users WHERE email = $1`,
        [provEmail],
      );
      expect(Number(check[0].n)).toBe(1);
    },
  );

  // --- couverture : au moins 9 cas REELLEMENT executes (anti faux-vert) ----------

  it('couverture : >= 9 cas reellement executes (en CI/avec URL)', () => {
    if (!ENFORCE) {
      console.warn('[NON EXECUTE] couverture ignoree hors CI et sans URL.');
      return;
    }
    expect(passedCases).toBeGreaterThanOrEqual(9);
  });
});
