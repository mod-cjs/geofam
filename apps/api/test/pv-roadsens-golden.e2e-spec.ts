/**
 * GOLDEN e2e — scellement du DOCUMENT ROADSENS réel (option-3), VRAIE base Postgres.
 * =============================================================================
 *
 * Complémentaire (NON redondant) de `pv-document.e2e-spec.ts` :
 *  - `pv-document` prouve le contrat de sceau/tamper/404/isolation sur un HTML
 *    SYNTHÉTIQUE minimal et prouve surtout que la garde §8 REJETTE du contenu fautif.
 *  - CE spec prouve le PENDANT MANQUANT : la garde §8 ACCEPTE un document ROADSENS
 *    RÉEL (doctype + <style> @media print + SVG + KPI unicode µdef/‰/×10⁷ + tableau
 *    #detout), et que le sceau le RESTITUE OCTET-À-OCTET (encodage UTF-8, SVG, CSS
 *    et caractères spéciaux compris) — la vraie preuve de fidélité côté serveur.
 *
 * Le document ci-dessous est STRUCTURELLEMENT identique à ce que produit le
 * sérialiseur du clone `__roadsensSerializePrintable` (`apps/web/src/tools-cloned/
 * roadsens.html`) : en-tête .hd + `.pane.printable#pane-r` + `.pane.printable#pane-d`,
 * tout le CSS inline. Si le spec Playwright de scellement a tourné avant et déposé la
 * capture RÉELLE (`docs/audits-fidelite/roadsens-capture-printhtml.html`), on la passe
 * AUSSI dans le pipeline (enhancement) ; sinon le document embarqué sert de baseline
 * (jamais de skip).
 *
 * ESPRIT MUTATION : si le service reconstruisait le HTML au lieu de servir le
 * `print_html` capturé, l'assertion `doc.text === capturedHtml` deviendrait ROUGE ;
 * si le sceau n'incluait plus sha256(printHtml), l'égalité `sealed.document.sha256 ===
 * sha256(html)` deviendrait ROUGE.
 *
 * ANTI-SKIP : DATABASE_URL absent ET CI -> échec dur. Hors CI sans base -> non-exécuté
 * (honnête), interdit en CI.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

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

/**
 * Document ROADSENS RÉALISTE — même forme que `__roadsensSerializePrintable` :
 * doctype + <style> (écran + @media print) + <main class="app"> avec .hd,
 * `.pane.printable#pane-r` (KPI + SVG de coupe), `.pane.printable#pane-d` (#detout).
 * Contient DÉLIBÉRÉMENT : SVG (schéma), unicode µ/‰/×10⁷/σ/ε/ν/θ, espaces fines
 * insécables ( ), entités — pour prouver le round-trip OCTET-À-OCTET. AUCUN
 * <script>, aucun handler inline, aucun marqueur moteur -> doit PASSER la garde §8.
 */
function buildRoadsensPrintHtml(): string {
  const svg =
    '<svg viewBox="0 0 560 220" width="100%" style="display:block">' +
    '<defs><marker id="R" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">' +
    '<path d="M0,0 L6,3 L0,6 z" fill="#1a4a7a"/></marker></defs>' +
    '<rect x="165" y="40" width="200" height="48" fill="#15171a"/>' +
    '<rect x="165" y="88" width="200" height="70" fill="#3a6ea5"/>' +
    '<text x="160" y="66" text-anchor="end" font-size="10">BBSG classe 1 — 6 cm</text>' +
    '</svg>';
  return (
    '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>ROADSENS — Rapport de vérification Burmister</title>' +
    '<style>' +
    ':root{--brand:#1a4a7a}body{font-family:system-ui;margin:0}' +
    '.pane{display:none}.metric{border:.5px solid #d2d8e1;padding:8px}' +
    '@media print{@page{margin:14mm}.tnav,.btnc,.resbar{display:none !important}' +
    '.pane{display:none !important}.pane.printable{display:block !important}}' +
    '\n.pane.printable{display:block !important}\n' +
    '</style></head><body><main class="app">' +
    '<div class="hd"><div class="brand-name">ROADSENS</div>' +
    '<div class="tag">Vérification structurelle Burmister — AGEROUTE 2015</div></div>' +
    // pane-r : panneau Résultats (verdict + KPI unicode + SVG de coupe)
    '<div class="pane printable" id="pane-r"><div id="resout">' +
    '<div class="verdict">Structure satisfaisante</div>' +
    '<div class="metric"><span class="ml">ε_t base bitumineux</span>' +
    '<span class="mv">76,3 µdef</span><span class="ms">adm 94,45 µdef</span></div>' +
    '<div class="metric"><span class="ml">ε_z sol support</span>' +
    '<span class="mv">312 µdef</span><span class="ms">adm 1 239 µdef</span></div>' +
    '<div class="metric"><span class="ml">NE</span>' +
    '<span class="mv">1,0×10⁷</span><span class="ms">essieux équivalents</span></div>' +
    '<div style="max-width:440px;margin:0 auto">' +
    svg +
    '</div></div></div>' +
    // pane-d : Détails de calcul (#detout)
    '<div class="pane printable" id="pane-d"><div id="detout"><table>' +
    '<tr><td colspan="3" style="background:#1a4a7a;color:#fff">1. Charge de référence</td></tr>' +
    '<tr><td>Pression p₀</td><td>0,662<span style="color:#888"> MPa</span></td><td>—</td></tr>' +
    '<tr><td>Rayon a</td><td>0,125<span style="color:#888"> m</span></td><td>—</td></tr>' +
    '<tr><td colspan="3" style="background:#1a4a7a;color:#fff">7. Coefficients LCPC</td></tr>' +
    '<tr><td>kθ (température)</td><td>1,00<span style="color:#888"></span></td><td>—</td></tr>' +
    '<tr><td>ν Poisson</td><td>0,45<span style="color:#888"></span></td><td>—</td></tr>' +
    '<tr><td>δ déflexion</td><td>0,84<span style="color:#888"> mm</span></td><td>distorsion 0,5 ‰</td></tr>' +
    '</table></div></div>' +
    '</main></body></html>'
  );
}

const PRINT_HTML = buildRoadsensPrintHtml();
const DISPLAY_HTML =
  '<div id="resout"><div class="verdict">Structure satisfaisante</div>' +
  '<div class="metric"><span class="ml">ε_t base bitumineux</span>' +
  '<span class="mv">76,3 µdef</span></div></div>';

/** Capture RÉELLE déposée par le spec Playwright de scellement (enhancement). */
const REAL_CAPTURE = path.resolve(
  __dirname,
  '../../../docs/audits-fidelite/roadsens-capture-printhtml.html',
);

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function loadPgClient(): PgClientCtor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('pg') as { Client: PgClientCtor };
  return mod.Client;
}

describe('GOLDEN scellement du document ROADSENS réel — option-3 (e2e)', () => {
  let app: INestApplication | null = null;
  let admin: PgClient | null = null;
  let connectError: Error | null = null;

  const orgA = randomUUID();
  const slugA = `rs-golden-${orgA.slice(0, 8)}`;
  const engineerA = randomUUID();
  const projectA = randomUUID();
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
      `INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1,$2,$3,'Eng RS',now())`,
      [engineerA, `eng-${engineerA.slice(0, 8)}@roadsen.test`, hash],
    );
    await admin.query(
      `INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ($1,'RS Golden',$2,now())`,
      [orgA, slugA],
    );
    await admin.query(
      `INSERT INTO memberships (id, org_id, user_id, role) VALUES ($1,$2,$3,'ENGINEER')`,
      [randomUUID(), orgA, engineerA],
    );
    await admin.query(
      `INSERT INTO projects (id, org_id, name, created_by_id, updated_at) VALUES ($1,$2,'P-RS',$3,now())`,
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
    await app.init();
  }, 60_000);

  afterAll(async () => {
    if (admin) {
      try {
        await admin.query(`ALTER TABLE official_pvs DISABLE TRIGGER USER`);
        await admin.query(`DELETE FROM official_pvs WHERE org_id = $1`, [orgA]);
        await admin.query(`ALTER TABLE official_pvs ENABLE TRIGGER USER`);
        await admin.query(`DELETE FROM pv_counters WHERE org_id = $1`, [orgA]);
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
  const emailEng = () => `eng-${engineerA.slice(0, 8)}@roadsen.test`;

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

  async function newCalc(token: string): Promise<string> {
    const c = await request(server())
      .post(`/projects/${projectA}/calc/burmister`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', orgA)
      .send(burmisterInput);
    expect(c.status).toBe(201);
    return String((c.body as CalcBody).calcResultId);
  }
  const snapshot = (token: string, calcId: string, printHtml: string) =>
    request(server())
      .post(`/projects/${projectA}/calc-results/${calcId}/snapshot`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', orgA)
      .send({ displayHtml: DISPLAY_HTML, printHtml });
  const emit = (token: string, calcId: string) =>
    request(server())
      .post(`/projects/${projectA}/calc-results/${calcId}/pv`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', orgA);
  const getDoc = (token: string, pvId: string) =>
    request(server())
      .get(`/projects/${projectA}/pvs/${pvId}/document`)
      .set('authorization', `Bearer ${token}`)
      .set('x-org-id', orgA);

  /** Parcours complet de bout en bout sur un HTML donné : capture -> emit -> GET byte-exact. */
  async function assertSealRoundTrip(html: string): Promise<void> {
    const token = await login(emailEng());
    const calcId = await newCalc(token);

    // 1) CAPTURE : la garde §8 ACCEPTE un document roadsens réel -> 201.
    const cap = await snapshot(token, calcId, html);
    expect(cap.status).toBe(201);
    expect(cap.body).toEqual({ ok: true });

    // Persistance byte-exact du print_html (aucune ré-écriture serveur).
    const row = await admin!.query(
      `SELECT print_html FROM calc_snapshots WHERE calc_result_id = $1`,
      [calcId],
    );
    expect(row.rows.length).toBe(1);
    expect((row.rows[0] as { print_html: string }).print_html).toBe(html);

    // 2) ÉMISSION : le sceau porte document.sha256 = sha256(printHtml).
    const pvRes = await emit(token, calcId);
    expect(pvRes.status).toBe(201);
    const pvId = String((pvRes.body as PvBody).id);
    const canon = await admin!.query(
      `SELECT input_canonical FROM official_pvs WHERE id = $1`,
      [pvId],
    );
    const sealed = JSON.parse(
      (canon.rows[0] as { input_canonical: string }).input_canonical,
    ) as { document?: { format?: string; sha256?: string } };
    expect(sealed.document?.format).toBe('html');
    expect(sealed.document?.sha256).toBe(sha256(html));

    // 3) SERVICE : GET document -> 200, corps === HTML capturé OCTET-À-OCTET, et la
    //    ré-vérification d'intégrité (sha256) réussit (sinon 409).
    const doc = await getDoc(token, pvId);
    expect(doc.status).toBe(200);
    expect(doc.headers['content-type']).toMatch(/text\/html/);
    expect(doc.text).toBe(html);
    // Longueur d'octets identique (garde-fou d'encodage UTF-8 : µ, ‰, ×, σ, ε…).
    expect(Buffer.byteLength(doc.text, 'utf8')).toBe(
      Buffer.byteLength(html, 'utf8'),
    );
    expect(sha256(doc.text)).toBe(sha256(html));
  }

  it('given un document ROADSENS réel (SVG+unicode+CSS), when capturé puis scellé, then GET document le restitue OCTET-À-OCTET', async () => {
    if (!ready()) return;
    // Sanity : le document embarqué est structurellement roadsens (non trivial).
    expect(PRINT_HTML).toContain('id="pane-r"');
    expect(PRINT_HTML).toContain('id="pane-d"');
    expect(PRINT_HTML).toContain('<svg');
    expect(PRINT_HTML).toContain('‰'); // ‰
    expect(PRINT_HTML).toContain('×10⁷'); // ×10⁷
    expect(Buffer.byteLength(PRINT_HTML, 'utf8')).toBeGreaterThan(1500);
    await assertSealRoundTrip(PRINT_HTML);

    // ENHANCEMENT (dans le MÊME cas, jamais un test vert sans assertion) : si le spec
    // Playwright de scellement a tourné avant et déposé la capture RÉELLE du clone, on
    // la fait AUSSI passer dans le pipeline byte-exact. Absente -> trace honnête, pas
    // un cas séparé qui verdirait à vide.
    if (existsSync(REAL_CAPTURE)) {
      const real = readFileSync(REAL_CAPTURE, 'utf8');
      expect(real.length).toBeGreaterThan(2000);
      expect(real).toContain('id="pane-r"');
      await assertSealRoundTrip(real);
    } else {
      console.warn(
        `[GOLDEN] capture réelle absente (${REAL_CAPTURE}) — enhancement non exécuté ; ` +
          `le baseline embarqué reste la garantie. Lancer le spec Playwright de scellement pour la produire.`,
      );
    }
  });
});
