/**
 * EQUIVALENCE de PROJECTION « zero ecart » (decision titulaire 14/07) — la SORTIE
 * ELARGIE de `runPressiometre` reproduit EXACTEMENT ce que le HTML d'origine AFFICHE.
 *
 * L'equivalence-PORTAGE (engine.equivalence.test.ts) prouve deja que le module `_res`
 * == le `_res` du HTML sur TOUS les champs. Ce test-ci prouve la couche au-dessus : que
 * la PROJECTION (index.ts: shapeOutput) surface chaque nouveau champ AFFICHE sur le BON
 * intermediaire `_res` (pf<-Pf, pE<-pE, sigmaH0<-sigH0, volumes<-VE/V0c/Vf/VsP2V1,
 * extrapolation<-ext.recip.A/B/PLM/PLMasym/errV, synthese<-beta/mE/auto_p0I/auto_pfI,
 * courbe<-C[].pRaw/p/v60/dv + phase). Un mauvais mapping (ex. pf<-PfS au lieu de Pf)
 * FERAIT ROUGE ce test alors que l'equivalence-portage resterait verte.
 *
 * @science-unsigned — prouve le PORTAGE/PROJECTION, pas la justesse scientifique.
 * GATE LOCAL : sources moteur hors depot git -> SKIP BRUYANT (jamais un faux-vert).
 */
import { describe, expect, it, vi } from 'vitest';

import {
  loadOriginalCompute,
  pressiometreSourceAvailable,
} from './equivalence-harness.js';
import { PRESSIOMETRE_FIXTURES } from './test-fixtures.js';

import { runPressiometre } from './index.js';

const SOURCE_OK = pressiometreSourceAvailable();

/** Compare un nombre a la tolerance de portage (module et origine = meme code). */
function eqNum(actual: unknown, expected: number, path: string): void {
  expect(typeof actual === 'number', `${path} doit etre un nombre`).toBe(true);
  expect(actual as number, path).toBeCloseTo(expected, 9);
}

describe('pressiometre — equivalence de PROJECTION (sortie elargie <-> HTML affiche)', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  if (!SOURCE_OK) {
    const msg =
      'AVERTISSEMENT : source pressiometre__1_.html ABSENTE (03-Moteurs-client hors ' +
      'depot git). L equivalence de PROJECTION N A PAS ete verifiee — gate LOCAL. Ce skip ' +
      'n est PAS un succes.';
    // eslint-disable-next-line no-console -- avertissement volontaire (gate local absent)
    console.warn(msg);
    it.skip(`equivalence de projection NON verifiee (source absente) — ${msg}`, () => {});
    return;
  }

  const { computeHtml, cleanup } = loadOriginalCompute();
  const cmpFixtures = PRESSIOMETRE_FIXTURES.filter((f) => !f.horsDomaine);

  it('compare au moins 2 fixtures (pas de suite vide)', () => {
    expect(cmpFixtures.length).toBeGreaterThanOrEqual(2);
  });

  for (const fx of cmpFixtures) {
    it(`[${fx.id}] chaque champ AFFICHE est projete sur le bon _res`, () => {
      const ref = computeHtml(fx.input) as Record<string, any>;
      // Cas d'erreur du HTML : on ne compare pas (couvert ailleurs).
      if (ref.err) return;
      const env = runPressiometre(fx.input);
      expect(env.ok, fx.id).toBe(true);
      if (!env.ok) return;
      const o = env.output;

      // Scalaires de calage / contrainte / profondeur.
      eqNum(o.pf, ref.Pf, 'pf');
      eqNum(o.pE, ref.pE, 'pE');
      eqNum(o.p0, ref.p0, 'p0');
      eqNum(o.sigmaH0, ref.sigH0, 'sigmaH0');
      eqNum(o.z, ref.z, 'z');
      expect(o.categorieDescription, 'categorieDescription').toBe(ref.catDesc);

      // Volumes de reference.
      eqNum(o.volumes.vE, ref.VE, 'volumes.vE');
      eqNum(o.volumes.v0, ref.V0c, 'volumes.v0');
      eqNum(o.volumes.vf, ref.Vf, 'volumes.vf');
      eqNum(o.volumes.vLim, ref.VsP2V1, 'volumes.vLim');

      // Extrapolation courbe inverse.
      eqNum(o.extrapolation.a, ref.ext.recip.A, 'extrapolation.a');
      eqNum(o.extrapolation.b, ref.ext.recip.B, 'extrapolation.b');
      eqNum(o.extrapolation.plmVLim, ref.ext.recip.PLM, 'extrapolation.plmVLim');
      eqNum(
        o.extrapolation.plmAsymptote,
        ref.ext.recip.PLMasym,
        'extrapolation.plmAsymptote',
      );
      const refErrV = Number.isFinite(ref.ext.recip.errV) ? ref.ext.recip.errV : null;
      if (refErrV === null) expect(o.extrapolation.errV, 'errV').toBeNull();
      else eqNum(o.extrapolation.errV, refErrV, 'extrapolation.errV');

      // Synthese de plage.
      eqNum(o.synthese.beta, ref.beta, 'synthese.beta');
      eqNum(o.synthese.mE, ref.mE, 'synthese.mE');
      expect(o.synthese.plageAutoDebut, 'plageAutoDebut').toBe(ref.auto_p0I);
      expect(o.synthese.plageAutoFin, 'plageAutoFin').toBe(ref.auto_pfI);

      // Courbe corrigee : colonnes exactes + phase (verbatim client L.1255-1258).
      expect(o.courbe.length, 'courbe.length').toBe(ref.C.length);
      const p0Idx = ref.pfI as number; // _res.pfI = indice p0
      const pfIdx = ref.plmI as number; // _res.plmI = indice pf
      o.courbe.forEach((pt, i) => {
        const c = ref.C[i];
        eqNum(pt.p, c.pRaw, `courbe[${i}].p`);
        eqNum(pt.pCorr, c.p, `courbe[${i}].pCorr`);
        eqNum(pt.v60, c.v60, `courbe[${i}].v60`);
        eqNum(pt.d6030, c.dv, `courbe[${i}].d6030`);
        const expectedPhase =
          i < p0Idx ? 'Recompression' : i <= pfIdx ? 'Pseudo-élast.' : 'Plastique';
        expect(pt.phase, `courbe[${i}].phase`).toBe(expectedPhase);
        // Les colonnes NON affichees (pS net, v15/v30 corriges) ne fuient pas.
        expect(Object.keys(pt).sort()).toEqual(
          ['d6030', 'p', 'pCorr', 'phase', 'v60'].sort(),
        );
      });
    });
  }

  it('teardown jsdom', () => {
    cleanup();
    expect(true).toBe(true);
  });
});
