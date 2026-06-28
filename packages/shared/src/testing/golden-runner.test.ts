/**
 * Tests du runner de cas golden (entrees -> moteur -> comparaison) et des profils.
 *
 * On prouve : application d un profil (FEM), precedence cas > profil, refus
 * d auto-reference a l execution, et comparaison sur la valeur CALCULEE (pas une
 * chaine formatee).
 */
import { describe, expect, it } from 'vitest';

import type { GoldenCase } from './golden-case.js';
import { buildCompareOptions, runGoldenCase } from './golden-runner.js';
import { FEM_TOLERANCE_PROFILE, TOLERANCE_PROFILES } from './tolerance-profiles.js';

const casFem: GoldenCase = {
  id: 'fem-1',
  provenance: 'STARFIRE-kit-v1',
  inputs: { q: 200 },
  expected: { moment: 1000 },
  toleranceProfile: 'FEM',
};

describe('profils de tolerance', () => {
  it('FEM est enregistre et marque comme tel', () => {
    expect(TOLERANCE_PROFILES.FEM).toBeDefined();
    expect(FEM_TOLERANCE_PROFILE.name).toBe('FEM');
    expect(FEM_TOLERANCE_PROFILE.defaultTolerance.rel).toBeGreaterThan(0);
  });
});

describe('buildCompareOptions', () => {
  it('le cas surcharge le profil (precedence plus specifique)', () => {
    const opts = buildCompareOptions(
      { defaultTolerance: { rel: 0.05 } },
      FEM_TOLERANCE_PROFILE,
    );
    expect(opts.defaultTolerance?.rel).toBe(0.05);
  });

  it('a defaut de tolerance de cas, applique celle du profil', () => {
    const opts = buildCompareOptions({}, FEM_TOLERANCE_PROFILE);
    expect(opts.defaultTolerance?.rel).toBe(FEM_TOLERANCE_PROFILE.defaultTolerance.rel);
  });
});

describe('runGoldenCase', () => {
  it('profil FEM (rel 1%) : accepte un ecart de maillage, refuse au-dela', () => {
    // 1000 +/- 1% = +/-10
    const okProche = runGoldenCase(casFem, 'geoplaque.ts', () => ({ moment: 1008 }));
    expect(okProche.equal).toBe(true);

    const trop = runGoldenCase(casFem, 'geoplaque.ts', () => ({ moment: 1100 }));
    expect(trop.equal).toBe(false);
  });

  it('compare la valeur CALCULEE brute, pas une chaine formatee/arrondie', () => {
    // Le moteur renvoie le nombre brut 12.34 ; l affichage arrondirait a 12.3.
    // On exige l egalite stricte par defaut -> 12.34 != 12.3 -> ecart detecte.
    const cas: GoldenCase = {
      id: 'brut-1',
      provenance: 'HTML-origine',
      inputs: {},
      expected: { tassement: 12.3 },
    };
    const r = runGoldenCase(cas, 'burmister.ts', () => ({ tassement: 12.34 }));
    expect(r.equal).toBe(false);
  });

  it('REFUSE a l execution un cas dont la provenance = le module sous test', () => {
    const cas: GoldenCase = {
      id: 'auto-1',
      provenance: 'geoplaque.ts',
      inputs: {},
      expected: { x: 1 },
    };
    expect(() => runGoldenCase(cas, 'geoplaque.ts', () => ({ x: 1 }))).toThrow(
      /SOUS TEST/,
    );
  });

  it('accepte une provenance externe distincte du module sous test', () => {
    const r = runGoldenCase(casFem, 'geoplaque.ts', () => ({ moment: 1000 }));
    expect(r.equal).toBe(true);
  });

  it('moduleUnderTest est REQUIS : un appel sans cet argument ne compile pas', () => {
    // @ts-expect-error moduleUnderTest est obligatoire (2e parametre) — la garde
    // anti-auto-reference ne doit jamais etre inerte par omission (M3).
    expect(() => runGoldenCase(casFem, () => ({ moment: 1000 }))).toThrow();
  });

  it('REFUSE un cas dont expected est vide (objet sans cle) — anti faux-vert C1', () => {
    const cas: GoldenCase = {
      id: 'vide-obj-runner',
      provenance: 'STARFIRE-kit-v1',
      inputs: {},
      expected: {},
    };
    expect(() => runGoldenCase(cas, 'burmister.ts', () => ({ x: 1 }))).toThrow(
      /sans cle|aucune valeur numerique/,
    );
  });

  it('profil inconnu -> erreur explicite', () => {
    const cas: GoldenCase = {
      id: 'p-1',
      provenance: 'STARFIRE-kit-v1',
      inputs: {},
      expected: { x: 1 },
      toleranceProfile: 'INEXISTANT',
    };
    expect(() => runGoldenCase(cas, 'burmister.ts', () => ({ x: 1 }))).toThrow(/inconnu/);
  });

  it('detecte un vrai ecart (le runner echoue pour la bonne raison)', () => {
    const r = runGoldenCase(casFem, 'geoplaque.ts', () => ({ moment: 2000 }));
    expect(r.equal).toBe(false);
    expect(r.diffs[0]?.path).toBe('moment');
  });
});
