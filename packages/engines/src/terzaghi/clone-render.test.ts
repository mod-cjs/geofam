/**
 * FIDELITE DU CLONE (ADR 0015) — le clone EXCISE, alimente par la SORTIE SERVEUR
 * reelle (runTerzaghi), doit RENDRE les verdicts ET le DEROULE PAS-A-PAS
 * fidelement, SANS calcul cote navigateur et SANS fuite d'intermediaire moteur.
 *
 * C'est l'arbitre d'integration du pilote (jsdom, sans serveur) : on charge
 * apps/web/src/tools-cloned/terzaghi.html, on BRANCHE un faux hote qui repond au
 * `calc:request` du bridge avec l'`output` whitelisté de runTerzaghi, puis :
 *   1. le pont fonctionne (le placeholder « Calcul en cours… » disparait) ;
 *   2. le verdict de portance s'affiche (taux %, classe ok/bad) — mapping OK ;
 *   3. la grandeur de demande q_ref (whitelistée) s'affiche ;
 *   4. DE-STUB (reco A) : le DEROULE pas-a-pas (`.calc .step`) est RESTAURE et ses
 *      VALEURS SUBSTITUEES (`.rl`) sont IDENTIQUES a la REFERENCE gelee (rendue en
 *      parallele avec son propre moteur) — zero ecart d'affichage ;
 *   5. les coefficients de courbe k_p/k_c (table publiee annexe D, reco A) sont
 *      injectes depuis le serveur (formule curveStr substituee) — jamais la table ;
 *   6. AUCUN intermediaire HORS ALLOWLIST (facteurs c–φ annexe F N_q/N_c/N_γ) ni
 *      fuite grossiere ([object Object]) n'apparait au DOM.
 *
 * Skip BRUYANT si le clone (ou la reference gelee, comparaison ligne 4) est absent.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { terzaghiSourceAvailable, terzaghiSourcePath } from './equivalence-harness.js';
import { TERZAGHI_FIXTURES } from './test-fixtures.js';

import { runTerzaghi } from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/engines/src/terzaghi -> 05-Plateforme (4 niveaux).
const CLONE_PATH = resolve(HERE, '../../../../apps/web/src/tools-cloned/terzaghi.html');

/** Injecte le fixture via l'import JSON natif de l'outil (fileImport) puis attend la
 * fin du recalc (le clone est async ; la reference est synchrone mais FileReader l'est). */
async function driveWithFixture(dom: JSDOM, input: unknown): Promise<void> {
  const win = dom.window as unknown as {
    document: Document;
    File: typeof File;
    Event: typeof Event;
  };
  const fileInput = win.document.getElementById('fileImport') as HTMLInputElement;
  const file = new win.File([JSON.stringify(input)], 'fixture.json', {
    type: 'application/json',
  });
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
  fileInput.dispatchEvent(new win.Event('change', { bubbles: true }));
  const pane = () => win.document.getElementById('tab-verifs')?.innerHTML ?? '';
  for (let i = 0; i < 160; i++) {
    if (pane().length > 60 && !pane().includes('Calcul en cours')) break;
    await new Promise((r) => setTimeout(r, 15));
  }
}

/** Charge le CLONE et MOCKE le pont (calc() renvoie la sortie serveur). */
async function renderCloneWith(input: unknown, output: unknown): Promise<JSDOM> {
  const html = readFileSync(CLONE_PATH, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  (dom.window as unknown as Record<string, unknown>).__geofamBridge = {
    calc: () => Promise.resolve({ ok: true, calcResultId: 'test-cr-1', output }),
    emitPv: () => undefined,
    context: () => ({}),
  };
  await driveWithFixture(dom, input);
  return dom;
}

/** Charge la REFERENCE gelee (LECTURE seule) : elle calcule LOCALEMENT (moteur intact). */
async function renderReferenceWith(input: unknown): Promise<JSDOM> {
  const html = readFileSync(terzaghiSourcePath(), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  await driveWithFixture(dom, input);
  return dom;
}

/** Texte normalise des valeurs substituees (`.rl`) du deroule pas-a-pas. */
function rlValues(dom: JSDOM): string[] {
  const pane = dom.window.document.getElementById('tab-verifs');
  return Array.from(pane?.querySelectorAll('.calc .rl') ?? []).map((e) =>
    (e.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
}
/** Titres des etapes du deroule (`.step-h`). */
function stepTitles(dom: JSDOM): string[] {
  const pane = dom.window.document.getElementById('tab-verifs');
  return Array.from(pane?.querySelectorAll('.calc .step .step-h') ?? []).map((e) =>
    (e.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
}

const hasClone = existsSync(CLONE_PATH);
const d = hasClone ? describe : describe.skip;
if (!hasClone) {
  // eslint-disable-next-line no-console
  console.warn(
    `[clone-render] SKIP : clone absent (${CLONE_PATH}). Lancer « pnpm clone:tools ».`,
  );
}

d('terzaghi — fidelite du clone excise (mapping serveur -> renderers conserves)', () => {
  it('rend le verdict de portance a partir de la sortie serveur (pont + mapping)', async () => {
    const fx = TERZAGHI_FIXTURES.find((f) => f.id === 'pressio-carree-excentree');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runTerzaghi(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;

    const dom = await renderCloneWith(fx.input, env.output);
    const verifs = dom.window.document.getElementById('tab-verifs')?.innerHTML ?? '';

    // 1. le pont a repondu (plus de placeholder d'attente).
    expect(verifs).not.toContain('Calcul en cours');
    expect(verifs.length).toBeGreaterThan(0);
    // 2. verdict de portance affiche : la carte porte l'indicateur ok/bad + le taux %.
    expect(verifs).toContain('Portance');
    expect(verifs).toMatch(/vcard (ok|bad)/);
    expect(verifs).toMatch(/\d+\s*%/);
    // 3. grandeur de demande q_ref (whitelistée) affichee.
    expect(verifs).toContain('q<sub>ref</sub>');
    // 4. DE-STUB : le deroule pas-a-pas est RESTAURE (plus de renvoi au PV scellé).
    expect(verifs).not.toContain('PV scellé');
    expect(
      dom.window.document.querySelectorAll('#tab-verifs .calc .step').length,
    ).toBeGreaterThan(6);

    dom.window.close();
  });

  it('DE-STUB : les VALEURS substituees du deroule sont IDENTIQUES a la reference gelee', async () => {
    if (!terzaghiSourceAvailable()) {
      // eslint-disable-next-line no-console
      console.warn(
        '[clone-render] SKIP comparaison reference : source gelee absente (CI).',
      );
      return;
    }
    // Cas nominal in situ (pressio) : deroule complet portance + tassement + raideurs.
    const fx = TERZAGHI_FIXTURES.find((f) => f.id === 'nominal-pressio-rect');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runTerzaghi(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;

    const refDom = await renderReferenceWith(fx.input);
    const cloneDom = await renderCloneWith(fx.input, env.output);

    const refTitles = stepTitles(refDom);
    const cloneTitles = stepTitles(cloneDom);
    const refRl = rlValues(refDom);
    const cloneRl = rlValues(cloneDom);

    // Garde anti faux-vert : la reference DOIT avoir rendu un vrai deroule.
    expect(refTitles.length, 'reference sans deroule (rendu casse ?)').toBeGreaterThan(6);
    expect(refRl.length, 'reference sans valeurs substituees').toBeGreaterThan(6);

    // ZERO ECART : memes etapes, memes valeurs substituees (le clone = renderers de la
    // reference alimentes par la sortie serveur, equivalente au moteur de la reference).
    expect(cloneTitles, 'etapes du deroule clone != reference').toEqual(refTitles);
    expect(cloneRl, 'valeurs substituees clone != reference').toEqual(refRl);

    refDom.window.close();
    cloneDom.window.close();
  });

  it('coefficients de courbe k_p/k_c injectes depuis le serveur (formule curveStr substituee)', async () => {
    const fx = TERZAGHI_FIXTURES.find((f) => f.id === 'nominal-pressio-rect');
    if (!fx) return;
    const env = runTerzaghi(fx.input);
    if (!env.ok) return;
    // La sortie serveur porte bien les coefficients (une seule categorie).
    const c0 = (env.output as { cas: Array<{ coefCourbeF?: number[] }> }).cas[0];
    expect(c0, 'un cas de charge attendu').toBeDefined();
    expect(
      Array.isArray(c0?.coefCourbeF),
      'coefficients de courbe absents de la sortie',
    ).toBe(true);

    const dom = await renderCloneWith(fx.input, env.output);
    const verifs = dom.window.document.getElementById('tab-verifs')?.innerHTML ?? '';
    // La formule de courbe (curveStr, reco A : table publiee annexe D) est bien substituee…
    expect(verifs).toContain('1 − e^(−');
    expect(verifs).toContain('Facteur de portance');
    // …avec des NOMBRES (pas « undefined »/« NaN » : preuve que les coeffs serveur ont ete injectes).
    expect(verifs).not.toMatch(/e\^\(−undefined/);
    expect(verifs).not.toMatch(/e\^\(−NaN/);

    dom.window.close();
  });

  it('aucun intermediaire HORS ALLOWLIST ni fuite grossiere n apparait dans le DOM rendu', async () => {
    // Fixture in situ SANS c–φ : le detail annexe F (residu ferme) n'est pas sollicite.
    const fx = TERZAGHI_FIXTURES.find((f) => f.id === 'penetro-carree');
    if (!fx) return;
    const env = runTerzaghi(fx.input);
    if (!env.ok) return;

    const dom = await renderCloneWith(fx.input, env.output);
    const verifs = dom.window.document.getElementById('tab-verifs')?.innerHTML ?? '';
    const note = dom.window.document.getElementById('noteView')?.innerHTML ?? '';
    const rendu = verifs + '\n' + note;

    // RESIDU FERME §8 : les facteurs de portance c–φ annexe F (N_q/N_c/N_γ) restent HORS
    // allowlist -> jamais de VALEUR affichee (le mode in situ sans c–φ ne les sollicite pas ;
    // ce garde-fou verrouille qu'aucune valeur de facteur analytique ne fuite ici).
    expect(rendu).not.toMatch(/N<sub>q<\/sub>\s*=\s*-?\d/);
    expect(rendu).not.toMatch(/N<sub>c<\/sub>\s*=\s*-?\d/);
    // Pas de fuite grossiere de mapping (objet non serialise) ni de valeur non definie.
    expect(rendu).not.toContain('[object Object]');
    expect(rendu).not.toContain('undefined');
    // Le deroule est bien RESTAURE (dé-stub) et non le renvoi au PV.
    expect(verifs).not.toContain('PV scellé');
    expect(
      dom.window.document.querySelectorAll('#tab-verifs .calc .step').length,
    ).toBeGreaterThan(4);

    dom.window.close();
  });

  it('rend un cas de tassement (ELS) sans planter (mapping des tassements)', async () => {
    const fx = TERZAGHI_FIXTURES.find((f) => f.id === 'nominal-pressio-rect');
    if (!fx) return;
    const env = runTerzaghi(fx.input);
    if (!env.ok) return;

    const dom = await renderCloneWith(fx.input, env.output);
    const verifs = dom.window.document.getElementById('tab-verifs')?.innerHTML ?? '';
    expect(verifs).not.toContain('Calcul en cours');
    expect(verifs).toContain('Tassement');
    // la note de calcul s'est construite (hypotheses + synthese).
    const note = dom.window.document.getElementById('noteView')?.innerHTML ?? '';
    expect(note).toContain('note de calcul');
    expect(note).toContain('Synthèse');

    dom.window.close();
  });
});
