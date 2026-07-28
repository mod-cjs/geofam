/**
 * Test e2e — POINT DE FACTURATION = EMISSION DU PV (« voir gratuit, sceller
 * payant ») — contre la VRAIE base (Postgres reel, role applicatif via l'app).
 *
 * DECISION TITULAIRE : le quota (subscriptions.consommation + ledger append-only)
 * se decremente UNIQUEMENT a l'emission d'un PV scelle. Calculer (persister),
 * pre-visualiser (dry-run), re-emettre/consulter un PV deja scelle = GRATUIT.
 *
 * Chaque assertion s'appuie sur une CONTRE-PREUVE EN BASE (comptage
 * `consommation` avant/apres via la connexion superuser DATABASE_URL, et lignes
 * `usage_ledger` par `kind`). Un mock ne prouverait rien ici : c'est le decompte
 * SQL reel (reserveUnit -> UPDATE ... SET consommation = consommation + 1) qui
 * est sous test.
 *
 *   a) CALCUL persiste -> consommation INCHANGEE (aucune ligne ledger 'CALC').
 *      ROUGE avant le correctif : le calcul decrementait +1 (kind 'CALC').
 *   b) EMISSION PV -> consommation +1 (exactement une ligne ledger 'PV').
 *   c) RE-EMISSION / CONSULTATION d'un PV deja scelle -> AUCUN re-decompte.
 *   d) DRY-RUN (apercu) -> 0 (deja couvert ailleurs ; verrouille ici aussi).
 *   e) ISOLATION : le decompte d'une org n'affecte JAMAIS une autre.
 *
 * ANTI-SKIP : DATABASE_URL absent ET CI -> echec dur. Hors CI sans base ->
 * non-execute (honnete), jamais un faux vert.
 */
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BURMISTER_FIXTURES } from '@roadsen/engines';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/auth/password';

type PgClient = {
  connect: () => Promise<void>;
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  end: () => Promise<void>;
};
type PgClientCtor = new (cfg: { connectionString: string }) => PgClient;

interface CalcBody {
  calcResultId?: unknown;
  ok?: unknown;
}
interface PvBody {
  id?: unknown;
  pvNumber?: unknown;
}

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const ENFORCE = process.env.CI === 'true' || ADMIN_URL.length > 0;

function loadPgClient(): PgClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pg') as { Client: PgClientCtor };
  return mod.Client;
}

describe('Facturation = emission PV (e2e)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const slugA = `bill-a-${orgA.slice(0, 8)}`;
  const slugB = `bill-b-${orgB.slice(0, 8)}`;
  const engineerA = randomUUID(); // ENGINEER dans orgA
  const engineerB = randomUUID(); // ENGINEER dans orgB
  const projectA = randomUUID();
  const projectB = randomUUID();
  const PASSWORD = 'Sup3r-Secret!';

  const burmisterInput = BURMISTER_FIXTURES[0].input;

  jest.setTimeout(60_000);

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
      `INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES
        ($1,$2,$5,'Eng A',now()),
        ($3,$4,$5,'Eng B',now())`,
      [
        engineerA,
        `bill-eng-a-${engineerA.slice(0, 8)}@roadsen.test`,
        engineerB,
        `bill-eng-b-${engineerB.slice(0, 8)}@roadsen.test`,
        hash,
      ],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,'Bill A',$2,now()), ($3,'Bill B',$4,now())`,
      [orgA, slugA, orgB, slugB],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES
        ($1,$2,$3,'ENGINEER'), ($4,$5,$6,'ENGINEER')`,
      [randomUUID(), orgA, engineerA, randomUUID(), orgB, engineerB],
    );
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, updated_at) VALUES ($1,$2,'P-A',$3,now()), ($4,$5,'P-B',$6,now())`,
      [projectA, orgA, engineerA, projectB, orgB, engineerB],
    );
    // Abonnements : quota large, consommation initiale 0, entitlement 'burmister'.
    await admin.query(
      `INSERT INTO subscriptions
         (id, org_id, pack, entitlements, date_debut, date_fin, quota, consommation, created_at, updated_at)
       VALUES
         ($1,$2,'ROUTES', ARRAY['burmister'], now() - interval '1 day', now() + interval '365 days', 1000, 0, now(), now()),
         ($3,$4,'ROUTES', ARRAY['burmister'], now() - interval '1 day', now() + interval '365 days', 1000, 0, now(), now())`,
      [randomUUID(), orgA, randomUUID(), orgB],
    );

    process.env.ROADSEN_DEV_HEADERS = '0';
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    if (admin) {
      try {
        try {
          await admin.query(`ALTER TABLE official_pvs DISABLE TRIGGER USER`);
          await admin.query(
            `DELETE FROM official_pvs WHERE org_id IN ($1,$2)`,
            [orgA, orgB],
          );
        } finally {
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
        await admin.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [
          orgA,
          orgB,
        ]);
        await admin.query(`DELETE FROM users WHERE id IN ($1,$2)`, [
          engineerA,
          engineerB,
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

  const tokenCache = new Map<string, string>();
  async function login(email: string): Promise<string> {
    const cached = tokenCache.get(email);
    if (cached) return cached;
    const res = await request(server())
      .post('/auth/login')
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    const token = String((res.body as { accessToken?: unknown }).accessToken);
    tokenCache.set(email, token);
    return token;
  }
  const emailA = () => `bill-eng-a-${engineerA.slice(0, 8)}@roadsen.test`;

  const calc = (token: string, org: string, project: string, dryRun = false) =>
    request(server())
      .post(
        `/projects/${project}/calc/burmister${dryRun ? '?dryRun=true' : ''}`,
      )
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', org)
      .send(burmisterInput);
  const emit = (token: string, org: string, project: string, calcId: string) =>
    request(server())
      .post(`/projects/${project}/calc-results/${calcId}/pv`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', org);
  const getPv = (token: string, org: string, project: string, pvId: string) =>
    request(server())
      .get(`/projects/${project}/pvs/${pvId}`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', org);

  // CONTRE-PREUVE EN BASE (superuser) : compteur materialise de l'abonnement.
  async function conso(org: string): Promise<number> {
    const r = await admin!.query(
      `SELECT consommation FROM subscriptions WHERE org_id = $1`,
      [org],
    );
    return Number((r.rows[0] as { consommation: number }).consommation);
  }
  // Lignes de ledger par kind pour une org (append-only ; on ne compte que).
  async function ledgerCount(
    org: string,
    kind: 'CALC' | 'PV',
  ): Promise<number> {
    const r = await admin!.query(
      `SELECT count(*)::int AS n FROM usage_ledger WHERE org_id = $1 AND kind = $2`,
      [org, kind],
    );
    return Number((r.rows[0] as { n: number }).n);
  }

  // --- a) CALCUL PERSISTE = GRATUIT -----------------------------------------

  it('a) given un calcul PERSISTE, when il reussit, then consommation INCHANGEE et aucune ligne ledger CALC', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailA());

    const consoBefore = await conso(orgA);
    const ledgerCalcBefore = await ledgerCount(orgA, 'CALC');

    const res = await calc(token, orgA, projectA);
    expect(res.status).toBe(201);
    expect(typeof (res.body as CalcBody).calcResultId).toBe('string');

    const consoAfter = await conso(orgA);
    const ledgerCalcAfter = await ledgerCount(orgA, 'CALC');

    // « voir gratuit » : persister un calcul ne brule AUCUNE unite.
    expect(consoAfter).toBe(consoBefore);
    // Aucune ligne de ledger 'CALC' (le kind 'CALC' ne doit plus jamais etre ecrit).
    expect(ledgerCalcAfter).toBe(ledgerCalcBefore);
  });

  // --- b) EMISSION PV = PAYANT ----------------------------------------------

  it('b) given une EMISSION de PV scelle, when 1er scellement, then consommation +1 et exactement une ligne ledger PV', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailA());
    const created = await calc(token, orgA, projectA);
    const calcId = String((created.body as CalcBody).calcResultId);

    const consoBefore = await conso(orgA);
    const ledgerPvBefore = await ledgerCount(orgA, 'PV');

    const res = await emit(token, orgA, projectA, calcId);
    expect(res.status).toBe(201);
    expect(typeof (res.body as PvBody).id).toBe('string');

    const consoAfter = await conso(orgA);
    const ledgerPvAfter = await ledgerCount(orgA, 'PV');

    // « sceller payant » : exactement une unite consommee pour ce PV.
    expect(consoAfter).toBe(consoBefore + 1);
    expect(ledgerPvAfter).toBe(ledgerPvBefore + 1);
  });

  // --- c) RE-EMISSION / CONSULTATION = GRATUIT (idempotence) ----------------

  it('c) given un PV DEJA scelle, when on le re-emet puis le consulte, then AUCUN re-decompte', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailA());
    const created = await calc(token, orgA, projectA);
    const calcId = String((created.body as CalcBody).calcResultId);

    // 1er scellement (paye).
    const first = await emit(token, orgA, projectA, calcId);
    expect(first.status).toBe(201);
    const pvId = String((first.body as PvBody).id);

    const consoBefore = await conso(orgA);
    const ledgerPvBefore = await ledgerCount(orgA, 'PV');

    // RE-EMISSION idempotente : meme PV, pas de nouveau numero, pas de conso.
    const second = await emit(token, orgA, projectA, calcId);
    expect(second.status).toBe(201);
    expect((second.body as PvBody).id).toBe(pvId);
    // CONSULTATION : lecture pure.
    const read = await getPv(token, orgA, projectA, pvId);
    expect(read.status).toBe(200);

    const consoAfter = await conso(orgA);
    const ledgerPvAfter = await ledgerCount(orgA, 'PV');

    expect(consoAfter).toBe(consoBefore);
    expect(ledgerPvAfter).toBe(ledgerPvBefore);
  });

  // --- d) DRY-RUN (APERCU) = GRATUIT ----------------------------------------

  it('d) given un APERCU (dryRun=true), when il calcule, then consommation INCHANGEE et calcResultId null', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailA());

    const consoBefore = await conso(orgA);
    const res = await calc(token, orgA, projectA, true);
    expect(res.status).toBe(201);
    // Apercu : rien de scellable.
    expect((res.body as CalcBody).calcResultId).toBeNull();

    const consoAfter = await conso(orgA);
    expect(consoAfter).toBe(consoBefore);
  });

  // --- e) ISOLATION : le decompte d'une org n'affecte pas une autre ----------

  it('e) given une EMISSION dans orgA, when elle consomme, then la consommation d orgB est INCHANGEE', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const tokenA = await login(emailA());

    const consoBBefore = await conso(orgB);

    const created = await calc(tokenA, orgA, projectA);
    const calcId = String((created.body as CalcBody).calcResultId);
    const emitted = await emit(tokenA, orgA, projectA, calcId);
    expect(emitted.status).toBe(201);

    const consoBAfter = await conso(orgB);
    // L'org B ne bouge JAMAIS quand A consomme (RLS scope le decompte a A).
    expect(consoBAfter).toBe(consoBBefore);
  });
});
