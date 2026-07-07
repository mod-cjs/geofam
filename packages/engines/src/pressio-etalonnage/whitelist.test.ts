/**
 * WHITELIST / anti-fuite (DoD §8) du PIPELINE `runPressioEtalonnage`.
 *
 * Le calcul produit, en interne, les INTERMEDIAIRES DE REGRESSION (`pts`, `residuals`,
 * `V_pe`, `Vs_reel`) qui constituent la methode. Ce test cible le PIPELINE (index.ts) : la
 * PROJECTION `runPressioEtalonnage` ne laisse passer QUE les coefficients + verdicts
 * (Vs/Pe/a/R²/RMS), jamais un intermediaire, meme si le resultat brut `e` en regorge.
 *
 * Le test MORD : (1) sur fixtures REELLES, aucune cle hors whitelist ne sort ; (2) un `e`
 * MOCKE porteur d'intermediaires -> ces cles sont ABSENTES de la sortie (preuve que la
 * projection construit champ a champ, ne spread pas le brut) ; (3) l'entree < 3 points est
 * REJETEE (fail-closed) — aucune sortie de zeros scellable.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as EngineModule from './engine.js';
import { PRESSIO_ETALONNAGE_FIXTURES } from './test-fixtures.js';

import { PressioEtalonnageInputSchema, runPressioEtalonnage } from './index.js';

/** Cles AUTORISEES en sortie (coefficients d'appareillage + verdicts). */
const ALLOWED = new Set(['Vs', 'Pe', 'a', 'R2', 'rms']);

/** Intermediaires de regression qui NE doivent JAMAIS sortir. */
const FORBIDDEN = ['pts', 'residuals', 'V_pe', 'Vs_reel', 'rmsError'];

describe('pressio-etalonnage — whitelist de sortie (aucun intermediaire ne fuit)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('./engine.js');
  });

  it('sur TOUTES les fixtures reelles : la sortie ne contient QUE des cles whitelistees', () => {
    expect(PRESSIO_ETALONNAGE_FIXTURES.length).toBeGreaterThan(0);
    let checked = 0;
    for (const fx of PRESSIO_ETALONNAGE_FIXTURES) {
      // Fixtures INVALIDES par conception (< 3 points) : le contrat DOIT les rejeter.
      if (!PressioEtalonnageInputSchema.safeParse(fx.input).success) {
        expect(
          () => runPressioEtalonnage(fx.input),
          `${fx.id} (invalide) doit etre rejete`,
        ).toThrow();
        continue;
      }
      const env = runPressioEtalonnage(fx.input);
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

  it('MORD : un `e` MOCKE porteur d intermediaires -> ces cles sont STRIPPEES', async () => {
    vi.resetModules();
    vi.doMock('./engine.js', async () => {
      const actual = await vi.importActual<typeof EngineModule>('./engine.js');
      return {
        ...actual,
        // Resultat VALIDE (coefficients) + intermediaires INTERDITS : si la projection
        // faisait un spread, ils fuiteraient.
        computeEtalonnage: () => ({
          a: 30,
          Vs: 200,
          Pe: 1.5,
          R2: 0.999,
          rmsError: 0.12,
          pts: [{ p: 0, v: 200 }],
          residuals: [{ p: 0, v: 200, vhat: 200, res: 0 }],
          V_pe: 240,
          Vs_reel: 200,
        }),
      };
    });
    const { runPressioEtalonnage: runMocked } = await import('./index.js');
    const fx0 = PRESSIO_ETALONNAGE_FIXTURES[0];
    expect(fx0).toBeDefined();
    if (!fx0) return;
    const env = runMocked(fx0.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const serial = JSON.stringify(env.output);
    for (const f of FORBIDDEN) {
      expect(serial, `fuite de « ${f} »`).not.toContain(`"${f}"`);
    }
    // Les coefficients, eux, sont bien la et corrects (rmsError -> rms).
    expect(env.output.Vs).toBe(200);
    expect(env.output.Pe).toBe(1.5);
    expect(env.output.a).toBe(30);
    expect(env.output.rms).toBe(0.12);
  });
});
