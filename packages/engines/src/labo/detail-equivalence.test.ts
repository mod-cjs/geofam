/**
 * EQUIVALENCE du DETAIL D'AFFICHAGE FASTLAB (#56, ADR 0015) — la sortie SERVEUR
 * (`runLabo(...).output.detail` + `.warnings`) reproduit EXACTEMENT ce que l'outil client
 * ECRIT dans son DOM : colonnes calculees par ligne (w % par prise, passant/refus cumules
 * par tamis, ρd par point Proctor, w par point d'Atterberg, M1/Mb/VBS par essai) et les
 * alertes normatives par feuille.
 *
 * ARBITRE = le HTML d'origine gele lui-meme (jsdom) : on remplit le formulaire via
 * `writeForm(input)` (chemin UI canonique) puis on LIT le texte rendu des cellules, et on
 * le compare a la valeur serveur FORMATEE A L'IDENTIQUE (toFixed du HTML). AUCUNE
 * auto-reference : la reference est le DOM du client, pas une re-derivation cote test.
 *
 * Ce test MORD : si la projection `detail` derivait de ce que le client affiche (mauvais
 * arrondi, mauvaise ligne, valeur manquante), il devient ROUGE. Il prouve aussi que le
 * `warnings: []` FIGE est leve (les encarts normatifs remontent du serveur).
 *
 * @science-unsigned. GATE LOCAL : source gelee hors depot -> SKIP BRUYANT (jamais faux-vert).
 */
import { readFileSync } from 'node:fs';

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { laboSourceAvailable, laboSourcePath } from './equivalence-harness.js';
import { LABO_FIXTURES } from './test-fixtures.js';

import { runLabo } from './index.js';

const SOURCE_OK = laboSourceAvailable();

/** Charge le HTML gele dans jsdom, canvas NEUTRALISE (draw* = presentation pure). */
function loadDom(): JSDOM {
  const html = readFileSync(laboSourcePath(), 'utf8');
  return new JSDOM(html, {
    runScripts: 'dangerously',
    beforeParse(window: {
      structuredClone?: unknown;
      HTMLCanvasElement?: { prototype: { getContext: unknown } };
    }) {
      if (typeof window.structuredClone !== 'function') {
        window.structuredClone = (v: unknown) => JSON.parse(JSON.stringify(v));
      }
      // getContext -> proxy no-op : les draw* du HTML tracent des SERIES (presentation),
      // aucun effet sur les cellules de texte qu'on compare. Sans lui, drawGran crashe.
      const noop: unknown = new Proxy(function () {}, {
        get: () => () => noop,
        apply: () => noop,
      });
      if (window.HTMLCanvasElement) {
        window.HTMLCanvasElement.prototype.getContext = () => noop;
      }
    },
  });
}

/** Applique un input via le chemin UI canonique (writeForm : reset + set + toggles + recalc). */
function drive(dom: JSDOM, input: unknown): void {
  const win = dom.window as unknown as { eval: (c: string) => unknown };
  win.eval(`writeForm(${JSON.stringify(input)});`);
}

/** Texte rendu d'une cellule par id, normalise. */
function cellById(dom: JSDOM, id: string): string {
  const el = dom.window.document.getElementById(id);
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}
/** Texte rendu d'une cellule par selecteur (querySelector), normalise. */
function cellBySel(dom: JSDOM, sel: string): string {
  const el = dom.window.document.querySelector(sel);
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}
/** Formate une valeur serveur COMME le HTML : `null -> '—'`, sinon `toFixed(d)`. */
function fmt(v: number | null | undefined, d: number): string {
  return v == null || !Number.isFinite(v) ? '—' : (v as number).toFixed(d);
}

const d = SOURCE_OK ? describe : describe.skip;
if (!SOURCE_OK) {
  // eslint-disable-next-line no-console
  console.warn(
    '[detail-equivalence] SKIP : source FASTLAB7.html absente (gate LOCAL). Ce skip n est PAS un succes.',
  );
}

d(
  'labo — equivalence du DETAIL d affichage (serveur detail/warnings <-> DOM client)',
  () => {
    it('DEMO A2 : colonnes par ligne (w / granulo / Atterberg / VBS / Proctor) == DOM client', async () => {
      const fx = LABO_FIXTURES.find((f) => f.id === 'demo-A2-limon');
      expect(fx, 'fixture demo-A2-limon absente').toBeDefined();
      if (!fx) return;

      const env = runLabo(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const det = env.output.detail;
      expect(det, 'detail serveur absent').not.toBeNull();
      if (!det) return;

      const dom = loadDom();
      drive(dom, fx.input);

      // Garde anti faux-vert : le DEMO DOIT rendre de vraies valeurs (pas que des « — »).
      expect(cellById(dom, 'w_r1'), 'DOM w_r1 vide (rendu casse ?)').not.toBe('—');
      expect(cellById(dom, 'pr_rd1'), 'DOM pr_rd1 vide (rendu casse ?)').not.toBe('—');

      // 1. Teneur en eau — $('w_r'+i) = w.toFixed(2).
      expect(det.w, 'detail.w absent').toBeDefined();
      for (let i = 1; i <= 3; i++) {
        expect(fmt(det.w?.rows[i - 1], 2), `w_r${i}`).toBe(cellById(dom, `w_r${i}`));
      }

      // 2. Granulometrie — passant cumule par tamis .gr_pass[data-s] = pass.toFixed(1).
      expect(det.gran, 'detail.gran absent').toBeDefined();
      for (const r of det.gran?.rows ?? []) {
        const sizeStr = String(r.s);
        expect(fmt(r.pass, 1), `gr_pass s=${sizeStr}`).toBe(
          cellBySel(dom, `.gr_pass[data-s="${sizeStr}"]`),
        );
        expect(fmt(r.cum, 1), `gr_cum s=${sizeStr}`).toBe(
          cellBySel(dom, `.gr_cum[data-s="${sizeStr}"]`),
        );
      }

      // 3. Atterberg — w par point de liquidite $('ll_w'+i) et de plasticite $('pl_w'+i).
      expect(det.att, 'detail.att absent').toBeDefined();
      for (let i = 1; i <= 5; i++) {
        expect(fmt(det.att?.llw[i - 1], 2), `ll_w${i}`).toBe(cellById(dom, `ll_w${i}`));
      }
      for (let i = 1; i <= 2; i++) {
        expect(fmt(det.att?.plw[i - 1], 2), `pl_w${i}`).toBe(cellById(dom, `pl_w${i}`));
      }

      // 4. VBS — M1 / Mb / VBS 0/5 / VBS du sol par essai (toFixed(2)).
      expect(det.vbs, 'detail.vbs absent').toBeDefined();
      for (let i = 1; i <= 2; i++) {
        const row = det.vbs?.rows[i - 1];
        expect(fmt(row?.M1, 2), `v_M1_${i}`).toBe(cellById(dom, `v_M1_${i}`));
        expect(fmt(row?.Mb, 2), `v_Mb${i}`).toBe(cellById(dom, `v_Mb${i}`));
        expect(fmt(row?.v05, 2), `v_v05_${i}`).toBe(cellById(dom, `v_v05_${i}`));
        expect(fmt(row?.vs, 2), `v_vsol${i}`).toBe(cellById(dom, `v_vsol${i}`));
      }

      // 5. Proctor — w et ρd par point ($('pr_w'+i)=toFixed(2), $('pr_rd'+i)=toFixed(3)).
      expect(det.proctor, 'detail.proctor absent').toBeDefined();
      for (let i = 1; i <= 7; i++) {
        const row = det.proctor?.rows[i - 1];
        expect(fmt(row?.w, 2), `pr_w${i}`).toBe(cellById(dom, `pr_w${i}`));
        expect(fmt(row?.rd, 3), `pr_rd${i}`).toBe(cellById(dom, `pr_rd${i}`));
      }

      // Laisse le loadDB() async du boot (fire-and-forget) se resoudre AVANT close :
      // sinon renderDB accede a `document` apres fermeture (unhandled rejection parasite).
      await new Promise((r) => setTimeout(r, 30));
      dom.window.close();
    });

    it('Atterberg 1 point : l alerte « Controles NF P 94-051 » remonte du serveur (warnings != [])', async () => {
      const fx = LABO_FIXTURES.find((f) => f.id === 'degenere-atterberg-1-point');
      expect(fx, 'fixture degenere-atterberg-1-point absente').toBeDefined();
      if (!fx) return;

      const env = runLabo(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;

      // Le serveur remonte l encart normatif (auparavant FIGE a []).
      const attWarn = env.output.warnings.find((w) => /^Atterberg/.test(w));
      expect(attWarn, 'aucune alerte Atterberg remontee (warnings fige ?)').toBeDefined();
      expect(attWarn).toMatch(/minimum 4 requis/);
      // Et le detail porte la meme alerte + le drapeau de validite.
      expect(env.output.detail?.att?.valide).toBe(false);
      expect(env.output.detail?.att?.warns.some((w) => /minimum 4 requis/.test(w))).toBe(
        true,
      );

      // Contre-preuve cote client : l outil affiche bien l encart pour ce meme input.
      const dom = loadDom();
      drive(dom, fx.input);
      expect(cellById(dom, 'out_att')).toMatch(/Contrôles NF P 94-051/);
      // Laisse le loadDB() async du boot (fire-and-forget) se resoudre AVANT close :
      // sinon renderDB accede a `document` apres fermeture (unhandled rejection parasite).
      await new Promise((r) => setTimeout(r, 30));
      dom.window.close();
    });
  },
);
