/**
 * Test du COEUR D'INTEGRITE DU PV SCELLE (BUILD #63 — incrément A) — preuve base.
 *
 * Exige une base PostgreSQL REELLE avec les migrations 0001..0006 appliquees
 * (pnpm db:up && prisma migrate deploy). Se connecte, comme rls-isolation, sous
 * DEUX roles distincts :
 *   - admin/seed  = DATABASE_URL (superuser : bypasse RLS, seed/teardown).
 *   - app/assertions = RLS_TEST_DATABASE_URL (roadsen_app, NOBYPASSRLS) : c'est
 *     sous CE role que FORCE ROW LEVEL SECURITY, l'immuabilite et les privileges
 *     s'exercent reellement.
 *
 * Ce qui est prouve :
 *   ISOLATION (calc_results + official_pvs) :
 *     1) sans app.current_org -> RAISE (fail-closed bruyant, 0004).
 *     2) org A ne SELECT que ses calc_results, jamais ceux de B.
 *     3) WITH CHECK : INSERT calc_results cross-org refuse.
 *     4) org A ne SELECT que ses official_pvs, jamais ceux de B.
 *   IMMUABILITE (official_pvs, trigger 0006) :
 *     5) UPDATE d'un official_pv -> REFUSE (trigger). Sentinelle : retirer le
 *        trigger ferait passer ce test ROUGE (cf. mutation-check documente).
 *     6) DELETE d'un official_pv -> REFUSE (trigger).
 *   SCEAU (verifySeal cote app, primitive @roadsen/shared) :
 *     7) le content_hash STOCKE re-egale sealContentHash(input_canonical) ; une
 *        ligne official_pv « alteree » (output modifie) re-canonicalisee ne
 *        correspond plus au hash/hmac stockes -> verifySeal = false.
 *   FK COMPOSITE (anti cross-tenant) :
 *     8) un calc_results ne peut referencer un project d'un AUTRE org (FK
 *        composite (org_id, project_id) -> projects(org_id, id)).
 *   NUMEROTATION PAR ORG :
 *     9) allocate_pv_number incremente PAR org (compteurs independants) et RAISE
 *        sans contexte tenant.
 *
 * ANTI-SKIP (gating CI) : en CI (CI === 'true') OU des qu'une URL est fournie,
 * une base injoignable = ECHEC DUR (pas de skip silencieux), et un compteur final
 * exige qu'AU MOINS 8 cas aient REELLEMENT passe. Hors-CI sans base : cas marques
 * non-executes (honnetete d'ingenieur), chemin interdit en CI.
 *
 * Connexion via `pg` brut (choix du role par connexion), comme rls-isolation.
 */
import { randomUUID } from 'node:crypto';

import {
  canonicalize,
  sealContentHash,
  sealHmac,
  verifySeal,
  type SealableValue,
} from '@roadsen/shared';

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

// Secret de scellement : le test calcule le hmac de la MEME facon que l'app. En
// CI/local il est pose dans .env (PV_SIGNING_SECRET) ; on retombe sur une valeur
// de test deterministe si absent (le test ne vise pas la confidentialite du
// secret mais la coherence hash/hmac <-> contenu).
const PV_SECRET = process.env.PV_SIGNING_SECRET ?? 'secret-de-test-pv-roadsen';

function loadPgClient(): new (cfg: { connectionString: string }) => PgClient {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pg = require('pg') as {
      Client: new (cfg: { connectionString: string }) => PgClient;
    };
    return pg.Client;
  } catch {
    throw new Error(
      "Dependance 'pg' introuvable : le test PV ne peut pas se connecter.",
    );
  }
}

async function connectAs(url: string, label: string): Promise<PgClient> {
  if (!url) {
    throw new Error(
      `${label} absent : impossible de prouver le coeur PV. En CI, fournir ` +
        'DATABASE_URL (superuser, seed) ET RLS_TEST_DATABASE_URL (roadsen_app).',
    );
  }
  const Client = loadPgClient();
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

// Contenu scelle representatif (cf. seal.test). Fige : le test re-derive le sceau.
const SEALED_AT = '2026-06-25T10:00:00.000Z';
function contenuScelle(args: {
  pvNumber: string;
  userId: string;
  projectId: string;
  output: { [key: string]: SealableValue };
}): SealableValue {
  return {
    pvNumber: args.pvNumber,
    sealedAt: SEALED_AT,
    engineMeta: {
      engineId: 'chaussee-burmister',
      engineVersion: '1.0.0',
      engineSourceHash: 'a'.repeat(64),
    },
    identity: {
      userId: args.userId,
      projectId: args.projectId,
      projectName: 'Route A',
    },
    input: { trafic: 'T1', module: '1,5' },
    output: args.output,
    scienceStatus: 'unsigned',
  };
}

describe('Coeur d integrite du PV scelle (calc_results + official_pvs)', () => {
  let admin: PgClient | null = null;
  let app: PgClient | null = null;
  let connectError: Error | null = null;
  let passedCases = 0;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const calcA = randomUUID();
  const calcB = randomUUID();
  const pvA = randomUUID();
  const pvB = randomUUID();

  // Sceau du PV de A (re-derive cote test, insere par le seed admin).
  const canonA = canonicalize(
    contenuScelle({
      pvNumber: 'PV-RDS-org-a-2026-000001',
      userId: userA,
      projectId: projectA,
      output: { epaisseur: 0.32, verdict: 'OK' },
    }),
  );
  const hashA = sealContentHash(canonA);
  const hmacA = sealHmac(canonA, PV_SECRET);

  const canonB = canonicalize(
    contenuScelle({
      pvNumber: 'PV-RDS-org-b-2026-000001',
      userId: userB,
      projectId: projectB,
      output: { epaisseur: 0.4, verdict: 'OK' },
    }),
  );
  const hashB = sealContentHash(canonB);
  const hmacB = sealHmac(canonB, PV_SECRET);

  beforeAll(async () => {
    try {
      admin = await connectAs(ADMIN_URL, 'DATABASE_URL (seed/superuser)');
      app = await connectAs(APP_URL, 'RLS_TEST_DATABASE_URL (roadsen_app)');
    } catch (err) {
      connectError = err as Error;
      if (ENFORCE) throw connectError;
      return;
    }

    // SEED via admin (superuser -> bypasse RLS, y compris FORCE). Graphe 2 tenants.
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at)
       VALUES ($1,$2,'h','User A',now()), ($3,$4,'h','User B',now())`,
      [
        userA,
        `a-${userA.slice(0, 8)}@pv.test`,
        userB,
        `b-${userB.slice(0, 8)}@pv.test`,
      ],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt")
       VALUES ($1,'Org A',$2,now()), ($3,'Org B',$4,now())`,
      [orgA, `org-a-${orgA.slice(0, 8)}`, orgB, `org-b-${orgB.slice(0, 8)}`],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role)
       VALUES ($1,$2,$3,'OWNER'), ($4,$5,$6,'OWNER')`,
      [randomUUID(), orgA, userA, randomUUID(), orgB, userB],
    );
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, updated_at)
       VALUES ($1,$2,'P-A',$3,now()), ($4,$5,'P-B',$6,now())`,
      [projectA, orgA, userA, projectB, orgB, userB],
    );
    // calc_results : un par org.
    await admin.query(
      `INSERT INTO calc_results (id, org_id, project_id, user_id, engine_id, engine_version, input, output)
       VALUES ($1,$2,$3,$4,'chaussee-burmister','1.0.0','{"t":1}','{"e":0.32}')`,
      [calcA, orgA, projectA, userA],
    );
    await admin.query(
      `INSERT INTO calc_results (id, org_id, project_id, user_id, engine_id, engine_version, input, output)
       VALUES ($1,$2,$3,$4,'chaussee-burmister','1.0.0','{"t":1}','{"e":0.40}')`,
      [calcB, orgB, projectB, userB],
    );
    // official_pvs : un par org, scelle (hash/hmac re-derives ci-dessus).
    await admin.query(
      `INSERT INTO official_pvs
        (id, org_id, calc_result_id, project_id, pv_number, user_id, project_name,
         engine_id, engine_version, engine_source_hash, input_canonical, output,
         science_status, content_hash, hmac, sealed_at)
       VALUES ($1,$2,$3,$4,$5,$6,'Route A','chaussee-burmister','1.0.0',$7,$8,'{"epaisseur":0.32,"verdict":"OK"}','unsigned',$9,$10,$11)`,
      [
        pvA,
        orgA,
        calcA,
        projectA,
        'PV-RDS-org-a-2026-000001',
        userA,
        'a'.repeat(64),
        canonA,
        hashA,
        hmacA,
        SEALED_AT,
      ],
    );
    await admin.query(
      `INSERT INTO official_pvs
        (id, org_id, calc_result_id, project_id, pv_number, user_id, project_name,
         engine_id, engine_version, engine_source_hash, input_canonical, output,
         science_status, content_hash, hmac, sealed_at)
       VALUES ($1,$2,$3,$4,$5,$6,'Route A','chaussee-burmister','1.0.0',$7,$8,'{"epaisseur":0.4,"verdict":"OK"}','unsigned',$9,$10,$11)`,
      [
        pvB,
        orgB,
        calcB,
        projectB,
        'PV-RDS-org-b-2026-000001',
        userB,
        'a'.repeat(64),
        canonB,
        hashB,
        hmacB,
        SEALED_AT,
      ],
    );
  });

  afterAll(async () => {
    if (admin) {
      try {
        // official_pvs est IMMUABLE meme pour le superuser via le trigger DML :
        // on DESACTIVE le trigger le temps du teardown (DDL, droit du superuser).
        try {
          await admin.query(`ALTER TABLE official_pvs DISABLE TRIGGER USER`);
          await admin.query(
            `DELETE FROM official_pvs WHERE org_id IN ($1,$2)`,
            [orgA, orgB],
          );
        } finally {
          // try/finally : un echec de DELETE ne doit JAMAIS laisser la base de
          // recette avec son trigger d'immuabilite desactive.
          await admin.query(`ALTER TABLE official_pvs ENABLE TRIGGER USER`);
        }
        await admin.query(`DELETE FROM pv_counters WHERE org_id IN ($1,$2)`, [
          orgA,
          orgB,
        ]);
        await admin.query(`DELETE FROM calc_results WHERE org_id IN ($1,$2)`, [
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
        await admin.query(`DELETE FROM users WHERE id IN ($1,$2)`, [
          userA,
          userB,
        ]);
      } finally {
        await admin.end();
      }
    }
    if (app) await app.end();
  });

  const guarded = (name: string, fn: () => Promise<void>) => {
    it(name, async () => {
      if (!app) {
        if (ENFORCE) {
          throw (
            connectError ??
            new Error(`Base non joignable en CI : ${name} non prouve.`)
          );
        }
        console.warn(
          `[NON EXECUTE] ${name} — aucune base joignable (hors CI).`,
        );
        return;
      }
      await fn();
      passedCases += 1;
    });
  };

  // --- ISOLATION ------------------------------------------------------------

  guarded(
    '1) calc_results : sans org pose -> ECHOUE (fail-closed bruyant)',
    async () => {
      await app!.query(`RESET app.current_org`);
      await expect(app!.query('SELECT * FROM calc_results')).rejects.toThrow(
        /app\.current_org non defini/i,
      );
    },
  );

  guarded('2) calc_results : org A ne voit que ses calculs', async () => {
    await app!.query(`SET app.current_org = '${orgA}'`);
    const { rows } = await app!.query<{ org_id: string }>(
      'SELECT org_id FROM calc_results',
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.org_id === orgA)).toBe(true);
  });

  guarded(
    '3) calc_results : WITH CHECK refuse un INSERT cross-org',
    async () => {
      await app!.query(`SET app.current_org = '${orgA}'`);
      await expect(
        app!.query(
          `INSERT INTO calc_results (id, org_id, project_id, user_id, engine_id, engine_version, input, output)
           VALUES ($1,$2,$3,$4,'x','1','{}','{}')`,
          [randomUUID(), orgB, projectB, userA],
        ),
      ).rejects.toThrow();
    },
  );

  guarded('4) official_pvs : org A ne voit que ses PV', async () => {
    await app!.query(`SET app.current_org = '${orgA}'`);
    const { rows } = await app!.query<{ org_id: string; pv_number: string }>(
      'SELECT org_id, pv_number FROM official_pvs',
    );
    expect(rows.length).toBe(1);
    expect(rows[0].org_id).toBe(orgA);
    expect(rows.some((r) => r.pv_number === 'PV-RDS-org-b-2026-000001')).toBe(
      false,
    );
  });

  // --- IMMUABILITE — DOUBLE VERROU (privilege + trigger) -------------------
  //
  //  official_pvs est protege par DEUX barrieres independantes :
  //   (a) PRIVILEGE : roadsen_app n'a NI UPDATE NI DELETE (revoques en 0006) ->
  //       une tentative sous le runtime echoue en « permission denied » AVANT
  //       meme que le trigger ne s'evalue.
  //   (b) TRIGGER d'immuabilite : meme un role qui POSSEDE UPDATE/DELETE (owner,
  //       superuser, futur role mal configure) est refuse par le trigger.
  //  On prouve les DEUX separement (5 = privilege sous roadsen_app ; 6 = trigger
  //  sous le proprietaire/superuser qui, lui, a le privilege mais subit le trigger).
  //  Mutation-check du trigger : retirer le trigger 0006 ferait passer le cas 6
  //  ROUGE (l'UPDATE/DELETE sous l'owner aboutirait alors).

  guarded(
    '5) official_pvs : runtime (roadsen_app) n a NI UPDATE NI DELETE (privilege)',
    async () => {
      await app!.query(`SET app.current_org = '${orgA}'`);
      await expect(
        app!.query(
          `UPDATE official_pvs SET science_status = 'signed' WHERE id = $1`,
          [pvA],
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        app!.query(`DELETE FROM official_pvs WHERE id = $1`, [pvA]),
      ).rejects.toThrow(/permission denied/i);
    },
  );

  guarded(
    '6) official_pvs : trigger refuse UPDATE/DELETE meme avec le privilege',
    async () => {
      // Connexion admin = proprietaire/superuser : il A le privilege UPDATE/DELETE.
      // Le trigger d'immuabilite (TRIGGER USER, actif) doit malgre tout REFUSER.
      // (Le superuser ne contourne PAS un trigger ; seul DISABLE TRIGGER le fait,
      //  ce qu'on reserve au teardown.)
      await expect(
        admin!.query(
          `UPDATE official_pvs SET science_status = 'signed' WHERE id = $1`,
          [pvA],
        ),
      ).rejects.toThrow(/IMMUABLE/i);
      await expect(
        admin!.query(`DELETE FROM official_pvs WHERE id = $1`, [pvA]),
      ).rejects.toThrow(/IMMUABLE/i);
    },
  );

  // --- SCEAU (verifySeal cote app) -----------------------------------------

  guarded(
    '7) sceau : hash stocke re-verifie OK ; ligne alteree -> verifySeal faux',
    async () => {
      await app!.query(`SET app.current_org = '${orgA}'`);
      const { rows } = await app!.query<{
        input_canonical: string;
        content_hash: string;
        hmac: string;
      }>(
        'SELECT input_canonical, content_hash, hmac FROM official_pvs WHERE id = $1',
        [pvA],
      );
      expect(rows).toHaveLength(1);
      const pv = rows[0];
      // Le sceau stocke est COHERENT avec la chaine canonique stockee.
      expect(sealContentHash(pv.input_canonical)).toBe(pv.content_hash);
      expect(
        verifySeal(pv.input_canonical, pv.content_hash, pv.hmac, PV_SECRET),
      ).toBe(true);
      // Si on RE-CANONICALISE un contenu ALTERE (output different) et qu'on le
      // confronte au hash/hmac STOCKES, la verif echoue : une falsification de la
      // sortie scellee est detectee.
      const altere = canonicalize(
        contenuScelle({
          pvNumber: 'PV-RDS-org-a-2026-000001',
          userId: userA,
          projectId: projectA,
          output: { epaisseur: 0.99, verdict: 'OK' }, // 0.32 -> 0.99
        }),
      );
      expect(verifySeal(altere, pv.content_hash, pv.hmac, PV_SECRET)).toBe(
        false,
      );
    },
  );

  // --- FK COMPOSITE (anti cross-tenant) ------------------------------------

  guarded(
    '8) FK composite : un calc ne peut referencer un project d un autre org',
    async () => {
      // Sous orgA, tenter de creer un calc qui pointe projectB (org B). Meme si
      // l'org_id pose est orgA (WITH CHECK satisfait), la FK composite
      // (org_id, project_id) -> projects(org_id, id) echoue : (orgA, projectB)
      // n'existe pas. Preuve que l'enfant ne franchit pas le tenant via son parent.
      await app!.query(`SET app.current_org = '${orgA}'`);
      await expect(
        app!.query(
          `INSERT INTO calc_results (id, org_id, project_id, user_id, engine_id, engine_version, input, output)
           VALUES ($1,$2,$3,$4,'x','1','{}','{}')`,
          [randomUUID(), orgA, projectB, userA],
        ),
      ).rejects.toThrow();
    },
  );

  // --- NUMEROTATION PAR ORG -------------------------------------------------

  guarded(
    '9) allocate_pv_number : compteurs independants par org + RAISE sans contexte',
    async () => {
      // Sans contexte -> RAISE (via app_current_org()).
      await app!.query(`RESET app.current_org`);
      await expect(
        app!.query(`SELECT allocate_pv_number(2026)`),
      ).rejects.toThrow(/app\.current_org non defini/i);

      // Sous orgA : 1re allocation = 1, 2e = 2.
      await app!.query(`SET app.current_org = '${orgA}'`);
      const a1 = await app!.query<{ allocate_pv_number: string }>(
        `SELECT allocate_pv_number(2026)`,
      );
      const a2 = await app!.query<{ allocate_pv_number: string }>(
        `SELECT allocate_pv_number(2026)`,
      );
      expect(Number(a1.rows[0].allocate_pv_number)).toBe(1);
      expect(Number(a2.rows[0].allocate_pv_number)).toBe(2);

      // Sous orgB : compteur INDEPENDANT -> repart a 1 (numerotation par org).
      await app!.query(`SET app.current_org = '${orgB}'`);
      const b1 = await app!.query<{ allocate_pv_number: string }>(
        `SELECT allocate_pv_number(2026)`,
      );
      expect(Number(b1.rows[0].allocate_pv_number)).toBe(1);
    },
  );

  // GARDE-FOU ANTI-FAUX-VERT : >= 8 cas reellement executes en CI/avec URL.
  it('couverture : >= 8 cas reellement executes (en CI/avec URL)', () => {
    if (!ENFORCE) {
      console.warn('[NON EXECUTE] couverture ignoree hors CI et sans URL.');
      return;
    }
    expect(passedCases).toBeGreaterThanOrEqual(8);
  });
});
