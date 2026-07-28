/**
 * PREUVE NAVIGATEUR (vrai Chromium) — anti « pages vierges » à l'impression.
 *
 * jsdom ne calcule AUCUN layout : les tests jsdom ne prouvent que la PRÉSENCE de
 * règles CSS, jamais l'ABSENCE de pages blanches. Ce script mesure le LAYOUT réel
 * dans Chromium, indépendamment de l'app et du mock : il ne teste que le DOCUMENT
 * capturé (printHtml) + une reproduction fidèle du helper `printInertHtml`.
 *
 * Mécanisme du bug : `printInertHtml` imprimait dans une iframe `width:0;height:0`
 * -> bloc conteneur initial de 0 px. Un document dont la largeur n'est que
 * `max-width` (sans `width`) s'effondre à 0 : le texte s'enroule sur des milliers
 * de px = une dizaine de colonnes fines quasi vides (« pages vierges »).
 *
 * DEUX corrections, prouvées ici en avant/après :
 *   1. HELPER (cause racine) : iframe hors-écran `width:210mm` (au lieu de `width:0`)
 *      -> protège TOUT document, même sans largeur (roadsens, moteurs futurs).
 *   2. DOCUMENT (défense en profondeur) : #notePrint{width:174mm} dans le printHtml
 *      Terzaghi -> tient même si un helper repassait à `width:0`.
 *
 * Note d'implémentation : tsx/esbuild (keepNames) réécrit les fonctions du fichier
 * avec des appels `__name` absents du navigateur ; tous les scripts injectés dans la
 * page sont donc passés en CHAÎNES (non transformées), jamais en callbacks.
 *
 * Sortie : rapport + assertions dures (throw -> exit≠0). Aucune dépendance app.
 * Lancement : `pnpm verify:print`.
 */
/* eslint-disable no-console -- script de vérification CLI : la sortie console EST le livrable. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from '@playwright/test';

import { wrapSealedDocumentWithPvChrome } from '../apps/api/src/pv/pv-document-chrome.js';
import { runBurmister } from '../packages/engines/src/burmister/index.js';
import { BURMISTER_FIXTURES } from '../packages/engines/src/burmister/test-fixtures.js';
import { runLabo } from '../packages/engines/src/labo/index.js';
import { LABO_FIXTURES } from '../packages/engines/src/labo/test-fixtures.js';
import { runPieux } from '../packages/engines/src/pieux/index.js';
import { PIEUX_FIXTURES } from '../packages/engines/src/pieux/test-fixtures.js';
import { runPressiometre } from '../packages/engines/src/pressiometre/index.js';
import { PRESSIOMETRE_FIXTURES } from '../packages/engines/src/pressiometre/test-fixtures.js';
import { runRadier } from '../packages/engines/src/radier/index.js';
import { RADIER_FIXTURES } from '../packages/engines/src/radier/test-fixtures.js';
import { runTerzaghi } from '../packages/engines/src/terzaghi/index.js';
import { TERZAGHI_FIXTURES } from '../packages/engines/src/terzaghi/test-fixtures.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const A4_PX = 1122; // 297mm @ 96dpi.

// Styles d'iframe MIROIR de apps/web/src/lib/print-inert-html.ts (les deux modes).
const HELPER = {
  old: 'position:fixed;right:0;bottom:0;width:0;height:0;border:none;visibility:hidden',
  new: 'position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:none;visibility:hidden',
} as const;

type Metric = { noteW: number; bodyH: number; pages: number };
const J = (v: unknown): string => JSON.stringify(v);

/** Injecte `html` dans une iframe reproduisant printInertHtml (mode helper donné) et
 *  mesure la largeur du bloc de contenu + le nombre de pages A4 du layout réel. */
async function measure(
  page: Page,
  html: string,
  helper: 'old' | 'new',
  sel: string,
): Promise<Metric> {
  await page.setContent('<!doctype html><body style="margin:0"></body>');
  await page.evaluate(
    `(function(){var f=document.createElement('iframe');f.setAttribute('sandbox','allow-same-origin allow-modals');f.style.cssText=${J(HELPER[helper])};f.id='__pf';f.srcdoc=${J(html)};document.body.appendChild(f);})()`,
  );
  const fr = page.frames().find((f) => f !== page.mainFrame());
  if (!fr) throw new Error('iframe frame introuvable');
  await page.waitForTimeout(500);
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(150);
  const m = (await fr.evaluate(
    `(function(){var el=document.querySelector(${J(sel)});var r=el?el.getBoundingClientRect():null;return {noteW:r?Math.round(r.width):-1,bodyH:document.body.scrollHeight};})()`,
  )) as { noteW: number; bodyH: number };
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(
    `(function(){var e=document.getElementById('__pf');if(e)e.remove();})()`,
  );
  return { ...m, pages: Math.max(1, Math.ceil(m.bodyH / A4_PX)) };
}

/** Capture le printHtml réel d'un clone piloté par la sortie serveur (snapshot:capture). */
async function capturePrintHtml(
  page: Page,
  cloneRel: string,
  output: unknown,
  driveScript: string,
  readyScript: string,
): Promise<string> {
  const clone = readFileSync(resolve(REPO, cloneRel), 'utf8');
  let captured = '';
  await page.exposeFunction('__pwOutput', () => output);
  await page.exposeFunction('__pwSnapshot', (_d: string, p: string) => {
    captured = String(p || '');
  });
  await page.setContent(clone, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    `(function(){window.__geofamBridge={calc:function(){return window.__pwOutput().then(function(o){return {ok:true,calcResultId:'r1',output:o};});},emitPv:function(){},snapshot:function(d,p){return window.__pwSnapshot(d,p);},context:function(){return {};}};})()`,
  );
  await page.evaluate(driveScript);
  await page.waitForFunction(readyScript, { timeout: 15000 });
  await page.waitForTimeout(300);
  await page.removeAllListeners();
  if (!captured) throw new Error(`aucun printHtml capturé pour ${cloneRel}`);
  return captured;
}

/** Pipe un HTML dans la VRAIE garde §8 serveur (assertInertHtml) via le runner
 *  scripts/assert-inert-run.mts — jamais une copie des règles. Sur les octets RÉELS
 *  capturés en Chromium (SVG réellement rendu), pas une reproduction jsdom. */
function guardInert(html: string): { ok: boolean; error?: string } {
  const raw = execFileSync('npx', ['tsx', 'scripts/assert-inert-run.mts'], {
    input: html,
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(raw) as { ok: boolean; error?: string };
}

const results: string[] = [];
function assert(cond: boolean, msg: string): void {
  results.push((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) throw new Error('ASSERTION ÉCHOUÉE : ' + msg);
}

async function main(): Promise<void> {
  const browser: Browser = await chromium.launch();
  try {
    // ---------------- TERZAGHI ----------------
    const tfx = TERZAGHI_FIXTURES.find((f) => f.id === 'nominal-pressio-rect')!;
    const tenv = runTerzaghi(tfx.input);
    if (!tenv.ok) throw new Error('runTerzaghi a échoué');
    const tPage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const tDrive =
      `(function(){var inp=${J(tfx.input)};var fi=document.getElementById('fileImport');` +
      `var file=new File([JSON.stringify(inp)],'f.json',{type:'application/json'});` +
      `var dt=new DataTransfer();dt.items.add(file);` +
      `Object.defineProperty(fi,'files',{value:dt.files,configurable:true});` +
      `fi.dispatchEvent(new Event('change',{bubbles:true}));})()`;
    const tReady = `(function(){var p=(document.getElementById('tab-verifs')||{}).innerHTML||'';return p.indexOf('vcard')>=0&&p.indexOf('Calcul en cours')<0;})()`;
    const tPrint = await capturePrintHtml(
      tPage,
      'apps/web/src/tools-cloned/terzaghi.html',
      tenv.output,
      tDrive,
      tReady,
    );

    const PIN =
      '#notePrint{display:block !important;width:174mm;max-width:none;margin:0 auto}';
    const tUnpinned = tPrint.replace(
      PIN,
      '#notePrint{display:block !important;margin:0 auto}',
    );
    if (tUnpinned === tPrint)
      throw new Error('pin 174mm introuvable dans le printHtml Terzaghi (test caduc)');

    const t_unpin_old = await measure(tPage, tUnpinned, 'old', '.note');
    const t_unpin_new = await measure(tPage, tUnpinned, 'new', '.note');
    const t_pin_old = await measure(tPage, tPrint, 'old', '.note');
    const t_pin_new = await measure(tPage, tPrint, 'new', '.note');
    await tPage.close();

    console.log('\n=== TERZAGHI (note .note — largeur px, pages A4) ===');
    console.log(
      'doc SANS pin + helper AVANT (width:0)  :',
      J(t_unpin_old),
      '<= BUG reproduit',
    );
    console.log(
      'doc SANS pin + helper APRÈS (210mm)    :',
      J(t_unpin_new),
      '<= corrigé par le helper',
    );
    console.log(
      'doc AVEC pin + helper AVANT (width:0)  :',
      J(t_pin_old),
      '<= corrigé par le document',
    );
    console.log(
      'doc AVEC pin + helper APRÈS (210mm)    :',
      J(t_pin_new),
      '<= état livré',
    );

    assert(
      t_unpin_old.noteW <= 60 && t_unpin_old.pages >= 12,
      `Terzaghi non-corrigé s'effondre (~0px, ≥12 pages) — bug reproduit ${J(t_unpin_old)}`,
    );
    assert(
      t_unpin_new.noteW >= 600 && t_unpin_new.pages <= 7,
      `helper corrigé sauve le doc non-piné ${J(t_unpin_new)}`,
    );
    assert(
      t_pin_old.noteW >= 400 && t_pin_old.pages <= 7,
      `pin document tient sous helper buggé ${J(t_pin_old)}`,
    );
    assert(
      t_pin_new.noteW >= 600 && t_pin_new.pages <= 7,
      `état livré : pleine largeur, pages denses ${J(t_pin_new)}`,
    );

    // ---------------- ROADSENS (audit réel, non-régression du helper partagé) ----------------
    const bfx = BURMISTER_FIXTURES.find((f) => f.id === 'bitumineuse-epaisse-defaut')!;
    const benv = runBurmister(bfx.input);
    if (!benv.ok) throw new Error('runBurmister a échoué');
    const rPage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const rDrive =
      `(function(){var inp=${J(bfx.input)};` +
      `window.ly=inp.layers.map(function(l){return Object.assign({},l,{ifc:'auto'});});` +
      `window.pf=inp.subgrade;window.tr=inp.traffic;` +
      `window.cp=Object.assign({},inp.load,{gntAuto:false,neForce:null});window.runCalc();})()`;
    const rReady = `(function(){var r=(document.getElementById('resout')||{}).innerHTML||'';return r.length>400&&/satisfaisante/.test(r);})()`;
    const rPrint = await capturePrintHtml(
      rPage,
      'apps/web/src/tools-cloned/roadsens.html',
      benv.output,
      rDrive,
      rReady,
    );

    const r_old = await measure(rPage, rPrint, 'old', 'main.app');
    const r_new = await measure(rPage, rPrint, 'new', 'main.app');
    await rPage.close();

    console.log('\n=== ROADSENS (audit réel — main.app, pages A4) ===');
    console.log('roadsens + helper AVANT (width:0) :', J(r_old));
    console.log('roadsens + helper APRÈS (210mm)   :', J(r_new));
    const latent = r_old.noteW <= 60 || r_old.pages >= 12;
    console.log(
      'VERDICT roadsens sous ANCIEN helper :',
      latent
        ? 'BUG LATENT (aurait produit des pages vierges)'
        : 'marchait (largeur non nulle)',
    );
    assert(
      r_new.noteW >= 600 && r_new.pages <= 12,
      `helper corrigé : roadsens pleine largeur, pages raisonnables (NON-régression) ${J(r_new)}`,
    );

    // ---------------- DOCUMENT ENROBÉ (l'artefact REELLEMENT imprimé/scellé au service) ----------------
    // Le PV servi = printHtml enrobé du cartouche PV (bandeau + pied) par
    // wrapSealedDocumentWithPvChrome. On vérifie que l'enrobage n'introduit pas
    // d'effondrement (grille pvx-band) ni d'explosion de pages sous le helper corrigé.
    const wrapped = wrapSealedDocumentWithPvChrome(tPrint, {
      pvNumber: 'PV-RDS-demo-2026-000001',
      contentHash: '0'.repeat(64),
      sealedAt: '2026-07-25T00:00:00.000Z',
      projectName: 'Bâtiment R+5 — exemple',
      userDisplayName: 'Démo',
      orgDisplayName: 'STARFIRE',
      engineId: 'fondation-superficielle',
      engineVersion: '0.9.3',
      verdict: 'CONFORME',
    });
    const wPage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const w_note = await measure(wPage, wrapped, 'new', '.note');
    const w_band = await measure(wPage, wrapped, 'new', '.pvx-band');
    await wPage.close();
    console.log('\n=== DOCUMENT ENROBÉ (cartouche PV — helper corrigé) ===');
    console.log('note dans le PV enrobé :', J(w_note));
    console.log('bandeau pvx-band       :', J(w_band), '(largeur px)');
    assert(
      w_note.noteW >= 600 && w_note.pages <= 8,
      `PV enrobé : note pleine largeur, pas d'explosion de pages ${J(w_note)}`,
    );
    assert(
      w_band.noteW >= 600,
      `cartouche pvx-band non effondré (grille intacte) ${J(w_band)}`,
    );

    // ---------------- GEOPLAQUE (note printReport option-3 — radier, mode principal) ----------------
    // La note client `printReport` est TOUJOURS bâtie sur `state.results` (mode RADIER
    // principal) : les 3 modes 2D (plane-strain/axi/tri) rendent leur propre panneau et ne
    // FEED PAS printReport -> UNE seule note scellable (radier). On prouve donc ici la note
    // radier : pleine largeur A4, pas de pages blanches, FIGURE (SVG heatmap) présente, table
    // des couples présente, AUCUNE URI data: (figure sealable), AUCUNE localisation *At.
    const gfx = RADIER_FIXTURES.find((f) => f.id === 'carre-quatre-poteaux')!;
    const genv = runRadier(gfx.input);
    if (!genv.ok) throw new Error('runRadier a échoué');
    const gPage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const gRafts = gfx.input.rafts.map((r, i) => ({
      id: i + 1,
      pts: r.pts,
      E: r.E * 1000,
      nu: r.nu,
      e: r.e,
    }));
    const gLayers = gfx.input.layers.map((l) => ({
      name: l.name ?? 'Couche',
      zBase: l.zBase,
      E: l.E * 1000,
      nu: l.nu,
    }));
    const gDrive =
      `(function(){state.rafts=${J(gRafts)};state.pointLoads=${J(gfx.input.pointLoads ?? [])};` +
      `state.lineLoads=[];state.areaLoads=[];state.pointSprings=[];state.lineSprings=[];` +
      `state.layers=${J(gLayers)};doSolve();})()`;
    const gReady = `(function(){var r=(document.getElementById('resbody')||{}).innerHTML||'';return r.indexOf('EC7 annexe H')>=0&&r.indexOf('Calcul en cours')<0;})()`;
    const gPrint = await capturePrintHtml(
      gPage,
      'apps/web/src/tools-cloned/geoplaque.html',
      genv.output,
      gDrive,
      gReady,
    );

    const g_new = await measure(gPage, gPrint, 'new', 'table.chk');
    const g_body = await measure(gPage, gPrint, 'new', 'body');
    await gPage.close();

    console.log('\n=== GEOPLAQUE (note radier — table.chk / body, pages A4) ===');
    console.log('geoplaque + helper APRÈS (210mm) table :', J(g_new));
    console.log('geoplaque + helper APRÈS (210mm) body  :', J(g_body));
    assert(
      g_new.noteW >= 500 && g_body.pages <= 10,
      `GEOPLAQUE : note pleine largeur A4, pages denses ${J(g_new)} ${J(g_body)}`,
    );
    // FIGURE présente = SVG inline (design-sûr, sealable) — jamais une URI data: brute.
    assert(/<svg/i.test(gPrint), 'GEOPLAQUE : figure SVG absente de la note');
    assert(
      !/src\s*=\s*["']?\s*data:/i.test(gPrint),
      'GEOPLAQUE : figure canvas brute (URI data:) — non sealable',
    );
    // Fidélité (task c) + §8 (task a) : table des couples présente, aucune localisation *At.
    assert(
      gPrint.includes('Tassement différentiel entre charges voisines'),
      'GEOPLAQUE : table complète des couples absente (fidélité task c)',
    );
    assert(
      !/—\s*en\s*\(/.test(gPrint),
      'GEOPLAQUE : localisation *At exposée (masquage §8 rompu)',
    );
    // §8 sur OCTETS RÉELS (Chromium, SVG réellement rendu) : la note scellée passe la
    // VRAIE garde serveur assertInertHtml — complémentaire du test jsdom (bytes réels).
    const gGuard = guardInert(gPrint);
    assert(
      gGuard.ok,
      `GEOPLAQUE : garde §8 REFUSE le printHtml réel (Chromium) — motif : ${gGuard.error ?? ''}`,
    );

    // ---------------- FASTLAB (PV multi-feuilles labo + classification GTR) ----------------
    // Le PV FASTLAB = feuilles d essai RENSEIGNEES + classification GTR + chrome (en-tete
    // labo, visa, fiche de synthese), assemble par markPV/buildPVChrome (client conserve).
    // §8 : resultat de labo + classe GTR = LIVRABLE public (contrat labo) — aucun masquage.
    // On prouve : largeur A4 (pas d effondrement 0-largeur), pas d explosion de pages, feuilles
    // presentes (data-tab), classification presente, AUCUNE URI data: (pas de canvas -> sealable),
    // et la garde §8 serveur ACCEPTE les octets reels.
    const lfx = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon')!;
    const lenv = runLabo(lfx.input);
    if (!lenv.ok) throw new Error('runLabo a échoué');
    const lPage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const lDrive = `(function(){writeForm(${J(lfx.input)});})()`;
    const lReady = `(function(){var r=(document.getElementById('result')||{}).innerHTML||'';return r.indexOf('classbadge')>=0;})()`;
    const lPrint = await capturePrintHtml(
      lPage,
      'apps/web/src/tools-cloned/fastlab.html',
      lenv.output,
      lDrive,
      lReady,
    );

    const l_main = await measure(lPage, lPrint, 'new', 'main#main');
    const l_body = await measure(lPage, lPrint, 'new', 'body');
    await lPage.close();

    console.log('\n=== FASTLAB (PV labo — main#main / body, pages A4) ===');
    console.log('fastlab + helper APRÈS (210mm) main :', J(l_main));
    console.log('fastlab + helper APRÈS (210mm) body :', J(l_body));
    assert(
      l_main.noteW >= 500 && l_body.pages <= 16,
      `FASTLAB : PV pleine largeur A4, pas d'explosion de pages ${J(l_main)} ${J(l_body)}`,
    );
    // Feuilles + classification presentes (le PV n est pas vide).
    assert(/data-tab="ident"/.test(lPrint), 'FASTLAB : feuille identification absente');
    assert(/data-tab="class"/.test(lPrint), 'FASTLAB : feuille classification absente');
    assert(
      /data-tab="oedo"/.test(lPrint),
      'FASTLAB : feuille renseignée (œdomètre) absente',
    );
    assert(
      lPrint.includes(lenv.output.classe.full ?? '__x__'),
      'FASTLAB : classe GTR absente de la note',
    );
    // COURBES (décision titulaire « tel quel ») : chaque figure canvas est RE-DESSINÉE en SVG
    // inline vectoriel sealable. DEMO renseigne granulo/Atterberg/Proctor/cisaillement/œdomètre.
    assert(
      !/<canvas\b/i.test(lPrint),
      'FASTLAB : <canvas> (non sealable) présent dans le PV',
    );
    assert(/<svg\b/i.test(lPrint), 'FASTLAB : aucune figure SVG dans le PV');
    for (const label of [
      'Courbe granulométrique',
      'Courbe de liquidité (Atterberg)',
      'Diagramme de plasticité (Casagrande)',
      'Courbe Proctor',
      'Enveloppe de cisaillement (c′/φ′)',
      'Courbe œdométrique',
    ]) {
      assert(
        lPrint.includes(`aria-label="${label}"`),
        `FASTLAB : figure « ${label} » absente du PV`,
      );
    }
    assert(
      !/src\s*=\s*["']?\s*data:/i.test(lPrint),
      'FASTLAB : URI data: (non sealable) dans le PV',
    );
    // §8 sur OCTETS RÉELS (Chromium) : la garde serveur assertInertHtml ACCEPTE le PV.
    const lGuard = guardInert(lPrint);
    assert(
      lGuard.ok,
      `FASTLAB : garde §8 REFUSE le printHtml réel (Chromium) — motif : ${lGuard.error ?? ''}`,
    );

    // ---------------- CASAGRANDE (note pieux — tous les .tabpane, NF P 94-262) ----------------
    // La note CASAGRANDE = ce que « ⎙ Imprimer la note » (window.print) produit : tous les
    // .tabpane via @media print. On prouve : largeur A4 (pas d effondrement 0-largeur), pas
    // d explosion de pages, verdict + résistances + synthèse présents, courbe charge-tassement
    // en SVG (#settle-svg) présente, AUCUN <canvas>, AUCUNE URI data: (figures sealables),
    // et la garde §8 serveur ACCEPTE les octets réels.
    const cfx = PIEUX_FIXTURES.find((f) => f.input.meth === 'pmt')!;
    const cenv = runPieux(cfx.input);
    if (!cenv.ok) throw new Error('runPieux a échoué');
    const cPage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const ci = cfx.input;
    const cg = ci.geom;
    const csec = cg.section === 'carre' ? 'carr' : cg.section;
    const cDrive =
      `(function(){` +
      `state.layers=${J(ci.layers)};state.cpt=${J(ci.cpt)};` +
      `state.meth=${J(ci.meth)};state.da=${J(ci.da)};state.sens=${J(ci.sens)};` +
      `state.section=${J(csec)};state.arm=${J(ci.beton?.arm ?? 'arme')};` +
      `state.k3=${J(ci.beton?.k3 ?? '1.0')};state.essais=${J(ci.essais)};` +
      `state.fnmode=${J(ci.frottementNegatif?.mode ?? 'auto')};` +
      `function sv(id,v){var e=document.getElementById(id);if(e)e.value=String(v);}` +
      `sv('g_B',${cg.g_B ?? 0.6});sv('g_z0',${ci.g_z0});sv('g_D',${ci.g_D});` +
      `sv('g_pieu',${ci.cat});sv('c_G',${ci.c_G});sv('c_Q',${ci.c_Q});` +
      `sv('o_nappe',${ci.o_nappe});sv('o_nprofil',${ci.o_nprofil});sv('o_surf',${ci.o_surf});` +
      `sv('grp_n',${ci.grp.grp_n});sv('grp_m',${ci.grp.grp_m});sv('grp_s',${ci.grp.grp_s});` +
      `compute();})()`;
    const cReady = `(function(){var r=(document.getElementById('res-content')||{}).innerHTML||'';return r.indexOf('Portance')>=0&&r.indexOf('Calcul en cours')<0;})()`;
    const cPrint = await capturePrintHtml(
      cPage,
      'apps/web/src/tools-cloned/casagrande.html',
      cenv.output,
      cDrive,
      cReady,
    );

    const c_main = await measure(cPage, cPrint, 'new', 'main');
    const c_body = await measure(cPage, cPrint, 'new', 'body');
    await cPage.close();

    console.log('\n=== CASAGRANDE (note pieux — main / body, pages A4) ===');
    console.log('casagrande + helper APRÈS (210mm) main :', J(c_main));
    console.log('casagrande + helper APRÈS (210mm) body :', J(c_body));
    assert(
      c_main.noteW >= 500 && c_body.pages <= 16,
      `CASAGRANDE : note pleine largeur A4, pas d'explosion de pages ${J(c_main)} ${J(c_body)}`,
    );
    // Contenu de note : verdict + résistances + synthèse (la note n est pas vide).
    assert(
      /Portance vérifiée|Portance NON vérifiée/.test(cPrint),
      'CASAGRANDE : verdict de portance absent de la note',
    );
    assert(
      /Synthèse géométrique/.test(cPrint),
      'CASAGRANDE : synthèse géométrique absente',
    );
    assert(/Résistances/.test(cPrint), 'CASAGRANDE : tableau des résistances absent');
    // Courbe charge-tassement : SVG inline #settle-svg avec un <path> vectoriel (pas un canvas).
    assert(/id="settle-svg"/.test(cPrint), 'CASAGRANDE : #settle-svg absent de la note');
    assert(/<svg\b/i.test(cPrint), 'CASAGRANDE : aucune figure SVG dans la note');
    assert(
      !/<canvas\b/i.test(cPrint),
      'CASAGRANDE : <canvas> (non sealable) présent dans la note',
    );
    assert(
      !/src\s*=\s*["']?\s*data:/i.test(cPrint),
      'CASAGRANDE : URI data: (non sealable) dans la note',
    );
    // §8 sur OCTETS RÉELS (Chromium) : la garde serveur assertInertHtml ACCEPTE la note.
    const cGuard = guardInert(cPrint);
    assert(
      cGuard.ok,
      `CASAGRANDE : garde §8 REFUSE le printHtml réel (Chromium) — motif : ${cGuard.error ?? ''}`,
    );

    // ---------------- PRESSIOPRO (note pressiométrique — toutes les pages .pg) ----------------
    // La note PressioPro = ce que « Imprimer / PDF » (window.print) produit : TOUTES les
    // pages .pg via @media print. On prouve : largeur A4 (pas d'effondrement 0-largeur), pas
    // d'explosion de pages, KPI de dépouillement présents (E_M + catégorie), courbe P-V
    // redessinée en SVG inline (chartPV), AUCUN <canvas>, AUCUNE figure rasterisée (src=data:),
    // et la garde §8 serveur ACCEPTE les octets réels.
    const pfx = PRESSIOMETRE_FIXTURES.find((f) => f.id === 'demo-4m-seuils-manuels')!;
    const penv = runPressiometre(pfx.input);
    if (!penv.ok) throw new Error('runPressiometre a échoué');
    const pPage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const pi = pfx.input;
    const pParams = pi.params;
    const pDrive =
      `(function(){window.applyData({` +
      `projet:{projet:'Sondage démo',sondage:'BH-DEMO',a:String(${pParams.a * 10}),` +
      `ph:String(${pParams.Ph}),pe:String(${pParams.Pe}),v0:String(${pParams.V0}),` +
      `k0:String(${pParams.k0}),gamma:String(${pi.gamma}),nappe:String(${pi.nappe})},` +
      `depths:[{label:${J(pi.label)},pf_idx:${pi.pf_idx ?? 2},plm_idx:${pi.plm_idx ?? 5},rows:${J(pi.rows)}}]});` +
      `doCalc();})()`;
    const pReady = `(function(){var r=(document.getElementById('resCont')||{}).innerHTML||'';return r.indexOf('E<sub>M</sub>')>=0&&r.indexOf('Calcul en cours')<0;})()`;
    const pPrint = await capturePrintHtml(
      pPage,
      'apps/web/src/tools-cloned/pressiopro.html',
      penv.output,
      pDrive,
      pReady,
    );

    const p_pgs = await measure(pPage, pPrint, 'new', '.pgs');
    const p_body = await measure(pPage, pPrint, 'new', 'body');
    await pPage.close();

    console.log('\n=== PRESSIOPRO (note pressiométrique — .pgs / body, pages A4) ===');
    console.log('pressiopro + helper APRÈS (210mm) .pgs :', J(p_pgs));
    console.log('pressiopro + helper APRÈS (210mm) body :', J(p_body));
    assert(
      p_pgs.noteW >= 500 && p_body.pages <= 24,
      `PRESSIOPRO : note pleine largeur A4, pas d'explosion de pages ${J(p_pgs)} ${J(p_body)}`,
    );
    // Contenu de note : KPI de dépouillement (E_M + catégorie) — la note n'est pas vide.
    assert(
      pPrint.includes(penv.output.EM.toFixed(2)),
      'PRESSIOPRO : E_M absent de la note',
    );
    assert(
      pPrint.includes(penv.output.categorieLibelle),
      'PRESSIOPRO : catégorie absente de la note',
    );
    // Courbe P-V redessinée en SVG inline vectoriel sealable (pas un canvas).
    assert(
      /aria-label="Courbe pressiometrique P-V et fluage"/.test(pPrint),
      'PRESSIOPRO : courbe P-V (SVG) absente de la note',
    );
    assert(/<svg\b/i.test(pPrint), 'PRESSIOPRO : aucune figure SVG dans la note');
    assert(
      !/<canvas\b/i.test(pPrint),
      'PRESSIOPRO : <canvas> (non sealable) présent dans la note',
    );
    assert(
      !/src\s*=\s*["']?\s*data:/i.test(pPrint),
      'PRESSIOPRO : figure rasterisée (src=data:) dans la note',
    );
    // §8 sur OCTETS RÉELS (Chromium) : la garde serveur assertInertHtml ACCEPTE la note.
    const pGuard = guardInert(pPrint);
    assert(
      pGuard.ok,
      `PRESSIOPRO : garde §8 REFUSE le printHtml réel (Chromium) — motif : ${pGuard.error ?? ''}`,
    );

    console.log('\n=== SYNTHÈSE ASSERTIONS ===');
    results.forEach((r) => console.log('  ' + r));
    console.log(
      '\nPREUVE NAVIGATEUR : VERTE — pas de pages vierges (helper + document).',
    );
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('\nPREUVE NAVIGATEUR : ÉCHEC —', (e as Error)?.message || e);
  results.forEach((r) => console.error('  ' + r));
  process.exit(1);
});
