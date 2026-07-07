/**
 * WHITELIST / anti-fuite (DoD §8) du PIPELINE `runPressioCalibrage`.
 *
 * Le calcul produit, en interne, les INTERMEDIAIRES DE REGRESSION (`pts`, `residuals`) et
 * surtout les COEFFICIENTS POLYNOMIAUX `c0`/`c1`/`c2` (la courbe de calibrage = methode).
 * Ce test cible le PIPELINE (index.ts) : la PROJECTION `runPressioCalibrage` ne laisse
 * passer QUE le coefficient metier + verdicts (a/R²/RMS), jamais c0/c1/c2 ni un
 * intermediaire, meme si le resultat brut `e` en regorge.
 *
 * Le test MORD : (1) sur fixtures REELLES, aucune cle hors whitelist ne sort ; (2) un `e`
 * MOCKE porteur de c0/c1/c2 + intermediaires -> ces cles sont ABSENTES de la sortie
 * (projection champ a champ, pas de spread) ; (3) l'entree < 3 points est REJETEE.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as EngineModule from './engine.js';
import { PRESSIO_CALIBRAGE_FIXTURES } from './test-fixtures.js';

import { PressioCalibrageInputSchema, runPressioCalibrage } from './index.js';

/** Cles AUTORISEES en sortie (coefficient de calibrage + verdicts). */
const ALLOWED = new Set(['a', 'R2', 'rms']);

/** Intermediaires / coefficients de METHODE qui NE doivent JAMAIS sortir. */
const FORBIDDEN = ['pts', 'residuals', 'c0', 'c1', 'c2', 'a_calib'];

describe('pressio-calibrage — whitelist de sortie (aucun c0/c1/c2 ni intermediaire ne fuit)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('./engine.js');
  });

  it('sur TOUTES les fixtures reelles : la sortie ne contient QUE des cles whitelistees', () => {
    expect(PRESSIO_CALIBRAGE_FIXTURES.length).toBeGreaterThan(0);
    let checked = 0;
    for (const fx of PRESSIO_CALIBRAGE_FIXTURES) {
      if (!PressioCalibrageInputSchema.safeParse(fx.input).success) {
        expect(
          () => runPressioCalibrage(fx.input),
          `${fx.id} (invalide) doit etre rejete`,
        ).toThrow();
        continue;
      }
      const env = runPressioCalibrage(fx.input);
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

  it('MORD : un `e` MOCKE porteur de c0/c1/c2 + intermediaires -> ces cles sont STRIPPEES', async () => {
    vi.resetModules();
    vi.doMock('./engine.js', async () => {
      const actual = await vi.importActual<typeof EngineModule>('./engine.js');
      return {
        ...actual,
        computeCalibrage: () => ({
          a_calib: 0.42,
          R2: 0.998,
          rms: 0.05,
          c0: 0.1,
          c1: 0.4,
          c2: -0.002,
          pts: [{ p: 1, v: 1 }],
          residuals: [{ v: 1, pc: 1, phat: 1, res: 0 }],
        }),
      };
    });
    const { runPressioCalibrage: runMocked } = await import('./index.js');
    const fx0 = PRESSIO_CALIBRAGE_FIXTURES[0];
    expect(fx0).toBeDefined();
    if (!fx0) return;
    const env = runMocked(fx0.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const serial = JSON.stringify(env.output);
    for (const f of FORBIDDEN) {
      expect(serial, `fuite de « ${f} »`).not.toContain(`"${f}"`);
    }
    // Le coefficient metier (a_calib -> a) + verdicts sont bien la.
    expect(env.output.a).toBe(0.42);
    expect(env.output.R2).toBe(0.998);
    expect(env.output.rms).toBe(0.05);
  });
});
