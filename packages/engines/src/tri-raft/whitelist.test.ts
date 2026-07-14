/**
 * WHITELIST / anti-fuite (DoD §8) du PIPELINE `runTriRaft` — radier triangulaire (DKT).
 *
 * Le contract.test.ts prouve deja que le SCHEMA rejette une cle nodale. Ce test cible le
 * PIPELINE (index.ts) : la PROJECTION `runTriRaft` ne laisse passer QUE les diagnostics
 * GLOBAUX, jamais un champ NODAL (`w`/`p`) ni la TOPOLOGIE DE MAILLAGE (`P` = coordonnees
 * de nœuds, `tris` = connectivite, `N`/`nt` = densite de maillage), meme si `R` en
 * regorge. La reaction max est RENOMMEE (`pMax` -> `reactionMax`) : la cle brute `pMax`
 * ne doit pas non plus fuiter.
 *
 * Le test MORD : fixtures reelles + R mocke porteur de topologie + canal texte redacte.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as EngineModule from './engine.js';
import { TRI_RAFT_FIXTURES } from './test-fixtures.js';

import { TriRaftInputSchema, runTriRaft } from './index.js';

/** Cles AUTORISEES en sortie (diagnostics globaux). */
const ALLOWED = new Set([
  'erreur',
  'warnings',
  'wMax',
  'wMin',
  'diff',
  'reactionMax',
  'totalLoad',
  'sumReact',
  'nRaft',
  'z0',
  // Heatmap RE-ECHANTILLONNEE (grille ≤48×48 decouplee du maillage triangulaire) — ADR 0014.
  'champDeflexion',
]);

/** Cles NODALES / de TOPOLOGIE (et la cle brute `pMax` renommee) qui NE doivent JAMAIS sortir. */
const FORBIDDEN = ['P', 'tris', 'w', 'p', 'N', 'nt', 'pMax'];

describe('tri-raft — whitelist de sortie (aucun champ nodal/maillage triangulaire ne fuit)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('./engine.js');
  });

  it('sur TOUTES les fixtures reelles : la sortie ne contient QUE des cles whitelistees', () => {
    expect(TRI_RAFT_FIXTURES.length).toBeGreaterThan(0);
    let checked = 0;
    for (const fx of TRI_RAFT_FIXTURES) {
      // Fixtures INVALIDES par conception (garde du contrat) -> runX doit REJETER.
      if (!TriRaftInputSchema.safeParse(fx.input).success) {
        expect(
          () => runTriRaft(fx.input),
          `${fx.id} (invalide) doit etre rejete`,
        ).toThrow();
        continue;
      }
      const env = runTriRaft(fx.input);
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

  it('MORD : un R MOCKE porteur de topologie triangulaire -> ces cles sont STRIPPEES', async () => {
    vi.resetModules();
    vi.doMock('./engine.js', async () => {
      const actual = await vi.importActual<typeof EngineModule>('./engine.js');
      return {
        ...actual,
        computeTriRaft: () => ({
          wMax: 4,
          wMin: 1,
          pMax: 90,
          totalLoad: 1000,
          sumReact: 1000,
          nRaft: 1,
          z0: 0.4,
          // Cles INTERDITES injectees (champ + maillage triangulaire).
          w: [4, 3, 1],
          p: [10, 20, 30],
          P: [
            [0, 0],
            [1, 0],
            [0, 1],
          ],
          tris: [[0, 1, 2]],
          N: 3,
          nt: 1,
        }),
      };
    });
    const { runTriRaft: runMocked } = await import('./index.js');
    const fx0 = TRI_RAFT_FIXTURES[0];
    expect(fx0).toBeDefined();
    if (!fx0) return;
    const env = runMocked(fx0.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const serial = JSON.stringify(env.output);
    for (const f of FORBIDDEN) {
      expect(serial, `fuite de « ${f} »`).not.toContain(`"${f}"`);
    }
    // Diagnostics presents et corrects : reactionMax = pMax renomme, diff recalcule.
    expect(env.output.reactionMax).toBe(90);
    expect(env.output.diff).toBe(3);
    expect(env.output.nRaft).toBe(1);
  });

  it('canal texte : un warning confidentiel est redacte fail-closed par runTriRaft', async () => {
    const FUITE = 'Maillage : nt = 128 triangles ; P[3] = 0,5 m ; w[9] = 0,02 m.';
    vi.resetModules();
    vi.doMock('./engine.js', async () => {
      const actual = await vi.importActual<typeof EngineModule>('./engine.js');
      return {
        ...actual,
        computeTriRaft: () => ({
          wMax: 4,
          wMin: 1,
          pMax: 0,
          totalLoad: 0,
          sumReact: 0,
          nRaft: 1,
          z0: 0,
          warn: [FUITE],
        }),
      };
    });
    const { runTriRaft: runMocked } = await import('./index.js');
    const fx0 = TRI_RAFT_FIXTURES[0];
    if (!fx0) return;
    const env = runMocked(fx0.input);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const joined = env.output.warnings.join(' || ');
    expect(FUITE).toMatch(/=\s*-?[0-9]/); // anti faux-vert : le brut fuit
    expect(joined).toMatch(/valeur confidentielle masquee/);
    expect(joined).not.toMatch(/nt\s*=\s*128/);
    expect(joined).not.toMatch(/P\[3\]\s*=\s*0,5/);
    expect(joined).not.toMatch(/w\[9\]\s*=\s*0,02/);
  });
});
