/**
 * FIDÉLITÉ D'INTERFACE TERZAGHI — HTML client (référence gelée) ↔ NOTRE clone
 * (pilote « clone UI client », ADR 0015).
 * ==========================================================================
 *
 * OBJECTIF : PROUVER l'équivalence d'AFFICHAGE/FONCTIONNEMENT entre l'outil
 * Terzaghi du client (`terzaghi_V13.html`, gelé) et notre logiciel web — qui,
 * depuis ADR 0015, N'EST PLUS une reconstruction React mais le CLONE fidèle de
 * l'UI client (calcul EXCISÉ), chargé en `<iframe srcdoc sandbox>` via
 * `ToolFrame`, dont le calcul part côté SERVEUR (DoD §8).
 *
 * DISPOSITIF (les 3 volets exigés) :
 *   (a) SORTIE SERVEUR du cas de référence — `exampleState()` du HTML client
 *       (« diarra sp1 ») exécuté par le MOTEUR SOURCE `runTerzaghi` en
 *       sous-processus (`scripts/terzaghi-engine-run.mts`) : c'est numériquement
 *       la sortie qu'un serveur renverrait (équivalence module↔origine prouvée
 *       par `engine.equivalence.test.ts`). L'API Render publique n'expose pas de
 *       endpoint calc non authentifié, et sa dist peut ne pas porter les champs
 *       élargis (`cas[].qref`/`Hd`/`contraintesBase`) — d'où ce fallback local
 *       DOCUMENTÉ (jamais un skip déguisé). NB : la dist COMPILÉE du paquet est
 *       périmée (sans champs élargis) → on charge la SOURCE via tsx.
 *   (b) RÉFÉRENCE (LECTURE seule) — `terzaghi_V13.html` en file://, « Exemple
 *       fictif » cliqué → calcul LOCAL (elle a encore son moteur) → extraction
 *       DOM (cartes de vérification, note §2, structure de navigation, coupe SVG).
 *   (c) NOTRE app en LOCAL, MODE RÉEL (port 3101), clone en iframe : même cas via
 *       « Exemple fictif » du clone ; la requête de calcul (`POST .../calc/
 *       fondation-superficielle`) est INTERCEPTÉE par page.route et fulfillée avec
 *       la sortie (a) sous la forme `BackendPersistedCalcResult`. Extraction du
 *       MÊME jeu d'éléments dans le frame.
 *   (d) CLASSIFICATION FERMÉE par élément : (a) mappé = valeurs identiques (tol),
 *       (b) §8 fail-closed = UNIQUEMENT les stubs `caseSteps`/`refCapSteps`
 *       (liste fermée), (c) absent = liste fermée (idéalement vide). Toute ligne
 *       non classée = ÉCHEC. Assertions dures finales : uncovered/omitted/
 *       valueMismatch vides.
 *
 * ZÉRO FAUX-VERT : réf absente → ÉCHEC dur ; « 0 carte » extraite d'un côté →
 * ÉCHEC dur ; calc non intercepté → ÉCHEC dur ; le stub backend REFUSE le calcul
 * (405) pour garantir que la sortie comparée vient bien de l'interception.
 *
 * PORTÉE HONNÊTE : ceci prouve la FIDÉLITÉ D'INTERFACE + AFFICHAGE, PAS la
 * justesse scientifique (responsabilité STARFIRE — split contractuel).
 */
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { test, expect, type Frame, type Page } from '@playwright/test';

// --------------------------------------------------------------------------
// Constantes & identité forgée
// --------------------------------------------------------------------------
const SECRET = 'fidelite-terzaghi-e2e-secret-32bytes-min-xxxxxxxx'; // = webServer.env.JWT_SECRET
const ORG_SLUG = 'etude-terzaghi';
const ORG_ID = 'org_terz';
const REF_HTML = path.resolve(
  __dirname,
  '../../packages/engines/reference/terzaghi_V13.html',
);
const CLONE_HTML = path.resolve(
  __dirname,
  '../../apps/web/src/tools-cloned/terzaghi.html',
);
const REPO = path.resolve(__dirname, '../..');
const OUT_DIR = path.resolve(__dirname, '../../docs/audits-fidelite');
const CAP_DIR = path.join(OUT_DIR, 'captures');

/** Cas de validation « diarra sp1 » — exampleState() du HTML (figé ; vérifié contre la réf). */
const EXAMPLE_STATE = {
  projet: 'Bâtiment R+5 — exemple',
  sondage: [
    { z: '1,5', pl: '', em: '2,5', al: '0,5' },
    { z: '3', pl: '0,5', em: '7', al: '0,5' },
    { z: '4,5', pl: '0,6', em: '6', al: '0,5' },
    { z: '6', pl: '0,6', em: '6', al: '0,5' },
    { z: '7,5', pl: '0,7', em: '6', al: '0,5' },
    { z: '9', pl: '5', em: '150', al: '0,5' },
    { z: '10,5', pl: '5', em: '200', al: '0,5' },
    { z: '12', pl: '5', em: '198', al: '0,5' },
    { z: '13,5', pl: '5', em: '202', al: '0,5' },
  ],
  solCat: 'marnes',
  nappe: '',
  gAvant: '20',
  gApres: '20',
  c: '0',
  phi: '30',
  eYoung: '50',
  nuSol: '0,33',
  cphiOn: false,
  cphiMode: 'auto',
  gSous: '',
  essai: 'pressio',
  alphaSang: '',
  profilMode: 'essais',
  forme: 'rect',
  B: '6',
  L: '10',
  D: '4,5',
  talusOn: false,
  beta: '',
  dTalus: '',
  talusDir: 'ext',
  beton: 'coule',
  alphaConst: true,
  alphaConstVal: '0,5',
  charges: [{ etat: 'ELS_QP', fz: '12240', fx: '0', fy: '0', mx: '0', my: '0' }],
};

function ensureDirs(): void {
  mkdirSync(CAP_DIR, { recursive: true });
}
function dumpJson(name: string, data: unknown): void {
  ensureDirs();
  writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2), 'utf8');
}

// --------------------------------------------------------------------------
// JWT HS256 forgé (node:crypto, aucun dépendance) — mêmes claims que le middleware attend.
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
      sub: 'user_terz',
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
// Extraction DOM — fonction SÉRIALISÉE (navigateur). MÊME code pour la référence
// (page) et pour le clone (frame) : la structure DOM du clone est celle de la
// référence (clonage), donc les mêmes sélecteurs valent des deux côtés.
// --------------------------------------------------------------------------
interface VCard {
  cls: string; // 'ok' | 'bad' | 'warn' | ''
  k: string;
  v: string;
  s: string;
}
interface UiModel {
  cards: VCard[];
  hasSteps: boolean; // déroulé pas-à-pas présent (.calc .step) — réf: oui ; clone: OUI (dé-stub)
  stubText: boolean; // renvoi au « PV scellé » (ancien stub §8 — doit être FALSE après dé-stub)
  stepTitles: string[]; // titres des étapes du déroulé (.calc .step .step-h)
  stepResults: string[]; // valeurs substituées du déroulé (.calc .rl)
  verifsLen: number;
  noteHeadings: string[];
  contraintes: string; // ligne §2 : u / q0 / σ'v0
  noteHasSynthese: boolean;
  segEssai: string[];
  segForme: string[];
  segProfil: string[];
  tabs: string[];
  cardTitles: string[];
  coupeSvg: boolean;
  coupePaths: number; // courbes de sondage tracées (écart n°1 de l'audit)
}

function extractModel(): UiModel {
  const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const pane = document.getElementById('tab-verifs');
  const cards: VCard[] = Array.from(pane?.querySelectorAll('.vcard') ?? []).map((c) => ({
    cls: c.className.replace('vcard', '').replace(/\s+/g, ' ').trim(),
    k: norm(c.querySelector('.k')?.textContent),
    v: norm(c.querySelector('.v')?.textContent),
    s: norm(c.querySelector('.s')?.textContent),
  }));
  const paneTxt = norm(pane?.textContent);
  const hasSteps = !!pane?.querySelector('.calc .step');
  const stubText = /PV scellé/i.test(paneTxt);
  const stepTitles = Array.from(pane?.querySelectorAll('.calc .step .step-h') ?? []).map(
    (h) => norm(h.textContent),
  );
  const stepResults = Array.from(pane?.querySelectorAll('.calc .rl') ?? []).map((e) =>
    norm(e.textContent),
  );

  const note = document.getElementById('noteView');
  const noteHeadings = Array.from(note?.querySelectorAll('h4') ?? []).map((h) =>
    norm(h.textContent),
  );
  const contraintes = norm(
    Array.from(note?.querySelectorAll('.f') ?? [])
      .map((f) => f.textContent ?? '')
      .find((t) => /u\s*=|q0|q<sub>0/.test(t)) ?? '',
  );
  const noteHasSynthese = /Synthèse/i.test(norm(note?.textContent));

  const segTxt = (id: string) =>
    Array.from(document.querySelectorAll(`#${id} button`)).map((b) =>
      norm(b.textContent),
    );
  const coupe = document.getElementById('coupeSvg');

  return {
    cards,
    hasSteps,
    stubText,
    stepTitles,
    stepResults,
    verifsLen: (pane?.innerHTML ?? '').length,
    noteHeadings,
    contraintes,
    noteHasSynthese,
    segEssai: segTxt('segEssai'),
    segForme: segTxt('segForme'),
    segProfil: segTxt('segProfil'),
    tabs: Array.from(document.querySelectorAll('#tabs button')).map((b) =>
      norm(b.textContent),
    ),
    cardTitles: Array.from(document.querySelectorAll('.card-h h2')).map((h) =>
      norm(h.textContent),
    ),
    coupeSvg: !!coupe?.querySelector('svg'),
    coupePaths: coupe?.querySelectorAll('svg path').length ?? 0,
  };
}

// --------------------------------------------------------------------------
// Normalisation & comparaison numérique (Node) — patron fidelite-roadsens.
// --------------------------------------------------------------------------
function keyOf(cardK: string): string {
  return cardK
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function parseNums(s: string): number[] {
  let t = s.replace(/[\u00a0\u202f]/g, '');
  t = t.replace(/(\d),(\d)/g, '$1.$2'); // décimales fr-FR
  const m = t.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
  return m ? m.map(Number) : [];
}
function relErr(a: number, b: number): number {
  if (a === b) return 0;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);
}
/** Compare deux chaînes affichées : mêmes nombres (tol) OU même texte normalisé. */
function displayEqual(ref: string, ours: string): { ok: boolean; why: string } {
  const rn = parseNums(ref);
  const on = parseNums(ours);
  if (rn.length === 0 && on.length === 0) {
    const a = keyOf(ref);
    const b = keyOf(ours);
    return a === b
      ? { ok: true, why: '' }
      : { ok: false, why: `texte « ${ref} » ≠ « ${ours} »` };
  }
  if (rn.length !== on.length) {
    return { ok: false, why: `#valeurs ${JSON.stringify(rn)} ≠ ${JSON.stringify(on)}` };
  }
  for (let i = 0; i < rn.length; i++) {
    // Tolérance : les valeurs sont affichées à la même précision fr-FR des deux
    // côtés (mêmes renderers) ; on tolère l'arrondi d'affichage (rel 5e-3) et
    // l'égalité exacte des entiers formatés.
    const e = relErr(rn[i], on[i]);
    if (e > 5e-3)
      return {
        ok: false,
        why: `valeur[${i}] réf=${rn[i]} nous=${on[i]} rel=${e.toExponential(2)}`,
      };
  }
  return { ok: true, why: '' };
}

// --------------------------------------------------------------------------
// Sortie serveur (a) via moteur SOURCE en sous-processus.
// --------------------------------------------------------------------------
function serverOutputFor(state: unknown): unknown {
  const raw = execFileSync('npx', ['tsx', 'scripts/terzaghi-engine-run.mts'], {
    input: JSON.stringify(state),
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const parsed = JSON.parse(raw) as { ok: boolean; output?: unknown; error?: string };
  expect(parsed.ok, `moteur serveur (a) a échoué : ${raw.slice(0, 400)}`).toBe(true);
  expect(parsed.output, 'sortie serveur (a) vide').toBeTruthy();
  return parsed.output;
}

// --------------------------------------------------------------------------
// (b) RÉFÉRENCE — file://, clic « Exemple fictif », extraction.
// --------------------------------------------------------------------------
async function loadReferenceModel(page: Page): Promise<UiModel> {
  page.on('pageerror', () => {
    /* icônes CDN absentes en file:// — sans effet sur le moteur/DOM */
  });
  page.on('dialog', (d) => void d.accept()); // confirm « remplacer la saisie »
  await page.goto(pathToFileURL(REF_HTML).href, { waitUntil: 'domcontentloaded' });
  // Le moteur de la référence doit être présent (sinon file:// cassé) — zéro faux-vert.
  await page.locator('#btnExample').click();
  await page.waitForTimeout(700);
  // Garde-fou : le cas figé DOIT correspondre à ce que la réf a chargé.
  expect(await page.locator('#dimB').inputValue()).toBe('6');
  expect(await page.locator('#dimL').inputValue()).toBe('10');
  expect(await page.locator('[data-t="charge"][data-k="fz"]').first().inputValue()).toBe(
    '12240',
  );
  return page.evaluate(extractModel);
}

// --------------------------------------------------------------------------
// (c) NOTRE app — connexion forgée, iframe clone, interception du calcul.
// --------------------------------------------------------------------------
async function openOurClone(
  page: Page,
  serverOutput: unknown,
  token: string,
): Promise<{ intercepted: () => boolean }> {
  let calcIntercepted = false;

  await page.addInitScript((tok) => {
    try {
      window.sessionStorage.setItem('roadsen_access_token', tok);
    } catch {
      /* noop */
    }
  }, token);

  // Appels CLIENT interceptés (le serveur route-handler, lui, tape le stub).
  await page.route(/\/me\/entitlements/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        orgId: ORG_ID,
        pack: 'COMPLETE',
        modules: ['terzaghi', 'fondation-superficielle'],
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
          id: 'proj_terz',
          orgId: ORG_ID,
          name: 'E2E fidélité terzaghi',
          domain: 'FD',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdById: 'user_terz',
        },
      ]),
    }),
  );
  // LE CŒUR : la requête de calcul est interceptée et fulfillée avec (a),
  // sous la forme BackendPersistedCalcResult attendue par httpRunCalc/ToolFrame.
  await page.route(/\/projects\/[^/]+\/calc\/[^/]+/, async (route) => {
    calcIntercepted = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        calcResultId: 'cr_e2e_terz_1',
        ok: true,
        meta: { engineId: 'fondation-superficielle', engineVersion: 'e2e-fidelite' },
        output: serverOutput,
      }),
    });
  });

  await page.goto(`/app/${ORG_SLUG}/logiciels/terzaghi`, {
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

// ==========================================================================
// SUITE 1 — RÉFÉRENCE (catalogue + garde-fou non-vide)
// ==========================================================================
test.describe('FIDÉLITÉ TERZAGHI — référence client (file://)', () => {
  test('given le HTML client, when « Exemple fictif » + calcul local, then l’UI de référence est catalogable et NON vide', async ({
    browser,
  }) => {
    expect(existsSync(REF_HTML), `Référence ABSENTE (${REF_HTML}) — ÉCHEC dur.`).toBe(
      true,
    );
    ensureDirs();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const REF = await loadReferenceModel(page);
    await page.screenshot({
      path: path.join(CAP_DIR, 'terzaghi-client-verifs.png'),
      fullPage: true,
    });
    dumpJson('terzaghi-fidelite-reference.json', REF);

    // Zéro faux-vert : la référence DOIT produire un vrai résultat.
    expect(
      REF.cards.length,
      'la réf doit rendre des cartes de vérification',
    ).toBeGreaterThanOrEqual(3);
    expect(REF.coupeSvg, 'la réf doit rendre la coupe SVG').toBe(true);
    expect(
      REF.coupePaths,
      'la coupe de réf doit tracer le sondage (paths)',
    ).toBeGreaterThan(0);
    expect(REF.hasSteps, 'la réf déroule le calcul pas-à-pas (.calc .step)').toBe(true);
    expect(REF.segEssai, 'segments essai réf').toEqual([
      'Pressiomètre Ménard',
      'Pénétromètre statique',
      'Méthode c–φ',
    ]);
    expect(REF.segForme.length, 'segments forme réf').toBe(4);
    await ctx.close();
  });
});

// ==========================================================================
// SUITE 2 — CLONE + COMPARAISON (classification fermée, assertions dures)
// ==========================================================================
test.describe('FIDÉLITÉ TERZAGHI — clone (iframe) ↔ référence', () => {
  test('given le même cas, when calcul serveur intercepté, then affichage/structure du clone FIDÈLES à la réf (classification fermée)', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    expect(existsSync(CLONE_HTML), `Clone ABSENT (${CLONE_HTML}).`).toBe(true);

    // Modèle de référence (autonome — ne dépend pas de l'ordre des suites).
    const refCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const REF = await loadReferenceModel(await refCtx.newPage());
    expect(
      REF.cards.length,
      'réf sans cartes (extraction cassée)',
    ).toBeGreaterThanOrEqual(3);
    await refCtx.close();

    // (a) sortie serveur du cas exemple.
    const serverOutput = serverOutputFor(EXAMPLE_STATE);

    const token = forgeJwt();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addCookies([
      { name: 'roadsen_access_token', value: token, domain: 'localhost', path: '/' },
    ]);
    const page = await ctx.newPage();

    const { intercepted } = await openOurClone(page, serverOutput, token);

    // Le clone doit être chargé et prêt.
    const frame = cloneFrame(page);
    await frame.locator('#btnExample').waitFor({ state: 'visible', timeout: 15_000 });

    // (c) même cas via « Exemple fictif » du clone → calcul serveur intercepté.
    await frame.locator('#btnExample').click();
    await frame.locator('#tab-verifs').waitFor({ state: 'attached' });
    // Attendre la fin du recalc async (le placeholder « Calcul en cours… » disparaît).
    await expect
      .poll(
        async () =>
          (await frame.locator('#tab-verifs').innerHTML()).includes('Calcul en cours'),
        {
          timeout: 20_000,
        },
      )
      .toBe(false);
    await page.waitForTimeout(800);

    expect(
      intercepted(),
      'la requête de calcul DOIT avoir été interceptée (sinon comparaison invalide)',
    ).toBe(true);

    const OURS = await frame.evaluate(extractModel);
    await page.screenshot({
      path: path.join(CAP_DIR, 'terzaghi-nous-verifs.png'),
      fullPage: true,
    });
    dumpJson('terzaghi-fidelite-clone.json', OURS);

    // ---- Recheck EXCISION : le HTML servi ne contient aucun symbole moteur excisé ----
    const servedHtml = await page.evaluate(async () => {
      const res = await fetch(
        `/api/tools/terzaghi?orgId=${encodeURIComponent('org_terz')}`,
        {
          headers: {
            Authorization: `Bearer ${sessionStorage.getItem('roadsen_access_token')}`,
          },
        },
      );
      return res.text();
    });
    // Garde anti-faux-vert : on a bien récupéré le CLONE (pas une page d'erreur).
    expect(servedHtml.length, 'HTML servi trop court (fetch échoué ?)').toBeGreaterThan(
      10_000,
    );
    expect(servedHtml, 'HTML servi ≠ clone terzaghi (bridge absent)').toContain(
      '__geofamBridge',
    );
    const EXCISED_MARKERS = [
      'computeAll',
      'kpCurve',
      'gazetasFromKv',
      'gammaEffF',
      'bouss',
      '__ROADSEN_ENGINE_',
    ];
    const leaks = EXCISED_MARKERS.filter((m) => servedHtml.includes(m));
    expect(
      leaks,
      `symboles moteur EXCISÉS/confidentiels présents dans le HTML servi : ${leaks.join(', ')}`,
    ).toHaveLength(0);

    // ==================================================================
    // CLASSIFICATION FERMÉE
    // ==================================================================
    const uncovered: string[] = []; // ligne réf non classée (mapping troué)
    const omitted: string[] = []; // ligne réf sans équivalent côté clone
    const valueMismatch: string[] = []; // mappée mais valeur/texte divergent
    const sec8Residual: string[] = []; // (b) §8 fail-closed documenté (caseSteps/refCapSteps)
    const absentClosed: string[] = []; // (c) absences documentées (liste fermée)

    // -- Précondition d'INTÉGRATION : le clone doit AVOIR rendu un résultat. --
    // (mapOutputToR lit la sortie BRUTE `output.cas` : si le clone est vide alors
    //  que la réf a des cartes, c'est un défaut de LIVRAISON de la sortie, pas
    //  un écart d'affichage — on l'expose explicitement.)
    const integrationOk = OURS.cards.length > 0;

    // (b) §8 — DÉ-STUB (ADR 0015 reco A) : le déroulé pas-à-pas (caseSteps/refCapSteps)
    // est désormais RESTAURÉ et alimenté par la sortie serveur whitelistée. Il n'est donc
    // PLUS un stub : `OURS.stubText` doit être FALSE et `OURS.hasSteps` TRUE. RÉSIDU FERMÉ
    // restant hors allowlist reco A : le seul détail des FACTEURS DE PORTANCE c–φ annexe F
    // (N_q/N_c/N_γ) — NON sollicité par ce cas in situ (cphiOn=false) → liste (b) VIDE ici.
    if (OURS.stubText) {
      uncovered.push(
        'Le clone renvoie encore au « PV scellé » (stub) alors que le déroulé pas-à-pas doit être dé-stubbé (reco A).',
      );
    }
    if (REF.hasSteps && !OURS.hasSteps) {
      omitted.push(
        'Déroulé pas-à-pas ABSENT côté clone alors que présent en réf — dé-stub caseSteps/refCapSteps cassé.',
      );
    }
    // Le résidu fermé documenté (détail c–φ annexe F), non déclenché par ce cas, est tracé
    // pour mémoire dans la synthèse (absentClosed) — pas un écart sur ce jeu.
    absentClosed.push(
      'Détail des facteurs de portance c–φ annexe F (N_q/N_c/N_γ) : hors allowlist nominative reco A — non exposé (résidu fermé §8) ; non sollicité par ce cas in situ.',
    );

    // (a) mappé : chaque carte de vérification de la réf ↔ carte du clone.
    const oursByKey = new Map<string, VCard>();
    for (const c of OURS.cards)
      if (!oursByKey.has(keyOf(c.k))) oursByKey.set(keyOf(c.k), c);

    for (const rc of REF.cards) {
      const key = keyOf(rc.k);
      if (!key) {
        uncovered.push(`carte « ${rc.k} » (clé vide)`);
        continue;
      }
      const oc = oursByKey.get(key);
      if (!oc) {
        omitted.push(
          `carte « ${rc.k} » = « ${rc.v} » / « ${rc.s} » — ABSENTE côté clone`,
        );
        continue;
      }
      const cmpV = displayEqual(rc.v, oc.v);
      if (!cmpV.ok) valueMismatch.push(`« ${rc.k} » valeur : ${cmpV.why}`);
      const cmpS = displayEqual(rc.s, oc.s);
      if (!cmpS.ok) valueMismatch.push(`« ${rc.k} » sous-texte : ${cmpS.why}`);
      if (rc.cls !== oc.cls)
        valueMismatch.push(
          `« ${rc.k} » verdict-classe : réf « ${rc.cls} » ≠ clone « ${oc.cls} »`,
        );
    }

    // (a) note §2 — contraintes u/q0/σ'v0 (champ contract élargi contraintesBase).
    if (REF.contraintes) {
      const cmp = displayEqual(REF.contraintes, OURS.contraintes);
      if (!cmp.ok) valueMismatch.push(`note §2 contraintes : ${cmp.why}`);
    }

    // (a) DÉ-STUB — déroulé pas-à-pas (caseSteps) : titres d'étapes + VALEURS SUBSTITUÉES
    // (.rl) doivent être IDENTIQUES à la réf (le clone = renderers de la réf alimentés par
    // la sortie serveur, numériquement équivalente à son moteur — cf. clone-render.test).
    if (REF.stepTitles.length !== OURS.stepTitles.length) {
      valueMismatch.push(
        `déroulé : #étapes réf=${REF.stepTitles.length} ≠ clone=${OURS.stepTitles.length}`,
      );
    } else {
      for (let i = 0; i < REF.stepTitles.length; i++) {
        if (REF.stepTitles[i] !== OURS.stepTitles[i])
          valueMismatch.push(
            `étape ${i + 1} : réf « ${REF.stepTitles[i]} » ≠ clone « ${OURS.stepTitles[i]} »`,
          );
      }
    }
    if (REF.stepResults.length !== OURS.stepResults.length) {
      valueMismatch.push(
        `déroulé : #valeurs substituées réf=${REF.stepResults.length} ≠ clone=${OURS.stepResults.length}`,
      );
    } else {
      for (let i = 0; i < REF.stepResults.length; i++) {
        const cmp = displayEqual(REF.stepResults[i], OURS.stepResults[i]);
        if (!cmp.ok)
          valueMismatch.push(`valeur substituée pas-à-pas [${i}] : ${cmp.why}`);
      }
    }

    // -- Structure (segments, onglets, cartes de saisie) : fidélité par construction. --
    expect(OURS.segEssai, 'segments Essai clone ≠ réf').toEqual(REF.segEssai);
    expect(OURS.segForme, 'segments Forme clone ≠ réf').toEqual(REF.segForme);
    expect(OURS.segProfil, 'segments Profil clone ≠ réf').toEqual(REF.segProfil);
    expect(OURS.tabs, 'onglets résultats clone ≠ réf').toEqual(REF.tabs);
    expect(OURS.cardTitles, 'titres des cartes de saisie clone ≠ réf').toEqual(
      REF.cardTitles,
    );

    // -- Coupe SVG avec sondage (écart n°1 de l'audit) --
    expect(OURS.coupeSvg, 'la coupe du clone doit être un SVG rendu').toBe(true);
    expect(
      OURS.coupePaths,
      'la coupe du clone doit tracer le sondage (paths)',
    ).toBeGreaterThan(0);

    const summary = {
      integrationOk,
      refCards: REF.cards.length,
      ourCards: OURS.cards.length,
      classes: { uncovered, omitted, valueMismatch, sec8Residual, absentClosed },
      ourStubText: OURS.stubText,
      refHasSteps: REF.hasSteps,
      ourHasSteps: OURS.hasSteps,
      refSteps: REF.stepTitles.length,
      ourSteps: OURS.stepTitles.length,
      refStepResults: REF.stepResults.length,
      ourStepResults: OURS.stepResults.length,
      contraintesRef: REF.contraintes,
      contraintesNous: OURS.contraintes,
    };
    dumpJson('terzaghi-fidelite-classification.json', summary);
    // eslint-disable-next-line no-console
    console.log('\n[FIDÉLITÉ TERZAGHI]\n' + JSON.stringify(summary, null, 2));

    // ==================================================================
    // ASSERTIONS DURES (zéro faux-vert)
    // ==================================================================
    expect(
      integrationOk,
      `INTÉGRATION : le clone n'a rendu AUCUNE carte de vérification alors que la réf en a ${REF.cards.length}. ` +
        `Cause : la sortie serveur BRUTE (output.cas/capaciteReference/contraintesBase) est réduite par ` +
        `normalizeOutput() dans adaptPersistedCalcResult (httpRunCalc) AVANT d'atteindre l'iframe ; ` +
        `le clone (mapOutputToR) lit output.cas — absent après normalisation → « Renseignez au moins Fz… ». ` +
        `Aucun test n'exerçait le chemin réel runCalc→adapter→clone (clone-render.test mocke la sortie BRUTE, ` +
        `ToolFrame.test mocke la sortie NORMALISÉE). Correctif = livrer au clone la sortie whitelistée BRUTE.`,
    ).toBe(true);
    expect(uncovered, 'lignes réf NON classées (mapping troué)').toHaveLength(0);
    expect(omitted, 'lignes réf OMISES côté clone').toHaveLength(0);
    expect(valueMismatch, 'VALEURS/verdicts divergents clone↔réf').toHaveLength(0);

    // DÉ-STUB (reco A) : le clone rend désormais le déroulé pas-à-pas (plus de renvoi au PV).
    expect(
      OURS.stubText,
      'le clone renvoie encore au « PV scellé » (stub non retiré)',
    ).toBe(false);
    expect(
      OURS.hasSteps,
      'le clone doit rendre le déroulé pas-à-pas (.calc .step) — dé-stub',
    ).toBe(true);
    expect(
      OURS.stepResults.length,
      'le déroulé du clone doit porter des valeurs substituées',
    ).toBeGreaterThan(6);

    await ctx.close();
  });
});
