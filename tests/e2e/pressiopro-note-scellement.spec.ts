/**
 * NOTE + SCELLEMENT DU DOCUMENT PRESSIOPRO (6e moteur — essai pressiométrique
 * Ménard, NF EN ISO 22476-4). Dette de patron : les 5 autres logiciels ont un
 * e2e navigateur dédié ; PressioPro n'avait que des unitaires (clone-render,
 * contract) + le contrôle d'impression. Ce spec prouve le PARCOURS RÉEL sur le
 * CLONE servi en `<iframe srcdoc sandbox>` (calcul EXCISÉ, recalcul serveur), sur
 * backend e2e (routes interceptées, MÊME dispositif que scellement-roadsens).
 *
 * ── Ce que ce spec PROUVE (given/when/then, zéro faux-vert) ────────────────────
 *
 *  (1) PARCOURS NOTE — « 🧪 Exemple » → « Calculer — Dépouillement complet »
 *      (dépouillement) → la NOTE s'affiche (E_M, catégorie, courbe P–V) → le bridge
 *      émet `snapshot:capture` → l'hôte POSTe le document → « Émettre le PV scellé »
 *      s'active → émission → le PV scellé (documentFormat html) se re-sert
 *      (bannière « PV scellé n° … »).
 *
 *  (2) GARDE DE COURSE dry-run (le point critique) — un APERÇU E_M (`dryRun`,
 *      déclenché par `updateSeuilPreview`) part bien côté serveur (route calc
 *      `?dryRun=true` RÉELLEMENT touchée + aperçu rendu dans `#seuilPreview`), MAIS :
 *      il n'active PAS le bouton d'émission (le shell ne reçoit AUCUN `calcResultId`,
 *      le clone ne pose PAS `window.__pressioLastCalcResultId`), ne POSTe AUCUN
 *      snapshot, n'émet AUCUN PV. Contre-preuve dans le MÊME test : un vrai
 *      « Calculer » (non-dryRun) rend, LUI, l'émission possible. C'est la régression
 *      verrouillée : un aperçu ne doit jamais sceller un PV vide.
 *
 *  (3) §8 — le document scellé (printHtml RÉELLEMENT capturé) ne contient AUCUN
 *      symbole/marqueur moteur, AUCUN `<canvas>` (la courbe P–V canvas est
 *      re-dessinée en SVG inline), AUCUNE image `data:` ; et il passe la VRAIE garde
 *      serveur `assertInertHtml` (scripts/assert-inert-run.mts, jamais une copie).
 *
 * ── Dispositif ────────────────────────────────────────────────────────────────
 * La requête de calcul du clone est INTERCEPTÉE et fulfillée avec la sortie du
 * MOTEUR SOURCE `runPressiometre` exécuté en sous-processus sur le body RÉELLEMENT
 * posté par le clone (scripts/pressiopro-engine-run.mts) : input = ce que le VRAI
 * clone a construit (`buildEssaiInput`), output = ce que le VRAI moteur renvoie —
 * exactement ce que le serveur renverrait, sans jamais importer le moteur dans le
 * navigateur (DoD §8). Le snapshot POST est intercepté pour capturer le printHtml
 * RÉEL (chemin de persistance réel), puis fulfillé 201 (→ capture 'confirmed' →
 * bouton actif).
 *
 * ── Portée honnête ────────────────────────────────────────────────────────────
 * Prouve le PARCOURS + la FIDÉLITÉ d'affichage/scellement + la garde de course,
 * PAS la justesse scientifique du calcul (responsabilité STARFIRE — split
 * contractuel ; l'équivalence module↔origine est prouvée par les unitaires du
 * paquet). L'entitlement/quota/projet sont mockés (comme les autres specs de
 * fidélité) — l'isolation multi-tenant réelle est couverte par les e2e backend.
 */
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import { test, expect, type Frame, type Page, type Route } from '@playwright/test';

// = webServer.env.JWT_SECRET (playwright.scellement-pressiopro.config.ts)
const SECRET = 'scellement-pressiopro-e2e-secret-32bytes-min-xxxx';
const ORG_SLUG = 'etude-pressiopro';
const ORG_ID = 'org_pp';
const PROJECT_ID = 'proj_pp';
const REPO = path.resolve(__dirname, '../..');
const CLONE_HTML = path.resolve(
  __dirname,
  '../../apps/web/src/tools-cloned/pressiopro.html',
);
const OUT_DIR = path.resolve(__dirname, '../../docs/audits-fidelite');

// --------------------------------------------------------------------------
// Cas de référence : profondeur « 2.0 m » de loadExempleFictif() (figée ici pour
// le test de garde dry-run, qui INJECTE l'état sans passer par loadExempleFictif
// — celui-ci auto-calcule au chargement, ce qui contaminerait la preuve « un
// aperçu seul n'active jamais l'émission »). Le parcours note (1), lui, utilise le
// VRAI bouton « 🧪 Exemple ».
// --------------------------------------------------------------------------
const EXAMPLE_ROWS = [
  { p: 0.8, v15: 21, v30: 22, v60: 24 },
  { p: 1.2, v15: 44, v30: 45, v60: 47 },
  { p: 1.6, v15: 68, v30: 69, v60: 70 },
  { p: 2, v15: 88, v30: 89, v60: 90 },
  { p: 2.4, v15: 108, v30: 109, v60: 110 },
  { p: 2.8, v15: 127, v30: 128, v60: 130 },
  { p: 3.2, v15: 144, v30: 148, v60: 154 },
  { p: 3.6, v15: 171, v30: 177, v60: 188 },
  { p: 4, v15: 219, v30: 227, v60: 242 },
  { p: 4.4, v15: 310, v30: 321, v60: 340 },
];

// --------------------------------------------------------------------------
// JWT HS256 forgé (node:crypto, aucune dépendance) — mêmes claims que le middleware.
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
      sub: 'user_pp',
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
// Sortie serveur via le MOTEUR SOURCE en sous-processus (cache par body pour
// éviter de re-spawn tsx sur des entrées identiques : boot + doCalc = même body).
// --------------------------------------------------------------------------
const _engineCache = new Map<string, unknown>();
function serverOutputForBody(bodyJson: string): unknown {
  const cached = _engineCache.get(bodyJson);
  if (cached !== undefined) return cached;
  const raw = execFileSync('npx', ['tsx', 'scripts/pressiopro-engine-run.mts'], {
    input: bodyJson,
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const parsed = JSON.parse(raw) as { ok: boolean; output?: unknown; error?: string };
  expect(parsed.ok, `moteur serveur pressio a échoué : ${raw.slice(0, 400)}`).toBe(true);
  expect(parsed.output, 'sortie serveur pressio vide').toBeTruthy();
  _engineCache.set(bodyJson, parsed.output);
  return parsed.output;
}

// --------------------------------------------------------------------------
// Compteurs d'interception partagés (mutés par les route handlers).
// --------------------------------------------------------------------------
interface Hits {
  calcReal: number; // calc non-dryRun (calcul scellable)
  calcDry: number; // calc ?dryRun=true (aperçu)
  snapshot: number; // POST calc-results/:id/snapshot
  pv: number; // POST calc-results/:id/pv
  lastPrintHtml: string | null; // dernier printHtml RÉELLEMENT capturé
}

const ENTITLEMENTS = {
  orgId: ORG_ID,
  pack: 'COMPLETE',
  modules: ['pressiometre', 'pressio-etalonnage', 'pressio-calibrage'],
  expiresAt: new Date(Date.now() + 3.15e10).toISOString(),
  expired: false,
  quota: { limit: 1000, used: 1, remaining: 999 },
  serverTime: new Date().toISOString(),
};
const PROJECTS = [
  {
    id: PROJECT_ID,
    orgId: ORG_ID,
    name: 'E2E note+scellement PressioPro',
    domain: 'LB',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdById: 'user_pp',
  },
];

/**
 * Ouvre le clone pressiopro : token en session, routes CLIENT interceptées
 * (entitlements, projets, calc via moteur source, snapshot, pv). Renvoie les
 * compteurs d'interception + un moyen de geler/relâcher le POST snapshot.
 */
async function openClone(
  page: Page,
  token: string,
  opts: { snapshotGate?: Promise<void> } = {},
): Promise<Hits> {
  const hits: Hits = { calcReal: 0, calcDry: 0, snapshot: 0, pv: 0, lastPrintHtml: null };

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
      body: JSON.stringify(ENTITLEMENTS),
    }),
  );
  await page.route(/\/projects$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(PROJECTS),
    }),
  );

  // CŒUR : calcul intercepté → sortie du moteur SOURCE sur le body RÉELLEMENT
  // posté par le clone. dryRun distingué par la query `?dryRun=true` (cf.
  // httpRunCalc). Un id n'est renvoyé QUE pour un calcul réel (un aperçu ne doit
  // jamais fournir un id scellable — même si le back en donnait un, ToolFrame ne
  // le remonterait pas ; on ne fabrique donc PAS d'id pour un dryRun).
  let calcSeq = 0;
  await page.route(/\/projects\/[^/]+\/calc\/pressiometre/, async (route: Route) => {
    const isDry = route.request().url().includes('dryRun=true');
    const bodyJson = route.request().postData() ?? '{}';
    let output: unknown;
    try {
      output = serverOutputForBody(bodyJson);
    } catch (e) {
      // Échec dur, jamais un faux-vert : on renvoie une erreur explicite.
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: `moteur source: ${String(e)}` }),
      });
      return;
    }
    if (isDry) hits.calcDry += 1;
    else hits.calcReal += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        calcResultId: isDry ? undefined : `cr_pp_${++calcSeq}`,
        ok: true,
        meta: { engineId: 'pressiometre', engineVersion: 'e2e-note-scellement' },
        output,
      }),
    });
  });

  // POST snapshot : capture le printHtml RÉEL (chemin de persistance réel) puis
  // (éventuellement gelé) fulfill 201 → ToolFrame résout la capture en 'confirmed'.
  await page.route(
    /\/projects\/[^/]+\/calc-results\/[^/]+\/snapshot$/,
    async (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      hits.snapshot += 1;
      try {
        const payload = route.request().postDataJSON() as { printHtml?: string };
        if (typeof payload?.printHtml === 'string')
          hits.lastPrintHtml = payload.printHtml;
      } catch {
        /* body illisible — laissé null, l'assertion échouera (zéro faux-vert) */
      }
      if (opts.snapshotGate) await opts.snapshotGate;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    },
  );

  // POST pv : PV scellé re-servi. Forme PLATE PrismaOfficialPvCore telle que
  // `httpEmitPv` la reçoit puis `adaptOfficialPv` l'adapte — le champ du numéro
  // est `pvNumber` (mappé vers OfficialPv.number, cf. adapters.ts), PAS `numero` :
  // c'est ce numéro que la bannière du shell affiche (« PV scellé n° … »).
  await page.route(/\/projects\/[^/]+\/calc-results\/[^/]+\/pv$/, (route: Route) => {
    hits.pv += 1;
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: '22222222-2222-2222-2222-222222222222',
        orgId: ORG_ID,
        projectId: PROJECT_ID,
        calcResultId: 'cr_pp_final',
        engineId: 'pressiometre',
        pvNumber: 'PV-2026-000777',
        documentFormat: 'html',
        hmac: 'a1b2c3d4e5f6a7b8',
        sealedAt: new Date().toISOString(),
        userId: 'user_pp',
        inputCanonical: '{}',
        output: null,
        verdict: 'FAVORABLE',
        name: null,
      }),
    });
  });

  await page.goto(`/app/${ORG_SLUG}/logiciels/pressiopro`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .locator('iframe[data-testid="tool-frame-iframe"]')
    .waitFor({ state: 'attached', timeout: 30_000 });
  // Le projet (unique projet LB) doit être AUTO-sélectionné avant toute interaction :
  // tant qu'il ne l'est pas, l'indice « Sélectionnez un projet » est affiché et
  // ToolFrame BLOQUE tout calcul (y compris un aperçu dryRun). Attendre sa
  // disparition garantit que la requête de calcul atteindra bien la route.
  await page
    .locator('[data-testid="no-project-hint"]')
    .waitFor({ state: 'detached', timeout: 30_000 });
  await page.waitForTimeout(500);
  return hits;
}

function cloneFrame(page: Page): Frame {
  const frame = page
    .frames()
    .find((f) => f.url().includes('srcdoc') || f !== page.mainFrame());
  if (!frame) throw new Error('frame du clone pressiopro introuvable');
  return frame;
}

function dumpJson(name: string, data: unknown): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2), 'utf8');
}

test.describe('PRESSIOPRO — note + scellement (parcours réel, clone iframe)', () => {
  // ======================================================================
  // (1) PARCOURS NOTE — Exemple → Calculer → note → sceller → PV re-servi + §8
  // ======================================================================
  test('given le clone pressiopro, when Exemple → Calculer (dépouillement) → Sceller, then la note s affiche (E_M, catégorie, courbe P–V), le PV scellé se re-sert, et le document scellé est §8-propre (SVG, sans canvas ni data:, garde serveur OK)', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    expect(existsSync(CLONE_HTML), `Clone pressiopro ABSENT (${CLONE_HTML}).`).toBe(true);

    const token = forgeJwt();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addCookies([
      { name: 'roadsen_access_token', value: token, domain: 'localhost', path: '/' },
    ]);
    const page = await ctx.newPage();
    const hits = await openClone(page, token);
    const frame = cloneFrame(page);

    // WHEN — charger l'exemple fictif (le VRAI bouton « 🧪 Exemple »). NB : son
    // auto-calcul de boot n'est PAS fiable pour l'affichage (une course connue —
    // un aperçu dryRun débouncé supersède la réponse du calcul de boot via la garde
    // de séquence de ToolFrame) ; on NE s'appuie donc PAS dessus. On déclenche le
    // dépouillement EXPLICITEMENT via « Calculer — Dépouillement complet » (c'est
    // CE calcul-là qui émet `snapshot:capture` → scelle le document).
    await frame.getByRole('button', { name: /Exemple/ }).click();
    // L'onglet Mesures porte les seuils (renderMrows) + le bouton Calculer. On y va
    // et on attend que les seuils soient peuplés (preuve que l'exemple est chargé).
    await frame.locator('button.nb[data-page="mesures"]').click();
    await expect
      .poll(async () => frame.locator('#sel_pf option').count(), { timeout: 20_000 })
      .toBeGreaterThan(0);
    // AMORÇAGE — verrou anti-course (piège connu). `loadExempleFictif()` planifie un
    // aperçu E_M débouncé (`updateSeuilPreview` → calc `dryRun`, ~300 ms) ET un calcul
    // d'affichage de boot. Chaque `calc:request` incrémente la séquence de ToolFrame :
    // si l'aperçu débouncé partait APRÈS notre « Dépouillement complet », il
    // SUPERSÉDERAIT sa réponse (garde `seq !== requestSeqRef.current`) → doCalc reste
    // en attente, `snapshot:capture` n'arrive jamais, le bouton PV ne s'active pas.
    // On ATTEND donc que l'aperçu ait ABOUTI (le panneau `#seuilPreview` affiche la
    // ligne finale « E_M ≈ … MPa ») : à ce moment le timer de debounce a déjà tiré et
    // AUCUN aperçu n'est plus en vol. Notre « Dépouillement complet » sera alors le
    // `calc:request` de séquence la PLUS RÉCENTE (goPage/doCalc ne relancent pas
    // `renderMrows`, donc aucun nouvel aperçu n'est reprogrammé après ce clic).
    await frame.locator('#seuilPreview').waitFor({ state: 'visible', timeout: 20_000 });
    await expect
      .poll(async () => (await frame.locator('#seuilPreview').innerText()).trim(), {
        timeout: 20_000,
      })
      .toContain('MPa');
    await page.waitForTimeout(400);
    await frame.locator('button.bp', { hasText: /Dépouillement complet/ }).click();

    // La note se ré-affiche (onglet Résultats) — E_M, catégorie, courbe P–V canvas.
    await frame
      .locator('#resCont .kp.bl .kv.sm')
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 });

    const emValue = (
      await frame.locator('#resCont .kp.bl .kv.sm').first().innerText()
    ).trim();
    const catName = (
      await frame.locator('#resCont .catb .catnm').first().innerText()
    ).trim();
    const canvasCount = await frame.locator('#resCont canvas#chartPV').count();

    // Zéro faux-vert : la note DOIT porter un E_M numérique, une catégorie, une courbe.
    expect(emValue, 'E_M absent de la note').not.toBe('');
    expect(
      Number.parseFloat(emValue.replace(',', '.')),
      'E_M non numérique',
    ).toBeGreaterThan(0);
    expect(catName.length, 'catégorie absente de la note').toBeGreaterThan(0);
    expect(canvasCount, 'courbe P–V (canvas #chartPV) absente à l écran').toBeGreaterThan(
      0,
    );
    expect(hits.calcReal, 'aucun calcul réel intercepté').toBeGreaterThan(0);

    // THEN — le bridge a émis snapshot:capture → l'hôte a POSTé le document réel.
    await expect.poll(() => hits.snapshot, { timeout: 20_000 }).toBeGreaterThan(0);
    const printHtml = hits.lastPrintHtml;
    expect(
      printHtml,
      'aucun printHtml capturé (snapshot:capture non émis ?)',
    ).toBeTruthy();
    expect((printHtml as string).length, 'printHtml capturé trop court').toBeGreaterThan(
      5000,
    );
    const doc = printHtml as string;
    // Dépose l'artefact réel (note live + document scellé) pour audit de fidélité.
    mkdirSync(OUT_DIR, { recursive: true });
    dumpJson('pressiopro-note-live.json', { emValue, catName, canvasCount });
    writeFileSync(
      path.join(OUT_DIR, 'pressiopro-scellement-printhtml.html'),
      doc,
      'utf8',
    );

    // -- §8 : le document scellé est INERTE et confidentiel ----------------
    // Courbe P–V : canvas re-dessiné en SVG inline → SVG présent, canvas ABSENT.
    expect(
      /<svg\b/i.test(doc),
      'document scellé sans <svg> (courbe non re-dessinée)',
    ).toBe(true);
    expect(/<canvas\b/i.test(doc), 'document scellé contient <canvas> (§8)').toBe(false);
    // FIGURE RASTERISÉE INTERDITE : on cible `src=data:` (une <img> data:), PAS le
    // `url("data:image/svg+xml,…")` LÉGITIME du <style> (flèche de <select> — CSS
    // décoratif, jamais une figure de la note). C'EXACTEMENT le motif de la garde §8
    // authoritative (packages/engines/…/clone-render.test) : `data:image` seul y
    // ferait un FAUX POSITIF sur ce CSS. Le vrai verdict §8 reste `assertInertHtml`.
    expect(
      /src\s*=\s*["']?\s*data:/i.test(doc),
      'figure rasterisée (src=data:) dans le document scellé',
    ).toBe(false);
    expect(/<script\b/i.test(doc), 'document scellé contient <script>').toBe(false);
    for (const marker of [
      '__ROADSEN_ENGINE_',
      '@roadsen/engines',
      'computePressiometre',
      'runPressiometre',
      'shapeOutput',
    ]) {
      expect(
        doc.includes(marker),
        `marqueur moteur « ${marker} » dans le document scellé`,
      ).toBe(false);
    }
    // La note doit VRAIMENT porter le résultat (non vide) : E_M et catégorie présents.
    expect(doc.includes(catName), 'catégorie absente du document scellé').toBe(true);

    // -- §8 via la VRAIE garde serveur (jamais une copie) ------------------
    const guardRaw = execFileSync('npx', ['tsx', 'scripts/assert-inert-run.mts'], {
      input: doc,
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    const guard = JSON.parse(guardRaw) as { ok: boolean; error?: string };
    expect(
      guard.ok,
      `la garde serveur assertInertHtml REFUSE le document pressiopro scellé : ${guard.error ?? ''}`,
    ).toBe(true);

    // THEN — « Émettre le PV scellé » actif (capture 'confirmed') → émission → PV re-servi.
    const emitBtn = page.locator('[data-testid="btn-emettre-pv"]');
    await expect(emitBtn).toBeEnabled({ timeout: 20_000 });
    await expect(emitBtn).toHaveText('Émettre le PV scellé');
    await emitBtn.click();
    await expect.poll(() => hits.pv, { timeout: 15_000 }).toBeGreaterThan(0);
    // Le PV scellé (documentFormat html) se re-sert : bannière « PV scellé n° … ».
    await expect(page.getByText(/PV scellé n°\s*PV-2026-000777/)).toBeVisible({
      timeout: 15_000,
    });

    await ctx.close();
  });

  // ======================================================================
  // (2) GARDE DE COURSE dry-run — un aperçu n'active PAS l'émission
  // ======================================================================
  test('given un aperçu E_M (dryRun) déclenché par updateSeuilPreview, when il part côté serveur, then il n active PAS le bouton PV et ne crée AUCUN calcul scellable — seul un vrai « Calculer » rend l émission possible', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const token = forgeJwt();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addCookies([
      { name: 'roadsen_access_token', value: token, domain: 'localhost', path: '/' },
    ]);
    const page = await ctx.newPage();
    const hits = await openClone(page, token);
    const frame = cloneFrame(page);
    await frame.getByRole('button', { name: /Exemple/ }).waitFor({
      state: 'visible',
      timeout: 15_000,
    });

    // Le shell doit avoir auto-sélectionné le projet (1 seul projet LB) — sinon
    // ToolFrame bloquerait le calcul et la preuve serait vide.
    await expect
      .poll(async () =>
        (await frame.evaluate('typeof updateSeuilPreview')) === 'function' ? 1 : 0,
      )
      .toBe(1);

    // WHEN — on INJECTE l'état d'une profondeur SANS passer par loadExempleFictif
    // (qui, LUI, lance un calcul d'affichage de boot → poserait un calcResultId au
    // shell, contaminant la preuve « un aperçu seul n'active jamais l'émission »).
    //
    // On passe par la VRAIE routine d'hydratation du clone `applyData({projet, depths})` :
    //   - `depths`/`cur` sont des `let` TOP-LEVEL (portée lexicale du <script>), donc
    //     INACCESSIBLES depuis `window.*` ; seule une fonction du clone peut les
    //     réassigner. `applyData` fait `depths = d.depths` puis re-rend.
    //   - elle renseigne AUSSI les paramètres de sonde (p_a/p_ph/p_pe/p_v0/p_k0, nappe)
    //     depuis `d.projet` : `buildEssaiInput` les lit via `getParams()` et, sans eux,
    //     l'entrée serait rejetée par le MOTEUR SOURCE (500) → l'aperçu ne partirait
    //     jamais et la preuve serait vide.
    //   - elle NE lance AUCUN calcul (contrairement à loadExempleFictif) : `renderMrows`
    //     y planifie seulement l'aperçu débouncé `updateSeuilPreview` (dryRun). C'est
    //     exactement l'état voulu : un aperçu, jamais un calcul scellable.
    await frame.evaluate((rows) => {
      const applyData = (window as unknown as { applyData?: (d: unknown) => void })
        .applyData;
      if (typeof applyData !== 'function') throw new Error('applyData indisponible');
      applyData({
        projet: {
          a: '5',
          ph: '0.5',
          pe: '1.0',
          v0: '535',
          k0: '0.5',
          nappe: '3.0',
        },
        depths: [{ label: '2.0 m', pf_idx: 2, plm_idx: 5, rows }],
      });
      const goPage = (window as unknown as { goPage?: (p: string, i: number) => void })
        .goPage;
      if (goPage) goPage('mesures', 3);
      const upd = (window as unknown as { updateSeuilPreview?: () => void })
        .updateSeuilPreview;
      if (upd) upd();
    }, EXAMPLE_ROWS);

    // THEN — l'aperçu part RÉELLEMENT côté serveur (dryRun) et rend un E_M.
    await expect.poll(() => hits.calcDry, { timeout: 20_000 }).toBeGreaterThan(0);
    await expect
      .poll(async () => (await frame.locator('#seuilPreview').innerText()).trim(), {
        timeout: 20_000,
      })
      .toMatch(/MPa/); // « E_M ≈ … MPa » (aperçu réellement rendu — pas « Erreur »/« … »)

    // Laisse le temps à un éventuel (indésirable) calcResultId de remonter au shell.
    await page.waitForTimeout(1200);

    // -- INVARIANTS DE LA GARDE (zéro faux-vert) ---------------------------
    // Aucun calcul scellable : pas de calc réel, pas de snapshot, pas de PV.
    expect(hits.calcReal, 'un aperçu dryRun a déclenché un calcul RÉEL (scellable)').toBe(
      0,
    );
    expect(hits.snapshot, 'un aperçu dryRun a POSTé un snapshot de document').toBe(0);
    expect(hits.pv, 'un aperçu dryRun a émis un PV').toBe(0);
    // Le clone n'a PAS posé son id scellable (posé uniquement par doCalc).
    const lastId = await frame.evaluate(
      () =>
        (window as unknown as { __pressioLastCalcResultId?: unknown })
          .__pressioLastCalcResultId ?? null,
    );
    expect(
      lastId,
      'le clone a posé __pressioLastCalcResultId sur un simple aperçu',
    ).toBeNull();
    // Le bouton d'émission du shell reste DÉSACTIVÉ (aucun calcResultId remonté).
    const emitBtn = page.locator('[data-testid="btn-emettre-pv"]');
    await expect(emitBtn).toBeDisabled();
    await expect(emitBtn).toHaveText('Émettre le PV scellé');

    // -- CONTRE-PREUVE : un vrai « Calculer » RÉ-ACTIVE l émission ----------
    // (prouve que la garde n'est pas juste « bouton toujours désactivé » : c'est
    //  bien le calcul RÉEL, pas l'aperçu, qui débloque le scellement.)
    await frame.locator('button.bp', { hasText: /Dépouillement complet/ }).click();
    await expect.poll(() => hits.calcReal, { timeout: 20_000 }).toBeGreaterThan(0);
    await expect.poll(() => hits.snapshot, { timeout: 20_000 }).toBeGreaterThan(0);
    await expect(emitBtn).toBeEnabled({ timeout: 20_000 });

    dumpJson('pressiopro-dryrun-guard.json', {
      calcDry: hits.calcDry,
      calcReal: hits.calcReal,
      snapshot: hits.snapshot,
      pv: hits.pv,
    });

    await ctx.close();
  });
});
