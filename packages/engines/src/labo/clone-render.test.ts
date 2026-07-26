/**
 * FIDELITE DU CLONE FASTLAB (ADR 0015) — le clone EXCISE, alimente par la SORTIE SERVEUR
 * reelle (runLabo), doit RENDRE les colonnes par ligne, les chips, les alertes normatives
 * et la classification GTR, via un POST UNIQUE DEBOUNCE, SANS calcul cote navigateur.
 *
 * Arbitre d integration (jsdom, sans serveur) : on charge apps/web/src/tools-cloned/
 * fastlab.html, on MOCKE le pont (calc() renvoie l `output` whitelise de runLabo), on
 * pilote via `writeForm(input)` (chemin UI canonique du clone), puis :
 *   1. le pont fonctionne (le verdict de classification s affiche) ;
 *   2. les colonnes par ligne (granulo passants cumules, Proctor ρd, Atterberg w) ==
 *      la sortie serveur mappee (renderers OK) ;
 *   3. DEBOUNCE : une rafale de recalc() ne declenche qu UN SEUL POST ;
 *   4. NO-CALC-INITIAL : au boot (etat vide) aucun calc:request, message natif.
 *
 * Chaine de preuve « zero ecart » : detail-equivalence prouve serveur.detail == DOM du
 * HTML gele ; ce test prouve clone.DOM == serveur.detail mappe ; donc clone == HTML.
 *
 * Skip BRUYANT si le clone est absent (lancer « pnpm clone:tools »).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import {
  laboRegistrySha256,
  laboSourceAvailable,
  laboSourcePath,
} from './equivalence-harness.js';
import { LABO_FIXTURES } from './test-fixtures.js';

import { runLabo } from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/engines/src/labo -> 05-Plateforme (4 niveaux).
const CLONE_PATH = resolve(HERE, '../../../../apps/web/src/tools-cloned/fastlab.html');
const REPO = resolve(HERE, '../../../..');

/**
 * POLYFILL structuredClone : le HTML FASTLAB l'appelle des le chargement
 * (`let CFG=structuredClone(DEFAULTS)`). jsdom 29 ne le fournit pas ; TOUT navigateur
 * moderne l'a. C'est de l'outillage de PARITE d'environnement (comme l'equivalence-
 * harness), pas une modification du clone.
 */
function polyfill(window: { structuredClone?: unknown }): void {
  if (typeof window.structuredClone !== 'function') {
    window.structuredClone = (v: unknown) => JSON.parse(JSON.stringify(v));
  }
}

/** Charge le clone, mocke le pont (calc -> sortie serveur, compte les appels). */
function loadClone(output: unknown): { dom: JSDOM; calls: () => number } {
  const html = readFileSync(CLONE_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse: polyfill,
  });
  let n = 0;
  (dom.window as unknown as Record<string, unknown>).__geofamBridge = {
    calc: () => {
      n += 1;
      return Promise.resolve({ ok: true, calcResultId: 'test-cr-1', output });
    },
    emitPv: () => undefined,
    storeGet: () => new Promise(() => {}),
    storeSet: () => Promise.resolve(),
    context: () => ({}),
  };
  return { dom, calls: () => n };
}

/** Pilote le clone via writeForm(input) (conserve) puis attend le rendu debounce. */
async function drive(dom: JSDOM, input: unknown): Promise<void> {
  const win = dom.window as unknown as { eval: (c: string) => unknown };
  win.eval(`writeForm(${JSON.stringify(input)});`);
  // recalc debounce ~320 ms -> POST -> renderAll. On attend le verdict rendu.
  const result = () => dom.window.document.getElementById('result')?.innerHTML ?? '';
  for (let i = 0; i < 120; i++) {
    if (result().includes('classbadge')) break;
    await new Promise((r) => setTimeout(r, 15));
  }
}

function cellById(dom: JSDOM, id: string): string {
  return (dom.window.document.getElementById(id)?.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}
function cellBySel(dom: JSDOM, sel: string): string {
  return (dom.window.document.querySelector(sel)?.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}
function fmt(v: number | null | undefined, d: number): string {
  return v == null || !Number.isFinite(v) ? '—' : (v as number).toFixed(d);
}

const hasClone = existsSync(CLONE_PATH);
const d = hasClone ? describe : describe.skip;
if (!hasClone) {
  // eslint-disable-next-line no-console
  console.warn(
    `[clone-render] SKIP : clone absent (${CLONE_PATH}). Lancer « pnpm clone:tools ».`,
  );
}

d('fastlab — fidelite du clone excise (POST unique -> render, sortie serveur)', () => {
  it('DEMO A2 : verdict GTR + colonnes par ligne (granulo/Proctor/Atterberg) == sortie serveur', async () => {
    const fx = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon');
    expect(fx).toBeDefined();
    if (!fx) return;
    const env = runLabo(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const out = env.output;
    const det = out.detail;
    expect(det).not.toBeNull();
    if (!det) return;

    const { dom } = loadClone(out);
    await drive(dom, fx.input);

    // 1. Verdict de classification affiche depuis la sortie serveur (pont + mapping).
    const result = dom.window.document.getElementById('result')?.innerHTML ?? '';
    expect(result).toContain('classbadge');
    expect(result).toContain(out.classe.full ?? '__none__');
    expect(result).toContain('Chemin de d'); // « Chemin de décision »

    // 2. Granulometrie — passant cumule par tamis == sortie serveur (renderer OK).
    for (const r of det.gran?.rows ?? []) {
      expect(fmt(r.pass, 1), `gr_pass s=${r.s}`).toBe(
        cellBySel(dom, `.gr_pass[data-s="${r.s}"]`),
      );
    }
    // 3. Proctor — ρd par point + wOPN chip.
    for (let i = 1; i <= 7; i++) {
      const row = det.proctor?.rows[i - 1];
      expect(fmt(row?.rd, 3), `pr_rd${i}`).toBe(cellById(dom, `pr_rd${i}`));
    }
    expect(cellById(dom, 'out_proctor')).toContain('wOPN');
    // 4. Atterberg — w par point de liquidite.
    for (let i = 1; i <= 5; i++) {
      expect(fmt(det.att?.llw[i - 1], 2), `ll_w${i}`).toBe(cellById(dom, `ll_w${i}`));
    }
    // 5. Aucune fuite grossiere de mapping.
    expect(result).not.toContain('[object Object]');
    expect(result).not.toContain('undefined');

    dom.window.close();
  });

  /** Calcule l env d une fixture, charge le clone avec sa sortie, pilote, renvoie { dom, det }. */
  async function runClone(fxId: string) {
    const fx = LABO_FIXTURES.find((f) => f.id === fxId);
    expect(fx, `fixture ${fxId} absente`).toBeDefined();
    const env = runLabo(fx!.input);
    expect(env.ok).toBe(true);
    const det = env.ok ? env.output.detail : null;
    expect(det, `detail serveur absent (${fxId})`).not.toBeNull();
    const { dom } = loadClone(env.ok ? env.output : {});
    await drive(dom, fx!.input);
    return { dom, det: det! };
  }

  it('CBR : ρd/compacite/gonflement/CBR par moule (clone) == sortie serveur', async () => {
    const { dom, det } = await runClone('kernel-cbr-complet');
    expect(cellById(dom, 'cb_maxi_0'), 'clone cb_maxi_0 vide').not.toBe('—');
    for (let m = 0; m < 3; m++) {
      const r = det.cbr?.rows[m];
      expect(fmt(r?.ds, 3), `cb_ds${m}`).toBe(cellById(dom, `cb_ds${m}`));
      expect(fmt(r?.comp, 1), `cb_compf_${m}`).toBe(cellById(dom, `cb_compf_${m}`));
      expect(fmt(r?.c25, 1), `cb_c25_${m}`).toBe(cellById(dom, `cb_c25_${m}`));
      expect(fmt(r?.maxi, 1), `cb_maxi_${m}`).toBe(cellById(dom, `cb_maxi_${m}`));
    }
    dom.window.close();
  });

  it('Cisaillement + œdometre + ρs (clone, DEMO) == sortie serveur', async () => {
    const { dom, det } = await runClone('demo-A2-limon');
    // Cisaillement — σ′v/τpic + identification par eprouvette.
    expect(cellById(dom, 'ci_sv1'), 'clone ci_sv1 vide').not.toBe('—');
    for (let i = 1; i <= 4; i++) {
      const r = det.cisail?.rows[i - 1];
      expect(fmt(r?.sv, 1), `ci_sv${i}`).toBe(cellById(dom, `ci_sv${i}`));
      expect(fmt(r?.rd, 2), `ci_rdd${i}`).toBe(cellById(dom, `ci_rdd${i}`));
    }
    // Œdometre — e par palier.
    expect(cellById(dom, 'oe_e1'), 'clone oe_e1 vide').not.toBe('—');
    for (let i = 1; i <= 12; i++) {
      expect(fmt(det.oedo?.paliers[i - 1]?.e, 3), `oe_e${i}`).toBe(
        cellById(dom, `oe_e${i}`),
      );
    }
    dom.window.close();
  });

  it('SZ + Micro-Deval (norme) + triaxial (clone) == sortie serveur', async () => {
    const { dom, det } = await runClone('granulaire-R-LA-MDE');
    for (const r of det.sz?.rows ?? []) {
      const s = String(r.s);
      expect(fmt(r.pas, 1), `sz_pas ${s}`).toBe(cellBySel(dom, `.sz_pas[data-s="${s}"]`));
    }
    expect(cellById(dom, 'md_r1'), 'clone md_r1 vide').not.toBe('—');
    for (let i = 1; i <= 2; i++) {
      expect(fmt(det.mde?.rows?.[i - 1]?.cc, 1), `md_r${i}`).toBe(
        cellById(dom, `md_r${i}`),
      );
    }
    dom.window.close();
  });

  it('Micro-Deval CAMPAGNE : pertes + CMDE (clone) == sortie serveur', async () => {
    const { dom, det } = await runClone('kernel-mde-campagne');
    expect(cellById(dom, 'mc_p2'), 'clone mc_p2 vide').not.toBe('—');
    for (let i = 0; i < 4; i++) {
      expect(fmt(det.mde?.pertes?.[i], 1), `mc_p${i}`).toBe(cellById(dom, `mc_p${i}`));
    }
    expect(fmt(det.mde?.cmde, 1), 'mc_cmde').toBe(cellById(dom, 'mc_cmde'));
    dom.window.close();
  });

  it('DEBOUNCE : une rafale de recalc() ne declenche qu UN SEUL POST', async () => {
    const fx = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon');
    if (!fx) return;
    const env = runLabo(fx.input);
    if (!env.ok) return;

    const { dom, calls } = loadClone(env.output);
    const win = dom.window as unknown as { eval: (c: string) => unknown };
    // writeForm(DEMO) planifie 1 recalc ; on en declenche 9 autres AVANT l echeance debounce.
    win.eval(`writeForm(${JSON.stringify(fx.input)}); for(var i=0;i<9;i++) recalc();`);
    // Avant l echeance : aucun POST encore parti.
    expect(calls(), 'un POST est parti avant la fin du debounce').toBe(0);
    // Apres l echeance (>320 ms) : exactement UN POST pour toute la rafale.
    await new Promise((r) => setTimeout(r, 500));
    expect(calls(), 'la rafale a produit != 1 POST').toBe(1);

    dom.window.close();
  });

  it('NO-CALC-INITIAL : au boot (etat vide) aucun calc:request, verdict natif « En attente »', async () => {
    const html = readFileSync(CLONE_PATH, 'utf8');
    const posted: unknown[] = [];
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse(window) {
        polyfill(window as unknown as { structuredClone?: unknown });
        const orig = window.postMessage.bind(window);
        (window as unknown as { postMessage: unknown }).postMessage = (
          ...args: unknown[]
        ) => {
          posted.push(args[0]);
          return (orig as (...a: unknown[]) => unknown)(...args);
        };
      },
    });
    // Laisse le boot (writeForm({}) -> recalc) se derouler, largement au-dela du debounce.
    await new Promise((r) => setTimeout(r, 400));
    const calcRequests = posted.filter(
      (m) => (m as { type?: string })?.type === 'calc:request',
    );
    expect(calcRequests, 'un calc:request a fuite au boot (etat vide)').toHaveLength(0);
    const result = dom.window.document.getElementById('result')?.innerHTML ?? '';
    expect(result).toContain('En attente');
    dom.window.close();
  });
});

// ===========================================================================
// CAPTURE OPTION-3 (snapshot:capture) — le pont FASTLAB scelle le DOCUMENT (PV =
// feuilles d essai renseignees + classification GTR + chrome buildPVChrome) APRES
// un calcul REUSSI (garde §5). §8 (contrat labo l.30-34) : le resultat de labo +
// la classe GTR sont le LIVRABLE public (NF P 11-300) — tout client-safe, aucun
// masquage. ZERO FAUX-VERT : si le cablage (snapshot / __fastlabCaptureSnapshot /
// appel en fin de calcul) est absent, `caps` reste vide -> ces tests ECHOUENT.
// ===========================================================================

type Cap = { displayHtml: string; printHtml: string };

/** Passe un HTML dans la VRAIE garde §8 serveur (assertInertHtml) via le runner
 *  scripts/assert-inert-run.mts — jamais une copie des regles. Sur octets REELS. */
function guardInert(html: string): { ok: boolean; error?: string } {
  const raw = execFileSync('npx', ['tsx', 'scripts/assert-inert-run.mts'], {
    input: html,
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(raw) as { ok: boolean; error?: string };
}

/** Charge le clone avec un pont capteur `snapshot` ; collecte les captures emises. */
function loadCloneCapturing(output: unknown): { dom: JSDOM; caps: Cap[] } {
  const html = readFileSync(CLONE_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse: polyfill,
  });
  const caps: Cap[] = [];
  (dom.window as unknown as Record<string, unknown>).__geofamBridge = {
    calc: () => Promise.resolve({ ok: true, calcResultId: 'cap-cr-1', output }),
    emitPv: () => undefined,
    snapshot: (displayHtml: string, printHtml: string) =>
      caps.push({
        displayHtml: String(displayHtml || ''),
        printHtml: String(printHtml || ''),
      }),
    storeGet: () => new Promise(() => {}),
    storeSet: () => Promise.resolve(),
    context: () => ({}),
  };
  return { dom, caps };
}

/** Ensemble des data-tab d une capture (feuilles .tab.pv-show serialisees). */
function tabSet(html: string): string[] {
  const out: string[] = [];
  const re = /data-tab="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out.sort();
}

/**
 * Rend le PV de REFERENCE du HTML client GELE : boote la source (canvas neutralise),
 * pilote via writeForm(input) (recalc LOCAL synchrone du client), appelle markPV()
 * (feuilles renseignees + chrome), puis lit l ensemble des .tab.pv-show + la classe.
 * ARBITRE d equivalence : ce que le client aurait imprime.
 */
function renderReferencePv(input: unknown): {
  tabs: string[];
  classeFull: string | null;
} {
  const buf = readFileSync(laboSourcePath());
  const actualSha = createHash('sha256').update(buf).digest('hex');
  // Le HTML teste DOIT etre la version scellee au registre (sinon on compare a une
  // autre version que celle du PV) — echec DUR, jamais un skip silencieux.
  expect(actualSha, 'SHA-256 source labo != registre (version divergente)').toBe(
    laboRegistrySha256(),
  );
  const dom = new JSDOM(buf.toString('utf8'), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window: { structuredClone?: unknown; HTMLCanvasElement?: unknown }) {
      if (typeof window.structuredClone !== 'function') {
        window.structuredClone = (v: unknown) => JSON.parse(JSON.stringify(v));
      }
    },
  });
  const win = dom.window as unknown as { eval: (c: string) => unknown };
  // Canvas neutralise (draw* du client PRESENTATION pure -> getContext noop).
  win.eval(
    'try{var __n=new Proxy({},{get:function(){return function(){return __n;};},set:function(){return true;}});HTMLCanvasElement.prototype.getContext=function(){return __n;};}catch(e){}',
  );
  win.eval(`writeForm(${JSON.stringify(input)});`); // recalc LOCAL synchrone
  win.eval('markPV();');
  const doc = dom.window.document;
  const tabs = Array.from(doc.querySelectorAll('.tab.pv-show'))
    .map((t) => (t as HTMLElement).dataset.tab ?? '')
    .filter(Boolean)
    .sort();
  const cls = win.eval('JSON.stringify(classify()||{})') as string;
  const classeFull = (JSON.parse(cls) as { full?: string }).full ?? null;
  dom.window.close();
  return { tabs, classeFull };
}

const dCap = hasClone && laboSourceAvailable() ? describe : describe.skip;
if (hasClone && !laboSourceAvailable()) {
  // eslint-disable-next-line no-console
  console.warn(
    '[clone-render] capture/equivalence SKIP : source client gelee absente (03-Moteurs-client/).',
  );
}

dCap('fastlab — capture option-3 du PV (§8 client-safe, garde §5, equivalence)', () => {
  it('given un calcul labo reussi, when __runCalcLabo se termine, then le pont emet snapshot:capture (display + print) NON vide et auto-contenu', async () => {
    const fx = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon')!;
    const env = runLabo(fx.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const { dom, caps } = loadCloneCapturing(env.output);
    await drive(dom, fx.input);
    await new Promise((r) => setTimeout(r, 30));

    expect(
      caps.length,
      'aucune capture emise (cablage snapshot absent ?)',
    ).toBeGreaterThan(0);
    const cap = caps[caps.length - 1]!;
    // printHtml auto-contenu, CSS inline, feuilles + classification presentes.
    expect(cap.printHtml.length, 'printHtml vide').toBeGreaterThan(2000);
    expect(cap.printHtml, 'printHtml non auto-contenu').toContain('<!doctype html>');
    expect(cap.printHtml, 'CSS non inline').toContain('<style>');
    expect(cap.printHtml, 'en-tete PV absente').toContain("PROCÈS-VERBAL D'ESSAI");
    // « SYNTHÈSE & CLASSIFICATION GTR » — le & est serialise &amp; par insertAdjacentHTML.
    expect(cap.printHtml, 'synthese/classification absente').toContain(
      'CLASSIFICATION GTR',
    );
    expect(cap.printHtml, 'classe GTR absente').toContain(
      env.output.classe.full ?? '__x__',
    );
    expect(cap.displayHtml.length, 'displayHtml vide').toBeGreaterThan(2000);
    expect(cap.displayHtml, 'displayHtml non auto-contenu').toContain('<!doctype html>');
    dom.window.close();
  });

  it('given des feuilles CONDITIONNELLES (markPV : ident+class toujours, essais si renseignes), when capture, then le jeu de feuilles == PV de reference client (equivalence)', async () => {
    const fx = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon')!;
    const env = runLabo(fx.input);
    if (!env.ok) return;
    const { dom, caps } = loadCloneCapturing(env.output);
    await drive(dom, fx.input);
    await new Promise((r) => setTimeout(r, 30));
    const cloneTabs = tabSet(caps[caps.length - 1]!.printHtml);

    const ref = renderReferencePv(fx.input);
    // Equivalence de note : MEMES feuilles que le client imprimerait.
    expect(cloneTabs, 'jeu de feuilles clone != reference client').toEqual(ref.tabs);
    // Non vacue + invariants : ident+class TOUJOURS ; une feuille NON renseignee absente.
    expect(cloneTabs).toContain('ident');
    expect(cloneTabs).toContain('class');
    expect(cloneTabs).toContain('oedo'); // oe_H0 renseigne dans DEMO
    expect(cloneTabs, "feuille 'la' non renseignee ne doit pas apparaitre").not.toContain(
      'la',
    );
    // Classification identique a la reference (et coherente avec la sortie serveur).
    expect(ref.classeFull).toBe(env.output.classe.full);
    dom.window.close();
  });

  it('given le displayHtml et le printHtml REELLEMENT captures, when passes dans la VRAIE garde §8 (assertInertHtml), then ACCEPTES (aucun script/handler/URI data:)', async () => {
    const fx = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon')!;
    const env = runLabo(fx.input);
    if (!env.ok) return;
    const { dom, caps } = loadCloneCapturing(env.output);
    await drive(dom, fx.input);
    await new Promise((r) => setTimeout(r, 30));
    const cap = caps[caps.length - 1]!;
    dom.window.close();

    expect(/<script\b/i.test(cap.printHtml), 'printHtml contient <script>').toBe(false);
    expect(/<canvas\b/i.test(cap.printHtml), 'printHtml contient <canvas> (blank)').toBe(
      false,
    );
    expect(/\son\w+\s*=/i.test(cap.printHtml), 'gestionnaire inline on…= present').toBe(
      false,
    );
    expect(/data:/i.test(cap.printHtml), 'URI data: (non sealable) presente').toBe(false);
    const gPrint = guardInert(cap.printHtml);
    expect(gPrint.ok, `garde §8 REFUSE le printHtml : ${gPrint.error ?? ''}`).toBe(true);
    const gDisp = guardInert(cap.displayHtml);
    expect(gDisp.ok, `garde §8 REFUSE le displayHtml : ${gDisp.error ?? ''}`).toBe(true);
  });

  it('given la SAISIE (input/select/textarea) du formulaire, when capture, then les valeurs sont FIGEES dans les attributs (feuilles non vides)', async () => {
    const fx = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon')!;
    const env = runLabo(fx.input);
    if (!env.ok) return;
    const { dom, caps } = loadCloneCapturing(env.output);
    await drive(dom, fx.input);
    await new Promise((r) => setTimeout(r, 30));
    const cap = caps[caps.length - 1]!;
    dom.window.close();
    // outerHTML ne serialise pas .value : sans le freeze, les inputs seraient vides.
    // oe_H0=20.0 (DEMO) doit apparaitre comme attribut value dans la feuille oedometre.
    expect(cap.printHtml, 'valeur de saisie oe_H0 non figee (freeze KO)').toMatch(
      /id="oe_H0"[^>]*value="20\.0"|value="20\.0"[^>]*id="oe_H0"/,
    );
  });

  it('DETERMINISME : deux captures du MEME calcul produisent des octets IDENTIQUES (aucune horloge/hasard)', async () => {
    const fx = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon')!;
    const env = runLabo(fx.input);
    if (!env.ok) return;
    const a = loadCloneCapturing(env.output);
    await drive(a.dom, fx.input);
    await new Promise((r) => setTimeout(r, 30));
    const b = loadCloneCapturing(env.output);
    await drive(b.dom, fx.input);
    await new Promise((r) => setTimeout(r, 30));
    expect(a.caps[a.caps.length - 1]!.printHtml).toBe(
      b.caps[b.caps.length - 1]!.printHtml,
    );
    a.dom.window.close();
    b.dom.window.close();
  });

  it('GARDE §5 (esprit mutation) : sur une ERREUR EN BANDE (output.erreur), AUCUNE capture n est emise', async () => {
    // runLabo encode l erreur dans output.erreur (ok reste true). Le clone rend la note
    // d erreur MAIS ne doit JAMAIS la sceller. Retirer `if(__out.erreur)return` -> cap>0.
    const errOutput = {
      erreur: 'Saisie invalide (granulometrie incoherente).',
      warnings: [],
      classe: {
        fam: null,
        code: null,
        full: null,
        desc: '',
        path: [],
        caveats: [],
        etat: null,
        stApplies: false,
        rNote: null,
      },
      detail: null,
    };
    const fx = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon')!;
    const { dom, caps } = loadCloneCapturing(errOutput);
    // Etat PLAUSIBLE -> un POST part ; le serveur repond une erreur en bande.
    const win = dom.window as unknown as { eval: (c: string) => unknown };
    win.eval(`writeForm(${JSON.stringify(fx.input)});`);
    // Au-dela du debounce (320 ms) + rendu : la note d erreur est affichee, PAS scellee.
    await new Promise((r) => setTimeout(r, 600));
    expect(
      caps.length,
      'une capture a ete emise sur une erreur en bande (garde §5 KO)',
    ).toBe(0);
    dom.window.close();
  });

  // -------------------------------------------------------------------------
  // COURBES SVG INLINE (décision titulaire « prendre tel quel ») — chaque figure
  // canvas du PV client est RE-DESSINÉE en SVG vectoriel sealable, FIDÈLE aux séries
  // serveur/saisie. On ne peut pas comparer bit-à-bit canvas↔SVG (formats différents) :
  // on prouve que le SVG PORTE LES MÊMES DONNÉES (coordonnées recalculées avec la
  // transformée du client) + count de points == série serveur + sanity-mutation.
  // -------------------------------------------------------------------------

  /** Extrait le fragment <svg …aria-label="LABEL"…>…</svg> du HTML capturé. */
  function sliceSvg(html: string, label: string): string {
    const i = html.indexOf(`aria-label="${label}"`);
    if (i < 0) return '';
    const start = html.lastIndexOf('<svg', i);
    const end = html.indexOf('</svg>', i);
    return start < 0 || end < 0 ? '' : html.slice(start, end + 6);
  }
  /** Compte les points de mesure (class="flpt") d'un fragment SVG. */
  function flptCount(svg: string): number {
    return (svg.match(/class="flpt"/g) ?? []).length;
  }
  // MÊME arrondi que le clone (__sN) : Math.round(n*100)/100 puis String par défaut.
  const sN = (n: number) => Math.round(n * 100) / 100;

  /** Capture le printHtml pour un (input, output) donné (une session JSDOM). */
  async function captureHtml(input: unknown, output: unknown): Promise<string> {
    const { dom, caps } = loadCloneCapturing(output);
    await drive(dom, input);
    await new Promise((r) => setTimeout(r, 30));
    const html = caps.length ? caps[caps.length - 1]!.printHtml : '';
    dom.window.close();
    return html;
  }

  // Vue TYPÉE (minimale) du detail serveur consommé par les figures — évite `any`.
  type XY = [number, number];
  interface LaboDetailView {
    gran?: { pts?: XY[] };
    att?: { raw?: XY[] };
    proctor?: { rows?: Array<{ w: number | null; rd: number | null }> };
    cbr?: { varPts?: XY[]; cible?: number | null; icbr?: number | null };
    cisail?: { ptsP?: XY[]; ptsR?: XY[] };
    oedo?: { curvePts?: XY[] };
  }
  const detOf = (out: unknown): LaboDetailView =>
    ((out as { detail?: unknown }).detail ?? {}) as LaboDetailView;
  const wlIpOf = (out: unknown) => out as { wl?: number | null; ip?: number | null };

  /** Assertion FORTE d'une courbe : chaque point de la série est tracé aux coordonnées
   *  de la transformée CLIENT (recalculée ici) + le compte de points tracés == la série.
   *  Une échelle/transformée FAUSSE (mauvais min/max, mauvais log, axes inversés) ROUGIT. */
  function assertSeriePlotted(
    svg: string,
    pts: XY[],
    px: (x: number) => number,
    py: (y: number) => number,
    key: string,
  ): void {
    expect(svg.length, `SVG « ${key} » absent`).toBeGreaterThan(100);
    expect(flptCount(svg), `nb de points tracés ${key} != série serveur/saisie`).toBe(
      pts.length,
    );
    for (const [x, y] of pts) {
      const cx = sN(px(x));
      const cy = sN(py(y));
      expect(
        svg.includes(`cx="${cx}" cy="${cy}"`),
        `point ${key} (${x}, ${y}) absent aux coordonnées client (${cx},${cy})`,
      ).toBe(true);
    }
  }

  it('COURBES : les figures du PV sont rendues en SVG inline vectoriel (pas de canvas), une par feuille renseignée', async () => {
    const fx = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon')!;
    const env = runLabo(fx.input);
    if (!env.ok) return;
    const { dom, caps } = loadCloneCapturing(env.output);
    await drive(dom, fx.input);
    await new Promise((r) => setTimeout(r, 30));
    const html = caps[caps.length - 1]!.printHtml;
    dom.window.close();

    // AUCUN canvas (le bitmap ne serait pas scellable) ; les figures sont des <svg>.
    expect(/<canvas\b/i.test(html), 'un <canvas> subsiste dans le PV').toBe(false);
    // Feuilles renseignées par DEMO : granulo, Atterberg (2 figures), Proctor,
    // cisaillement, œdomètre — chaque figure présente par son aria-label.
    for (const label of [
      'Courbe granulométrique',
      'Courbe de liquidité (Atterberg)',
      'Diagramme de plasticité (Casagrande)',
      'Courbe Proctor',
      'Enveloppe de cisaillement (c′/φ′)',
      'Courbe œdométrique',
    ]) {
      expect(sliceSvg(html, label).length, `figure « ${label} » absente`).toBeGreaterThan(
        100,
      );
    }
  });

  // -------- PREUVE DONNÉES FORTE, LES 6 COURBES À SÉRIE (serveur) -----------
  // Chaque spec recalcule INDÉPENDAMMENT la transformée du client (mêmes W/H/marges,
  // mêmes bornes min/max, même log) → une échelle/transformée fausse ROUGIT. + count
  // de points == série + sanity-mutation (muter un point déplace le point dans le SVG).
  interface CurveSpec {
    key: string;
    label: string;
    fixture: string;
    series: (out: unknown) => XY[];
    tf: (
      pts: XY[],
      out: unknown,
    ) => { px: (x: number) => number; py: (y: number) => number };
    mutate: (out: unknown) => void;
  }
  const CURVES: CurveSpec[] = [
    {
      key: 'granulo',
      label: 'Courbe granulométrique',
      fixture: 'demo-A2-limon',
      series: (o) => detOf(o).gran?.pts ?? [],
      tf: () => {
        const W = 900,
          H = 300,
          mL = 44,
          mR = 14,
          mT = 12,
          mB = 28;
        const xm = Math.log10(0.06),
          xM = Math.log10(100);
        return {
          px: (v) => mL + ((Math.log10(v) - xm) / (xM - xm)) * (W - mL - mR),
          py: (p) => mT + ((100 - p) / 100) * (H - mT - mB),
        };
      },
      mutate: (o) => {
        detOf(o).gran!.pts![0]![1] -= 17;
      },
    },
    {
      key: 'liquidité',
      label: 'Courbe de liquidité (Atterberg)',
      fixture: 'demo-A2-limon',
      series: (o) => detOf(o).att?.raw ?? [],
      tf: (pts) => {
        const W = 800,
          H = 280,
          mL = 48,
          mR = 14,
          mT = 14,
          mB = 30;
        const xs = pts.map((p) => p[0]),
          ws = pts.map((p) => p[1]);
        const xmin = Math.min(...xs) / 1.3,
          xmax = Math.max(...xs) * 1.3;
        const wmin = Math.min(...ws) - 2,
          wmax = Math.max(...ws) + 2;
        const tx = (v: number) => Math.log10(v);
        return {
          px: (v) => mL + ((tx(v) - tx(xmin)) / (tx(xmax) - tx(xmin))) * (W - mL - mR),
          py: (w) => mT + ((wmax - w) / (wmax - wmin)) * (H - mT - mB),
        };
      },
      mutate: (o) => {
        detOf(o).att!.raw![0]![1] -= 5;
      },
    },
    {
      key: 'proctor',
      label: 'Courbe Proctor',
      fixture: 'demo-A2-limon',
      series: (o) =>
        (detOf(o).proctor?.rows ?? [])
          .filter((r) => r.w != null && r.rd != null)
          .map((r) => [r.w as number, r.rd as number] as XY),
      tf: (pts) => {
        const W = 800,
          H = 300,
          mL = 48,
          mR = 14,
          mT = 14,
          mB = 30;
        const ws = pts.map((p) => p[0]),
          rs = pts.map((p) => p[1]);
        const wmin = Math.min(...ws) - 2,
          wmax = Math.max(...ws) + 2;
        const rmin = Math.min(...rs) - 0.05,
          rmax = Math.max(...rs) + 0.05;
        return {
          px: (w) => mL + ((w - wmin) / (wmax - wmin)) * (W - mL - mR),
          py: (r) => mT + ((rmax - r) / (rmax - rmin)) * (H - mT - mB),
        };
      },
      mutate: (o) => {
        const row = (detOf(o).proctor!.rows ?? []).find((r) => r.rd != null)!;
        row.rd = (row.rd as number) - 0.1;
      },
    },
    {
      key: 'cbr-compacité',
      label: 'CBR / Compacité',
      fixture: 'kernel-cbr-complet',
      series: (o) => detOf(o).cbr?.varPts ?? [],
      tf: (pts, o) => {
        const W = 460,
          H = 320,
          mL = 46,
          mR = 12,
          mT = 26,
          mB = 30;
        const cbr = detOf(o).cbr ?? {};
        const cs = pts.map((p) => p[0]).concat([cbr.cible ?? 0]);
        const vs = pts.map((p) => p[1]).concat([cbr.icbr ?? 0]);
        const xmin = Math.min(...cs) - 1,
          xmax = Math.max(...cs) + 1;
        const ymin = Math.max(0, Math.min(...vs) - 2),
          ymax = Math.max(...vs) + 2;
        return {
          px: (c) => mL + ((c - xmin) / (xmax - xmin)) * (W - mL - mR),
          py: (v) => mT + ((ymax - v) / (ymax - ymin)) * (H - mT - mB),
        };
      },
      mutate: (o) => {
        detOf(o).cbr!.varPts![0]![1] -= 5;
      },
    },
    {
      key: 'œdomètre',
      label: 'Courbe œdométrique',
      fixture: 'demo-A2-limon',
      series: (o) => detOf(o).oedo?.curvePts ?? [],
      tf: (pts) => {
        const W = 800,
          H = 300,
          mL = 48,
          mR = 14,
          mT = 14,
          mB = 30;
        const ss = pts.map((p) => p[0]),
          es = pts.map((p) => p[1]);
        const smin = Math.log10(Math.max(1, Math.min(...ss)));
        const smax = Math.log10(Math.max(...ss) * 1.2);
        const emin = Math.min(...es) - 0.02,
          emax = Math.max(...es) + 0.02;
        void emin;
        return {
          px: (sv) => mL + ((Math.log10(sv) - smin) / (smax - smin)) * (W - mL - mR),
          py: (e) => mT + ((emax - e) / (emax - emin)) * (H - mT - mB),
        };
      },
      mutate: (o) => {
        detOf(o).oedo!.curvePts![3]![1] -= 0.05;
      },
    },
    {
      key: 'cisaillement',
      label: 'Enveloppe de cisaillement (c′/φ′)',
      fixture: 'demo-A2-limon',
      series: (o) => (detOf(o).cisail?.ptsP ?? []).concat(detOf(o).cisail?.ptsR ?? []),
      tf: (pts) => {
        const W = 820,
          H = 330,
          mL = 50,
          mR = 16,
          mT = 14,
          mB = 32;
        const smax = Math.max(Math.max(...pts.map((p) => p[0])), 1) * 1.15;
        const tmax = Math.max(Math.max(...pts.map((p) => p[1])), 1) * 1.2;
        return {
          px: (sv) => mL + (sv / smax) * (W - mL - mR),
          py: (t) => mT + ((tmax - t) / tmax) * (H - mT - mB),
        };
      },
      mutate: (o) => {
        detOf(o).cisail!.ptsP![0]![1] -= 10;
      },
    },
  ];

  for (const c of CURVES) {
    it(`DONNÉES FIDÈLES (${c.key}) : points tracés aux coordonnées de la transformée client + count == série + sanity-mutation`, async () => {
      const fx = LABO_FIXTURES.find((f) => f.id === c.fixture)!;
      const env = runLabo(fx.input);
      if (!env.ok) return;
      const pts = c.series(env.output);
      expect(pts.length, `série ${c.key} vide`).toBeGreaterThan(0);

      const svg = sliceSvg(await captureHtml(fx.input, env.output), c.label);
      const { px, py } = c.tf(pts, env.output);
      assertSeriePlotted(svg, pts, px, py, c.key);

      // Sanity-mutation : muter un point de la série DÉPLACE le tracé (données branchées,
      // pas une figure figée). Rougit si le SVG ignore la série.
      const mutated = JSON.parse(JSON.stringify(env.output)) as unknown;
      c.mutate(mutated);
      const svgB = sliceSvg(await captureHtml(fx.input, mutated), c.label);
      expect(svgB, `muter un point ${c.key} ne change PAS le SVG`).not.toBe(svg);
    });
  }

  it('DONNÉES FIDÈLES (plasticité Casagrande) : le point échantillon est tracé à (wL, Ip) selon la transformée client', async () => {
    const fx = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon')!;
    const env = runLabo(fx.input);
    if (!env.ok) return;
    const { wl, ip } = wlIpOf(env.output);
    expect(wl != null && ip != null, 'wL/Ip absents').toBe(true);
    const svg = sliceSvg(
      await captureHtml(fx.input, env.output),
      'Diagramme de plasticité (Casagrande)',
    );
    // Transformée client (__flSvgPlast) : W=700,H=320,mL=44,mR=14,mT=14,mB=34 ; x 0-100, y 0-60.
    const W = 700,
      H = 320,
      mL = 44,
      mR = 14,
      mT = 14,
      mB = 34;
    const px = (v: number) => mL + (v / 100) * (W - mL - mR);
    const py = (v: number) => mT + ((60 - v) / 60) * (H - mT - mB);
    const cx = sN(px(wl as number));
    const cy = sN(py(ip as number));
    // Le point échantillon est un cercle STYLÉ (r=5, non-flpt) — assert ses coordonnées.
    expect(
      svg.includes(`cx="${cx}" cy="${cy}" r="5"`),
      `point plasticité (wL=${wl}, Ip=${ip}) absent en (${cx},${cy})`,
    ).toBe(true);
    // Sanity-mutation : déplacer wL déplace le point.
    const mutated = JSON.parse(JSON.stringify(env.output)) as unknown;
    (mutated as { wl: number }).wl = (wl as number) - 8;
    const svgB = sliceSvg(
      await captureHtml(fx.input, mutated),
      'Diagramme de plasticité (Casagrande)',
    );
    expect(svgB, 'muter wL ne change PAS le diagramme').not.toBe(svg);
  });

  it('DONNÉES FIDÈLES (poinçonnement CBR) : les 3 séries de SAISIE (DOM) sont tracées selon la transformée client', async () => {
    const fx = LABO_FIXTURES.find((f) => f.id === 'kernel-cbr-complet')!;
    const env = runLabo(fx.input);
    if (!env.ok) return;
    // Séries reconstruites DEPUIS LA SAISIE (comme drawCbrPen/__flSvgCbrPen : num(cb_pen_m_i)×K).
    const CBR_ENF = [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5];
    const input = fx.input as Record<string, string>;
    const K = Number(input.cb_K) || 1;
    const series = [0, 1, 2].map((m) =>
      CBR_ENF.map((e, i) => {
        const v = input[`cb_pen_${m}_${i}`];
        return v != null ? ([e, Number(v) * K] as XY) : null;
      }).filter((p): p is XY => p !== null),
    );
    const drawn = series.filter((s) => s.length >= 2); // seules les séries ≥2 points sont tracées
    const all = drawn.flat();
    expect(all.length, 'aucune série de poinçonnement').toBeGreaterThan(0);
    const ymax = Math.max(...all.map((p) => p[1])) * 1.1;
    const W = 460,
      H = 320,
      mL = 46,
      mR = 12,
      mT = 26,
      mB = 30;
    const px = (e: number) => mL + (e / 5) * (W - mL - mR);
    const py = (v: number) => mT + ((ymax - v) / ymax) * (H - mT - mB);

    const svg = sliceSvg(
      await captureHtml(fx.input, env.output),
      'Courbe de poinçonnement CBR',
    );
    assertSeriePlotted(svg, all, px, py, 'poinçonnement CBR');

    // Sanity-mutation : changer une saisie de poinçonnement déplace le tracé (série DOM).
    const mi = JSON.parse(JSON.stringify(fx.input)) as Record<string, string>;
    mi.cb_pen_0_9 = String(Number(mi.cb_pen_0_9) + 9);
    const menv = runLabo(mi);
    const svgB = sliceSvg(
      await captureHtml(mi, menv.ok ? menv.output : {}),
      'Courbe de poinçonnement CBR',
    );
    expect(svgB, 'muter une saisie de poinçonnement ne change PAS le SVG').not.toBe(svg);
  });

  it('REGISTRE : renderAll RÉINITIALISE __flCurves (aucun slot périmé ne subsiste — défense en profondeur)', async () => {
    // ROUGE sans le reset : un slot sentinelle injecté AVANT renderAll survivrait à l appel.
    const fx = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon')!;
    const env = runLabo(fx.input);
    if (!env.ok) return;
    const { dom } = loadCloneCapturing(env.output);
    await drive(dom, fx.input);
    await new Promise((r) => setTimeout(r, 30));
    const win = dom.window as unknown as { eval: (c: string) => unknown };
    const survived = win.eval(
      `(function(){ window.__flCurves.__sentinelle={x:1}; renderAll(${JSON.stringify(env.output)}); return typeof window.__flCurves.__sentinelle; })()`,
    );
    expect(survived, 'un slot périmé survit à renderAll (reset manquant)').toBe(
      'undefined',
    );
    dom.window.close();
  });

  it('DISPARITION inter-échantillon : un calcul SANS œdomètre ne conserve NI feuille NI figure œdomètre', async () => {
    // A : demo (oe_H0 renseigné) -> figure œdomètre présente.
    const A = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon')!;
    const eA = runLabo(A.input);
    if (!eA.ok) return;
    const htmlA = await captureHtml(A.input, eA.output);
    expect(
      sliceSvg(htmlA, 'Courbe œdométrique').length,
      'A : figure œdomètre attendue',
    ).toBeGreaterThan(100);
    // B : sable-B-mf (aucun oe_H0) -> feuille œdo NON marquée par markPV, figure absente.
    const B = LABO_FIXTURES.find((f) => f.id === 'sable-B-mf')!;
    const eB = runLabo(B.input);
    if (!eB.ok) return;
    const htmlB = await captureHtml(B.input, eB.output);
    expect(/data-tab="oedo"/.test(htmlB), 'B : feuille œdomètre fantôme').toBe(false);
    expect(sliceSvg(htmlB, 'Courbe œdométrique'), 'B : figure œdomètre fantôme').toBe('');
  });

  it('COURBES CBR : sur une feuille CBR renseignée, poinçonnement + CBR/compacité rendus en SVG', async () => {
    const fx = LABO_FIXTURES.find((f) => f.id === 'kernel-cbr-complet')!;
    const env = runLabo(fx.input);
    if (!env.ok) return;
    const { dom, caps } = loadCloneCapturing(env.output);
    await drive(dom, fx.input);
    await new Promise((r) => setTimeout(r, 30));
    const html = caps[caps.length - 1]!.printHtml;
    dom.window.close();
    expect(/<canvas\b/i.test(html), 'canvas résiduel (CBR)').toBe(false);
    // Poinçonnement (série DOM = saisie) + CBR/Compacité (série serveur varPts).
    expect(
      sliceSvg(html, 'Courbe de poinçonnement CBR').length,
      'figure poinçonnement CBR absente',
    ).toBeGreaterThan(100);
    expect(
      sliceSvg(html, 'CBR / Compacité').length,
      'figure CBR/Compacité absente',
    ).toBeGreaterThan(100);
  });
});
