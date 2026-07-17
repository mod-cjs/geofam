/**
 * FIDELITE DU CLONE casagrande (ADR 0015) — le clone EXCISE (science NF P 94-262
 * supprimee : portance, frottement, tassement Frank & Zhao, beton, abaques), alimente
 * par la SORTIE SERVEUR reelle (runPieux), doit RENDRE le verdict, les resistances,
 * les verifications, le tassement ELS, le frottement negatif et la verification beton
 * FIDELEMENT — sans calcul cote navigateur et sans fuite d'intermediaire moteur.
 *
 * ARBITRE : la sortie SERVEUR (le contrat pieux est deja prouve equivalent au HTML
 * d'origine par engine.equivalence.test — arbitre module<->origine). ICI on prouve
 * que le clone RENDER la sortie serveur SANS la deformer et SANS recalculer.
 *
 * DEFAUT NON PIEUX : les intermediaires publies mais NON whitelistes (R_b/R_s bruts,
 * p_le et q_ce, k_p, xi3/xi4, gamma_R;d1, D_ef, frottement par couche, courbes de
 * portance/tassement/frottement negatif) restent FERMES cote clone -> « — » / placeholder
 * (regime de confidentialite actuel). Le clone est CABLE pour les consommer si le contrat
 * est elargi (courbePortance/courbeTassement/profilsDowndrag) : le dernier test le prouve
 * (wiring positif) sans que le contrat les expose aujourd'hui.
 *
 * jsdom n'implemente pas le canvas 2D : sans objet ici (les figures pieux sont en SVG,
 * rendues en innerHTML). Skip BRUYANT si le clone est absent.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM, VirtualConsole } from 'jsdom';
import { describe, expect, it } from 'vitest';

import type { PieuxInput } from './contract.js';
import {
  PIEUX_BETON_FIXTURES,
  PIEUX_DOWNDRAG_FIXTURES,
  PIEUX_FIXTURES,
} from './test-fixtures.js';

import { runPieux } from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/engines/src/pieux -> 05-Plateforme (4 niveaux).
const CLONE_PATH = resolve(HERE, '../../../../apps/web/src/tools-cloned/casagrande.html');

type Win = {
  document: Document;
  eval: (code: string) => unknown;
  dispatchEvent: (e: unknown) => boolean;
  Event: new (t: string) => unknown;
  __geofamBridge?: unknown;
  close?: () => void;
};

/** fmt du clone (fr-FR, meme Intl que jsdom) — pour comparer les valeurs AFFICHEES. */
function fmt(v: number | null, d = 0): string {
  return v == null || Number.isNaN(v)
    ? '—'
    : v.toLocaleString('fr-FR', {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });
}

/** Charge le clone dans jsdom, declenche `load` (init), renvoie la fenetre + erreurs. */
async function bootClone(): Promise<{ win: Win; errs: string[]; dom: JSDOM }> {
  const html = readFileSync(CLONE_PATH, 'utf8');
  const errs: string[] = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const m = String((e as Error).message);
    if (!/Not implemented/.test(m)) errs.push(m);
  });
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const win = dom.window as unknown as Win;
  win.dispatchEvent(new win.Event('load'));
  await new Promise((r) => setTimeout(r, 20));
  return { win, errs, dom };
}

/** Peuple `state` + les champs DOM depuis l'entree de fixture (comme la SAISIE outil). */
function setPieuxState(win: Win, input: PieuxInput): void {
  const g = input.geom;
  // section 'carre' (contrat) -> 'carr' (data-sec du HTML) pour refleter la saisie.
  const section = g.section === 'carre' ? 'carr' : g.section;
  win.eval(
    `state.layers=${JSON.stringify(input.layers)};` +
      `state.cpt=${JSON.stringify(input.cpt)};` +
      `state.meth=${JSON.stringify(input.meth)};` +
      `state.da=${JSON.stringify(input.da)};` +
      `state.sens=${JSON.stringify(input.sens)};` +
      `state.section=${JSON.stringify(section)};` +
      `state.arm=${JSON.stringify(input.beton?.arm ?? 'arme')};` +
      `state.k3=${JSON.stringify(input.beton?.k3 ?? '1.0')};` +
      `state.essais=${JSON.stringify(input.essais)};` +
      `state.fnmode=${JSON.stringify(input.frottementNegatif?.mode ?? 'auto')};`,
  );
  const setV = (id: string, v: string | number): void => {
    win.eval(
      `(function(){var el=document.getElementById(${JSON.stringify(id)});if(el)el.value=${JSON.stringify(String(v))};})()`,
    );
  };
  setV('g_B', g.g_B ?? 0.6);
  if (g.g_b2 != null) setV('g_b2', g.g_b2);
  if (g.g_Ap != null) setV('g_Ap', g.g_Ap);
  if (g.g_P != null) setV('g_P', g.g_P);
  setV('g_z0', input.g_z0);
  setV('g_D', input.g_D);
  setV('g_pieu', input.cat);
  setV('c_G', input.c_G);
  setV('c_Q', input.c_Q);
  setV('o_nappe', input.o_nappe);
  setV('o_nprofil', input.o_nprofil);
  setV('o_surf', input.o_surf);
  setV('grp_n', input.grp.grp_n);
  setV('grp_m', input.grp.grp_m);
  setV('grp_s', input.grp.grp_s);
  if (input.beton?.b_fck != null) setV('b_fck', input.beton.b_fck);
  const fn = input.frottementNegatif;
  if (fn) {
    setV('fn_Q', fn.fn_Q);
    setV('fn_ktd', fn.fn_ktd);
    setV('fn_s0', fn.fn_s0);
    setV('fn_hc', fn.fn_hc);
    setV('fn_zt', fn.fn_zt);
    setV('fn_zb', fn.fn_zb);
  }
}

/** Installe un pont qui renvoie `output` (et enregistre les params envoyes). */
function mockBridge(
  win: Win,
  output: unknown,
): { sent: () => Record<string, unknown> | null } {
  let last: Record<string, unknown> | null = null;
  win.__geofamBridge = {
    calc: (params: Record<string, unknown>) => {
      last = params;
      return Promise.resolve({ ok: true, calcResultId: 'cr-pieux-1', output });
    },
    emitPv: () => undefined,
    context: () => ({}),
  };
  return { sent: () => last };
}

const hasClone = existsSync(CLONE_PATH);
const d = hasClone ? describe : describe.skip;
if (!hasClone) {
  // eslint-disable-next-line no-console
  console.warn(
    `[clone-render] SKIP : clone absent (${CLONE_PATH}). Lancer « pnpm clone:tools ».`,
  );
}

d(
  'casagrande — fidelite du clone excise (mapping serveur -> renderers rebranchés)',
  () => {
    it('PMT nominal : rend verdict + résistances + vérifs + tassement ELS FIDÈLEMENT (résidus « — »)', async () => {
      const fx = PIEUX_FIXTURES.find((f) => f.input.meth === 'pmt');
      expect(fx).toBeDefined();
      if (!fx) return;
      const env = runPieux(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const out = env.output;

      const { win, errs } = await bootClone();
      expect(errs, errs.join('\n')).toHaveLength(0);
      const bridge = mockBridge(win, out);
      setPieuxState(win, fx.input);
      await (win.eval('compute()') as Promise<unknown>);
      await new Promise((r) => setTimeout(r, 10));

      const rc = win.document.getElementById('res-content')?.innerHTML ?? '';
      // 1. verdict + contexte (whitelistés).
      expect(rc).toContain(out.allOk ? 'Portance vérifiée' : 'Portance NON vérifiée');
      expect(rc).toContain(fmt(out.tauxGouvernant * 100, 0) + ' %');
      // 2. résistances CARACTÉRISTIQUES + CALCUL (whitelistées) FIDÈLES.
      expect(rc).toContain(fmt(out.RbK, 0));
      expect(rc).toContain(fmt(out.RsK, 0));
      expect(rc).toContain(fmt(out.RcK, 0));
      expect(rc).toContain(fmt(out.RcD / 1000, 2));
      // 3. tassement ELS (whitelisté) FIDÈLE.
      if (out.tassementELS != null)
        expect(rc).toContain(fmt(out.tassementELS, 1) + '<span class="un">mm</span>');
      // 4. paramètres envoyés = contrat (coeffs normatifs, cpt, layers).
      const sent = bridge.sent();
      expect(sent).not.toBeNull();
      const p = sent as unknown as PieuxInput;
      expect(p.coeffs.k_gG).toBe(1.35);
      expect(p.layers.length).toBe(fx.input.layers.length);
      expect(p.geom.section).toBe(fx.input.geom.section);
      // 5. RÉSIDUS FERMÉS (défaut NON) : p_le*/q_ce/k_p (qbDetail), frottement par couche,
      //    R_b/R_s bruts -> jamais affichés numériquement, table frottement vide (« — »).
      expect(rc).toContain('—');
      expect(rc).not.toContain('p_le');
      expect(rc).not.toContain('q_ce');
      // 6. aucune fuite grossière ni valeur non définie.
      expect(rc).not.toContain('undefined');
      expect(rc).not.toContain('[object Object]');
      expect(/\bNaN\b/.test(rc)).toBe(false);
      // 7. aucun symbole moteur dans le DOM rendu.
      expect(rc).not.toMatch(/portanceCore|settlement|betonCheck|kpMax|alphaPMT/);

      win.close?.();
    });

    it('CPT : rend les résultats depuis la sortie serveur (méthode pénétrométrique)', async () => {
      const fx = PIEUX_FIXTURES.find((f) => f.input.meth === 'cpt');
      expect(fx).toBeDefined();
      if (!fx) return;
      const env = runPieux(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const out = env.output;

      const { win, errs } = await bootClone();
      expect(errs, errs.join('\n')).toHaveLength(0);
      mockBridge(win, out);
      setPieuxState(win, fx.input);
      await (win.eval('compute()') as Promise<unknown>);
      await new Promise((r) => setTimeout(r, 10));

      const rc = win.document.getElementById('res-content')?.innerHTML ?? '';
      expect(rc).toContain(out.allOk ? 'Portance vérifiée' : 'Portance NON vérifiée');
      expect(rc).toContain(fmt(out.RcD / 1000, 2));
      expect(rc).not.toContain('undefined');
      expect(/\bNaN\b/.test(rc)).toBe(false);
      // le log q_c(z) (saisie) est rendu SANS overlay q_ce (excisé) — pas de fuite.
      const qc = win.document.getElementById('qclog')?.innerHTML ?? '';
      expect(qc).not.toContain('q_ce');
      win.close?.();
    });

    it('BÉTON : rend la vérification structurale (verdict + taux + f_cd whitelistés ; σ « — »)', async () => {
      const fx = PIEUX_BETON_FIXTURES.find((f) => f.input.sens === 'comp');
      expect(fx).toBeDefined();
      if (!fx) return;
      const env = runPieux(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const out = env.output;
      expect(out.betonApplicable).toBe(true);

      const { win } = await bootClone();
      mockBridge(win, out);
      setPieuxState(win, fx.input);
      await (win.eval('compute()') as Promise<unknown>);
      await new Promise((r) => setTimeout(r, 10));

      const rc = win.document.getElementById('res-content')?.innerHTML ?? '';
      expect(rc).toContain('Résistance du béton');
      if (out.betonFcd != null) expect(rc).toContain(fmt(out.betonFcd, 1) + ' MPa');
      expect(rc).toContain(
        out.betonOkELU && out.betonOkELS ? 'Béton vérifié' : 'Béton NON vérifié',
      );
      // σ appliquées non whitelistées -> « — » ; jamais les facteurs de calage.
      expect(rc).not.toMatch(/fckStar|Cmax|betonCheck/);
      expect(/\bNaN\b/.test(rc)).toBe(false);
      win.close?.();
    });

    it('FROTTEMENT NÉGATIF : rend N_max / G_sn / point neutre + profils servis (SVG, §8)', async () => {
      const fx = PIEUX_DOWNDRAG_FIXTURES.find((f) => f.input.meth === 'pmt');
      expect(fx).toBeDefined();
      if (!fx) return;
      const env = runPieux(fx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const out = env.output;
      expect(out.Nmax, 'la fixture downdrag doit produire N_max').not.toBeNull();

      const { win, errs } = await bootClone();
      expect(errs, errs.join('\n')).toHaveLength(0);
      mockBridge(win, out);
      setPieuxState(win, fx.input);
      await (win.eval('computeDowndrag()') as Promise<unknown>);
      await new Promise((r) => setTimeout(r, 10));

      const fc = win.document.getElementById('fn-content')?.innerHTML ?? '';
      expect(fc).toContain('Effort axial max');
      if (out.Nmax != null) expect(fc).toContain(fmt(out.Nmax / 1000, 2));
      if (out.Gsn != null) expect(fc).toContain(fmt(out.Gsn / 1000, 2));
      // RECLASSIFICATION §8 : les profils sont DÉSORMAIS servis (profilsDowndrag) -> wHead
      // réel affiché + SVG 3 panneaux, plus de placeholder « attente de validation ».
      expect(
        out.profilsDowndrag,
        'la fixture downdrag doit produire des profils',
      ).not.toBeNull();
      if (out.profilsDowndrag) {
        expect(fc).toContain(
          fmt(out.profilsDowndrag.wHead, 1) + '<span class="un">mm</span>',
        );
        expect(fc).toContain('<svg');
        expect(fc).not.toContain('attente de validation');
      }
      expect(fc).not.toContain('undefined');
      expect(/\bNaN\b/.test(fc)).toBe(false);
      win.close?.();
    });

    it('CHEMIN RÉEL (élargissement §8) : les courbes SERVEUR allument les 3 figures (SVG, vraies valeurs)', async () => {
      // Ancien test WIRING (sortie synthétique) -> désormais CHEMIN RÉEL : le contrat est
      // élargi, `runPieux` produit courbePortance/courbeTassement/profilsDowndrag pour de
      // bon. Le clone les REND en SVG avec les VRAIES valeurs du moteur (plus de placeholder).
      const fx =
        PIEUX_DOWNDRAG_FIXTURES.find((f) => f.input.meth === 'pmt' && !f.horsDomaine) ??
        PIEUX_DOWNDRAG_FIXTURES[0]!;
      const base = runPieux(fx.input);
      expect(base.ok).toBe(true);
      if (!base.ok) return;
      const out = base.output;
      // Précondition (anti test creux) : le contrat élargi expose bien les 3 séries RÉELLES.
      expect(out.courbePortance, 'courbePortance doit être servie').not.toBeNull();
      expect(out.courbeTassement, 'courbeTassement doit être servie').not.toBeNull();
      expect(out.profilsDowndrag, 'profilsDowndrag doit être servie').not.toBeNull();
      // Ré-échantillonnage serveur à grille FIXE (48 pts) découplée de la résolution interne.
      expect(out.courbePortance!.rows.length).toBe(48);
      expect(out.courbeTassement!.pts.length).toBe(48);

      const { win } = await bootClone();
      mockBridge(win, out);
      setPieuxState(win, fx.input);
      await (win.eval('compute()') as Promise<unknown>);
      await (win.eval('computeDowndrag()') as Promise<unknown>);
      await new Promise((r) => setTimeout(r, 10));

      const rc = win.document.getElementById('res-content')?.innerHTML ?? '';
      // Courbe de portance servie -> SVG rendu (plus de placeholder).
      expect(rc).toContain('Courbe de portance avec la profondeur');
      expect(rc).toContain('<svg');
      // Courbe charge-tassement servie -> SVG dans #settle-svg (vraies valeurs).
      const settle = win.document.getElementById('settle-svg')?.innerHTML ?? '';
      expect(settle).toContain('<path');
      expect(settle).toContain('mm');
      // Profils downdrag servis -> wHead RÉEL affiché + SVG 3 panneaux, plus de placeholder.
      const fc = win.document.getElementById('fn-content')?.innerHTML ?? '';
      expect(fc).toContain(
        fmt(out.profilsDowndrag!.wHead, 1) + '<span class="un">mm</span>',
      );
      expect(fc).toContain('<svg');
      expect(fc).not.toContain('attente de validation');
      // Aucune fuite grossière ni NaN sur les 3 figures rendues.
      expect(/\bNaN\b/.test(rc + settle + fc)).toBe(false);
      expect((rc + fc).includes('undefined')).toBe(false);
      win.close?.();
    });

    it('NO-CALC-INITIAL : un profil vide (aucune couche) NE sollicite PAS le serveur', async () => {
      const { win } = await bootClone();
      let calls = 0;
      win.__geofamBridge = {
        calc: () => {
          calls += 1;
          return Promise.resolve({ ok: true, output: {} });
        },
        emitPv: () => undefined,
        context: () => ({}),
      };
      // init() démarre à VIDE (aucune couche) -> garde locale, pas d'appel serveur.
      await (win.eval('compute()') as Promise<unknown>);
      await new Promise((r) => setTimeout(r, 10));
      expect(calls).toBe(0);
      const rc = win.document.getElementById('res-content')?.innerHTML ?? '';
      expect(rc).toMatch(/Aucune couche de sol/);
      win.close?.();
    });

    it('§8 : le HTML servi ne contient AUCUN symbole moteur ni marqueur confidentiel', () => {
      const html = readFileSync(CLONE_PATH, 'utf8');
      for (const sym of [
        'portanceCore',
        'portanceCaps',
        'settlement',
        'betonCheck',
        'computeQce',
        'xiFactors',
        'qsCPT',
        'kpMax',
        'kcMax',
        'alphaPMT',
        'alphaCPT',
        'kpReduced',
        'kcReduced',
      ]) {
        expect(
          new RegExp(`(?<![\\w.$])${sym}\\s*\\(`).test(html),
          `symbole ${sym} présent`,
        ).toBe(false);
      }
      // Abaques (accès par crochet) absentes ; marqueur confidentiel jamais servi.
      expect(html).not.toMatch(
        /\bKP_MAX\b|\bKC_MAX\b|\bALPHA_PMT\b|\bQSMAX\b|\bPMT_CURVE\b/,
      );
      expect(html).not.toContain('__ROADSEN_ENGINE_CONFIDENTIAL_DO_NOT_SHIP__');
    });
  },
);
