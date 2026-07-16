/**
 * EQUIVALENCE de PROJECTION « zero ecart » (14/07) — la sortie ELARGIE de
 * `runPressioCalibrage` reproduit ce que `renderCalibResult` du HTML AFFICHE.
 *
 * L'equivalence-portage prouve deja module `e` == HTML `e`. Ce test prouve que la
 * projection surface c0/c1/c2 et la table des residus sur les bons intermediaires :
 * residus[i]<-residuals[i] (renommage v/pc/phat/res -> p/v60Mesure/v60Ajuste/residu).
 *
 * @science-unsigned. GATE LOCAL : source hors depot -> SKIP BRUYANT (jamais faux-vert).
 */
import { describe, expect, it } from 'vitest';

import { PressioCalibrageInputSchema } from './contract.js';
import { calibrageSourceAvailable, loadOriginalCompute } from './equivalence-harness.js';
import { PRESSIO_CALIBRAGE_FIXTURES } from './test-fixtures.js';

import { runPressioCalibrage } from './index.js';

const SOURCE_OK = calibrageSourceAvailable();

describe('pressio-calibrage — equivalence de PROJECTION (sortie elargie <-> HTML affiche)', () => {
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
  const valid = PRESSIO_CALIBRAGE_FIXTURES.filter(
    (f) => PressioCalibrageInputSchema.safeParse(f.input).success,
  );

  it('compare au moins 2 fixtures valides (pas de suite vide)', () => {
    expect(valid.length).toBeGreaterThanOrEqual(2);
  });

  for (const fx of valid) {
    it(`[${fx.id}] c0/c1/c2 + residus projetes sur le bon intermediaire`, () => {
      const ref = computeHtml(fx.input) as Record<string, any>;
      if (ref.err) return;
      const env = runPressioCalibrage(fx.input);
      expect(env.ok, fx.id).toBe(true);
      if (!env.ok) return;
      const o = env.output;
      expect(o.c0, 'c0').toBeCloseTo(ref.c0, 9);
      expect(o.c1, 'c1').toBeCloseTo(ref.c1, 9);
      expect(o.c2, 'c2').toBeCloseTo(ref.c2, 9);
      expect(o.residus.length, 'residus.length').toBe(ref.residuals.length);
      o.residus.forEach((r, i) => {
        const s = ref.residuals[i]; // {v, pc, phat, res}
        expect(r.p, `residus[${i}].p`).toBeCloseTo(s.v, 9);
        expect(r.v60Mesure, `residus[${i}].v60Mesure`).toBeCloseTo(s.pc, 9);
        expect(r.v60Ajuste, `residus[${i}].v60Ajuste`).toBeCloseTo(s.phat, 9);
        expect(r.residu, `residus[${i}].residu`).toBeCloseTo(s.res, 9);
        expect(Object.keys(r).sort()).toEqual(
          ['p', 'residu', 'v60Ajuste', 'v60Mesure'].sort(),
        );
      });
    });
  }

  it('teardown jsdom', () => {
    cleanup();
    expect(true).toBe(true);
  });
});
