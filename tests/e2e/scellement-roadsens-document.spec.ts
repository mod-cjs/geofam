/**
 * SCELLEMENT DU DOCUMENT ROADSENS (option-3) — capture RÉELLE du clone.
 * ==========================================================================
 * Trois preuves sur le CLONE roadsens réel (iframe srcdoc, calcul EXCISÉ, recalcul
 * serveur intercepté), given/when/then :
 *
 *  (2) FIDÉLITÉ DE CAPTURE — le `printHtml` que le clone émet via le bridge
 *      `snapshot:capture` reproduit À L'IDENTIQUE les zones .printable rendues
 *      (pane-r = Résultats, pane-d = Détails). « Au mm près » = concrètement :
 *      pour CHAQUE KPI (.metric) le libellé+valeur, le VERDICT, et pour CHAQUE ligne
 *      du tableau #detout le (libellé, valeur, unité) sont EXTRAITS des deux côtés
 *      par la MÊME fonction et comparés à l'IDENTIQUE (égalité stricte de texte
 *      normalisé) ; le SVG de coupe doit être présent. Aucune tolérance numérique :
 *      le document capturé est un CLONE du DOM rendu, toute dérive de sérialisation
 *      (valeur altérée, ligne perdue, SVG retiré) rend le test ROUGE.
 *
 *  (3) GARDE §8 SUR CONTENU RÉEL — ce printHtml RÉELLEMENT capturé passe la VRAIE
 *      garde serveur `assertInertHtml` (via scripts/assert-inert-run.mts, jamais une
 *      copie) : aucun <script>, aucun handler inline, aucun marqueur/symbole moteur.
 *
 *  (a) CHEMIN loadPreset — après `loadPreset(...)`, la note de préset (ajoutée dans
 *      pane-s APRÈS le calcul) n'est ni dans les zones .printable ni dans la capture
 *      -> le document scellé n'est PAS incomplet ; il est FIDÈLE à ce que l'outil
 *      imprime (le tool n'imprime que .hd + pane-r + pane-d).
 *
 * ZÉRO FAUX-VERT : capture non émise -> ÉCHEC dur ; calc non intercepté -> ÉCHEC ;
 * 0 KPI / 0 ligne extraite -> ÉCHEC ; garde §8 qui refuserait -> ÉCHEC.
 *
 * Effet de bord utile : dépose la capture réelle dans docs/audits-fidelite/ pour que
 * le golden backend (pv-roadsens-golden.e2e-spec.ts) la fasse passer dans le pipeline
 * de scellement byte-exact.
 */
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import { test, expect, type Frame, type Page } from '@playwright/test';

const CLONE_HTML = path.resolve(
  __dirname,
  '../../apps/web/src/tools-cloned/roadsens.html',
);
const REPO = path.resolve(__dirname, '../..');
const OUT_DIR = path.resolve(__dirname, '../../docs/audits-fidelite');
const CAPTURE_FIXTURE = path.join(OUT_DIR, 'roadsens-capture-printhtml.html');

const SECRET = 'fidelite-roadsens-e2e-secret-32bytes-min-xxxxxxxx';
const ORG_SLUG = 'etude-roadsens';
const ORG_ID = 'org_rs';

// --------------------------------------------------------------------------
// JWT HS256 forgé (aucune dépendance).
// --------------------------------------------------------------------------
function b64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function forgeJwt(): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      sub: 'user_rs',
      orgs: [{ id: ORG_ID, slug: ORG_SLUG, role: 'OWNER' }],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  );
  const sig = b64url(
    createHmac('sha256', SECRET).update(`${header}.${payload}`).digest(),
  );
  return `${header}.${payload}.${sig}`;
}

// --------------------------------------------------------------------------
// Cas de référence + STATE de l'UI (mêmes bindings que la définitive/clone).
// --------------------------------------------------------------------------
interface UiState {
  ly: Array<{ id: number; mat: string; h: number; E: number; nu: number; ifc: string }>;
  pf: { cls: string; E: number; nu: number };
  tr: { T: number; C: number; N: number; tau: number; dir: number; tv: number };
  cp: {
    p: number;
    a: number;
    d: number;
    r: string;
    sh: string;
    ks: string;
    gntAuto: boolean;
    neForce: number | null;
  };
}
const CAS_STATE: UiState = {
  ly: [
    { id: 1, mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45, ifc: 'auto' },
    { id: 2, mat: 'GB3', h: 0.1, E: 2588, nu: 0.45, ifc: 'auto' },
    { id: 3, mat: 'GL1', h: 0.25, E: 200, nu: 0.35, ifc: 'auto' },
  ],
  pf: { cls: 'PF2', E: 50, nu: 0.35 },
  tr: { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 },
  cp: {
    p: 0.662,
    a: 0.125,
    d: 0.375,
    r: 'auto',
    sh: 'auto',
    ks: 'auto',
    gntAuto: false,
    neForce: null,
  },
};
// Sortie serveur (rawOutput whitelisté) que le stub d'interception livre au clone :
// produite par le moteur SOURCE en sous-processus (jamais importé dans le spec).
function serverOutputForState(): unknown {
  const input = {
    layers: CAS_STATE.ly.map((l) => ({ mat: l.mat, h: l.h, E: l.E, nu: l.nu })),
    subgrade: { cls: CAS_STATE.pf.cls, E: CAS_STATE.pf.E, nu: CAS_STATE.pf.nu },
    traffic: CAS_STATE.tr,
    load: {
      p: CAS_STATE.cp.p,
      a: CAS_STATE.cp.a,
      d: CAS_STATE.cp.d,
      r: 'auto',
      sh: 'auto',
      ks: 'auto',
    },
  };
  const raw = execFileSync('npx', ['tsx', 'scripts/burmister-engine-run.mts'], {
    input: JSON.stringify(input),
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const parsed = JSON.parse(raw) as { ok: boolean; output?: unknown };
  expect(parsed.ok, `moteur serveur a échoué : ${raw.slice(0, 300)}`).toBe(true);
  expect(parsed.output, 'sortie serveur vide').toBeTruthy();
  return parsed.output;
}
function stateScript(st: UiState): string {
  return (
    `ly=${JSON.stringify(st.ly)};` +
    `pf=${JSON.stringify(st.pf)};` +
    `tr=${JSON.stringify(st.tr)};` +
    `cp=${JSON.stringify(st.cp)};`
  );
}

// --------------------------------------------------------------------------
// Extraction DOM (sérialisée navigateur) — MÊME code pour le frame live et pour
// le document capturé (chargé via setContent) : #resout (verdict + KPI) et
// #detout (lignes label/value/unit).
// --------------------------------------------------------------------------
interface RawRow {
  label: string;
  value: string;
  unit: string;
}
interface Extracted {
  verdict: string;
  metrics: { label: string; value: string }[];
  rows: RawRow[];
  svgCount: number;
}
function extractFrom(): Extracted {
  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const out = document.getElementById('resout');
  const txt = norm(out?.textContent);
  const verdict = /non satisfaisante/i.test(txt)
    ? 'non satisfaisante'
    : /satisfaisante/i.test(txt)
      ? 'satisfaisante'
      : '';
  const metrics = Array.from(out?.querySelectorAll('.metric') ?? []).map((m) => ({
    label: norm(m.querySelector('.ml')?.textContent),
    value: norm(m.querySelector('.mv')?.textContent),
  }));
  const rows: RawRow[] = [];
  const table = document.querySelector('#detout table');
  const colorOf = (el: Element) => getComputedStyle(el).color;
  if (table) {
    for (const tr of Array.from(table.querySelectorAll('tr'))) {
      const tds = Array.from(tr.children).filter((c) => c.tagName === 'TD');
      if (tds.length < 3) continue;
      const label = norm(tds[0].textContent);
      const valueCell = tds[1];
      let unit = '';
      for (const s of Array.from(valueCell.querySelectorAll('span'))) {
        if (colorOf(s) === 'rgb(136, 136, 136)') {
          unit = norm(s.textContent);
          break;
        }
      }
      let value = valueCell.textContent || '';
      if (unit) {
        const idx = value.lastIndexOf(unit);
        if (idx >= 0) value = value.slice(0, idx);
      }
      rows.push({ label, value: norm(value), unit });
    }
  }
  const svgCount = document.querySelectorAll('#resout svg, #detout svg').length;
  return { verdict, metrics, rows, svgCount };
}

// --------------------------------------------------------------------------
// Ouverture du clone (routes interceptées, token, listener de capture).
// --------------------------------------------------------------------------
async function openClone(
  page: Page,
  token: string,
  serverOutput: unknown,
): Promise<{ intercepted: () => boolean }> {
  let calcIntercepted = false;

  // (1) token en session + (2) COLLECTE des messages snapshot:capture émis par le
  // bridge du clone (iframe -> hôte). On lit window.__caps après le calcul.
  await page.addInitScript((tok) => {
    try {
      window.sessionStorage.setItem('roadsen_access_token', tok);
    } catch {
      /* noop */
    }
    (window as unknown as { __caps: unknown[] }).__caps = [];
    window.addEventListener('message', (e: MessageEvent) => {
      const d = e.data as { type?: string; payload?: unknown } | null;
      if (d && d.type === 'snapshot:capture') {
        (window as unknown as { __caps: unknown[] }).__caps.push(d.payload);
      }
    });
  }, token);

  await page.route(/\/me\/entitlements/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        orgId: ORG_ID,
        pack: 'COMPLETE',
        modules: ['burmister', 'chaussee-burmister'],
        expiresAt: new Date(Date.now() + 3.15e10).toISOString(),
        expired: false,
        quota: { limit: 1000, used: 1, remaining: 999 },
        serverTime: new Date().toISOString(),
      }),
    }),
  );
  await page.route(/\/projects$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'proj_rs',
          orgId: ORG_ID,
          name: 'E2E scellement ROADSENS',
          domain: 'CH',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdById: 'user_rs',
        },
      ]),
    }),
  );
  // Calcul burmister intercepté -> sortie serveur (forme BackendPersistedCalcResult).
  await page.route(/\/projects\/[^/]+\/calc\/[^/]+$/, async (route) => {
    calcIntercepted = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        calcResultId: 'cr_sc_rs_1',
        ok: true,
        meta: { engineId: 'burmister', engineVersion: 'e2e-scellement' },
        output: serverOutput,
      }),
    });
  });
  // La capture POSTée par l'hôte (calc-results/:id/snapshot) : acceptée pour ne pas
  // polluer la console (on lit la capture via le listener, pas via cette route).
  await page.route(/\/projects\/[^/]+\/calc-results\/[^/]+\/snapshot$/, (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    }),
  );

  await page.goto(`/app/${ORG_SLUG}/logiciels/roadsens`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .locator('iframe[data-testid="tool-frame-iframe"]')
    .waitFor({ state: 'attached', timeout: 30_000 });
  await page.waitForTimeout(1500);
  return { intercepted: () => calcIntercepted };
}

function cloneFrame(page: Page): Frame {
  const frame = page
    .frames()
    .find((f) => f.url().includes('srcdoc') || f !== page.mainFrame());
  if (!frame) throw new Error('frame du clone introuvable');
  return frame;
}

async function readCaptures(
  page: Page,
): Promise<{ displayHtml: string; printHtml: string }[]> {
  return (await page.evaluate(
    () =>
      (window as unknown as { __caps: { displayHtml: string; printHtml: string }[] })
        .__caps,
  )) as { displayHtml: string; printHtml: string }[];
}

/** Ouvre le clone, saisit CAS_STATE, clique « Calculer », renvoie la capture réelle
 *  émise par le bridge + l'extraction LIVE du frame (pane-r + pane-d rendus). */
async function calcAndCapture(browser: import('@playwright/test').Browser): Promise<{
  ctx: import('@playwright/test').BrowserContext;
  page: Page;
  frame: Frame;
  printHtml: string;
  live: Extracted;
}> {
  const serverOutput = serverOutputForState();
  const token = forgeJwt();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([
    { name: 'roadsen_access_token', value: token, domain: 'localhost', path: '/' },
  ]);
  const page = await ctx.newPage();
  const { intercepted } = await openClone(page, token, serverOutput);
  const frame = cloneFrame(page);

  await frame.locator('#btnc').waitFor({ state: 'visible', timeout: 15_000 });
  await frame.evaluate(`(function(){ ${stateScript(CAS_STATE)} })()`);
  await frame.locator('#btnc').click();
  await expect
    .poll(async () => frame.locator('#resout .metric').count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await page.waitForTimeout(600);
  expect(intercepted(), 'le calcul DOIT avoir été intercepté').toBe(true);

  const caps = await readCaptures(page);
  expect(
    caps.length,
    'AUCUNE capture snapshot:capture émise par le bridge',
  ).toBeGreaterThan(0);
  const printHtml = caps[caps.length - 1].printHtml;
  expect(printHtml.length, 'printHtml capturé vide').toBeGreaterThan(2000);

  const live = await frame.evaluate(extractFrom);
  return { ctx, page, frame, printHtml, live };
}

test.describe('SCELLEMENT ROADSENS — capture réelle (option-3)', () => {
  test('given un calcul dans le clone, when le bridge émet snapshot:capture, then le document capturé reproduit À L IDENTIQUE les zones .printable (fidélité au mm près)', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    expect(existsSync(CLONE_HTML), `Clone ABSENT (${CLONE_HTML}).`).toBe(true);
    mkdirSync(OUT_DIR, { recursive: true });

    const { ctx, printHtml, live } = await calcAndCapture(browser);

    expect(live.metrics.length, 'LIVE : aucun KPI rendu').toBeGreaterThan(0);
    expect(live.rows.length, 'LIVE : aucune ligne #detout rendue').toBeGreaterThan(10);
    expect(live.verdict, 'LIVE : verdict absent').not.toBe('');
    expect(live.svgCount, 'LIVE : SVG de coupe absent').toBeGreaterThan(0);

    // Côté CAPTURE : on charge le document capturé dans une page neuve (setContent)
    // et on ré-extrait avec la MÊME fonction (CSS inline appliqué -> unités fidèles).
    const capPage = await browser.newPage();
    await capPage.setContent(printHtml, { waitUntil: 'domcontentloaded' });
    const cap = await capPage.evaluate(extractFrom);
    dumpJson('roadsens-scellement-live.json', live);
    dumpJson('roadsens-scellement-capture.json', cap);

    // Égalité STRICTE (aucune tolérance : le document est un CLONE du DOM rendu) :
    // « au mm près » = même verdict, mêmes KPI (libellé+valeur), mêmes lignes #detout
    // (libellé, valeur, unité), SVG de coupe présent.
    expect(cap.verdict, 'VERDICT capture ≠ live').toBe(live.verdict);
    expect(cap.metrics, 'KPI (.metric) capture ≠ live').toEqual(live.metrics);
    expect(cap.rows, 'lignes #detout capture ≠ live').toEqual(live.rows);
    expect(cap.svgCount, 'SVG de coupe absent de la capture').toBeGreaterThan(0);
    await capPage.close();
    await ctx.close();
  });

  test('given le printHtml RÉELLEMENT capturé, when passé dans la VRAIE garde §8 serveur (assertInertHtml), then il est ACCEPTÉ (inerte, sans handler ni marqueur moteur)', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const { ctx, printHtml } = await calcAndCapture(browser);

    // Marqueurs moteur : doivent être ABSENTS (confidentialité §8) — ceinture verte.
    for (const marker of [
      '__ROADSEN_ENGINE_',
      '@roadsen/engines',
      'burIntegrateMLWithPSC',
      'computeBurmister',
      'krLCPC',
    ]) {
      expect(
        printHtml.includes(marker),
        `marqueur moteur « ${marker} » dans le printHtml`,
      ).toBe(false);
    }
    expect(/<script\b/i.test(printHtml), 'printHtml contient <script>').toBe(false);

    // Garde §8 sur le contenu RÉEL via la VRAIE fonction serveur (jamais une copie).
    const guardRaw = execFileSync('npx', ['tsx', 'scripts/assert-inert-run.mts'], {
      input: printHtml,
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    const guard = JSON.parse(guardRaw) as { ok: boolean; error?: string };

    // Dépose la capture réelle pour le golden backend UNIQUEMENT si elle est inerte
    // (sinon le seal la rejetterait ; cf. défaut ci-dessous).
    if (guard.ok) writeFileSync(CAPTURE_FIXTURE, printHtml, 'utf8');

    expect(
      guard.ok,
      `DÉFAUT option-3 : la garde §8 REFUSE le printHtml roadsens réel -> capture NON persistée ` +
        `(400 avalé en best-effort) -> PV sans document -> repli PDF silencieux. Motif : ${guard.error ?? ''}`,
    ).toBe(true);

    await ctx.close();
  });

  test('given un préset chargé (loadPreset), when la capture est émise en fin de calcul, then la note de préset (pane-s) n EST NI imprimée NI capturée (document fidèle, non incomplet)', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const serverOutput = serverOutputForState();
    const token = forgeJwt();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addCookies([
      { name: 'roadsen_access_token', value: token, domain: 'localhost', path: '/' },
    ]);
    const page = await ctx.newPage();
    await openClone(page, token, serverOutput);
    const frame = cloneFrame(page);
    await frame.locator('#btnc').waitFor({ state: 'visible', timeout: 15_000 });

    // WHEN : chargement d'un préset -> loadPreset() appelle runCalc() (capture en fin
    // de calcul) PUIS pose la note de préset dans #presetNote (pane-s).
    await frame.evaluate(`loadPreset('s1')`);
    await expect
      .poll(async () => frame.locator('#resout .metric').count(), { timeout: 20_000 })
      .toBeGreaterThan(0);
    // On attend que la note de préset soit BIEN posée (sinon la preuve serait vide).
    await expect
      .poll(async () => (await frame.locator('#presetNote').innerText()).trim().length, {
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
    const presetNoteText = (await frame.locator('#presetNote').innerText()).trim();
    expect(
      presetNoteText,
      'la note de préset DOIT être rendue pour que la preuve soit non vide',
    ).toContain('Conditions du cas de validation');
    await page.waitForTimeout(400);

    const caps = await readCaptures(page);
    expect(caps.length, 'AUCUNE capture émise via loadPreset').toBeGreaterThan(0);
    const printHtml = caps[caps.length - 1].printHtml;

    // THEN : le document capturé contient pane-r + pane-d, mais PAS la note de préset
    // (pane-s), exactement comme l'impression de l'outil (printReport n'imprime que
    // .hd + pane-r + pane-d ; @media print masque toutes les .pane non .printable).
    expect(printHtml).toContain('id="pane-r"');
    expect(printHtml).toContain('id="pane-d"');
    expect(printHtml).not.toContain('id="pane-s"');
    expect(printHtml).not.toContain('id="presetNote"');
    expect(
      printHtml.includes('Conditions du cas de validation'),
      'la note de préset (pane-s) NE DOIT PAS être dans le document scellé — sinon incohérence de périmètre',
    ).toBe(false);

    // Contre-preuve : la note EXISTE bien à l'écran (dans pane-s) — donc son absence
    // de la capture est un choix de PÉRIMÈTRE fidèle à l'impression, pas une perte.
    expect(presetNoteText.length).toBeGreaterThan(0);

    await ctx.close();
  });

  // ======================================================================
  // (M3) CHEMIN PRIMAIRE — course fermée + bannière véridique.
  // Prouve que « Émettre le PV scellé » ne s'active QU'APRÈS confirmation de la
  // capture (POST snapshot 201). On GÈLE volontairement la réponse du POST
  // snapshot : tant qu'elle est en vol, le bouton DOIT rester DÉSACTIVÉ
  // (« Capture du document… ») -> émettre AVANT la capture est IMPOSSIBLE.
  // Puis on libère la réponse -> statut 'confirmed' -> bouton actif -> émission
  // -> PV documentFormat==='html' -> bannière du document de l'outil.
  // ======================================================================
  test('given le chemin primaire, when la capture n est pas encore confirmée, then « Émettre le PV scellé » est DÉSACTIVÉ (course fermée) puis actif après confirmation -> PV documentFormat html', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const serverOutput = serverOutputForState();
    const token = forgeJwt();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addCookies([
      { name: 'roadsen_access_token', value: token, domain: 'localhost', path: '/' },
    ]);
    const page = await ctx.newPage();

    await page.addInitScript((tok) => {
      try {
        window.sessionStorage.setItem('roadsen_access_token', tok);
      } catch {
        /* noop */
      }
    }, token);

    await page.route(/\/me\/entitlements/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          orgId: ORG_ID,
          pack: 'COMPLETE',
          modules: ['burmister', 'chaussee-burmister'],
          expiresAt: new Date(Date.now() + 3.15e10).toISOString(),
          expired: false,
          quota: { limit: 1000, used: 1, remaining: 999 },
          serverTime: new Date().toISOString(),
        }),
      }),
    );
    await page.route(/\/projects$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'proj_rs',
            orgId: ORG_ID,
            name: 'E2E M3 ROADSENS',
            domain: 'CH',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            createdById: 'user_rs',
          },
        ]),
      }),
    );
    await page.route(/\/projects\/[^/]+\/calc\/[^/]+$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          calcResultId: 'cr_m3_rs_1',
          ok: true,
          meta: { engineId: 'burmister', engineVersion: 'e2e-m3' },
          output: serverOutput,
        }),
      }),
    );

    // PORTE : le POST snapshot reste EN VOL jusqu'à ce que le test le libère.
    let releaseSnapshot!: () => void;
    const snapshotGate = new Promise<void>((r) => (releaseSnapshot = r));
    let snapshotHit = false;
    await page.route(
      /\/projects\/[^/]+\/calc-results\/[^/]+\/snapshot$/,
      async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        snapshotHit = true;
        await snapshotGate; // gel volontaire
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
      },
    );

    // Émission du PV interceptée -> PV documentFormat 'html' (bannière véridique).
    let emitHit = false;
    await page.route(/\/projects\/[^/]+\/calc-results\/[^/]+\/pv$/, (route) => {
      emitHit = true;
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '11111111-1111-1111-1111-111111111111',
          orgId: ORG_ID,
          projectId: 'proj_rs',
          numero: 'PV-2026-000042',
          documentFormat: 'html',
          createdAt: new Date().toISOString(),
          sealValid: true,
        }),
      });
    });

    await page.goto(`/app/${ORG_SLUG}/logiciels/roadsens`, {
      waitUntil: 'domcontentloaded',
    });
    await page
      .locator('iframe[data-testid="tool-frame-iframe"]')
      .waitFor({ state: 'attached', timeout: 30_000 });
    await page.waitForTimeout(1200);

    const frame = cloneFrame(page);
    await frame.locator('#btnc').waitFor({ state: 'visible', timeout: 15_000 });
    await frame.evaluate(`(function(){ ${stateScript(CAS_STATE)} })()`);
    await frame.locator('#btnc').click();
    await expect
      .poll(async () => frame.locator('#resout .metric').count(), { timeout: 20_000 })
      .toBeGreaterThan(0);

    const emitBtn = page.locator('[data-testid="btn-emettre-pv"]');

    // (1) COURSE FERMÉE : calcul terminé MAIS capture en vol -> bouton DÉSACTIVÉ,
    // libellé « Capture du document… » (prouve : calcResultId présent, mais pas prêt).
    await expect.poll(async () => snapshotHit, { timeout: 15_000 }).toBe(true);
    await expect(emitBtn).toBeDisabled();
    await expect(emitBtn).toHaveText(/Capture du document/);
    expect(
      emitHit,
      'aucune émission ne doit partir tant que la capture n est pas confirmée',
    ).toBe(false);

    // (2) LIBÉRATION de la capture -> statut 'confirmed' -> bouton ACTIF.
    releaseSnapshot();
    await expect(emitBtn).toBeEnabled({ timeout: 15_000 });
    await expect(emitBtn).toHaveText('Émettre le PV scellé');

    // (3) ÉMISSION -> PV documentFormat 'html' -> bannière du document de l'outil.
    await emitBtn.click();
    await expect.poll(async () => emitHit, { timeout: 15_000 }).toBe(true);
    // Bannière VÉRIDIQUE (documentFormat==='html') : annonce le document de l'outil
    // scellé « au mm près » (la branche de repli, elle, dirait « non capturé »).
    const banner = page.locator('[data-testid="pv-success-banner"]');
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toHaveText(/document de l.outil scellé \(au mm près\)/i);
    await expect(banner).not.toHaveText(/non capturé/i);

    await ctx.close();
  });
});

function dumpJson(name: string, data: unknown): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2), 'utf8');
}
