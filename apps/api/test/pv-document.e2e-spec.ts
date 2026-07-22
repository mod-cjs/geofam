/**
 * Test e2e du SCELLEMENT DU DOCUMENT CLIENT (option-3, 0023) — VRAIE base Postgres.
 *
 * Prouve, via HTTP (supertest) sur l'app NestJS reelle branchee sur PostgreSQL,
 * et via une connexion SUPERUSER (DATABASE_URL) pour seed/teardown/alteration :
 *
 *   CAPTURE + GARDE §8
 *     1) ENGINEER capture le document (displayHtml + printHtml) d'un calcul -> 201 {ok}.
 *     2) GARDE §8 : capturer un HTML avec <script> -> 400 ; avec un marqueur moteur -> 400.
 *     3) ISOLATION capture : userB (orgB) ne peut PAS capturer le calcul de orgA (404).
 *   SCELLEMENT
 *     4) EMISSION apres capture -> le contenu canonique porte document.sha256
 *        (sha256 du printHtml) : le document est SCELLE.
 *   SERVICE + RE-VERIFICATION (source = official_pv.document_html IMMUABLE, B1)
 *     4+5) GET /pvs/:id/document -> 200 text/html + CSP sandbox/nosniff (M1), corps
 *          == printHtml ; official_pv.document_html = copie figee autoportante.
 *     6) ISOLATION lecture : userB ne lit pas le document de orgA (404).
 *     7) TAMPER : alterer document_html en base APRES scellement -> GET document ->
 *        409 (mutation-check : sans la re-verif sha256, ce test ne pourrait rougir).
 *     7bis) REGENERABILITE (B1) : re-capture (UPSERT) APRES emission -> GET document
 *        renvoie TOUJOURS le document ORIGINAL scelle (200), jamais 409.
 *     8) RETRO-COMPAT : un PV emis SANS capture n'a pas de champ document -> GET
 *        document -> 404 (l'appelant retombe sur le PDF pdfmake).
 *     9) LECTURE AVANT SCELLEMENT : GET calc-results/:id/snapshot (200/404/isolation).
 *
 * ANTI-SKIP : DATABASE_URL absent ET CI -> echec dur. Hors CI sans base ->
 * non-execute (honnete), interdit en CI.
 */
import { createHash, randomUUID } from 'node:crypto';

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
}
interface PvBody {
  id?: unknown;
}

const ADMIN_URL = process.env.DATABASE_URL ?? '';
const ENFORCE = process.env.CI === 'true' || ADMIN_URL.length > 0;

// Document d'impression INERTE (HTML/SVG auto-contenu, zero JS) — ce que l'outil
// client produit a l'impression. sha256 de CETTE chaine = empreinte scellee.
const PRINT_HTML =
  '<html><head><meta charset="utf-8"></head><body><h1>Procès-verbal</h1>' +
  '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>' +
  '<p>NE = 1467314.82 µdef ; distorsion = 0,5 ‰</p></body></html>';
const DISPLAY_HTML = '<div class="pv-display">' + PRINT_HTML + '</div>';

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function loadPgClient(): PgClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pg') as { Client: PgClientCtor };
  return mod.Client;
}

describe('Scellement du document client — option-3 (e2e)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const slugA = `doc-a-${orgA.slice(0, 8)}`;
  const engineerA = randomUUID();
  const userB = randomUUID();
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
        ($1,$2,$5,'Eng A',now()), ($3,$4,$5,'User B',now())`,
      [
        engineerA,
        `eng-${engineerA.slice(0, 8)}@roadsen.test`,
        userB,
        `b-${userB.slice(0, 8)}@roadsen.test`,
        hash,
      ],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,'Doc A',$2,now()), ($3,'Doc B',$4,now())`,
      [orgA, slugA, orgB, `doc-b-${orgB.slice(0, 8)}`],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES
        ($1,$2,$3,'ENGINEER'), ($4,$5,$6,'OWNER')`,
      [randomUUID(), orgA, engineerA, randomUUID(), orgB, userB],
    );
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, updated_at) VALUES ($1,$2,'P-A',$3,now()), ($4,$5,'P-B',$6,now())`,
      [projectA, orgA, engineerA, projectB, orgB, userB],
    );
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
          // try/finally : un echec de DELETE ne doit JAMAIS laisser la base de
          // recette avec son trigger d'integrite desactive.
          await admin.query(`ALTER TABLE official_pvs ENABLE TRIGGER USER`);
        }
        await admin.query(`DELETE FROM pv_counters WHERE org_id IN ($1,$2)`, [
          orgA,
          orgB,
        ]);
        await admin.query(
          `DELETE FROM calc_snapshots WHERE org_id IN ($1,$2)`,
          [orgA, orgB],
        );
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
  const emailB = () => `b-${userB.slice(0, 8)}@roadsen.test`;

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

  const calc = (token: string, org: string, project: string) =>
    request(server())
      .post(`/projects/${project}/calc/burmister`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', org)
      .send(burmisterInput);
  const snapshot = (
    token: string,
    org: string,
    project: string,
    calcId: string,
    body: unknown,
  ) =>
    request(server())
      .post(`/projects/${project}/calc-results/${calcId}/snapshot`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', org)
      .send(body as object);
  const emit = (token: string, org: string, project: string, calcId: string) =>
    request(server())
      .post(`/projects/${project}/calc-results/${calcId}/pv`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', org);
  const getDoc = (token: string, org: string, project: string, pvId: string) =>
    request(server())
      .get(`/projects/${project}/pvs/${pvId}/document`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', org);
  const getSnap = (
    token: string,
    org: string,
    project: string,
    calcId: string,
  ) =>
    request(server())
      .get(`/projects/${project}/calc-results/${calcId}/snapshot`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', org);
  const getPvView = (
    token: string,
    org: string,
    project: string,
    pvId: string,
  ) =>
    request(server())
      .get(`/projects/${project}/pvs/${pvId}`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', org);
  const listPvs = (token: string, org: string, project: string) =>
    request(server())
      .get(`/projects/${project}/pvs`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', org);

  async function newCalc(token: string): Promise<string> {
    const c = await calc(token, orgA, projectA);
    expect(c.status).toBe(201);
    return String((c.body as CalcBody).calcResultId);
  }

  // --- 1) CAPTURE -----------------------------------------------------------

  it('1) ENGINEER capture le document -> 201 {ok:true} + ligne calc_snapshots', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const calcId = await newCalc(token);
    const res = await snapshot(token, orgA, projectA, calcId, {
      displayHtml: DISPLAY_HTML,
      printHtml: PRINT_HTML,
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
    const row = await admin!.query(
      `SELECT print_html FROM calc_snapshots WHERE calc_result_id = $1`,
      [calcId],
    );
    expect(row.rows.length).toBe(1);
    expect((row.rows[0] as { print_html: string }).print_html).toBe(PRINT_HTML);
  });

  it('1bis) RE-CAPTURE d un meme calcul ECRASE (UPSERT, une seule ligne)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const calcId = await newCalc(token);
    await snapshot(token, orgA, projectA, calcId, {
      displayHtml: DISPLAY_HTML,
      printHtml: PRINT_HTML,
    });
    const updated = PRINT_HTML.replace('Procès-verbal', 'Procès-verbal (v2)');
    const res = await snapshot(token, orgA, projectA, calcId, {
      displayHtml: DISPLAY_HTML,
      printHtml: updated,
    });
    expect(res.status).toBe(201);
    const rows = await admin!.query(
      `SELECT print_html FROM calc_snapshots WHERE calc_result_id = $1`,
      [calcId],
    );
    expect(rows.rows.length).toBe(1);
    expect((rows.rows[0] as { print_html: string }).print_html).toBe(updated);
  });

  // --- 2) GARDE §8 ----------------------------------------------------------

  it('2) GARDE §8 : capturer un HTML avec <script> -> 400 (aucune persistance)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const calcId = await newCalc(token);
    const res = await snapshot(token, orgA, projectA, calcId, {
      displayHtml: DISPLAY_HTML,
      printHtml: '<div><script>fetch("/steal")</script></div>',
    });
    expect(res.status).toBe(400);
    const rows = await admin!.query(
      `SELECT 1 FROM calc_snapshots WHERE calc_result_id = $1`,
      [calcId],
    );
    expect(rows.rows.length).toBe(0);
  });

  it('2bis) GARDE §8 : capturer un HTML avec un marqueur moteur -> 400', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const calcId = await newCalc(token);
    const res = await snapshot(token, orgA, projectA, calcId, {
      displayHtml: DISPLAY_HTML,
      printHtml: '<p>__ROADSEN_ENGINE_CONFIDENTIAL_DO_NOT_SHIP__</p>',
    });
    expect(res.status).toBe(400);
  });

  // --- 3) ISOLATION CAPTURE -------------------------------------------------

  it('3) ISOLATION : userB ne peut PAS capturer le calcul de orgA (404)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const tokenA = await login(emailEng());
    const calcId = await newCalc(tokenA);
    const tokenB = await login(emailB());
    // userB tente via SON org (orgB)/projet (projectB) : calcul invisible -> 404.
    const res = await snapshot(tokenB, orgB, projectB, calcId, {
      displayHtml: DISPLAY_HTML,
      printHtml: PRINT_HTML,
    });
    expect(res.status).toBe(404);
  });

  // --- 4/5) SCELLEMENT + SERVICE --------------------------------------------

  it('4+5) capture -> emission scelle document.sha256 -> GET document = printHtml', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const calcId = await newCalc(token);
    await snapshot(token, orgA, projectA, calcId, {
      displayHtml: DISPLAY_HTML,
      printHtml: PRINT_HTML,
    });
    const pvRes = await emit(token, orgA, projectA, calcId);
    expect(pvRes.status).toBe(201);
    const pvId = String((pvRes.body as PvBody).id);

    // Le contenu canonique scelle porte document.sha256 = sha256(printHtml) ; ET la
    // ligne IMMUABLE porte une COPIE FIGEE des octets (B1 : document autoportant).
    const canon = await admin!.query(
      `SELECT input_canonical, document_html, document_format, pv_number, content_hash
         FROM official_pvs WHERE id = $1`,
      [pvId],
    );
    const row = canon.rows[0] as {
      input_canonical: string;
      document_html: string | null;
      document_format: string | null;
      pv_number: string;
      content_hash: string;
    };
    const sealed = JSON.parse(row.input_canonical) as {
      document?: { format?: string; sha256?: string };
    };
    expect(sealed.document?.format).toBe('html');
    expect(sealed.document?.sha256).toBe(sha256(PRINT_HTML));
    // Copie autoportante figee dans l'official_pv — OCTETS STOCKES INCHANGES
    // (le cartouche est injecte au SERVICE, pas au scellement).
    expect(row.document_html).toBe(PRINT_HTML);
    expect(row.document_format).toBe('html');

    // GET document -> 200 text/html. Le corps ORIGINAL de l'outil est CONSERVE
    // (entre bandeau et pied), ET le cartouche PV (#pv-cartouche) est injecte.
    const doc = await getDoc(token, orgA, projectA, pvId);
    expect(doc.status).toBe(200);
    expect(doc.headers['content-type']).toMatch(/text\/html/);
    // Contenu d'origine preserve (contigu entre bandeau et pied).
    expect(doc.text).toContain('<h1>Procès-verbal</h1>');
    expect(doc.text).toContain('distorsion = 0,5 ‰');
    // CARTOUCHE PV : numero, empreinte COMPLETE, emetteur, organisation, note legale.
    expect(doc.text).toContain('class="pvx-band"');
    expect(doc.text).toContain(row.pv_number);
    expect(doc.text).toMatch(/PV-RDS-/);
    expect(doc.text).toContain(row.content_hash);
    expect(doc.text).toContain('Eng A'); // emetteur scelle (full_name du seed)
    expect(doc.text).toContain('Doc A'); // organisation scellee
    expect(doc.text).toContain(
      'Ne constitue pas une signature électronique qualifiée',
    );
    // Titre du document servi = numero de PV.
    expect(doc.text).toContain(`<title>Procès-verbal ${row.pv_number}</title>`);
    // Aucun script injecte (contrainte §8).
    expect(doc.text).not.toMatch(/<script/i);
    // BARRIERE NAVIGATEUR (M1) : le document est servi inerte (CSP sandbox + nosniff).
    expect(doc.headers['content-security-policy']).toMatch(/sandbox/);
    expect(doc.headers['content-security-policy']).toMatch(
      /default-src 'none'/,
    );
    expect(doc.headers['x-content-type-options']).toBe('nosniff');
  });

  // --- 6) ISOLATION LECTURE -------------------------------------------------

  it('6) ISOLATION : userB ne lit pas le document de orgA (404)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const calcId = await newCalc(token);
    await snapshot(token, orgA, projectA, calcId, {
      displayHtml: DISPLAY_HTML,
      printHtml: PRINT_HTML,
    });
    const pvRes = await emit(token, orgA, projectA, calcId);
    const pvId = String((pvRes.body as PvBody).id);

    const tokenB = await login(emailB());
    const doc = await getDoc(tokenB, orgB, projectB, pvId);
    expect(doc.status).toBe(404);
  });

  // --- 7) TAMPER (mutation-check de la re-verif sha256) ----------------------
  //
  //  Le document est desormais servi depuis official_pvs.document_html (copie
  //  IMMUABLE, B1). Pour forcer l'alteration, il faut trafiquer CETTE colonne
  //  (superuser + trigger d'immuabilite desactive) -> sha256(document_html) ne
  //  correspond plus a l'empreinte scellee -> 409. Sentinelle de la re-verif.
  it('7) TAMPER : document_html altere en base APRES scellement -> GET document 409', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const calcId = await newCalc(token);
    await snapshot(token, orgA, projectA, calcId, {
      displayHtml: DISPLAY_HTML,
      printHtml: PRINT_HTML,
    });
    const pvRes = await emit(token, orgA, projectA, calcId);
    const pvId = String((pvRes.body as PvBody).id);

    // Avant : document servi normalement.
    const ok = await getDoc(token, orgA, projectA, pvId);
    expect(ok.status).toBe(200);

    // ALTERATION de la copie figee (superuser, official_pvs immuable -> trigger off).
    try {
      await admin!.query(`ALTER TABLE official_pvs DISABLE TRIGGER USER`);
      await admin!.query(
        `UPDATE official_pvs SET document_html = document_html || '<!-- falsifie -->' WHERE id = $1`,
        [pvId],
      );
    } finally {
      // try/finally : si l'UPDATE echoue, le trigger d'immuabilite d'official_pvs
      // doit etre RETABLI quoi qu'il arrive — jamais de base de recette laissee
      // sans sa protection.
      await admin!.query(`ALTER TABLE official_pvs ENABLE TRIGGER USER`);
    }

    const tampered = await getDoc(token, orgA, projectA, pvId);
    expect(tampered.status).toBe(409);
  });

  // --- 7bis) REGENERABILITE (B1) : re-capture apres emission ne casse RIEN -----
  //
  //  Coeur du correctif B1 : une re-capture (UPSERT) du snapshot APRES emission
  //  ecrase le CACHE calc_snapshots, mais le document servi vient de la copie
  //  IMMUABLE official_pvs.document_html -> GET document renvoie TOUJOURS le
  //  document ORIGINAL scelle (200), jamais 409. Sans B1 (service depuis le cache),
  //  ce test serait ROUGE (409). Mutation-check de la regenerabilite.
  it('7bis) REGENERABILITE : re-capture APRES emission -> GET document = document original (200)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const calcId = await newCalc(token);
    await snapshot(token, orgA, projectA, calcId, {
      displayHtml: DISPLAY_HTML,
      printHtml: PRINT_HTML,
    });
    const pvRes = await emit(token, orgA, projectA, calcId);
    const pvId = String((pvRes.body as PvBody).id);

    // Re-capture (legitime cote API : UPSERT) avec un document DIFFERENT.
    const altered = PRINT_HTML.replace(
      'Procès-verbal',
      'Procès-verbal MODIFIÉ',
    );
    const recap = await snapshot(token, orgA, projectA, calcId, {
      displayHtml: DISPLAY_HTML,
      printHtml: altered,
    });
    expect(recap.status).toBe(201);

    // Le document scelle reste l'ORIGINAL (source = copie immuable), 200 sans 409.
    // Le corps ORIGINAL est servi (enrobe du cartouche) ; la re-capture n'a rien
    // change au livrable.
    const doc = await getDoc(token, orgA, projectA, pvId);
    expect(doc.status).toBe(200);
    expect(doc.text).toContain('<h1>Procès-verbal</h1>');
    expect(doc.text).not.toContain('Procès-verbal MODIFIÉ');
  });

  // --- 8) RETRO-COMPAT (PV sans capture) ------------------------------------

  it('8) RETRO-COMPAT : PV emis SANS capture -> pas de champ document -> GET document 404', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const calcId = await newCalc(token); // AUCUNE capture
    const pvRes = await emit(token, orgA, projectA, calcId);
    expect(pvRes.status).toBe(201);
    const pvId = String((pvRes.body as PvBody).id);

    // Le canonique ne porte PAS de champ document (retro-compat).
    const canon = await admin!.query(
      `SELECT input_canonical FROM official_pvs WHERE id = $1`,
      [pvId],
    );
    const sealed = JSON.parse(
      (canon.rows[0] as { input_canonical: string }).input_canonical,
    ) as { document?: unknown };
    expect(sealed.document).toBeUndefined();

    const doc = await getDoc(token, orgA, projectA, pvId);
    expect(doc.status).toBe(404);
  });

  // --- 8bis) BANDE PASSANTE (B1-bis) : document_html JAMAIS dans list/get ------
  //
  //  Les octets du document (jusqu'a 1 MiB/PV) NE DOIVENT PAS partir dans les
  //  reponses de liste/lecture (PWA reseau contraint). On expose UNIQUEMENT
  //  documentFormat ('html'|null) pour que le front sache qu'un document existe.
  //  Seul GET .../document sert les octets. Sans le `omit` Prisma, ce test est
  //  ROUGE (documentHtml present dans le JSON).
  it('8bis) BANDE PASSANTE : GET /pvs et get-by-id n exposent PAS documentHtml mais exposent documentFormat', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const calcId = await newCalc(token);
    await snapshot(token, orgA, projectA, calcId, {
      displayHtml: DISPLAY_HTML,
      printHtml: PRINT_HTML,
    });
    const pvRes = await emit(token, orgA, projectA, calcId);
    const pvId = String((pvRes.body as PvBody).id);

    // (a) le retour d'emit ne porte pas documentHtml mais porte documentFormat.
    expect(pvRes.body).not.toHaveProperty('documentHtml');
    expect((pvRes.body as Record<string, unknown>).documentFormat).toBe('html');

    // (b) get-by-id : pv.documentHtml absent, pv.documentFormat = 'html'.
    const view = await getPvView(token, orgA, projectA, pvId);
    expect(view.status).toBe(200);
    const viewPv = (view.body as { pv: Record<string, unknown> }).pv;
    expect(viewPv).not.toHaveProperty('documentHtml');
    expect(viewPv.documentFormat).toBe('html');

    // (c) liste : aucune entree ne porte documentHtml ; documentFormat present.
    const list = await listPvs(token, orgA, projectA);
    expect(list.status).toBe(200);
    const entries = list.body as Array<{ pv: Record<string, unknown> }>;
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.pv).not.toHaveProperty('documentHtml');
      expect(e.pv).toHaveProperty('documentFormat');
    }

    // (d) mais GET .../document sert TOUJOURS le document (corps original enrobe).
    const doc = await getDoc(token, orgA, projectA, pvId);
    expect(doc.status).toBe(200);
    expect(doc.text).toContain('<h1>Procès-verbal</h1>');
    expect(doc.text).toContain('class="pvx-band"');
  });

  // --- 9) LECTURE DU SNAPSHOT AVANT SCELLEMENT (re-affichage UI) -------------

  it('9) GET snapshot APRES capture (calcul non scelle) -> 200 { displayHtml, printHtml }', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const calcId = await newCalc(token);
    await snapshot(token, orgA, projectA, calcId, {
      displayHtml: DISPLAY_HTML,
      printHtml: PRINT_HTML,
    });
    // Aucune emission de PV : on relit directement le document capture.
    const res = await getSnap(token, orgA, projectA, calcId);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({
      displayHtml: DISPLAY_HTML,
      printHtml: PRINT_HTML,
    });
  });

  it('9bis) GET snapshot SANS capture -> 404 (l UI retombe sur les metadonnees)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const token = await login(emailEng());
    const calcId = await newCalc(token); // AUCUNE capture
    const res = await getSnap(token, orgA, projectA, calcId);
    expect(res.status).toBe(404);
  });

  it('9ter) ISOLATION : userB ne lit pas le snapshot du calcul de orgA (404)', async () => {
    expect.hasAssertions();
    if (!ready()) return;
    const tokenA = await login(emailEng());
    const calcId = await newCalc(tokenA);
    await snapshot(tokenA, orgA, projectA, calcId, {
      displayHtml: DISPLAY_HTML,
      printHtml: PRINT_HTML,
    });
    const tokenB = await login(emailB());
    // userB via SON org/projet : le calcul de orgA est invisible -> 404.
    const res = await getSnap(tokenB, orgB, projectB, calcId);
    expect(res.status).toBe(404);
  });
});
