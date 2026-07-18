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

      // 6. Cisaillement direct (boite) — σ′v/τpic + identification ρd/e/SR par eprouvette.
      expect(det.cisail, 'detail.cisail absent').toBeDefined();
      expect(cellById(dom, 'ci_sv1'), 'DOM ci_sv1 vide').not.toBe('—');
      for (let i = 1; i <= 4; i++) {
        const row = det.cisail?.rows[i - 1];
        expect(fmt(row?.sv, 1), `ci_sv${i}`).toBe(cellById(dom, `ci_sv${i}`));
        expect(fmt(row?.tp, 1), `ci_tp${i}`).toBe(cellById(dom, `ci_tp${i}`));
        expect(fmt(row?.rd, 2), `ci_rdd${i}`).toBe(cellById(dom, `ci_rdd${i}`));
        expect(fmt(row?.e, 2), `ci_e${i}`).toBe(cellById(dom, `ci_e${i}`));
        expect(fmt(row?.sr, 2), `ci_sr${i}`).toBe(cellById(dom, `ci_sr${i}`));
      }
      expect(fmt(det.cisail?.c, 2), 'ci_res_c').toBe(cellById(dom, 'ci_res_c'));
      expect(fmt(det.cisail?.phi, 2), 'ci_res_phi').toBe(cellById(dom, 'ci_res_phi'));

      // 7. Œdometre — Hf/ε_v/e par palier ($('oe_hf'+i)=3, $('oe_ev'+i)=2, $('oe_e'+i)=3).
      expect(det.oedo, 'detail.oedo absent').toBeDefined();
      expect(cellById(dom, 'oe_e1'), 'DOM oe_e1 vide').not.toBe('—');
      for (let i = 1; i <= 12; i++) {
        const p = det.oedo?.paliers[i - 1];
        expect(fmt(p?.Hf, 3), `oe_hf${i}`).toBe(cellById(dom, `oe_hf${i}`));
        expect(fmt(p?.ev, 2), `oe_ev${i}`).toBe(cellById(dom, `oe_ev${i}`));
        expect(fmt(p?.e, 3), `oe_e${i}`).toBe(cellById(dom, `oe_e${i}`));
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

    // -----------------------------------------------------------------------
    // Essais restants (detail complet) : serveur.detail == cellules du HTML gele.
    // Chaque cas pilote le HTML d'origine via writeForm(fixture) et compare les
    // cellules par ligne, avec garde anti-« — » (le rendu DOIT produire des valeurs).
    // -----------------------------------------------------------------------

    /** Charge le HTML, pilote la fixture, renvoie { dom, det } (serveur). */
    function run(fxId: string) {
      const fx = LABO_FIXTURES.find((f) => f.id === fxId);
      expect(fx, `fixture ${fxId} absente`).toBeDefined();
      const env = runLabo(fx!.input);
      expect(env.ok).toBe(true);
      const det = env.ok ? env.output.detail : null;
      expect(det, `detail serveur absent (${fxId})`).not.toBeNull();
      const dom = loadDom();
      drive(dom, fx!.input);
      return { dom, det: det! };
    }
    async function done(dom: JSDOM): Promise<void> {
      await new Promise((r) => setTimeout(r, 30));
      dom.window.close();
    }

    it('ρs (pycnometre) : md/ρs par determination == DOM client', async () => {
      const { dom, det } = run('kernel-rhos-methodeA');
      expect(det.rhos, 'detail.rhos absent').toBeDefined();
      expect(cellById(dom, 'rs_rs1'), 'DOM rs_rs1 vide').not.toBe('—');
      for (let i = 1; i <= 3; i++) {
        const r = det.rhos?.rows[i - 1];
        expect(fmt(r?.md, 2), `rs_md${i}`).toBe(cellById(dom, `rs_md${i}`));
        expect(fmt(r?.rs, 3), `rs_rs${i}`).toBe(cellById(dom, `rs_rs${i}`));
      }
      await done(dom);
    });

    it('CBR multi-energies : ρd/compacite/gonflement/CBR 2,5-5-maxi par moule == DOM client', async () => {
      const { dom, det } = run('kernel-cbr-complet');
      expect(det.cbr, 'detail.cbr absent').toBeDefined();
      expect(cellById(dom, 'cb_maxi_0'), 'DOM cb_maxi_0 vide').not.toBe('—');
      for (let m = 0; m < 3; m++) {
        const r = det.cbr?.rows[m];
        expect(fmt(r?.dh, 3), `cb_dh${m}`).toBe(cellById(dom, `cb_dh${m}`));
        expect(fmt(r?.ds, 3), `cb_ds${m}`).toBe(cellById(dom, `cb_ds${m}`));
        expect(fmt(r?.comp, 1), `cb_comp${m}`).toBe(cellById(dom, `cb_comp${m}`));
        expect(fmt(r?.comp, 1), `cb_compf_${m}`).toBe(cellById(dom, `cb_compf_${m}`));
        expect(fmt(r?.gp, 2), `cb_gpct${m}`).toBe(cellById(dom, `cb_gpct${m}`));
        expect(fmt(r?.c25, 1), `cb_c25_${m}`).toBe(cellById(dom, `cb_c25_${m}`));
        expect(fmt(r?.c5, 1), `cb_c5_${m}`).toBe(cellById(dom, `cb_c5_${m}`));
        expect(fmt(r?.maxi, 1), `cb_maxi_${m}`).toBe(cellById(dom, `cb_maxi_${m}`));
      }
      await done(dom);
    });

    it('Cisaillement annulaire (ring) : σ′v/τ par eprouvette == DOM client', async () => {
      const { dom, det } = run('kernel-cisail-ring');
      expect(det.cisail, 'detail.cisail absent').toBeDefined();
      expect(cellById(dom, 'ci_sv1'), 'DOM ci_sv1 vide').not.toBe('—');
      for (let i = 1; i <= 4; i++) {
        const r = det.cisail?.rows[i - 1];
        expect(fmt(r?.sv, 1), `ci_sv${i}`).toBe(cellById(dom, `ci_sv${i}`));
        expect(fmt(r?.tp, 1), `ci_tp${i}`).toBe(cellById(dom, `ci_tp${i}`));
      }
      await done(dom);
    });

    it('Triaxial UU : σ1/cu par eprouvette == DOM client', async () => {
      const { dom, det } = run('tri-uu-es');
      expect(det.triuu, 'detail.triuu absent').toBeDefined();
      expect(cellById(dom, 'tu_cu_1'), 'DOM tu_cu_1 vide').not.toBe('—');
      for (let i = 1; i <= 3; i++) {
        const r = det.triuu?.rows[i - 1];
        expect(fmt(r?.s1, 0), `tu_s1_${i}`).toBe(cellById(dom, `tu_s1_${i}`));
        expect(fmt(r?.cu, 0), `tu_cu_${i}`).toBe(cellById(dom, `tu_cu_${i}`));
      }
      // Equivalent de sable (meme fixture) — SE par essai.
      expect(det.es, 'detail.es absent').toBeDefined();
      expect(cellById(dom, 'es_r1'), 'DOM es_r1 vide').not.toBe('—');
      for (let i = 1; i <= 2; i++) {
        expect(fmt(det.es?.rows[i - 1]?.se, 1), `es_r${i}`).toBe(
          cellById(dom, `es_r${i}`),
        );
      }
      await done(dom);
    });

    it('Triaxial CU/CD : s/t (Mohr) par eprouvette == DOM client', async () => {
      const { dom, det } = run('perm-tricu-divers');
      expect(det.tricu, 'detail.tricu absent').toBeDefined();
      expect(cellById(dom, 'tc_t_1'), 'DOM tc_t_1 vide').not.toBe('—');
      for (let i = 1; i <= 3; i++) {
        const r = det.tricu?.rows[i - 1];
        expect(fmt(r?.s, 0), `tc_s_${i}`).toBe(cellById(dom, `tc_s_${i}`));
        expect(fmt(r?.t, 0), `tc_t_${i}`).toBe(cellById(dom, `tc_t_${i}`));
      }
      await done(dom);
    });

    it('Fragmentation SZ + Los Angeles + Micro-Deval (norme) == DOM client', async () => {
      const { dom, det } = run('granulaire-R-LA-MDE');
      // SZ — refus/passant par tamis.
      expect(det.sz, 'detail.sz absent').toBeDefined();
      expect(cellBySel(dom, '.sz_pas[data-s="8"]'), 'DOM sz_pas vide').not.toBe('—');
      for (const r of det.sz?.rows ?? []) {
        const s = String(r.s);
        expect(fmt(r.ref, 1), `sz_ref ${s}`).toBe(
          cellBySel(dom, `.sz_ref[data-s="${s}"]`),
        );
        expect(fmt(r.pas, 1), `sz_pas ${s}`).toBe(
          cellBySel(dom, `.sz_pas[data-s="${s}"]`),
        );
      }
      // Micro-Deval norme — coefficient par eprouvette.
      expect(det.mde?.mode, 'mde mode').toBe('norme');
      expect(cellById(dom, 'md_r1'), 'DOM md_r1 vide').not.toBe('—');
      for (let i = 1; i <= 2; i++) {
        expect(fmt(det.mde?.rows?.[i - 1]?.cc, 1), `md_r${i}`).toBe(
          cellById(dom, `md_r${i}`),
        );
      }
      await done(dom);
    });

    it('Micro-Deval CAMPAGNE : pertes + CMDS/CMDE/CMD == DOM client', async () => {
      const { dom, det } = run('kernel-mde-campagne');
      expect(det.mde?.mode, 'mde mode').toBe('camp');
      expect(cellById(dom, 'mc_p0'), 'DOM mc_p0 vide').not.toBe('—');
      for (let i = 0; i < 4; i++) {
        expect(fmt(det.mde?.pertes?.[i], 1), `mc_p${i}`).toBe(cellById(dom, `mc_p${i}`));
      }
      expect(fmt(det.mde?.cmds, 1), 'mc_cmds').toBe(cellById(dom, 'mc_cmds'));
      expect(fmt(det.mde?.cmde, 1), 'mc_cmde').toBe(cellById(dom, 'mc_cmde'));
      expect(fmt(det.mde?.cmd, 2), 'mc_cmd').toBe(cellById(dom, 'mc_cmd'));
      await done(dom);
    });
  },
);
