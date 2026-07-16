/**
 * EQUIVALENCE de PROJECTION « zero ecart » (14/07) — la sortie de `runLabo` reproduit
 * ce que le client FASTLAB AFFICHE en plus des resultats : l'encart « Points a verifier »
 * (classe.caveats <- classify().warn, VERBATIM) et le readout « Nature » de l'onglet
 * Atterberg (natureLigneA, derive de wL/Ip comme calcAtt L.1058).
 *
 * L'equivalence-portage prouve deja module {D,cls} == HTML {D,cls}. Ce test prouve que la
 * projection SURFACE ces deux affichages : caveats == cls.warn (verbatim, y compris la
 * ligne C1/C2), et natureLigneA == la regle d'affichage appliquee a D.wl/D.ip.
 *
 * @science-unsigned. GATE LOCAL : source hors depot -> SKIP BRUYANT (jamais faux-vert).
 */
import { describe, expect, it } from 'vitest';

import {
  laboSourceAvailable,
  loadOriginalCompute,
  sanitizeResult,
} from './equivalence-harness.js';
import { LABO_FIXTURES } from './test-fixtures.js';

import { runLabo } from './index.js';

const SOURCE_OK = laboSourceAvailable();

/** Regle d'affichage client (calcAtt L.1058), reproduite pour l'assertion de reference. */
function refNature(wl: unknown, ip: unknown): string | null {
  if (typeof wl !== 'number' || typeof ip !== 'number') return null;
  return ip > 0.73 * (wl - 20)
    ? 'Argile (au-dessus ligne A)'
    : 'Limon / sol organique (sous ligne A)';
}

describe('labo — equivalence de PROJECTION (caveats + natureLigneA <-> HTML affiche)', () => {
  if (!SOURCE_OK) {
    const msg =
      'AVERTISSEMENT : source FASTLAB7.html ABSENTE — equivalence de projection NON ' +
      'verifiee (gate LOCAL). Ce skip n est PAS un succes.';
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`equivalence de projection NON verifiee (source absente) — ${msg}`, () => {});
    return;
  }

  const { computeHtml, cleanup } = loadOriginalCompute();
  // Fixtures qui produisent une classification (donc un encart caveats potentiel).
  const classables = LABO_FIXTURES.filter((fx) => {
    const ref = sanitizeResult(computeHtml(fx.input)) as Record<string, any>;
    return ref && ref.cls && ref.cls.code != null;
  });

  it('compare au moins 2 fixtures classables (pas de suite vide)', () => {
    expect(classables.length).toBeGreaterThanOrEqual(2);
  });

  // Anti faux-vert : au moins une fixture doit REELLEMENT porter des caveats (sinon on
  // ne prouverait la projection que sur des tableaux vides).
  it('au moins une fixture porte un encart « Points a verifier » NON vide', () => {
    const withCaveats = classables.filter((fx) => {
      const ref = sanitizeResult(computeHtml(fx.input)) as Record<string, any>;
      return Array.isArray(ref.cls.warn) && ref.cls.warn.length > 0;
    });
    expect(withCaveats.length).toBeGreaterThanOrEqual(1);
  });

  for (const fx of classables) {
    it(`[${fx.id}] caveats == cls.warn (verbatim) et natureLigneA == regle client`, () => {
      const ref = sanitizeResult(computeHtml(fx.input)) as Record<string, any>;
      const env = runLabo(fx.input);
      expect(env.ok, fx.id).toBe(true);
      if (!env.ok) return;
      const expectedCaveats: string[] = Array.isArray(ref.cls.warn) ? ref.cls.warn : [];
      expect(env.output.classe.caveats, `caveats sur ${fx.id}`).toEqual(expectedCaveats);
      expect(env.output.natureLigneA, `natureLigneA sur ${fx.id}`).toBe(
        refNature(ref.D?.wl, ref.D?.ip),
      );
    });
  }

  it('teardown jsdom', () => {
    cleanup();
    expect(true).toBe(true);
  });
});
