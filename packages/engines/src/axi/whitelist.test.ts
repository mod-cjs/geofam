/**
 * WHITELIST / anti-fuite (DoD §8) du PIPELINE `runAxi` — axisymetrique.
 *
 * Le contract.test.ts prouve deja que le SCHEMA rejette une cle nodale. Ce test cible le
 * PIPELINE (index.ts) : la PROJECTION `runAxi` ne laisse passer QUE les diagnostics
 * GLOBAUX scalaires, jamais un champ NODAL radial (`r`/`w`/`p`/`Mr`/`Mt`) ni la
 * discretisation (`nn`/`D`/`EI`) ni `sumReact` (hors whitelist axi), meme si `R` en
 * regorge.
 *
 * Prouve aussi la DIVERGENCE fail-closed assumee : une garde/science levee (`R.err`) ne
 * produit PAS un objet de zeros « ok:true » scellable, mais une enveloppe `{ ok:false }`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as EngineModule from './engine.js';
import { AXI_FIXTURES } from './test-fixtures.js';

import { AxiInputSchema, runAxi } from './index.js';

/** Cles AUTORISEES en sortie (diagnostics globaux scalaires). */
const ALLOWED = new Set([
  'wc',
  'wEdge',
  'wMax',
  'wMin',
  'diff',
  'mrMax',
  'mtMax',
  'pMax',
  'totalLoad',
  'sumReact',
  'z0',
  // Profils radiaux re-echantillonnes (deflexion/momentR/momentT/reaction) — ADR 0014.
  'profils',
]);

/** Cles NODALES / de METHODE qui NE doivent JAMAIS sortir. `sumReact` (bilan global) est
 * desormais EXPOSE (ADR 0014) ; `EI`/`D` (rigidite) et `nn` restent la methode EF. */
const FORBIDDEN = ['r', 'w', 'p', 'Mr', 'Mt', 'nn', 'D', 'EI'];

describe('axi — whitelist de sortie (aucun champ nodal radial / methode ne fuit)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('./engine.js');
  });

  it('sur TOUTES les fixtures reelles : la sortie ne contient QUE des cles whitelistees', () => {
    expect(AXI_FIXTURES.length).toBeGreaterThan(0);
    let checked = 0;
    for (const fx of AXI_FIXTURES) {
      // Fixtures INVALIDES par conception (garde : `layers` vide) -> runX doit REJETER.
      if (!AxiInputSchema.safeParse(fx.input).success) {
        expect(() => runAxi(fx.input), `${fx.id} (invalide) doit etre rejete`).toThrow();
        continue;
      }
      const env = runAxi(fx.input);
      expect(env.ok, fx.id).toBe(true);
      if (!env.ok) continue;
      const keys = Object.keys(env.output);
      for (const k of keys) {
        expect(ALLOWED.has(k), `cle inattendue « ${k} » sur ${fx.id}`).toBe(true);
      }
      for (const f of FORBIDDEN) {
        expect(keys, `cle interdite « ${f} » sur ${fx.id}`).not.toContain(f);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('MORD : un R MOCKE porteur de champs nodaux radiaux -> ces cles sont STRIPPEES', async () => {
    vi.resetModules();
    vi.doMock('./engine.js', async () => {
      const actual = await vi.importActual<typeof EngineModule>('./engine.js');
      return {
        ...actual,
        computeAxi: () => ({
          wc: 5,
          wEdge: 2,
          wMax: 5,
          wMin: 2,
          mrMax: 10,
          mtMax: 8,
          pMax: 120,
          totalLoad: 1000,
          z0: 0,
          // Cles INTERDITES injectees.
          r: [0, 1, 2],
          w: [5, 4, 2],
          p: [10, 20, 30],
          Mr: [1, 2, 3],
          Mt: [1, 2, 3],
          nn: 3,
          D: 3.14,
          EI: 3.14,
          sumReact: 1000,
        }),
      };
    });
    const { runAxi: runMocked } = await import('./index.js');
    const fx0 = AXI_FIXTURES[0];
    expect(fx0).toBeDefined();
    if (!fx0) return;
    const env = runMocked(fx0.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const serial = JSON.stringify(env.output);
    for (const f of FORBIDDEN) {
      expect(serial, `fuite de « ${f} »`).not.toContain(`"${f}"`);
    }
    expect(env.output.wc).toBe(5);
    expect(env.output.wEdge).toBe(2);
    // sumReact (bilan global) EXPOSE (ADR 0014) ; diff derive (wMax−wMin = 5−2).
    expect(env.output.sumReact).toBe(1000);
    expect(env.output.diff).toBe(3);
  });

  it('FAIL-CLOSED : sur R.err le pipeline renvoie { ok:false } (aucun objet de zeros scellable)', async () => {
    vi.resetModules();
    vi.doMock('./engine.js', async () => {
      const actual = await vi.importActual<typeof EngineModule>('./engine.js');
      return {
        ...actual,
        computeAxi: () => ({ err: 'matrice singulière' }),
      };
    });
    const { runAxi: runMocked } = await import('./index.js');
    const fx0 = AXI_FIXTURES[0];
    if (!fx0) return;
    const env = runMocked(fx0.input);
    expect(env.ok).toBe(false);
    if (env.ok) return;
    // Enveloppe d'echec bornee : meta de version presente, aucune sortie de zeros.
    expect(env.meta.engineId).toBe('axi-plaque');
    expect((env as { output?: unknown }).output).toBeUndefined();
    // Le message d'erreur ne divulgue aucun intermediaire numerique.
    expect(JSON.stringify(env.error)).not.toMatch(/=\s*-?[0-9]/);
  });
});
