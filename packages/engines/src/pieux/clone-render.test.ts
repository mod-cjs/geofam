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
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
const REPO = resolve(HERE, '../../../..');
const CLONE_PATH = resolve(HERE, '../../../../apps/web/src/tools-cloned/casagrande.html');
// Reference GELEE (meme fichier que la generation du clone) — arbitre clone<->client.
const REF_PATH = resolve(HERE, '../../reference/casagrande_V5.html');
// sha256 scelle au registre (fondation-profonde-pieux) — cf. TOOLS.casagrande.expectedSha256.
const REF_SHA256 = '54c5d7d4cfd0d88998b26010335c888b9361163e0eb2825814f0c6430e4d86b0';

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
      // 5. AFFICHAGE DÉTAILLÉ (whitelist élargie) branché sur les cellules d'origine —
      //    plus AUCUN « — » pour un champ que le serveur FOURNIT. Chaque valeur affichée
      //    == valeur serveur exacte (arbitre : la sortie serveur runPieux).
      // 5a. colonne « Brut R_m » : R_b et R_s bruts.
      expect(out.Rb, 'PMT nominal doit produire R_b brut').not.toBeNull();
      expect(out.Rs, 'PMT nominal doit produire R_s brut').not.toBeNull();
      if (out.Rb != null) expect(rc).toContain(fmt(out.Rb, 0));
      if (out.Rs != null) expect(rc).toContain(fmt(out.Rs, 0));
      // 5b. sous-texte KPI R_b : p_le* / k_p / k_p,max (scalaires serveur, méthode pressio).
      expect(out.ple, 'PMT -> p*le servi').not.toBeNull();
      if (out.ple != null) {
        expect(rc).toContain('p<sub>le</sub>* = ' + fmt(out.ple, 2) + ' MPa');
      }
      if (out.kfac != null) expect(rc).toContain('k<sub>p</sub> = ' + fmt(out.kfac, 2));
      if (out.kmax != null) expect(rc).toContain('k<sub>p,max</sub>=' + fmt(out.kmax, 2));
      // 5c. encart des résistances : ξ₃ / ξ₄ / γ_R;d1.
      if (out.xi3 != null) expect(rc).toContain('ξ₃ = ' + fmt(out.xi3, 2));
      if (out.xi4 != null) expect(rc).toContain('ξ₄ = ' + fmt(out.xi4, 2));
      if (out.gammaRd1 != null)
        expect(rc).toContain('γ<sub>R;d1</sub> = ' + fmt(out.gammaRd1, 2));
      // 5d. synthèse géométrique : D_ef · D_ef/B et effet de groupe C_e.
      if (out.Def != null && out.debR != null)
        expect(rc).toContain(
          fmt(out.Def, 2) + ' m · D<sub>ef</sub>/B = ' + fmt(out.debR, 1),
        );
      if (out.Ce != null)
        expect(rc).toContain(
          'Effet de groupe C<sub>e</sub></td><td class="r">' + fmt(out.Ce, 2),
        );
      // 5e. table « Frottement latéral par couche » remplie depuis fric[] (cote de couche).
      expect(out.fric, 'PMT -> fric[] servi').not.toBeNull();
      expect(rc).toContain('Frottement latéral par couche');
      if (out.fric && out.fric.length) {
        const f0 = out.fric[0]!;
        expect(rc).toContain(fmt(f0.top, 1) + ' – ' + fmt(f0.bot, 1));
      }
      // 6. OUVERTURE §8 (26/07) : R_d PAR TERME (RbD/RsD, colonne « Calcul R_d ») DÉSORMAIS
      //    affichés avec les valeurs serveur (plus de « — » divergent). RbD+RsD ≈ RcD total.
      expect(out.RbD, 'PMT compression -> RbD servi').not.toBeNull();
      expect(out.RsD, 'PMT compression -> RsD servi').not.toBeNull();
      if (out.RbD != null) expect(rc).toContain('<td class="r">' + fmt(out.RbD, 0));
      if (out.RsD != null) expect(rc).toContain('<td class="r">' + fmt(out.RsD, 0));
      // Le seul « — » légitime restant = la cellule R_d de la ligne « Charge fluage »
      // (identique au client, l.1354). Aucun symbole MOTEUR brut (underscore) ne fuit.
      expect(rc).toContain('—');
      expect(rc).not.toContain('p_le');
      expect(rc).not.toContain('q_ce');
      // 7. aucune fuite grossière ni valeur non définie.
      expect(rc).not.toContain('undefined');
      expect(rc).not.toContain('[object Object]');
      expect(/\bNaN\b/.test(rc)).toBe(false);
      // 8. aucun symbole moteur dans le DOM rendu.
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

// ===========================================================================
// CAPTURE OPTION-3 (snapshot:capture) — le pont CASAGRANDE scelle le DOCUMENT
// (la NOTE que « ⎙ Imprimer la note » produirait : tous les .tabpane, via @media
// print) APRES un calcul de portance REUSSI (garde §5). §8 (politique 26/07) : la
// note ne porte que des valeurs AFFICHEES par l'outil (rendues depuis la sortie
// serveur whitelistee) ; toutes les figures sont des <svg> INLINE (aucune
// rasterisation), l'HTML est INERTE. ZERO FAUX-VERT : sans le cablage (snapshot /
// __casagrandeCaptureSnapshot / appel en fin de compute), `caps` reste vide -> ECHEC.
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

/** Boote le clone avec un pont CAPTEUR (calc + snapshot), pilote un calcul de
 *  portance, renvoie les captures emises + la fenetre. */
async function captureNote(
  input: PieuxInput,
  output: unknown,
): Promise<{ caps: Cap[]; win: Win }> {
  const { win } = await bootClone();
  const caps: Cap[] = [];
  win.__geofamBridge = {
    calc: () => Promise.resolve({ ok: true, calcResultId: 'cap-cg-1', output }),
    emitPv: () => undefined,
    snapshot: (displayHtml: string, printHtml: string) =>
      caps.push({
        displayHtml: String(displayHtml || ''),
        printHtml: String(printHtml || ''),
      }),
    context: () => ({}),
  };
  setPieuxState(win, input);
  await (win.eval('compute()') as Promise<unknown>);
  await new Promise((r) => setTimeout(r, 15));
  return { caps, win };
}

/** Transformee EXACTE de drawSettle (clone) : chaine `d` du <path> de #settle-svg.
 *  Reproduit W/H/marges + X(F)/Y(s) a l'identique -> arbitre point par point. */
function settlePathD(
  pts: Array<{ F: number; s: number }>,
  Fmax: number,
  sEls: number,
): string {
  const W = 420,
    H = 300,
    mL = 52,
    mR = 16,
    mT = 14,
    mB = 40;
  const arrS = pts.map((p) => p.s).concat([sEls]);
  const maxS = Math.max(...arrS) * 1.1 || 10;
  const X = (f: number): number => mL + (f / Fmax) * (W - mL - mR);
  const Y = (ss: number): number => mT + (ss / maxS) * (H - mT - mB);
  return pts.map((p, k) => (k ? 'L' : 'M') + X(p.F) + ' ' + Y(p.s)).join(' ');
}

/** Extrait la chaine `d` du <path> de #settle-svg dans un HTML capture. */
function settlePathFrom(html: string): string {
  const i = html.indexOf('id="settle-svg"');
  if (i < 0) return '';
  const p = html.indexOf('<path d="', i);
  if (p < 0) return '';
  const start = p + '<path d="'.length;
  const end = html.indexOf('"', start);
  return end < 0 ? '' : html.slice(start, end);
}

/** Rend la NOTE de REFERENCE du HTML client GELE : boote la source (science REELLE,
 *  non excisee), pilote via setPieuxState + compute() LOCAL, lit res-content + la liste
 *  des .tabpane. ARBITRE d'equivalence : ce que le client aurait imprime. */
function renderReferenceNote(input: PieuxInput): {
  resContent: string;
  tabIds: string[];
} {
  const buf = readFileSync(REF_PATH);
  const actualSha = createHash('sha256').update(buf).digest('hex');
  // Le HTML teste DOIT etre la version scellee au registre (echec DUR, jamais un skip).
  expect(actualSha, 'SHA-256 reference casagrande != registre (version divergente)').toBe(
    REF_SHA256,
  );
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  const dom = new JSDOM(buf.toString('utf8'), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const win = dom.window as unknown as Win;
  win.dispatchEvent(new win.Event('load'));
  setPieuxState(win, input);
  win.eval('compute()'); // science REELLE, synchrone
  const doc = dom.window.document;
  const resContent = doc.getElementById('res-content')?.innerHTML ?? '';
  const tabIds = Array.from(doc.querySelectorAll('.tabpane'))
    .map((t) => (t as HTMLElement).id)
    .filter(Boolean)
    .sort();
  dom.window.close();
  return { resContent, tabIds };
}

const refAvailable = existsSync(REF_PATH);
const dCap = hasClone && refAvailable ? describe : describe.skip;
if (hasClone && !refAvailable) {
  // eslint-disable-next-line no-console
  console.warn(`[clone-render] capture SKIP : reference gelee absente (${REF_PATH}).`);
}

dCap(
  'casagrande — capture option-3 de la note (§8 inerte, garde §5, equivalence, courbe SVG)',
  () => {
    const pmtFx = PIEUX_FIXTURES.find((f) => f.input.meth === 'pmt')!;

    it('given un calcul de portance REUSSI, when compute() se termine, then le pont emet snapshot:capture (display + print) NON vide et auto-contenu', async () => {
      const env = runPieux(pmtFx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const { caps, win } = await captureNote(pmtFx.input, env.output);
      expect(
        caps.length,
        'aucune capture emise (cablage snapshot absent ?)',
      ).toBeGreaterThan(0);
      const cap = caps[caps.length - 1]!;
      // printHtml auto-contenu, CSS inline, contenu de note present.
      expect(cap.printHtml.length, 'printHtml vide').toBeGreaterThan(2000);
      expect(cap.printHtml, 'printHtml non auto-contenu').toContain('<!doctype html>');
      expect(cap.printHtml, 'CSS non inline').toContain('<style>');
      // La note porte le verdict + les resistances + la synthese + le sous-texte qbDetail.
      const verdict = env.output.allOk ? 'Portance vérifiée' : 'Portance NON vérifiée';
      expect(cap.printHtml, 'verdict absent de la note').toContain(verdict);
      expect(cap.printHtml, 'Rc;k absent de la note').toContain(fmt(env.output.RcK, 0));
      expect(cap.printHtml, 'synthese geometrique absente').toContain(
        'Synthèse géométrique',
      );
      expect(env.output.qbDetail, 'PMT -> qbDetail servi').not.toBeNull();
      // qbDetail est du HTML (<sub>…) : le fragment stable « p<sub>le</sub>* » figure dans la note.
      expect(cap.printHtml, 'qbDetail (detail de portance) absent').toContain(
        'p<sub>le</sub>* =',
      );
      // displayHtml auto-contenu aussi.
      expect(cap.displayHtml.length, 'displayHtml vide').toBeGreaterThan(2000);
      expect(cap.displayHtml, 'displayHtml non auto-contenu').toContain(
        '<!doctype html>',
      );
      win.close?.();
    });

    it('given le displayHtml et le printHtml REELLEMENT captures, when passes dans la VRAIE garde §8 (assertInertHtml), then ACCEPTES (aucun script/handler/URI en ligne rasterisee)', async () => {
      const env = runPieux(pmtFx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const { caps, win } = await captureNote(pmtFx.input, env.output);
      const cap = caps[caps.length - 1]!;
      // Bornes rapides sur octets REELS (les vraies garanties passent par la garde serveur).
      expect(/<script\b/i.test(cap.printHtml), 'printHtml contient <script>').toBe(false);
      expect(
        /<canvas\b/i.test(cap.printHtml),
        'printHtml contient un element de rasterisation',
      ).toBe(false);
      // Heuristique TAG-SCOPEE : un gestionnaire inline est un attribut `on…=` DANS un tag
      // ouvrant (`<el … on…=`). On evite ainsi les faux positifs sur du TEXTE (ici un
      // commentaire CSS « /* ONGLETS = */ » inline). La garde serveur (guardInert) reste
      // l'arbitre authoritatif (elle PARSE le HTML, pas une regex).
      expect(
        /<[a-zA-Z][^>]*\son\w+\s*=/i.test(cap.printHtml),
        'gestionnaire inline on…= present dans un tag',
      ).toBe(false);
      expect(
        /data:[a-z]+\//i.test(cap.printHtml),
        'URI en ligne rasterisee presente',
      ).toBe(false);
      // VRAIE garde §8 serveur sur les octets captures.
      const gPrint = guardInert(cap.printHtml);
      expect(gPrint.ok, `garde §8 REFUSE le printHtml : ${gPrint.error ?? ''}`).toBe(
        true,
      );
      const gDisp = guardInert(cap.displayHtml);
      expect(gDisp.ok, `garde §8 REFUSE le displayHtml : ${gDisp.error ?? ''}`).toBe(
        true,
      );
      win.close?.();
    });

    it('EQUIVALENCE clone<->reference client : meme jeu de feuilles + meme verdict + meme qbDetail que la note du HTML gele', async () => {
      const env = runPieux(pmtFx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const ref = renderReferenceNote(pmtFx.input);
      const { caps, win } = await captureNote(pmtFx.input, env.output);
      const cap = caps[caps.length - 1]!;
      // 1. Jeu de feuilles identique : la note du clone porte les MEMES .tabpane que le client.
      for (const id of ref.tabIds) {
        expect(cap.printHtml, `feuille ${id} absente de la note du clone`).toContain(
          `id="${id}"`,
        );
      }
      // 2. Verdict IDENTIQUE (arbitre : la sortie serveur, prouvee equivalente au HTML d'origine).
      const refVerdict = /Portance vérifiée/.test(ref.resContent)
        ? 'Portance vérifiée'
        : 'Portance NON vérifiée';
      const cloneVerdict = env.output.allOk
        ? 'Portance vérifiée'
        : 'Portance NON vérifiée';
      expect(cloneVerdict, 'verdict clone != verdict reference').toBe(refVerdict);
      expect(cap.printHtml).toContain(cloneVerdict);
      // 3. qbDetail IDENTIQUE : le serveur produit la MEME chaine narrative que renderResults
      //    du client (meme code moteur) -> equivalence forte du detail de portance affiche.
      expect(env.output.qbDetail, 'qbDetail serveur absent').not.toBeNull();
      expect(ref.resContent, 'qbDetail reference absent').toContain(env.output.qbDetail!);
      expect(cap.printHtml, 'qbDetail clone absent de la note').toContain(
        env.output.qbDetail!,
      );
      // 4. COLONNE « Calcul R_d » (R_b;d / R_s;d par terme) : plus de « — » divergent —
      //    le tableau Resistances du clone == reference client sur RbD/RsD (ouverture §8 26/07).
      expect(env.output.RbD, 'RbD serveur absent').not.toBeNull();
      expect(env.output.RsD, 'RsD serveur absent').not.toBeNull();
      const cellRbD = '<td class="r">' + fmt(env.output.RbD, 0);
      const cellRsD = '<td class="r">' + fmt(env.output.RsD, 0);
      expect(ref.resContent, 'RbD absent de la référence client').toContain(cellRbD);
      expect(ref.resContent, 'RsD absent de la référence client').toContain(cellRsD);
      expect(cap.printHtml, 'RbD absent de la note du clone').toContain(cellRbD);
      expect(cap.printHtml, 'RsD absent de la note du clone').toContain(cellRsD);
      win.close?.();
    });

    // EQUIVALENCE qbDetail sur les 3 BRANCHES de portance (anti-regression, DoD §9). qbDetail
    // interpole des grandeurs METHODE-DEPENDANTES : PMT (p*le/D_ef/kp/kp,max), CPT (q_ce + cap
    // ECRETE/D_ef/kc/kc,max), c-φ (N_q/N_c/σ′v). Le serveur produit la chaine ; le client
    // (renderResults du HTML gele) produit LA SIENNE. On prouve qu'elles sont IDENTIQUES sur
    // les 3 branches -> sentinelle : si une branche interpolait un jour un intermediaire NON
    // AFFICHE (ou divergeait du client), `ref.resContent.toContain(serveur)` ROUGIRAIT.
    for (const meth of ['pmt', 'cpt', 'cphi'] as const) {
      it(`EQUIVALENCE qbDetail branche ${meth} : chaine serveur == chaine client (HTML gele)`, async () => {
        const fx = PIEUX_FIXTURES.find(
          (f) => f.input.meth === meth && f.id.startsWith(meth),
        );
        expect(fx, `fixture ${meth} absente`).toBeDefined();
        if (!fx) return;
        const env = runPieux(fx.input);
        expect(env.ok).toBe(true);
        if (!env.ok) return;
        // Anti test creux : la branche produit bien un qbDetail non vide.
        expect(env.output.qbDetail, `qbDetail ${meth} non servi`).not.toBeNull();
        expect((env.output.qbDetail ?? '').length).toBeGreaterThan(10);
        // La chaine SERVEUR figure telle quelle dans la note du CLIENT gele (equivalence).
        const ref = renderReferenceNote(fx.input);
        expect(
          ref.resContent,
          `qbDetail ${meth} : chaine serveur absente de la note client (divergence de branche ?)`,
        ).toContain(env.output.qbDetail!);
        // ... et dans la note capturee par le clone (le clone rend bien out.qbDetail).
        const { caps, win } = await captureNote(fx.input, env.output);
        expect(
          caps[caps.length - 1]!.printHtml,
          `qbDetail ${meth} absent de la note clone`,
        ).toContain(env.output.qbDetail!);
        win.close?.();
      });
    }

    it('GARDE §5 (esprit mutation) : sur une ERREUR EN BANDE (output.erreur), AUCUNE capture n est emise', async () => {
      // runPieux encode les erreurs de garde du moteur dans output.erreur (ok reste true).
      // La note d'un document d'erreur ne doit JAMAIS etre scellee : compute() return AVANT
      // la capture. Mutation : deplacer __casagrandeCaptureSnapshot() avant ce return rend
      // ce test ROUGE.
      const base = runPieux(pmtFx.input);
      expect(base.ok).toBe(true);
      if (!base.ok) return;
      const errOutput = { ...base.output, erreur: 'La base D doit être > z₀.' };
      const { caps, win } = await captureNote(pmtFx.input, errOutput);
      expect(
        caps.length,
        'une capture a ete emise sur une erreur en bande (garde §5 KO)',
      ).toBe(0);
      // La note d'erreur EST tout de meme rendue a l'ecran (mais NON scellee).
      const rc = win.document.getElementById('res-content')?.innerHTML ?? '';
      expect(rc).toMatch(/Calcul impossible|La base D/);
      win.close?.();
    });

    it('DETERMINISTE : deux captures du MEME calcul produisent un printHtml identique (aucune horloge/hasard)', async () => {
      const env = runPieux(pmtFx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const a = await captureNote(pmtFx.input, env.output);
      const b = await captureNote(pmtFx.input, env.output);
      expect(a.caps[a.caps.length - 1]!.printHtml).toBe(
        b.caps[b.caps.length - 1]!.printHtml,
      );
      a.win.close?.();
      b.win.close?.();
    });

    it('COURBE charge-tassement : la note porte le <svg> #settle-svg avec un <path> aux coordonnees de la transformee client (donnees fideles) + sanity-mutation', async () => {
      const env = runPieux(pmtFx.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const ct = env.output.courbeTassement;
      expect(ct, 'courbeTassement servie (PMT)').not.toBeNull();
      if (!ct) return;
      const sEls = env.output.tassementELS ?? 0;
      const { caps, win } = await captureNote(pmtFx.input, env.output);
      const cap = caps[caps.length - 1]!;
      // 1. Le settle-svg est present dans la note, avec un <path> vectoriel (pas un canvas).
      expect(cap.printHtml, '#settle-svg absent de la note').toContain('id="settle-svg"');
      const dCapt = settlePathFrom(cap.printHtml);
      expect(dCapt.length, '<path> du settle-svg absent').toBeGreaterThan(20);
      // 2. DONNEES FIDELES : la chaine `d` == transformee client point par point (arbitre
      //    independant recalcule ici). Non vacue : le path reproduit EXACTEMENT la serie serveur.
      const dExpect = settlePathD(ct.pts, ct.Fmax, sEls);
      expect(dCapt, 'chaine d du settle-svg != transformee client').toBe(dExpect);
      // 3. SANITY-MUTATION : decaler la serie DEPLACE le trace (donnees reellement branchees).
      const mutated = {
        ...env.output,
        courbeTassement: {
          ...ct,
          pts: ct.pts.map((p) => ({ F: p.F, s: p.s + 10 })),
        },
      };
      const capB = await captureNote(pmtFx.input, mutated);
      const dMut = settlePathFrom(capB.caps[capB.caps.length - 1]!.printHtml);
      expect(
        dMut,
        'muter la serie n a pas deplace le trace (donnees non branchees ?)',
      ).not.toBe(dCapt);
      win.close?.();
      capB.win.close?.();
    });
  },
);
