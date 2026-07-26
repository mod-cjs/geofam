/**
 * Test e2e — LIMITE DE CORPS de la capture de document (option-3) — contre la
 * VRAIE base (supertest -> app NestJS reelle -> PostgreSQL).
 *
 * SENTINELLE ANTI-REGRESSION (bug de recette) : l'onglet « details » d'un calcul
 * fastlab restait VIDE car la capture (POST snapshot { displayHtml, printHtml },
 * ~180 Kio pour une note multi-feuilles + 8 courbes SVG) depassait la limite de
 * corps JSON PAR DEFAUT d'Express (100 Kio = 102400 octets) -> 413 Payload Too
 * Large AVANT meme la garde §8 / le DTO -> capture jamais persistee (best-effort
 * cote front) -> getCalcSnapshot renvoie null -> details vide.
 *
 * Ce que ce test prouve, EN BRANCHANT l'app EXACTEMENT comme la prod (configureApp,
 * qui pose desormais useBodyParser('json', { limit: '5mb' })) :
 *   A) un snapshot INERTE de ~200 Kio est ACCEPTE (201) et PERSISTE (GET -> 200,
 *      contenu identique). ROUGE sans le fix (413), VERT avec.
 *   B) la GARDE §8 tient toujours : un HTML volumineux (> 100 Kio, donc au-dela de
 *      l'ancienne limite) MAIS porteur d'une balise active est rejete 400 par
 *      assertInertHtml — le relevement de la limite de corps NE contourne PAS la
 *      garde de confidentialite/inertie.
 *
 * ANTI-SKIP : DATABASE_URL absent ET CI -> echec dur. Hors CI sans base ->
 * non-execute (honnete), interdit en CI.
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
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  end: () => Promise<void>;
};
type PgClientCtor = new (cfg: { connectionString: string }) => PgClient;

interface CalcBody {
  calcResultId?: unknown;
}

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const ENFORCE = process.env.CI === 'true' || ADMIN_URL.length > 0;

function loadPgClient(): PgClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pg') as { Client: PgClientCtor };
  return mod.Client;
}

/**
 * HTML INERTE volumineux (aucune balise active, aucun `on…=`, aucun schema
 * `javascript:`/`data:`, aucun marqueur confidentiel) d'AU MOINS `bytes` octets —
 * padding par des 'x' (jamais un motif que la garde §8 refuse). Sert a fabriquer
 * un corps qui DEPASSE l'ancienne limite 100 Kio tout en restant sous le DTO (1 Mio).
 */
function inertHtml(bytes: number): string {
  const head = '<!doctype html><html><body><section><div>';
  const tail = '</div></section></body></html>';
  const padLen = Math.max(0, bytes - head.length - tail.length);
  return head + 'x'.repeat(padLen) + tail;
}

describe('Capture snapshot — limite de corps JSON (e2e)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  const orgA = randomUUID();
  const slugA = `org-bl-${orgA.slice(0, 8)}`;
  const engineerA = randomUUID();
  const projectA = randomUUID();
  const PASSWORD = 'Sup3r-Secret!';
  const email = `eng-${engineerA.slice(0, 8)}@roadsen.test`;

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
      `INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1,$2,$3,'Eng BL',now())`,
      [engineerA, email, hash],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,'Org BL',$2,now())`,
      [orgA, slugA],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES ($1,$2,$3,'ENGINEER')`,
      [randomUUID(), orgA, engineerA],
    );
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, updated_at) VALUES ($1,$2,'P-BL',$3,now())`,
      [projectA, orgA, engineerA],
    );
    await admin.query(
      `INSERT INTO subscriptions
         (id, org_id, pack, entitlements, date_debut, date_fin, quota, consommation, created_at, updated_at)
       VALUES ($1,$2,'ROUTES', ARRAY['burmister'], now() - interval '1 day', now() + interval '365 days', 1000, 0, now(), now())`,
      [randomUUID(), orgA],
    );

    process.env.ROADSEN_DEV_HEADERS = '0';
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // BRANCHEMENT IDENTIQUE A LA PROD : configureApp pose la limite de corps JSON
    // (useBodyParser '5mb') AVANT app.init() — c'est CE chemin que le test exerce.
    configureApp(app);
    await app.init();
  }, 60_000);

  afterAll(async () => {
    if (admin) {
      try {
        await admin.query(`DELETE FROM calc_snapshots WHERE org_id = $1`, [
          orgA,
        ]);
        await admin.query(`DELETE FROM calc_results WHERE org_id = $1`, [orgA]);
        await admin.query(`DELETE FROM projects WHERE org_id = $1`, [orgA]);
        await admin.query(`DELETE FROM memberships WHERE org_id = $1`, [orgA]);
        await admin.query(`ALTER TABLE usage_ledger DISABLE TRIGGER USER`);
        try {
          await admin.query(`DELETE FROM usage_ledger WHERE org_id = $1`, [
            orgA,
          ]);
        } finally {
          await admin.query(`ALTER TABLE usage_ledger ENABLE TRIGGER USER`);
        }
        await admin.query(`DELETE FROM subscriptions WHERE org_id = $1`, [
          orgA,
        ]);
        await admin.query(`DELETE FROM organizations WHERE id = $1`, [orgA]);
        await admin.query(`DELETE FROM users WHERE id = $1`, [engineerA]);
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

  let tokenCache: string | null = null;
  async function login(): Promise<string> {
    if (tokenCache) return tokenCache;
    const res = await request(server())
      .post('/auth/login')
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    tokenCache = String((res.body as { accessToken?: unknown }).accessToken);
    return tokenCache;
  }

  // Cree un calc_result (via le vrai recalcul serveur) pour disposer d'une cible de
  // snapshot valide et ECRIVABLE, comme le fait le front avant la capture.
  async function newCalcId(token: string): Promise<string> {
    const res = await request(server())
      .post(`/projects/${projectA}/calc/burmister`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', orgA)
      .send(burmisterInput);
    expect(res.status).toBe(201);
    return String((res.body as CalcBody).calcResultId);
  }

  // --- A) SENTINELLE 413 -> 201 : corps ~200 Kio accepte + persiste ----------

  it('A) accepte et persiste un snapshot inerte de ~200 Kio (au-dela de l ancienne limite 100 Kio)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login();
    const calcId = await newCalcId(token);

    // Chaque champ ~100 Kio -> corps total ~200 Kio, tres au-dela de 102400 octets
    // (defaut Express) mais sous le DTO (1 Mio/champ). Sans le fix : 413. Avec : 201.
    const displayHtml = inertHtml(100 * 1024);
    const printHtml = inertHtml(100 * 1024);
    const totalBytes =
      Buffer.byteLength(displayHtml, 'utf8') +
      Buffer.byteLength(printHtml, 'utf8');
    // Garantit que le corps depasse REELLEMENT l'ancienne limite (sinon le test ne
    // prouverait rien) — borne basse explicite.
    expect(totalBytes).toBeGreaterThan(102_400);

    const res = await request(server())
      .post(`/projects/${projectA}/calc-results/${calcId}/snapshot`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', orgA)
      .send({ displayHtml, printHtml });
    // Cœur de la sentinelle : 201, PAS 413.
    expect(res.status).toBe(201);
    expect((res.body as { ok?: unknown }).ok).toBe(true);

    // PERSISTANCE reelle : relecture -> 200 + contenu identique (la capture n'a pas
    // ete perdue en silence -> l'onglet details ne sera plus vide).
    const read = await request(server())
      .get(`/projects/${projectA}/calc-results/${calcId}/snapshot`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', orgA);
    expect(read.status).toBe(200);
    const snap = read.body as { displayHtml?: unknown; printHtml?: unknown };
    expect(snap.displayHtml).toBe(displayHtml);
    expect(snap.printHtml).toBe(printHtml);
  });

  // --- B) La garde §8 tient malgre la limite relevee ------------------------

  it('B) rejette (400) un HTML volumineux porteur d une balise active — la garde §8 n est PAS contournee', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login();
    const calcId = await newCalcId(token);

    // > 100 Kio (franchit l'ancienne limite, donc atteint bien le service grace au
    // fix) mais < 1 Mio (passe le DTO) ET porteur d'un <script> -> assertInertHtml
    // doit refuser en 400 (balise active), jamais 201 ni 413.
    const displayHtml = inertHtml(100 * 1024);
    const printHtml =
      inertHtml(120 * 1024) + '<script>alert(1)</script></body></html>';
    expect(Buffer.byteLength(printHtml, 'utf8')).toBeGreaterThan(102_400);

    const res = await request(server())
      .post(`/projects/${projectA}/calc-results/${calcId}/snapshot`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', orgA)
      .send({ displayHtml, printHtml });
    expect(res.status).toBe(400);
    // Aucune capture persistee pour ce calcul (la garde a refuse AVANT tout stockage).
    const read = await request(server())
      .get(`/projects/${projectA}/calc-results/${calcId}/snapshot`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', orgA);
    expect(read.status).toBe(404);
  });
});
