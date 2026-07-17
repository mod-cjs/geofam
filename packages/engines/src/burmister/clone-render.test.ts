/**
 * FIDELITE DU CLONE burmister/ROADSENS (ADR 0015) — le clone EXCISE, alimente par
 * la SORTIE SERVEUR reelle (runBurmister), doit RENDRE le verdict, les grandeurs de
 * dimensionnement ET le detail pas-a-pas fidelement, SANS calcul cote navigateur et
 * SANS fuite d'intermediaire moteur (propagateur Burmister, calibration LCPC).
 *
 * Arbitre d'integration (jsdom, sans serveur) : on charge le clone COMMITE
 * (apps/web/src/tools-cloned/roadsens.html), on branche un faux hote qui repond au
 * `calc:request` du bridge avec l'`output` whitelisté de runBurmister, on pilote le
 * STATE (ly/pf/tr/cp) comme le ferait l'UI (reassignation des bindings `let` via un
 * eval global — meme technique que le harnais d'equivalence), puis :
 *   1. le pont fonctionne (le bouton sort de l'etat « Calcul… », les resultats
 *      s'affichent) et le VERDICT correspond a `output.conforme` ;
 *   2. les grandeurs FINALES (h paquet/total, ε_t/ε_t,adm, ε_z/ε_z,adm) affichees par
 *      renderRes sont IDENTIQUES a la REFERENCE gelee (rendue en parallele avec son
 *      propre moteur intact) — ZERO ECART, modulo la redaction assumee de la famille ;
 *   3. la FAMILLE affichee est le libelle NU d'allowlist (jamais le discriminant
 *      « K=… » — FUITE #1) ; aucun symbole moteur, aucun « undefined »/[object Object].
 *
 * Skip BRUYANT si le clone est absent (regenerer : `pnpm clone:tools`) ; la
 * comparaison a la reference (etape 2) skip si la source gelee est absente (CI).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM, VirtualConsole } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { burmisterSourceAvailable, burmisterSourcePath } from './equivalence-harness.js';
import { BURMISTER_FIXTURES } from './test-fixtures.js';

import { runBurmister } from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/engines/src/burmister -> 05-Plateforme (4 niveaux).
const CLONE_PATH = resolve(HERE, '../../../../apps/web/src/tools-cloned/roadsens.html');

type Win = {
  document: Document;
  eval: (code: string) => unknown;
  __geofamBridge?: unknown;
  close?: () => void;
};

/** Serialise le STATE d'un fixture en un script qui reassigne les bindings `let`. */
function stateScript(input: (typeof BURMISTER_FIXTURES)[number]['input']): string {
  return (
    `ly=${JSON.stringify(input.layers.map((l) => ({ ...l, ifc: 'auto' })))};` +
    `pf=${JSON.stringify(input.subgrade)};` +
    `tr=${JSON.stringify(input.traffic)};` +
    `cp=${JSON.stringify({ ...input.load, gntAuto: false, neForce: null })};`
  );
}

/** Attend que #resout soit rendu (au-dela du placeholder, bouton retabli). */
async function waitResout(win: Win): Promise<string> {
  const get = (): string =>
    (win.document.getElementById('resout') as HTMLElement | null)?.innerHTML ?? '';
  for (let i = 0; i < 300; i++) {
    const r = get();
    if (r.length > 400 && /satisfaisante/.test(r)) return r;
    await new Promise((res) => setTimeout(res, 10));
  }
  return get();
}

/** Charge le CLONE et MOCKE le pont (calc() renvoie la sortie serveur), pilote le state. */
async function renderCloneWith(
  input: (typeof BURMISTER_FIXTURES)[number]['input'],
  output: unknown,
): Promise<{ dom: JSDOM; win: Win; errs: string[] }> {
  const html = readFileSync(CLONE_PATH, 'utf8');
  const errs: string[] = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errs.push(String((e as Error).message)));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const win = dom.window as unknown as Win;
  win.__geofamBridge = {
    calc: () => Promise.resolve({ ok: true, calcResultId: 'test-cr-1', output }),
    emitPv: () => undefined,
    context: () => ({}),
  };
  win.eval(stateScript(input));
  win.eval('runCalc();');
  await waitResout(win);
  return { dom, win, errs };
}

/** Charge la REFERENCE gelee (LECTURE seule) : elle calcule LOCALEMENT (moteur intact). */
async function renderReferenceWith(
  input: (typeof BURMISTER_FIXTURES)[number]['input'],
): Promise<{ dom: JSDOM; win: Win }> {
  const html = readFileSync(burmisterSourcePath(), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  const win = dom.window as unknown as Win;
  win.eval(stateScript(input));
  win.eval('doCalc();'); // la reference calcule + assemble _D + renderRes en synchrone
  return { dom, win };
}

/** Valeurs des cartes .metric (h paquet, h total, E1) + grandes valeurs de critere. */
function metricValues(win: Win): string[] {
  const pane = win.document.getElementById('resout');
  return Array.from(pane?.querySelectorAll('.metric .mv') ?? []).map((e) =>
    (e.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
}
/** Grandes valeurs sollicitantes/admissibles des criteres (font-size:15px + adm.). */
function criterionText(win: Win): string {
  const r = win.document.getElementById('resout')?.innerHTML ?? '';
  // Extrait les couples « <valeur> μdef/MPa » et « adm. <valeur> » du bloc criteres.
  const m = r.match(/(?:μdef|MPa)[^<]*<\/div>\s*<div[^>]*>adm\. [^<]+/g) ?? [];
  return m.join(' | ').replace(/\s+/g, ' ');
}

const hasClone = existsSync(CLONE_PATH);
const d = hasClone ? describe : describe.skip;
if (!hasClone) {
  // eslint-disable-next-line no-console
  console.warn(
    `[clone-render] SKIP : clone absent (${CLONE_PATH}). Lancer « pnpm clone:tools ».`,
  );
}

d('roadsens — fidelite du clone excise (mapping serveur -> renderers conserves)', () => {
  it('rend le verdict + les grandeurs a partir de la sortie serveur (pont + mapping)', async () => {
    const fx = BURMISTER_FIXTURES.find((f) => f.id === 'bitumineuse-epaisse-defaut');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runBurmister(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;

    const { win, errs } = await renderCloneWith(fx.input, env.output);
    const resout = win.document.getElementById('resout')?.innerHTML ?? '';

    // Aucune erreur de script au chargement / au rendu.
    expect(errs, errs.join('\n')).toHaveLength(0);
    // 1. le pont a repondu : plus de placeholder « Aucun calcul », verdict rendu.
    expect(resout).not.toContain('Aucun calcul effectué');
    expect(resout).toContain('Burmister multi-couche');
    // Verdict coherent avec la sortie serveur.
    expect(/Structure (satisfaisante|non satisfaisante)/.test(resout)).toBe(true);
    if (env.output.conforme) expect(resout).toContain('Structure satisfaisante');
    else expect(resout).toContain('Structure non satisfaisante');
    // 2. grandeurs de dimensionnement (ε_z orniérage) presentes.
    expect(resout).toContain('Orniérage plateforme');
    expect(resout).toMatch(/μdef/);
    // 3. aucune fuite grossiere ni valeur non definie.
    expect(resout).not.toContain('undefined');
    expect(resout).not.toContain('[object Object]');
    expect(/\bNaN\b/.test(resout)).toBe(false);

    win.close?.();
  });

  it('REDACTION : la famille affichee est le libelle NU (jamais le discriminant K=)', async () => {
    const fx = BURMISTER_FIXTURES.find((f) => f.id === 'mixte-bit-mtlh');
    if (!fx) return;
    const env = runBurmister(fx.input);
    if (!env.ok) return;

    const { win } = await renderCloneWith(fx.input, env.output);
    const resout = win.document.getElementById('resout')?.innerHTML ?? '';
    const detout = win.document.getElementById('detout')?.innerHTML ?? '';
    const rendu = resout + '\n' + detout;

    // La famille NU d'allowlist s'affiche…
    expect(resout).toContain('mixte');
    // …mais JAMAIS le discriminant de rigidite Kmix (« K=0.62 »), intermediaire confidentiel.
    expect(/K\s*=\s*-?\d/.test(rendu)).toBe(false);
    // Aucun symbole moteur ni fuite grossiere dans le DOM rendu.
    expect(rendu).not.toContain('burIntegrateMLWithPSC');
    expect(rendu).not.toContain('[object Object]');
    expect(rendu).not.toContain('undefined');

    win.close?.();
  });

  it('NO-CALC-INITIAL : un state INVALIDE ne sollicite PAS le serveur (message local)', async () => {
    const html = readFileSync(CLONE_PATH, 'utf8');
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
    const win = dom.window as unknown as Win;
    let calls = 0;
    win.__geofamBridge = {
      calc: () => {
        calls += 1;
        return Promise.resolve({ ok: true, output: {} });
      },
      emitPv: () => undefined,
      context: () => ({}),
    };
    // Structure invalide : couche a module nul (hors bornes du contrat).
    win.eval(
      "ly=[{id:1,mat:'BBSG1',h:0.08,E:0,nu:0.45,ifc:'auto'}]; pf={cls:'PF3',E:120,nu:0.35};",
    );
    await (win.eval('runCalc()') as Promise<unknown>);
    // AUCUN appel serveur ; message local rendu par l'outil.
    expect(calls).toBe(0);
    const resout = win.document.getElementById('resout')?.innerHTML ?? '';
    expect(resout).toContain('Renseignez une structure valide');
    win.close?.();
  });

  it('ZERO ECART : les grandeurs rendues sont IDENTIQUES a la reference gelee', async () => {
    if (!burmisterSourceAvailable()) {
      // eslint-disable-next-line no-console
      console.warn(
        '[clone-render] SKIP comparaison reference : source gelee absente (CI).',
      );
      return;
    }
    // Balaye plusieurs familles (bitumineuse, semi-rigide, mixte, inverse, souple).
    const ids = [
      'bitumineuse-epaisse-defaut',
      'semi-rigide-glc',
      'mixte-bit-mtlh',
      'inverse-mtlh-profond',
      'souple-faible-trafic',
      'beton-multi-bc5',
    ];
    for (const id of ids) {
      const fx = BURMISTER_FIXTURES.find((f) => f.id === id);
      if (!fx) continue;
      const env = runBurmister(fx.input);
      expect(env.ok, `moteur KO pour ${id}`).toBe(true);
      if (!env.ok) continue;

      const { win: cloneWin } = await renderCloneWith(fx.input, env.output);
      const { win: refWin } = await renderReferenceWith(fx.input);

      const refMetrics = metricValues(refWin);
      const cloneMetrics = metricValues(cloneWin);
      // Garde anti faux-vert : la reference DOIT avoir rendu de vraies cartes.
      expect(refMetrics.length, `reference sans .metric pour ${id}`).toBeGreaterThan(2);
      // ZERO ECART sur les cartes de dimensionnement (h paquet/total, E1/ν1…).
      expect(cloneMetrics, `metriques clone != reference (${id})`).toEqual(refMetrics);
      // ZERO ECART sur les grandeurs sollicitantes/admissibles des criteres.
      expect(criterionText(cloneWin), `criteres clone != reference (${id})`).toEqual(
        criterionText(refWin),
      );

      cloneWin.close?.();
      refWin.close?.();
    }
  });
});
