/**
 * RADIER — SORTIE PROJETEE : synthese globale (ADR 0014) + alerte overCap + anti-fuite §8.
 *
 * Trois barrieres, toutes MORDANTES :
 *   1. overCap (INTEGRITE) : quand le moteur signale un poinçonnement (`R.overCap`), la
 *      sortie porte l'avertissement CLIENT-SAFE « resultats NON VALIDES » ; sinon absent.
 *      Le FLAG est prouve EQUIVALENT a l'etat `overCap` du HTML d'origine piloté (arbitre).
 *   2. Synthese (ADR 0014) : chaque scalaire projeté (totalLoad/sumReact/txMax/tyMax/
 *      pMin/pMax/mxMax/myMax/mxyMax + conditionnels sumWink/sumSpr/decolNodes) est compare
 *      a la valeur DERIVEE du HTML d'origine (bilans + reductions min/max exactement comme
 *      le panneau « Synthese » de refreshResults). Provenance = HTML (jamais notre module).
 *   3. §8 : la sortie projetée ne contient AUCUN tableau numerique de taille maillage —
 *      seul `champDeflexion.vals` (grille d'affichage 48×48 deja actee) est admis.
 *
 * GATE LOCAL : blocs 1 & 3 s'executent SANS le HTML (runRadier pur). Le bloc 2
 * d'equivalence est gate sur la presence de la source (SKIP BRUYANT en CI — jamais un
 * faux-vert). @science-unsigned : prouve le PORTAGE, pas la justesse scientifique.
 */
import { describe, expect, it } from 'vitest';

import { loadOriginalCompute, radierSourceAvailable } from './equivalence-harness.js';
import { RADIER_FIXTURES } from './test-fixtures.js';

import { OVER_CAP_WARNING, runRadier } from './index.js';

const fx = (id: string) => {
  const f = RADIER_FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`fixture "${id}" introuvable`);
  return f;
};

/** Egalite a tolerance signee (rel + abs) — jamais un comparateur laxiste (DoD §9). */
function closeTo(actual: number, expected: number, rel = 1e-8, abs = 1e-9): boolean {
  const d = Math.abs(actual - expected);
  return d <= abs + rel * Math.abs(expected);
}

// ── Bloc 1 — overCap (INTEGRITE), SANS HTML ────────────────────────────────────────
describe('radier — overCap : avertissement d integrite (poinçonnement)', () => {
  it('given un poinçonnement (qLim insuffisant), when runRadier, then warning NON VALIDES present', () => {
    const env = runRadier(fx('qlim-overcap-poinconnement').input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.output.warnings).toContain(OVER_CAP_WARNING);
    // Message CLIENT-SAFE : aucune valeur numerique nue (pas de fuite d intermediaire).
    expect(OVER_CAP_WARNING).not.toMatch(/=\s*-?[0-9]/);
  });

  it('given un cas nominal (equilibre atteint), when runRadier, then AUCUN warning overCap', () => {
    const env = runRadier(fx('carre-charge-centree').input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.output.warnings).not.toContain(OVER_CAP_WARNING);
    expect(env.output.warnings).toEqual([]);
  });
});

// ── Bloc 3 — §8 : aucun tableau nodal de taille maillage ne fuit ────────────────────
interface FoundArray {
  path: string;
  numeric: boolean;
  length: number;
}
function collectArrays(value: unknown, path: string, acc: FoundArray[]): void {
  if (Array.isArray(value)) {
    const numeric = value.some((v) => typeof v === 'number');
    acc.push({ path, numeric, length: value.length });
    value.forEach((v, i) => collectArrays(v, `${path}[${i}]`, acc));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      collectArrays(v, path ? `${path}.${k}` : k, acc);
    }
  }
}

describe('radier — §8 : la sortie projetée ne fuit AUCUN tableau nodal de maillage', () => {
  for (const f of RADIER_FIXTURES.filter((x) => !x.horsDomaine)) {
    it(`[${f.id}] seuls warnings (strings) et champDeflexion.vals (48×48) sont des tableaux`, () => {
      const env = runRadier(f.input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const arrays: FoundArray[] = [];
      collectArrays(env.output, '', arrays);
      // Les SEULS tableaux NUMERIQUES admis sont les GRILLES d'affichage ≤48×48 (deja
      // actees) : `champDeflexion.vals` (compat) et `champs.<champ>.vals` (cartes etendues).
      const GRID_VALS = /^(champDeflexion|champs\.[A-Za-z]+)\.vals$/;
      const numeriques = arrays.filter((a) => a.numeric);
      for (const a of numeriques) {
        expect(a.path, `tableau numerique inattendu en ${a.path}`).toMatch(GRID_VALS);
        expect(a.length, `grille d affichage de taille ≤ 48×48`).toBeLessThanOrEqual(
          48 * 48,
        );
      }
      // `warnings` est un tableau de CHAINES (jamais numerique).
      const warn = arrays.find((a) => a.path === 'warnings');
      if (warn) expect(warn.numeric).toBe(false);
    });
  }
});

// ── Bloc 2 — Equivalence de la synthese vs HTML d'origine (gate local) ──────────────
const SOURCE_OK = radierSourceAvailable();

describe('radier — synthese projetée == HTML d origine (@science-unsigned)', () => {
  if (!SOURCE_OK) {
    const msg =
      '[ADR 0014] source GEOPLAQUE_V10.html ABSENTE (03-Moteurs-client hors git) : ' +
      'equivalence de la synthese NON verifiee — gate LOCAL. Ce skip n est PAS un succes.';
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`equivalence synthese NON verifiee (source absente) — ${msg}`, () => {});
    return;
  }

  const { computeHtml, cleanup } = loadOriginalCompute();

  /** Valeurs nodales HTML (typed arrays -> objets indexes apres l'aller-retour JSON). */
  const nums = (o: unknown): number[] =>
    o && typeof o === 'object'
      ? (Object.values(o as Record<string, number>) as number[])
      : [];

  // Scalaires globaux + moments/reactions extremes : au moins 3 fixtures nominales.
  for (const id of [
    'carre-charge-centree',
    'carre-quatre-poteaux',
    'rect-charge-excentree',
  ]) {
    it(`[${id}] bilans + extremes (totalLoad/sumReact/tx/ty/pMin/pMax/Mx/My/Mxy) == HTML`, () => {
      const input = fx(id).input;
      const R = computeHtml(input) as Record<string, unknown>;
      const diag = R.diag as { txMax: number; tyMax: number };
      const env = runRadier(input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const o = env.output;
      const p = nums(R.p);
      const attendu = {
        totalLoad: R.totalLoad as number,
        sumReact: R.sumReact as number,
        txMax: diag.txMax,
        tyMax: diag.tyMax,
        pMin: Math.min(...p),
        pMax: Math.max(...p),
        mxMax: Math.max(...nums(R.Mx).map(Math.abs)),
        myMax: Math.max(...nums(R.My).map(Math.abs)),
        mxyMax: Math.max(...nums(R.Mxy).map(Math.abs)),
      };
      for (const [k, v] of Object.entries(attendu)) {
        const got = (o as unknown as Record<string, number>)[k] ?? NaN;
        expect(closeTo(got, v), `${id}.${k} : module=${got} origine=${v}`).toBe(true);
      }
    });
  }

  // Conditionnel Winkler : deux fixtures winkOn -> sumWink == R.sumWink.
  for (const id of ['winkler-additionnel', 'winkler-plastification']) {
    it(`[${id}] sumWink == R.sumWink (Winkler actif)`, () => {
      const input = fx(id).input;
      const R = computeHtml(input) as Record<string, unknown>;
      const env = runRadier(input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(R.winkOn).toBe(true);
      expect(env.output.sumWink).not.toBeNull();
      expect(closeTo(env.output.sumWink as number, R.sumWink as number)).toBe(true);
      // Winkler seul -> pas de ressorts ni de decollement affiches.
      expect(env.output.sumSpr).toBeNull();
      expect(env.output.decolNodes).toBeNull();
    });
  }

  // Conditionnel ressorts : deux fixtures sprOn -> sumSpr == R.sumSpr.
  for (const id of ['charges-ligne-et-ressorts', 'ressorts-ponctuels-seuls']) {
    it(`[${id}] sumSpr == R.sumSpr (ressorts actifs)`, () => {
      const input = fx(id).input;
      const R = computeHtml(input) as Record<string, unknown>;
      const env = runRadier(input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(R.sprOn).toBe(true);
      expect(env.output.sumSpr).not.toBeNull();
      expect(closeTo(env.output.sumSpr as number, R.sumSpr as number)).toBe(true);
    });
  }

  // Conditionnel decollement : deux fixtures decol -> decolNodes == R.decolNodes (compte).
  for (const id of ['decollement', 'qlim-plastification']) {
    it(`[${id}] decolNodes == R.decolNodes (option decol active, compte seul)`, () => {
      const input = fx(id).input;
      const R = computeHtml(input) as Record<string, unknown>;
      const env = runRadier(input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.output.decolNodes).toBe(R.decolNodes);
    });
  }

  // Nominal (aucune option) : les trois conditionnels sont null (lignes omises).
  it('[carre-charge-centree] sumWink/sumSpr/decolNodes = null (aucune option active)', () => {
    const env = runRadier(fx('carre-charge-centree').input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.output.sumWink).toBeNull();
    expect(env.output.sumSpr).toBeNull();
    expect(env.output.decolNodes).toBeNull();
  });

  // Le FLAG overCap correspond a l'etat overCap du HTML piloté (arbitre d'equivalence).
  for (const id of ['qlim-overcap-poinconnement', 'carre-charge-centree']) {
    it(`[${id}] warning overCap present <=> R.overCap du HTML`, () => {
      const input = fx(id).input;
      const R = computeHtml(input) as Record<string, unknown>;
      const env = runRadier(input);
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      const flagged = env.output.warnings.includes(OVER_CAP_WARNING);
      expect(flagged).toBe(R.overCap === true);
    });
  }

  it('teardown jsdom', () => {
    cleanup();
    expect(true).toBe(true);
  });
});
