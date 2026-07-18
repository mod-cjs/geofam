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
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { LABO_FIXTURES } from './test-fixtures.js';

import { runLabo } from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/engines/src/labo -> 05-Plateforme (4 niveaux).
const CLONE_PATH = resolve(HERE, '../../../../apps/web/src/tools-cloned/fastlab.html');

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
