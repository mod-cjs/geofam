/**
 * WHITELIST / anti-fuite (DoD §8) du PIPELINE `runPlaneStrain` — deformations planes.
 *
 * Le contract.test.ts prouve deja que le SCHEMA rejette une cle nodale. Ce test cible le
 * PIPELINE d'integration (index.ts) : la PROJECTION `runPlaneStrain` ne laisse passer QUE
 * les diagnostics GLOBAUX, jamais un champ NODAL (`X`/`w`/`p`/`M`/`V`) ni la TOPOLOGIE
 * (`nn`/`dx`/`EI`/`iters`), meme si le resultat brut `R` en regorge.
 *
 * Le test MORD : (1) sur fixtures REELLES, aucune cle hors whitelist ne sort ; (2) un `R`
 * MOCKE porteur de cles interdites -> ces cles sont ABSENTES de la sortie (preuve que la
 * projection construit champ a champ, ne spread pas le brut) ; (3) canal texte redacte
 * fail-closed. Un `expect` deviendrait ROUGE si on ajoutait une cle interdite au schema
 * ou si on remplacait la construction champ-a-champ par un spread.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as EngineModule from './engine.js';
import { PLANE_STRAIN_FIXTURES } from './test-fixtures.js';

import { PlaneStrainInputSchema, runPlaneStrain } from './index.js';

/** Cles AUTORISEES en sortie (= RadierOutputSchema-frere : diagnostics globaux). */
const ALLOWED = new Set([
  'erreur',
  'warnings',
  'wMax',
  'wMin',
  'diff',
  'mMax',
  'mMin',
  'pMax',
  'totalLoad',
  'sumReact',
  'z0',
  'decolN',
]);

/** Cles NODALES / de TOPOLOGIE qui NE doivent JAMAIS sortir. */
const FORBIDDEN = ['X', 'w', 'p', 'M', 'V', 'nn', 'dx', 'EI', 'iters'];

describe('plane-strain — whitelist de sortie (aucun champ nodal/maillage ne fuit)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('./engine.js');
  });

  it('sur TOUTES les fixtures reelles : la sortie ne contient QUE des cles whitelistees', () => {
    expect(PLANE_STRAIN_FIXTURES.length).toBeGreaterThan(0);
    let checked = 0;
    for (const fx of PLANE_STRAIN_FIXTURES) {
      // Certaines fixtures sont INVALIDES par conception (garde : `layers` vide) — elles
      // servent l'equivalence (computeX -> {err}). Au contrat, runX doit les REJETER
      // (fail-closed). On l'ASSERTE (jamais un skip silencieux, DoD §9).
      if (!PlaneStrainInputSchema.safeParse(fx.input).success) {
        expect(() => runPlaneStrain(fx.input), `${fx.id} (invalide) doit etre rejete`).toThrow();
        continue;
      }
      const env = runPlaneStrain(fx.input);
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
    // Garantit qu'on a REELLEMENT projete des sorties (pas « 0 cas execute »).
    expect(checked).toBeGreaterThan(0);
  });

  it('MORD : un R MOCKE porteur de champs nodaux/topologie -> ces cles sont STRIPPEES', async () => {
    vi.resetModules();
    vi.doMock('./engine.js', async () => {
      const actual = await vi.importActual<typeof EngineModule>('./engine.js');
      return {
        ...actual,
        // R minimal VALIDE (diagnostics) + cles INTERDITES injectees : si la projection
        // faisait un spread, elles fuiteraient.
        computePlaneStrain: () => ({
          wMax: 3,
          wMin: 1,
          mMax: 12,
          mMin: -8,
          pMax: 120,
          totalLoad: 1000,
          sumReact: 1000,
          z0: 0.5,
          decolN: 0,
          X: [0, 1, 2],
          w: [1, 2, 3],
          p: [10, 20, 30],
          M: [1, 2, 3],
          V: [1, 2, 3],
          nn: 3,
          dx: 0.25,
          EI: 4200,
          iters: 2,
        }),
      };
    });
    const { runPlaneStrain: runMocked } = await import('./index.js');
    const fx0 = PLANE_STRAIN_FIXTURES[0];
    expect(fx0).toBeDefined();
    if (!fx0) return;
    const env = runMocked(fx0.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const serial = JSON.stringify(env.output);
    for (const f of FORBIDDEN) {
      expect(serial, `fuite de « ${f} »`).not.toContain(`"${f}"`);
    }
    // Les diagnostics, eux, sont bien la et corrects (diff recalcule).
    expect(env.output.wMax).toBe(3);
    expect(env.output.diff).toBe(2);
    expect(env.output.decolN).toBe(0);
  });

  it('canal texte : un warning confidentiel est redacte fail-closed par runPlaneStrain', async () => {
    const FUITE = 'Interne : EI = 4200 kN·m² ; w[7] = 0,031 m au nœud.';
    vi.resetModules();
    vi.doMock('./engine.js', async () => {
      const actual = await vi.importActual<typeof EngineModule>('./engine.js');
      return {
        ...actual,
        computePlaneStrain: () => ({
          wMax: 3,
          wMin: 1,
          mMax: 0,
          mMin: 0,
          pMax: 0,
          totalLoad: 0,
          sumReact: 0,
          z0: 0,
          decolN: 0,
          warn: [FUITE],
        }),
      };
    });
    const { runPlaneStrain: runMocked } = await import('./index.js');
    const fx0 = PLANE_STRAIN_FIXTURES[0];
    if (!fx0) return;
    const env = runMocked(fx0.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const joined = env.output.warnings.join(' || ');
    // Anti faux-vert : le brut fuit bien une valeur nue.
    expect(FUITE).toMatch(/=\s*-?[0-9]/);
    // Mais nettoye : EI et w[7] masques (inconnus de l'allowlist).
    expect(joined).toMatch(/valeur confidentielle masquee/);
    expect(joined).not.toMatch(/EI\s*=\s*4200/);
    expect(joined).not.toMatch(/w\[7\]\s*=\s*0,031/);
  });
});
