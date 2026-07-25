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
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from '@playwright/test';

import { wrapSealedDocumentWithPvChrome } from '../apps/api/src/pv/pv-document-chrome.js';
import { runBurmister } from '../packages/engines/src/burmister/index.js';
import { BURMISTER_FIXTURES } from '../packages/engines/src/burmister/test-fixtures.js';
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
async function measure(page: Page, html: string, helper: 'old' | 'new', sel: string): Promise<Metric> {
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
  await page.evaluate(`(function(){var e=document.getElementById('__pf');if(e)e.remove();})()`);
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
    const tPrint = await capturePrintHtml(tPage, 'apps/web/src/tools-cloned/terzaghi.html', tenv.output, tDrive, tReady);

    const PIN = '#notePrint{display:block !important;width:174mm;max-width:none;margin:0 auto}';
    const tUnpinned = tPrint.replace(PIN, '#notePrint{display:block !important;margin:0 auto}');
    if (tUnpinned === tPrint) throw new Error('pin 174mm introuvable dans le printHtml Terzaghi (test caduc)');

    const t_unpin_old = await measure(tPage, tUnpinned, 'old', '.note');
    const t_unpin_new = await measure(tPage, tUnpinned, 'new', '.note');
    const t_pin_old = await measure(tPage, tPrint, 'old', '.note');
    const t_pin_new = await measure(tPage, tPrint, 'new', '.note');
    await tPage.close();

    console.log('\n=== TERZAGHI (note .note — largeur px, pages A4) ===');
    console.log('doc SANS pin + helper AVANT (width:0)  :', J(t_unpin_old), '<= BUG reproduit');
    console.log('doc SANS pin + helper APRÈS (210mm)    :', J(t_unpin_new), '<= corrigé par le helper');
    console.log('doc AVEC pin + helper AVANT (width:0)  :', J(t_pin_old), '<= corrigé par le document');
    console.log('doc AVEC pin + helper APRÈS (210mm)    :', J(t_pin_new), '<= état livré');

    assert(t_unpin_old.noteW <= 60 && t_unpin_old.pages >= 12, `Terzaghi non-corrigé s'effondre (~0px, ≥12 pages) — bug reproduit ${J(t_unpin_old)}`);
    assert(t_unpin_new.noteW >= 600 && t_unpin_new.pages <= 7, `helper corrigé sauve le doc non-piné ${J(t_unpin_new)}`);
    assert(t_pin_old.noteW >= 400 && t_pin_old.pages <= 7, `pin document tient sous helper buggé ${J(t_pin_old)}`);
    assert(t_pin_new.noteW >= 600 && t_pin_new.pages <= 7, `état livré : pleine largeur, pages denses ${J(t_pin_new)}`);

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
    const rPrint = await capturePrintHtml(rPage, 'apps/web/src/tools-cloned/roadsens.html', benv.output, rDrive, rReady);

    const r_old = await measure(rPage, rPrint, 'old', 'main.app');
    const r_new = await measure(rPage, rPrint, 'new', 'main.app');
    await rPage.close();

    console.log('\n=== ROADSENS (audit réel — main.app, pages A4) ===');
    console.log('roadsens + helper AVANT (width:0) :', J(r_old));
    console.log('roadsens + helper APRÈS (210mm)   :', J(r_new));
    const latent = r_old.noteW <= 60 || r_old.pages >= 12;
    console.log('VERDICT roadsens sous ANCIEN helper :', latent ? 'BUG LATENT (aurait produit des pages vierges)' : 'marchait (largeur non nulle)');
    assert(r_new.noteW >= 600 && r_new.pages <= 12, `helper corrigé : roadsens pleine largeur, pages raisonnables (NON-régression) ${J(r_new)}`);

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
    assert(w_note.noteW >= 600 && w_note.pages <= 8, `PV enrobé : note pleine largeur, pas d'explosion de pages ${J(w_note)}`);
    assert(w_band.noteW >= 600, `cartouche pvx-band non effondré (grille intacte) ${J(w_band)}`);

    console.log('\n=== SYNTHÈSE ASSERTIONS ===');
    results.forEach((r) => console.log('  ' + r));
    console.log('\nPREUVE NAVIGATEUR : VERTE — pas de pages vierges (helper + document).');
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('\nPREUVE NAVIGATEUR : ÉCHEC —', (e as Error)?.message || e);
  results.forEach((r) => console.error('  ' + r));
  process.exit(1);
});
