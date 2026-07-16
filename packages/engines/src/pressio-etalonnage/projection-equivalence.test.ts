/**
 * EQUIVALENCE de PROJECTION « zero ecart » (14/07) — la sortie ELARGIE de
 * `runPressioEtalonnage` reproduit ce que `renderEtalResult` du HTML AFFICHE.
 *
 * L'equivalence-portage prouve deja module `e` == HTML `e`. Ce test prouve que la
 * projection surface les grandeurs AFFICHEES sur les bons intermediaires : vsReel<-Vs_reel,
 * vPe<-V_pe, residus[i]<-residuals[i] (renommage p/v/vhat/res -> p/vMesure/vAjuste/residu).
 *
 * @science-unsigned. GATE LOCAL : source hors depot -> SKIP BRUYANT (jamais faux-vert).
 */
import { describe, expect, it } from 'vitest';

import { PressioEtalonnageInputSchema } from './contract.js';
import { etalonnageSourceAvailable, loadOriginalCompute } from './equivalence-harness.js';
import { PRESSIO_ETALONNAGE_FIXTURES } from './test-fixtures.js';

import { runPressioEtalonnage } from './index.js';

const SOURCE_OK = etalonnageSourceAvailable();

describe('pressio-etalonnage — equivalence de PROJECTION (sortie elargie <-> HTML affiche)', () => {
  if (!SOURCE_OK) {
    const msg =
      'AVERTISSEMENT : source pressiometre__1_.html ABSENTE — equivalence de projection ' +
      'NON verifiee (gate LOCAL). Ce skip n est PAS un succes.';
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`equivalence de projection NON verifiee (source absente) — ${msg}`, () => {});
    return;
  }

  const { computeHtml, cleanup } = loadOriginalCompute();
  const valid = PRESSIO_ETALONNAGE_FIXTURES.filter(
    (f) => PressioEtalonnageInputSchema.safeParse(f.input).success,
  );

  it('compare au moins 2 fixtures valides (pas de suite vide)', () => {
    expect(valid.length).toBeGreaterThanOrEqual(2);
  });

  for (const fx of valid) {
    it(`[${fx.id}] vsReel/vPe/residus projetes sur le bon intermediaire`, () => {
      const ref = computeHtml(fx.input) as Record<string, any>;
      if (ref.err) return;
      const env = runPressioEtalonnage(fx.input);
      expect(env.ok, fx.id).toBe(true);
      if (!env.ok) return;
      const o = env.output;
      expect(o.vsReel, 'vsReel').toBeCloseTo(ref.Vs_reel, 9);
      expect(o.vPe, 'vPe').toBeCloseTo(ref.V_pe, 9);
      expect(o.residus.length, 'residus.length').toBe(ref.residuals.length);
      o.residus.forEach((r, i) => {
        const s = ref.residuals[i];
        expect(r.p, `residus[${i}].p`).toBeCloseTo(s.p, 9);
        expect(r.vMesure, `residus[${i}].vMesure`).toBeCloseTo(s.v, 9);
        expect(r.vAjuste, `residus[${i}].vAjuste`).toBeCloseTo(s.vhat, 9);
        expect(r.residu, `residus[${i}].residu`).toBeCloseTo(s.res, 9);
        expect(Object.keys(r).sort()).toEqual(
          ['p', 'residu', 'vAjuste', 'vMesure'].sort(),
        );
      });
    });
  }

  it('teardown jsdom', () => {
    cleanup();
    expect(true).toBe(true);
  });
});
