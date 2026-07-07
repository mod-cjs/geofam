/**
 * ÉQUIVALENCE GOLDEN-MASTER — ROADSENS (burmister, AGEROUTE Sénégal 2015).
 *
 * Preuve NAVIGATEUR + bout-en-bout PLATEFORME que le portage reproduit le HTML
 * CLIENT d'origine à 0 % d'écart (tolérance rel 1e-9).
 *
 *   1. HTML CLIENT gelé (référence, LECTURE seule)
 *        03-Moteurs-client/GeoSuite/source/tools/roadsens_burmister_LCPC_VF_moderne.html
 *      chargé dans un VRAI navigateur (chromium, file://). On pilote `doCalc()` et
 *      on capture l'objet BRUT `_D` (tous intermédiaires : contraintes, ε_t/ε_z,
 *      admissibles, coefficients de structure).
 *   2. PLATEFORME : le MÊME jeu d'entrées est recalculé côté SERVEUR (POST
 *      /calc/burmister sur Render — le calcul confidentiel ne tourne jamais au
 *      navigateur, DoD §8). On capture la sortie whitelistée.
 *   3. COMPARAISON champ par champ via la PROJECTION documentée (index.ts) :
 *      identité pour les grandeurs finales, ×1000 (MPa→kPa) pour les contraintes,
 *      strip du discriminant Kmix pour la famille. Écart attendu : 0 (rel ≤ 1e-9).
 *
 * ANCRAGE À LA RÉFÉRENCE SCELLÉE : on vérifie que le SHA-256 du HTML testé ==
 * l'empreinte du registre (259a58a8…b8ba) == la meta `engineSourceHash` renvoyée
 * par le serveur. Le fichier piloté au navigateur est donc byte-identique à la
 * référence scellée au PV — la preuve porte sur la bonne science.
 *
 * SKIP BRUYANT (jamais un faux-vert) : si le HTML source est absent (03-Moteurs-client
 * hors dépôt git en CI), le test ÉCHOUE explicitement plutôt que de passer à vide.
 *
 * PORTÉE HONNÊTE (@science-unsigned) : ceci prouve l'ÉQUIVALENCE DU PORTAGE
 * (plateforme == HTML client), PAS la JUSTESSE scientifique absolue (cas-tests
 * STARFIRE — hors périmètre). Un portage à 0 % d'un moteur faux resterait faux :
 * la justesse est la responsabilité science du client (split contractuel).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import { test, expect, type Page } from '@playwright/test';

// --------------------------------------------------------------------------
// Référence gelée + API
// --------------------------------------------------------------------------

/** HTML CLIENT gelé (hors 05-Plateforme, dans 03-Moteurs-client). LECTURE seule. */
const FROZEN_HTML = path.resolve(
  __dirname,
  '../../../03-Moteurs-client/GeoSuite/source/tools/roadsens_burmister_LCPC_VF_moderne.html',
);
/** Empreinte scellée au registre (registry.ts) — doit égaler le SHA du fichier + la meta serveur. */
const SEALED_SHA = '259a58a8ac0881b20657a34a119de6e603a0ed2895fb4fca21527f2d8cfeb8ba';

const API_PUBLIC = 'https://roadsen.onrender.com/calc/burmister';
const REL_TOL = 1e-9;

// UI bout-en-bout (RUN_LIVE=1) :
const FRONT = 'https://roadsen.vercel.app';
const CREDS = { email: 'demo@starfire.test', password: 'RoadsenDemo2026!' };
const ORG = 'demo-starfire';
const RUN_LIVE = process.env.RUN_LIVE === '1';
const NAV = 120_000;

// --------------------------------------------------------------------------
// Jeux de cas de référence — ENTREES pures (client-safe), familles AGEROUTE.
// (Miroir des BURMISTER_FIXTURES ; on n'importe pas @roadsen/engines dans un
//  spec e2e — entrées numériques uniquement, aucune science.)
// --------------------------------------------------------------------------

interface BurmisterInput {
  layers: Array<{ mat: string; h: number; E: number; nu: number }>;
  subgrade: { cls?: string; E: number; nu: number };
  traffic: { T: number; C: number; N: number; tau: number; dir: number; tv: number };
  load: {
    p: number;
    a: number;
    d: number;
    r?: 'auto' | number;
    sh?: 'auto' | number;
    ks?: 'auto' | number;
  };
}

const TR_REF = { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 };
const TR_FAIBLE = { T: 10, C: 0.5, N: 15, tau: 2.0, dir: 1.0, tv: 1.0 };
const TR_FORT = { T: 800, C: 1.2, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 };
const CP = { p: 0.662, a: 0.125, d: 0.375, r: 'auto' as const, sh: 'auto' as const, ks: 'auto' as const };
const PF2 = { cls: 'PF2', E: 50, nu: 0.35 };
const PF3 = { cls: 'PF3', E: 120, nu: 0.35 };

interface Cas {
  id: string;
  /** Famille AGEROUTE attendue en sortie serveur (libellé NU), ou null (informatif). */
  familleAttendue: string | null;
  input: BurmisterInput;
}

const CAS: Cas[] = [
  { id: 'bitumineuse-épaisse', familleAttendue: 'bitumineuse épaisse', input: { layers: [{ mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 }, { mat: 'GB3', h: 0.1, E: 2588, nu: 0.45 }, { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 }], subgrade: PF2, traffic: TR_REF, load: CP } },
  { id: 'souple-à-faible-trafic', familleAttendue: 'souple à faible trafic', input: { layers: [{ mat: 'BBSG1', h: 0.05, E: 1512, nu: 0.45 }, { mat: 'GNT1', h: 0.2, E: 200, nu: 0.35 }, { mat: 'GNT2', h: 0.2, E: 150, nu: 0.35 }], subgrade: PF2, traffic: TR_FAIBLE, load: CP } },
  { id: 'bitumineuse-épaisse-fort-trafic', familleAttendue: 'bitumineuse épaisse', input: { layers: [{ mat: 'BBSG2', h: 0.06, E: 1896, nu: 0.45 }, { mat: 'GB3', h: 0.12, E: 2588, nu: 0.45 }, { mat: 'GB3', h: 0.12, E: 2588, nu: 0.45 }, { mat: 'GNT1', h: 0.2, E: 200, nu: 0.35 }], subgrade: PF3, traffic: TR_FORT, load: CP } },
  { id: 'eme2-sur-pf3', familleAttendue: null, input: { layers: [{ mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 }, { mat: 'EME2', h: 0.13, E: 6151, nu: 0.45 }, { mat: 'GNT1', h: 0.15, E: 200, nu: 0.35 }], subgrade: PF3, traffic: TR_REF, load: CP } },
  { id: 'semi-rigide', familleAttendue: 'semi-rigide', input: { layers: [{ mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 }, { mat: 'GLc2', h: 0.22, E: 3000, nu: 0.25 }, { mat: 'GLc2', h: 0.22, E: 3000, nu: 0.25 }], subgrade: PF2, traffic: TR_REF, load: CP } },
  { id: 'mixte', familleAttendue: 'mixte', input: { layers: [{ mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 }, { mat: 'GB3', h: 0.12, E: 2588, nu: 0.45 }, { mat: 'GLc1', h: 0.18, E: 2500, nu: 0.25 }, { mat: 'GNT1', h: 0.15, E: 200, nu: 0.35 }], subgrade: PF2, traffic: TR_REF, load: CP } },
  { id: 'béton-bc5', familleAttendue: null, input: { layers: [{ mat: 'BC5', h: 0.2, E: 35000, nu: 0.25 }, { mat: 'BC5', h: 0.18, E: 35000, nu: 0.25 }, { mat: 'GNT1', h: 0.2, E: 200, nu: 0.35 }], subgrade: PF2, traffic: TR_FORT, load: CP } },
  { id: 'inverse', familleAttendue: 'inverse', input: { layers: [{ mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 }, { mat: 'GB3', h: 0.08, E: 2588, nu: 0.45 }, { mat: 'GNT1', h: 0.12, E: 200, nu: 0.35 }, { mat: 'GLc2', h: 0.2, E: 3000, nu: 0.25 }], subgrade: PF2, traffic: TR_REF, load: CP } },
  { id: 'granulaire', familleAttendue: 'granulaire', input: { layers: [{ mat: 'GNT1', h: 0.2, E: 200, nu: 0.35 }, { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 }], subgrade: PF2, traffic: TR_FAIBLE, load: CP } },
  { id: 'override-risque-sh-ks', familleAttendue: null, input: { layers: [{ mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 }, { mat: 'GB3', h: 0.11, E: 2588, nu: 0.45 }, { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 }], subgrade: PF2, traffic: TR_REF, load: { p: 0.662, a: 0.125, d: 0.375, r: 10, sh: 2.5, ks: 0.95 } } },
  { id: 'borne-charge-centrée-d0', familleAttendue: null, input: { layers: [{ mat: 'BBSG1', h: 0.07, E: 1512, nu: 0.45 }, { mat: 'GB3', h: 0.12, E: 2588, nu: 0.45 }, { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 }], subgrade: PF2, traffic: TR_REF, load: { p: 0.662, a: 0.125, d: 0, r: 'auto', sh: 'auto', ks: 'auto' } } },
  { id: 'borne-pf-faible-pf1', familleAttendue: null, input: { layers: [{ mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 }, { mat: 'GB3', h: 0.1, E: 2588, nu: 0.45 }, { mat: 'GL1', h: 0.2, E: 200, nu: 0.35 }], subgrade: { cls: 'PF1', E: 20, nu: 0.35 }, traffic: TR_REF, load: CP } },
];

/**
 * Cas MATÉRIAU INCONNU : le référentiel n'a pas la clé -> le moteur d'origine NE
 * lève PAS, il DÉGRADE (e6=Infinity -> admissible fatigue null, famille "granulaire").
 * Vérité observée au navigateur (contredit l'étiquette `horsDomaine` de la fixture
 * jsdom historique). Ce qui compte pour le PORTAGE : le serveur reproduit ce même
 * comportement dégradé au bit près. On le traite donc comme un cas d'équivalence.
 * NOTE science (@science-unsigned) : le moteur ACCEPTE un matériau inconnu et rend
 * un résultat dégradé silencieux — robustesse à signaler au client, mais IDENTIQUE
 * des deux côtés (ce n'est pas un défaut de portage).
 */
const CAS_MATERIAU_INCONNU: Cas = {
  id: 'matériau-inconnu-dégradation-identique',
  familleAttendue: null,
  input: { layers: [{ mat: 'INCONNU_XYZ', h: 0.06, E: 1500, nu: 0.45 }, { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 }], subgrade: PF2, traffic: TR_REF, load: CP },
};

// --------------------------------------------------------------------------
// Pilotage du HTML CLIENT dans le navigateur : reassign des bindings + doCalc.
// --------------------------------------------------------------------------

interface HtmlResult {
  err: string | null;
  d: Record<string, unknown> | null;
}

async function computeHtml(page: Page, input: BurmisterInput): Promise<HtmlResult> {
  return page.evaluate((st) => {
    // Réassigne les bindings lexicaux `let` du HTML (accessibles en écriture depuis
    // une fonction), appelle `doCalc()`, capture l'objet global `_D` (var).
    // @ts-expect-error — symboles globaux du HTML d'origine.
    ly = st.layers.map((l, i) => ({ id: i + 1, ...l }));
    // @ts-expect-error
    pf = st.subgrade;
    // @ts-expect-error
    tr = st.traffic;
    // @ts-expect-error
    cp = st.load;
    let err: string | null = null;
    try {
      // @ts-expect-error
      doCalc();
    } catch (e) {
      err = String((e && (e as Error).message) || e);
    }
    // @ts-expect-error
    const d = typeof _D !== 'undefined' ? _D : null;
    const ok = d && Object.prototype.hasOwnProperty.call(d, 'PASS');
    return { err: ok ? null : err || 'aucun _D calculé', d: ok ? d : null };
  }, input as unknown as Record<string, unknown>);
}

// --------------------------------------------------------------------------
// Vues canoniques (mêmes transforms que la projection serveur, index.ts).
// --------------------------------------------------------------------------

type Canon = Record<string, number | boolean | null>;
const numOf = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const x1000 = (v: unknown): number | null => (numOf(v) === null ? null : (v as number) * 1000);

function htmlCanon(D: Record<string, unknown>): Canon {
  const s0 = (D.s0 ?? {}) as Record<string, unknown>;
  const sd2 = (D.sd2 ?? {}) as Record<string, unknown>;
  const c: Canon = {
    conforme: D.PASS === true,
    NE: numOf(D.NE),
    epaisseurLiee: numOf(D.H_bit),
    epaisseurTotale: numOf(D.H_tot),
    'ornierage.valeur': numOf(D.ez),
    'ornierage.admissible': numOf(D.ezA),
    'ornierage.ok': D.passZ === true,
    'details.E1_pond': numOf(D.E1),
    'details.nu1_pond': numOf(D.nu1),
    'details.E_psc': numOf(D.Eref),
    'details.nu_psc': numOf(D.nuRef),
    'details.risque_pct': numOf(D.rEff),
    'details.sigmaZ_r0': x1000(s0.sz),
    'details.sigmaR_r0': x1000(s0.sr),
    'details.sigmaZ_d2': x1000(sd2.sz),
    'details.sigmaR_d2': x1000(sd2.sr),
    'details.epsilonT_r0': numOf(D.et0),
    'details.epsilonT_d2': numOf(D.etM),
    'details.epsilonT': numOf(D.et),
    'details.epsilonT_adm': numOf(D.etA),
    'details.epsilonZ_axe': numOf(D.ez0),
    'details.epsilonZ_mid': numOf(D.ezM),
    'details.epsilonZ': numOf(D.ez),
    'details.epsilonZ_adm': numOf(D.ezA),
  };
  if (D.hasBit === true) {
    c['fatigue.valeur'] = numOf(D.et);
    c['fatigue.admissible'] = numOf(D.etA);
    c['fatigue.ok'] = D.passT === true;
    c['fatigue.rigide'] = D.sig === 1 || D.sig === true;
  }
  return c;
}

function srvCanon(o: Record<string, unknown>): Canon {
  const d = (o.details ?? {}) as Record<string, unknown>;
  const orn = (o.ornierage ?? {}) as Record<string, unknown>;
  const c: Canon = {
    conforme: o.conforme === true,
    NE: numOf(o.NE),
    epaisseurLiee: numOf(o.epaisseurLiee),
    epaisseurTotale: numOf(o.epaisseurTotale),
    'ornierage.valeur': numOf(orn.valeur),
    'ornierage.admissible': numOf(orn.admissible),
    'ornierage.ok': orn.ok === true,
    'details.E1_pond': numOf(d.E1_pond),
    'details.nu1_pond': numOf(d.nu1_pond),
    'details.E_psc': numOf(d.E_psc),
    'details.nu_psc': numOf(d.nu_psc),
    'details.risque_pct': numOf(d.risque_pct),
    'details.sigmaZ_r0': numOf(d.sigmaZ_r0),
    'details.sigmaR_r0': numOf(d.sigmaR_r0),
    'details.sigmaZ_d2': numOf(d.sigmaZ_d2),
    'details.sigmaR_d2': numOf(d.sigmaR_d2),
    'details.epsilonT_r0': numOf(d.epsilonT_r0),
    'details.epsilonT_d2': numOf(d.epsilonT_d2),
    'details.epsilonT': numOf(d.epsilonT),
    'details.epsilonT_adm': numOf(d.epsilonT_adm),
    'details.epsilonZ_axe': numOf(d.epsilonZ_axe),
    'details.epsilonZ_mid': numOf(d.epsilonZ_mid),
    'details.epsilonZ': numOf(d.epsilonZ),
    'details.epsilonZ_adm': numOf(d.epsilonZ_adm),
  };
  const fat = o.fatigue as Record<string, unknown> | undefined;
  if (fat) {
    c['fatigue.valeur'] = numOf(fat.valeur);
    c['fatigue.admissible'] = numOf(fat.admissible);
    c['fatigue.ok'] = fat.ok === true;
    c['fatigue.rigide'] = fat.rigide === true;
  }
  return c;
}

/** Écart relatif signé entre deux valeurs canoniques (0 si identiques au bit). */
function relErr(a: number | boolean | null, b: number | boolean | null): number {
  if (a === b) return 0;
  if (a === null || b === null) return Infinity;
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b ? 0 : Infinity;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-300);
  return Math.abs(a - b) / denom;
}

/** POST entrée -> API publique -> sortie serveur (recalcul confidentiel côté serveur). */
async function computeServer(
  request: import('@playwright/test').APIRequestContext,
  input: BurmisterInput,
): Promise<{ meta: Record<string, unknown>; output: Record<string, unknown> }> {
  const resp = await request.post(API_PUBLIC, {
    data: input,
    headers: { 'Content-Type': 'application/json' },
    timeout: NAV,
  });
  expect(resp.status(), 'API /calc/burmister doit répondre 201').toBe(201);
  const env = (await resp.json()) as {
    meta: Record<string, unknown>;
    output: Record<string, unknown>;
  };
  return { meta: env.meta, output: env.output };
}

// ==========================================================================
// SUITE 1 — golden-master champ par champ (navigateur HTML ↔ serveur API).
// ==========================================================================

test.describe('ÉQUIVALENCE burmister — HTML client (navigateur) ↔ plateforme (serveur)', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    // SKIP BRUYANT : sans le HTML source, on ÉCHOUE (jamais un faux-vert).
    if (!existsSync(FROZEN_HTML)) {
      throw new Error(
        `HTML client de référence ABSENT (${FROZEN_HTML}). Sources hors dépôt : ` +
          `impossible de prouver l'équivalence — ÉCHEC dur (pas de skip silencieux).`,
      );
    }
    // Ancrage : le fichier testé == la référence scellée au registre.
    const sha = createHash('sha256').update(readFileSync(FROZEN_HTML)).digest('hex');
    expect(sha, 'SHA du HTML testé != empreinte scellée au registre').toBe(SEALED_SHA);

    const ctx = await browser.newContext();
    page = await ctx.newPage();
    page.on('pageerror', () => {
      /* les erreurs de rendu (icônes CDN absentes) sont sans effet : _D est calculé avant renderRes */
    });
    await page.goto(pathToFileURL(FROZEN_HTML).href, { waitUntil: 'domcontentloaded' });
    // Sanity : le HTML expose bien la fonction de calcul.
    expect(await page.evaluate(() => typeof (globalThis as { doCalc?: unknown }).doCalc)).toBe(
      'function',
    );
  });

  test('la meta serveur scelle bien la même référence (engineSourceHash == SHA gelé)', async ({
    request,
  }) => {
    const { meta } = await computeServer(request, CAS[0].input);
    expect(meta.engineSourceHash, 'la meta serveur doit sceller le HTML client gelé').toBe(
      SEALED_SHA,
    );
  });

  for (const cas of CAS) {
    test(`given ${cas.id}, when calculé des 2 côtés, then 0 écart (rel ≤ 1e-9) sur tous les champs`, async ({
      request,
    }) => {
      const html = await computeHtml(page, cas.input);
      expect(html.d, `le HTML d'origine doit calculer un _D pour ${cas.id} (err=${html.err})`).not.toBeNull();

      const { output } = await computeServer(request, cas.input);
      expect(output.erreur, `le serveur ne doit pas être en erreur pour ${cas.id}`).toBeNull();

      const hc = htmlCanon(html.d as Record<string, unknown>);
      const sc = srvCanon(output);
      const keys = Array.from(new Set([...Object.keys(hc), ...Object.keys(sc)]));

      let worst = 0;
      const ecarts: string[] = [];
      for (const k of keys) {
        const e = relErr(hc[k], sc[k]);
        if (e > worst) worst = e;
        if (e > REL_TOL) ecarts.push(`${k}: HTML=${hc[k]} | serveur=${sc[k]} | rel=${e.toExponential(3)}`);
      }

      // Famille : le serveur strippe le discriminant Kmix ; le libellé NU doit
      // rester un préfixe du brut HTML (transform documenté, non un écart).
      const famRaw = String((html.d as Record<string, unknown>).fam ?? '');
      const famSrv = String(output.famille ?? '');
      expect(famRaw.toLowerCase().startsWith(famSrv.toLowerCase()) && famSrv.length > 0, `famille: brut="${famRaw}" serveur="${famSrv}"`).toBe(true);
      if (cas.familleAttendue) expect(famSrv).toBe(cas.familleAttendue);

      console.log(
        `[${cas.id}] écart max rel=${worst.toExponential(3)} · ${keys.length} champs · ` +
          `NE=${sc.NE} conforme=${sc.conforme} famille="${famSrv}"`,
      );
      expect(ecarts, `écarts hors tolérance:\n${ecarts.join('\n')}`).toHaveLength(0);
      expect(worst, `écart max rel doit être ≤ ${REL_TOL}`).toBeLessThanOrEqual(REL_TOL);
    });
  }

  test('given un matériau inconnu, when calculé des 2 côtés, then dégradation IDENTIQUE (0 écart)', async ({
    request,
  }) => {
    const html = await computeHtml(page, CAS_MATERIAU_INCONNU.input);
    expect(html.d, 'le HTML dégrade (ne lève pas) sur un matériau inconnu').not.toBeNull();
    const { output } = await computeServer(request, CAS_MATERIAU_INCONNU.input);
    expect(output.erreur, 'le serveur dégrade lui aussi (pas d\'erreur), fidèle au HTML').toBeNull();

    const hc = htmlCanon(html.d as Record<string, unknown>);
    const sc = srvCanon(output);
    let worst = 0;
    const ecarts: string[] = [];
    for (const k of Array.from(new Set([...Object.keys(hc), ...Object.keys(sc)]))) {
      const e = relErr(hc[k], sc[k]);
      if (e > worst) worst = e;
      if (e > REL_TOL) ecarts.push(`${k}: HTML=${hc[k]} | serveur=${sc[k]} | rel=${e.toExponential(3)}`);
    }
    console.log(`[matériau-inconnu] écart max rel=${worst.toExponential(3)} · dégradation identique · fatigue.adm=${sc['fatigue.admissible']}`);
    expect(ecarts, `écarts hors tolérance:\n${ecarts.join('\n')}`).toHaveLength(0);
    expect(worst).toBeLessThanOrEqual(REL_TOL);
  });
});

// ==========================================================================
// SUITE 2 — bout-en-bout PLATEFORME (UI réelle) : login -> ROADSENS ->
// Calculer -> le recalcul SERVEUR persisté == le HTML client, et l'affichage
// est fidèle (pas de ×1000 parasite). RUN_LIVE=1 requis.
// ==========================================================================

async function loginUi(page: Page) {
  await page.goto(`${FRONT}/login`, { waitUntil: 'domcontentloaded', timeout: NAV });
  await page.getByLabel('Adresse e-mail').fill(CREDS.email);
  await page.getByLabel('Mot de passe').fill(CREDS.password);
  await Promise.all([
    page.waitForURL(/\/app\/demo-starfire\/(logiciels|projets)/, { timeout: 90_000 }),
    page.getByRole('button', { name: 'Se connecter' }).click(),
  ]);
}

test.describe('BOUT-EN-BOUT ROADSENS (UI réelle Vercel↔Render)', () => {
  test.skip(!RUN_LIVE, 'RUN_LIVE=1 requis pour cibler la plateforme en ligne.');

  test('given la page ROADSENS (structure de référence), when je saisis le trafic et Calcule, then le recalcul serveur == HTML client et l\'affichage est fidèle', async ({
    browser,
  }) => {
    // Le HTML client sur la structure PAR DÉFAUT de la page (BBSG1/GB3/GL1 sur PF2),
    // avec le trafic qu'on va saisir dans l'UI (T=150, reste = défauts du formulaire).
    if (!existsSync(FROZEN_HTML)) throw new Error('HTML client absent — impossible de comparer.');
    const uiInput: BurmisterInput = {
      layers: [
        { mat: 'BBSG1', h: 0.06, E: 1512, nu: 0.45 },
        { mat: 'GB3', h: 0.1, E: 2588, nu: 0.45 },
        { mat: 'GL1', h: 0.25, E: 200, nu: 0.35 },
      ],
      subgrade: { cls: 'PF2', E: 50, nu: 0.35 },
      traffic: { T: 150, C: 0.9, N: 20, tau: 4.0, dir: 1.0, tv: 1.0 },
      load: { p: 0.662, a: 0.125, d: 0.375, r: 'auto', sh: 'auto', ks: 'auto' },
    };

    const refCtx = await browser.newContext();
    const refPage = await refCtx.newPage();
    await refPage.goto(pathToFileURL(FROZEN_HTML).href, { waitUntil: 'domcontentloaded' });
    const html = await computeHtml(refPage, uiInput);
    expect(html.d, 'HTML client doit calculer la structure UI').not.toBeNull();
    const hc = htmlCanon(html.d as Record<string, unknown>);
    await refCtx.close();

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.setDefaultNavigationTimeout(NAV);
    await loginUi(page);

    await page.goto(`${FRONT}/app/${ORG}/logiciels/roadsens`, {
      waitUntil: 'domcontentloaded',
      timeout: NAV,
    });
    await page.waitForLoadState('networkidle', { timeout: 40_000 }).catch(() => {});

    // Projet CH sélectionnable
    const picker = page.getByRole('combobox', { name: 'Projet' }).first();
    await expect
      .poll(async () => picker.locator('option').count(), { timeout: 30_000 })
      .toBeGreaterThan(1);
    await picker.selectOption({ index: 1 });

    // Onglet Trafic -> saisir T=150 (défaut = 0, sinon NE≤0 -> erreur)
    await page.getByRole('tab', { name: 'Trafic' }).click();
    const tField = page.getByLabel(/TMJA|trafic.*PL|T \(PL/i).first();
    await tField.fill('150');

    // Calculer -> intercepter le recalcul SERVEUR persisté (/projects/:id/calc/burmister)
    const [resp] = await Promise.all([
      page.waitForResponse(
        (r) => /\/projects\/[^/]+\/calc\/burmister/.test(r.url()) && r.request().method() === 'POST',
        { timeout: 90_000 },
      ),
      page.getByRole('button', { name: /^Calculer/i }).click(),
    ]);
    expect(resp.status(), 'le recalcul serveur ne doit pas planter').toBeLessThan(500);
    const body = (await resp.json()) as Record<string, unknown>;
    // La réponse persistée porte l'output whitelisté (sous .output ou .output.output selon l'enveloppe).
    const output = ((body.output as Record<string, unknown>)?.output ??
      body.output ??
      body) as Record<string, unknown>;

    const sc = srvCanon(output);
    // Comparaison des grandeurs de dimensionnement clés (celles présentes dans la
    // sortie persistée) — le serveur de l'UI == le HTML client.
    for (const k of ['NE', 'epaisseurLiee', 'epaisseurTotale', 'ornierage.valeur', 'ornierage.admissible'] as const) {
      if (sc[k] !== null && hc[k] !== null) {
        expect(relErr(hc[k], sc[k]), `UI/serveur ${k}: HTML=${hc[k]} serveur=${sc[k]}`).toBeLessThanOrEqual(REL_TOL);
      }
    }

    // Affichage : onglet Résultats visible + bandeau de verdict, capture de preuve.
    await page.getByRole('tab', { name: 'Résultats' }).click().catch(() => {});
    await page.screenshot({ path: 'test-results/equiv-burmister-artifacts/ui-resultats.png', fullPage: true });
    console.log(`[UI bout-en-bout] NE serveur=${sc.NE} · HTML=${hc.NE}`);

    await ctx.close();
  });
});
