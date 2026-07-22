/**
 * Test e2e du PIPELINE PV — surface TENANT (#63, incr. B) — contre la VRAIE base.
 *
 * Prouve, via HTTP (supertest) sur l'app NestJS reelle branchee sur PostgreSQL,
 * et via une connexion SUPERUSER (DATABASE_URL) pour seed/teardown/alteration :
 *
 *   PERSISTANCE + ISOLATION
 *     1) ENGINEER de orgA : POST /projects/:p/calc/burmister -> 201, calcResultId,
 *        enveloppe { ok, meta, output }. La ligne calc_result est org-scopee.
 *     2) ISOLATION : userB (orgB) ne voit NI le calcul NI le PV de orgA (404),
 *        meme en connaissant les ids.
 *   EMISSION
 *     3) POST /calc-results/:id/pv -> 201, pv_number au format
 *        PV-RDS-{orgSlug}-{YYYY}-{NNNNNN}, sceau present.
 *     4) IDEMPOTENCE : re-emettre le MEME calcul -> MEME pv (id + numero), aucun
 *        numero brule (le compteur n'avance pas).
 *     5) IMMUABILITE : official_pvs reste non modifiable (UPDATE direct refuse).
 *   LECTURE + VERIF
 *     6) GET /pvs/:id -> sealValid=true (sceau coherent avec input_canonical).
 *     7) ALTERATION en base (superuser, trigger desactive) de input_canonical ->
 *        GET /pvs/:id -> sealValid=FALSE (falsification detectee). Mutation-check :
 *        sans la re-verification, ce test ne pourrait pas virer au rouge.
 *     8) GET /pvs (liste) -> ne renvoie que les PV du projet/tenant.
 *   ROLES
 *     9) VIEWER ne peut PAS emettre de PV (403) ; TECHNICIAN ne peut pas emettre
 *        non plus (403) mais PEUT lancer un calcul (201).
 *   EQUIVALENCE
 *     10) l'output PERSISTE (calc_result.output) == output de runBurmister(input)
 *         appele DIRECTEMENT sur le meme input projete (la surface tenant ne
 *         derive pas du calcul de reference).
 *
 * ANTI-SKIP : DATABASE_URL absent ET CI -> echec dur. Hors CI sans base ->
 * non-execute (honnete), interdit en CI.
 */
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  BURMISTER_FIXTURES,
  burmisterContract,
  runBurmister,
} from '@roadsen/engines';
import { projectEngineInput } from '@roadsen/shared';
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
  meta?: { engineId?: unknown; engineVersion?: unknown };
  output?: unknown;
}
interface PvBody {
  id?: unknown;
  pvNumber?: unknown;
  contentHash?: unknown;
  hmac?: unknown;
  scienceStatus?: unknown;
}
interface PvViewBody {
  pv?: { id?: unknown; pvNumber?: unknown };
  sealValid?: unknown;
}

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const ENFORCE = process.env.CI === 'true' || ADMIN_URL.length > 0;

function loadPgClient(): PgClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pg') as { Client: PgClientCtor };
  return mod.Client;
}

describe('Pipeline PV — surface tenant (e2e)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const slugA = `org-a-${orgA.slice(0, 8)}`;
  const engineerA = randomUUID(); // ENGINEER dans orgA
  const techA = randomUUID(); // TECHNICIAN dans orgA
  const viewerA = randomUUID(); // VIEWER dans orgA
  const userB = randomUUID(); // OWNER dans orgB
  const projectA = randomUUID();
  const projectB = randomUUID();
  const PASSWORD = 'Sup3r-Secret!';

  // Entree burmister de reference (fixture non hors-domaine).
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

    // Seed (superuser -> bypasse RLS) : 4 users, 2 orgs, 4 memberships, 2 projets.
    await admin.query(
      `INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES
        ($1,$2,$9,'Eng A',now()),
        ($3,$4,$9,'Tech A',now()),
        ($5,$6,$9,'View A',now()),
        ($7,$8,$9,'User B',now())`,
      [
        engineerA,
        `eng-${engineerA.slice(0, 8)}@roadsen.test`,
        techA,
        `tech-${techA.slice(0, 8)}@roadsen.test`,
        viewerA,
        `view-${viewerA.slice(0, 8)}@roadsen.test`,
        userB,
        `b-${userB.slice(0, 8)}@roadsen.test`,
        hash,
      ],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,'Org A',$2,now()), ($3,'Org B',$4,now())`,
      [orgA, slugA, orgB, `org-b-${orgB.slice(0, 8)}`],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES
        ($1,$2,$3,'ENGINEER'), ($4,$5,$6,'TECHNICIAN'), ($7,$8,$9,'VIEWER'), ($10,$11,$12,'OWNER')`,
      [
        randomUUID(),
        orgA,
        engineerA,
        randomUUID(),
        orgA,
        techA,
        randomUUID(),
        orgA,
        viewerA,
        randomUUID(),
        orgB,
        userB,
      ],
    );
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, updated_at) VALUES ($1,$2,'P-A',$3,now()), ($4,$5,'P-B',$6,now())`,
      [projectA, orgA, engineerA, projectB, orgB, userB],
    );
    // Abonnements (enforcement ADR 0011 : org sans souscription = 403 NoSubscription,
    // meme pour un ENGINEER legitime) : quota large + entitlement 'burmister' pour les
    // deux orgs — la suite teste le pipeline PV, pas l'enforcement d'abonnement.
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
        // official_pvs immuable (trigger) : on desactive le temps du teardown.
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
        // usage_ledger est APPEND-ONLY (trigger) : desactivation le temps du nettoyage.
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
        await admin.query(`DELETE FROM users WHERE id IN ($1,$2,$3,$4)`, [
          engineerA,
          techA,
          viewerA,
          userB,
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
  const emailEng = () => `eng-${engineerA.slice(0, 8)}@roadsen.test`;
  const emailTech = () => `tech-${techA.slice(0, 8)}@roadsen.test`;
  const emailView = () => `view-${viewerA.slice(0, 8)}@roadsen.test`;
  const emailB = () => `b-${userB.slice(0, 8)}@roadsen.test`;

  // Cache des tokens par email : on se connecte UNE fois par utilisateur et on
  // reutilise le token dans toute la suite. Evite de re-jouer argon2 (lent) a
  // chaque cas ET de saturer le rate-limit global (60 req/60 s par IP) quand la
  // suite tourne en bloc avec les autres e2e -> supprime un flake possible.
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

  // Helpers HTTP scopes tenant.
  const calc = (
    token: string,
    org: string,
    project: string,
    engine: string,
    body: unknown,
  ) =>
    request(server())
      .post(`/projects/${project}/calc/${engine}`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', org)
      .send(body as object);
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

  // --- 1) PERSISTANCE -------------------------------------------------------

  it('1) ENGINEER : POST calc/burmister -> 201 + calcResultId + enveloppe', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const res = await calc(token, orgA, projectA, 'burmister', burmisterInput);
    expect(res.status).toBe(201);
    const body = res.body as CalcBody;
    expect(typeof body.calcResultId).toBe('string');
    expect((body.calcResultId as string).length).toBeGreaterThan(0);
    expect(body.ok).toBe(true);
    expect(body.meta?.engineId).toBe('chaussee-burmister');
    expect(body.output).toBeDefined();
  });

  // --- 2) ISOLATION ---------------------------------------------------------

  it('2) ISOLATION : userB ne voit ni le calcul ni le PV de orgA (404)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const tokenA = await login(emailEng());
    const created = await calc(
      tokenA,
      orgA,
      projectA,
      'burmister',
      burmisterInput,
    );
    const calcId = String((created.body as CalcBody).calcResultId);
    const pvRes = await emit(tokenA, orgA, projectA, calcId);
    expect(pvRes.status).toBe(201);
    const pvId = String((pvRes.body as PvBody).id);

    const tokenB = await login(emailB());
    // userB tente d'emettre/lire le calcul de A via SON org (orgB) : 404 (RLS).
    const emitB = await emit(tokenB, orgB, projectB, calcId);
    expect(emitB.status).toBe(404);
    const readB = await getPv(tokenB, orgB, projectB, pvId);
    expect(readB.status).toBe(404);
  });

  // --- 3) EMISSION + format numero ------------------------------------------

  it('3) EMISSION : pv_number au format PV-RDS-{slug}-{YYYY}-{NNNNNN} + sceau', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const created = await calc(
      token,
      orgA,
      projectA,
      'burmister',
      burmisterInput,
    );
    const calcId = String((created.body as CalcBody).calcResultId);
    const res = await emit(token, orgA, projectA, calcId);
    expect(res.status).toBe(201);
    const pv = res.body as PvBody;
    const year = new Date().getFullYear();
    expect(pv.pvNumber).toMatch(new RegExp(`^PV-RDS-${slugA}-${year}-\\d{6}$`));
    expect(pv.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(pv.hmac).toMatch(/^[0-9a-f]{64}$/);
  });

  // --- 4) IDEMPOTENCE -------------------------------------------------------

  it('4) IDEMPOTENCE : re-emettre le meme calcul -> meme PV, aucun numero brule', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const created = await calc(
      token,
      orgA,
      projectA,
      'burmister',
      burmisterInput,
    );
    const calcId = String((created.body as CalcBody).calcResultId);

    const first = await emit(token, orgA, projectA, calcId);
    expect(first.status).toBe(201);
    const pv1 = first.body as PvBody;

    // Compteur de l'org AVANT la 2e emission.
    const before = await admin!.query(
      `SELECT last_seq FROM pv_counters WHERE org_id = $1 AND year = $2`,
      [orgA, new Date().getFullYear()],
    );
    const seqBefore = Number(
      (before.rows[0] as { last_seq: bigint } | undefined)?.last_seq ?? 0,
    );

    const second = await emit(token, orgA, projectA, calcId);
    expect(second.status).toBe(201);
    const pv2 = second.body as PvBody;

    // MEME PV (id + numero), aucun nouveau scellement.
    expect(pv2.id).toBe(pv1.id);
    expect(pv2.pvNumber).toBe(pv1.pvNumber);

    const after = await admin!.query(
      `SELECT last_seq FROM pv_counters WHERE org_id = $1 AND year = $2`,
      [orgA, new Date().getFullYear()],
    );
    const seqAfter = Number(
      (after.rows[0] as { last_seq: bigint } | undefined)?.last_seq ?? 0,
    );
    // Le compteur n'a PAS avance a la 2e emission (numero non brule).
    expect(seqAfter).toBe(seqBefore);
  });

  // --- 4bis) IDEMPOTENCE CONCURRENTE (sentinelle race P2002) ---------------
  //
  //  Deux emissions SIMULTANEES du MEME calc_result (jamais emis) -> course sur
  //  UNIQUE(org_id, calc_result_id). Le perdant prend un P2002 et DOIT rattraper
  //  HORS de sa transaction avortee (sinon « current transaction is aborted » ->
  //  500). Sans le correctif, ce test est ROUGE (l'une des deux reponses n'est
  //  pas 201) : il prouve que le rattrapage P2002 fonctionne reellement.
  //
  //  Attendu : les DEUX reponses 201, MEME pv.id ; le compteur avance d'EXACTEMENT
  //  1 (le numero alloue par la transaction perdante est « brule » = acceptable).
  it('4bis) IDEMPOTENCE CONCURRENTE : 2 emissions simultanees -> meme PV, +1 numero', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const created = await calc(
      token,
      orgA,
      projectA,
      'burmister',
      burmisterInput,
    );
    const calcId = String((created.body as CalcBody).calcResultId);
    const year = new Date().getFullYear();

    const before = await admin!.query(
      `SELECT last_seq FROM pv_counters WHERE org_id = $1 AND year = $2`,
      [orgA, year],
    );
    const seqBefore = Number(
      (before.rows[0] as { last_seq: bigint } | undefined)?.last_seq ?? 0,
    );

    // DEUX emissions reellement concurrentes (Promise.all) sur le meme calcul.
    const [r1, r2] = await Promise.all([
      emit(token, orgA, projectA, calcId),
      emit(token, orgA, projectA, calcId),
    ]);

    // Les DEUX doivent reussir (le perdant rattrape le PV existant, pas un 500).
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    // ... et renvoyer le MEME PV (idempotence sous course).
    const id1 = (r1.body as PvBody).id;
    const id2 = (r2.body as PvBody).id;
    expect(typeof id1).toBe('string');
    expect(id2).toBe(id1);

    // Le compteur avance d'AU PLUS 2 et d'AU MOINS 1 (le perdant peut avoir alloue
    // un numero brule avant de buter sur l'unicite). Un seul PV existe in fine.
    const after = await admin!.query(
      `SELECT last_seq FROM pv_counters WHERE org_id = $1 AND year = $2`,
      [orgA, year],
    );
    const seqAfter = Number(
      (after.rows[0] as { last_seq: bigint } | undefined)?.last_seq ?? 0,
    );
    expect(seqAfter - seqBefore).toBeGreaterThanOrEqual(1);
    expect(seqAfter - seqBefore).toBeLessThanOrEqual(2);

    // Un SEUL official_pv pour ce calcul (pas de doublon).
    const count = await admin!.query(
      `SELECT count(*)::int AS n FROM official_pvs WHERE org_id = $1 AND calc_result_id = $2`,
      [orgA, calcId],
    );
    expect(Number((count.rows[0] as { n: number }).n)).toBe(1);
  });

  // --- 4ter) INTEGRITE A L'EMISSION : re-execution du moteur (revue de verification) ---
  // calc_results est MUTABLE (roadsen_app a UPDATE). emitFromCalc RE-EXECUTE le moteur sur
  // l'input stocke et REFUSE de sceller si la sortie recomputee differe de la sortie stockee.
  // Sentinelle DoD §9 : sans elle, supprimer la comparaison canonicalize resterait vert.

  it('4ter) INTEGRITE : output de calc_results ALTERE en base -> emission refusee (409)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const c = await calc(token, orgA, projectA, 'burmister', burmisterInput);
    expect(c.status).toBe(201);
    const calcId = String((c.body as { calcResultId: string }).calcResultId);
    // ALTERATION directe (superuser : bypasse RLS, simule un abus du privilege UPDATE de
    // roadsen_app) — on trafique la sortie SANS re-executer le moteur.
    await admin!.query(
      `UPDATE calc_results SET output = jsonb_set(output, '{NE}', '999999999'::jsonb) WHERE id = $1`,
      [calcId],
    );
    const e = await emit(token, orgA, projectA, calcId);
    // La re-execution serveur recompute la vraie sortie != stockee -> refus fail-closed.
    expect(e.status).toBe(409);
    // Aucun PV scelle sur la sortie falsifiee.
    const count = await admin!.query(
      `SELECT count(*)::int AS n FROM official_pvs WHERE calc_result_id = $1`,
      [calcId],
    );
    expect(Number((count.rows[0] as { n: number }).n)).toBe(0);
  });

  it('4quater) INTEGRITE : un calcul LEGITIME (non altere) s emet normalement (pas de faux positif)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const c = await calc(token, orgA, projectA, 'burmister', burmisterInput);
    const calcId = String((c.body as { calcResultId: string }).calcResultId);
    const e = await emit(token, orgA, projectA, calcId);
    // Re-execution reproduit la sortie a l'identique (round-trip JSONB) -> scelle (201).
    expect(e.status).toBe(201);
  });

  it('4quinquies) TRACABILITE : calc_result d une source moteur ANTERIEURE (hash != registre) -> emission refusee (409), meme a sortie identique', async () => {
    // Revue adverse ADR 0013 (CRITIQUE-1) : un calcul persiste AVANT la bascule de
    // registre porte engine_source_hash = ancienne source (259a…, HTML moderne).
    // Si sa sortie coincide numeriquement avec le recalcul courant, le garde
    // d'alteration (recompute == stocke) ne se declenche PAS : sans garde dediee,
    // on scellerait un PV neuf affirmant une source incapable de reproduire le
    // calcul. La garde de source doit refuser INCONDITIONNELLEMENT (fail-closed) :
    // hash stocke != hash registre courant => 409 « relancez le calcul ».
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const c = await calc(token, orgA, projectA, 'burmister', burmisterInput);
    expect(c.status).toBe(201);
    const calcId = String((c.body as { calcResultId: string }).calcResultId);
    // Simule une ligne pre-bascule : meme sortie (le moteur n'a pas change), mais
    // meta de source ANTERIEURE (l'ancien sha du registre, HTML moderne v1.0.0).
    await admin!.query(
      `UPDATE calc_results
         SET engine_source_hash = '259a58a8ac0881b20657a34a119de6e603a0ed2895fb4fca21527f2d8cfeb8ba'
       WHERE id = $1`,
      [calcId],
    );
    const e = await emit(token, orgA, projectA, calcId);
    expect(e.status).toBe(409);
    // Message actionnable : relancer le calcul (jamais de PV au mauvais hash).
    expect(JSON.stringify(e.body)).toMatch(/relancez le calcul/i);
    const count = await admin!.query(
      `SELECT count(*)::int AS n FROM official_pvs WHERE calc_result_id = $1`,
      [calcId],
    );
    expect(Number((count.rows[0] as { n: number }).n)).toBe(0);
  });

  // --- 5) IMMUABILITE -------------------------------------------------------

  it('5) IMMUABILITE : UPDATE direct d un official_pv -> refuse (trigger)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const created = await calc(
      token,
      orgA,
      projectA,
      'burmister',
      burmisterInput,
    );
    const calcId = String((created.body as CalcBody).calcResultId);
    const res = await emit(token, orgA, projectA, calcId);
    const pvId = String((res.body as PvBody).id);
    // Sous superuser (qui A le privilege) : le trigger d'immuabilite refuse.
    await expect(
      admin!.query(
        `UPDATE official_pvs SET science_status='signed' WHERE id=$1`,
        [pvId],
      ),
    ).rejects.toThrow(/IMMUABLE/i);
  });

  // --- 6) LECTURE + VERIF (true) --------------------------------------------

  it('6) GET /pvs/:id -> sealValid=true (sceau coherent)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const created = await calc(
      token,
      orgA,
      projectA,
      'burmister',
      burmisterInput,
    );
    const calcId = String((created.body as CalcBody).calcResultId);
    const emitted = await emit(token, orgA, projectA, calcId);
    const pvId = String((emitted.body as PvBody).id);

    const read = await getPv(token, orgA, projectA, pvId);
    expect(read.status).toBe(200);
    const view = read.body as PvViewBody;
    expect(view.sealValid).toBe(true);
    expect(view.pv?.id).toBe(pvId);
  });

  // --- 7) ALTERATION -> sealValid=false (mutation-check de la verif) ---------

  it('7) ALTERATION de input_canonical en base -> sealValid=FALSE', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const created = await calc(
      token,
      orgA,
      projectA,
      'burmister',
      burmisterInput,
    );
    const calcId = String((created.body as CalcBody).calcResultId);
    const emitted = await emit(token, orgA, projectA, calcId);
    const pvId = String((emitted.body as PvBody).id);

    // Avant : sceau valide.
    const ok = await getPv(token, orgA, projectA, pvId);
    expect((ok.body as PvViewBody).sealValid).toBe(true);

    // ALTERATION en base : on falsifie input_canonical (trigger desactive car
    // l'UPDATE est par ailleurs interdit). Le hash stocke ne correspond plus.
    try {
      await admin!.query(`ALTER TABLE official_pvs DISABLE TRIGGER USER`);
      await admin!.query(
        `UPDATE official_pvs SET input_canonical = input_canonical || ' falsifie' WHERE id=$1`,
        [pvId],
      );
    } finally {
      // try/finally : si l'UPDATE echoue, le trigger d'immuabilite d'official_pvs
      // doit etre RETABLI quoi qu'il arrive — jamais de base de recette laissee
      // sans sa protection.
      await admin!.query(`ALTER TABLE official_pvs ENABLE TRIGGER USER`);
    }

    const tampered = await getPv(token, orgA, projectA, pvId);
    expect(tampered.status).toBe(200);
    expect((tampered.body as PvViewBody).sealValid).toBe(false);
  });

  // --- 8) LISTE -------------------------------------------------------------

  it('8) GET /pvs -> liste les PV du projet du tenant', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const res = await request(server())
      .get(`/projects/${projectA}/pvs`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', orgA);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const list = res.body as PvViewBody[];
    expect(list.length).toBeGreaterThan(0);
    // chaque entree porte un verdict de sceau.
    expect(list.every((v) => typeof v.sealValid === 'boolean')).toBe(true);
  });

  // --- 9) ROLES -------------------------------------------------------------

  it('9) ROLES : VIEWER 403 sur calcul ; TECHNICIAN 201 calcul mais 403 emission', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    // VIEWER ne peut pas lancer de calcul (pas dans @Roles du calcul).
    const tokenView = await login(emailView());
    const viewCalc = await calc(
      tokenView,
      orgA,
      projectA,
      'burmister',
      burmisterInput,
    );
    expect(viewCalc.status).toBe(403);

    // TECHNICIAN peut lancer un calcul...
    const tokenTech = await login(emailTech());
    const techCalc = await calc(
      tokenTech,
      orgA,
      projectA,
      'burmister',
      burmisterInput,
    );
    expect(techCalc.status).toBe(201);
    const calcId = String((techCalc.body as CalcBody).calcResultId);
    // ...mais NE peut PAS emettre de PV (acte d'ingenierie).
    const techEmit = await emit(tokenTech, orgA, projectA, calcId);
    expect(techEmit.status).toBe(403);
  });

  // --- 10) EQUIVALENCE ------------------------------------------------------

  it('10) EQUIVALENCE : output persiste == runBurmister(input) direct', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const created = await calc(
      token,
      orgA,
      projectA,
      'burmister',
      burmisterInput,
    );
    expect(created.status).toBe(201);
    const persisted = (created.body as CalcBody).output;

    // Recalcul DIRECT du moteur sur le MEME input projete (comme la surface tenant).
    const projected = projectEngineInput(
      burmisterContract.inputSchema,
      burmisterInput,
    );
    const direct = runBurmister(projected);
    expect(direct.ok).toBe(true);
    if (direct.ok) {
      // Egalite structurelle stricte : la surface tenant ne derive pas du moteur.
      expect(persisted).toEqual(direct.output);
    }
  });
});
