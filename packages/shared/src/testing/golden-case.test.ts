/**
 * Tests du lecteur de cas-tests golden.
 *
 * On prouve : validation de forme (Zod), provenance OBLIGATOIRE, unicite des id,
 * et surtout le REFUS d un cas dont la provenance designe le module sous test
 * (anti auto-reference renforcee — le cœur anti faux-vert du harnais).
 */
import { describe, expect, it } from 'vitest';

import {
  assertExpectedIsComparable,
  assertProvenanceIsExternal,
  GoldenCaseSchema,
  loadGoldenCases,
} from './golden-case.js';

const casBase = {
  id: 'cas-1',
  provenance: 'STARFIRE-kit-v1',
  inputs: { charge: 100 },
  expected: { tassement: 12.3 },
};

describe('GoldenCaseSchema', () => {
  it('accepte un cas bien forme', () => {
    expect(() => GoldenCaseSchema.parse(casBase)).not.toThrow();
  });

  it('REFUSE un cas sans provenance', () => {
    const { provenance, ...sansProvenance } = casBase;
    void provenance;
    expect(() => GoldenCaseSchema.parse(sansProvenance)).toThrow();
  });

  it('REFUSE une provenance vide', () => {
    expect(() => GoldenCaseSchema.parse({ ...casBase, provenance: '' })).toThrow();
  });

  it('REFUSE une cle de tolerance inconnue (faute de frappe = faux-vert)', () => {
    expect(() =>
      GoldenCaseSchema.parse({
        ...casBase,
        // `absolute` n existe pas : devrait etre rejete (strict), sinon tolerance ignoree.
        defaultTolerance: { absolute: 0.1 },
      }),
    ).toThrow();
  });

  it('REFUSE une tolerance abs negative', () => {
    expect(() =>
      GoldenCaseSchema.parse({ ...casBase, defaultTolerance: { abs: -1 } }),
    ).toThrow();
  });
});

describe('loadGoldenCases', () => {
  it('charge une liste valide', () => {
    const cases = loadGoldenCases([casBase, { ...casBase, id: 'cas-2' }]);
    expect(cases).toHaveLength(2);
  });

  it('REFUSE des id dupliques', () => {
    expect(() => loadGoldenCases([casBase, { ...casBase }])).toThrow(/duplique/);
  });

  it('REFUSE un cas dont la provenance = le module sous test', () => {
    expect(() =>
      loadGoldenCases([{ ...casBase, provenance: 'burmister.ts' }], {
        moduleUnderTest: 'burmister.ts',
      }),
    ).toThrow(/SOUS TEST/);
  });

  it('accepte un cas dont la provenance differe du module sous test', () => {
    expect(() =>
      loadGoldenCases([casBase], { moduleUnderTest: 'burmister.ts' }),
    ).not.toThrow();
  });

  // --- C1 : anti faux-vert "expected vide" ---

  it('REFUSE un cas dont expected est un objet sans cle', () => {
    expect(() => loadGoldenCases([{ ...casBase, expected: {} }])).toThrow(
      /aucune cle|sans cle/,
    );
  });

  it('REFUSE un cas dont expected est un tableau vide', () => {
    expect(() => loadGoldenCases([{ ...casBase, expected: [] }])).toThrow(/tableau vide/);
  });

  it('REFUSE un cas dont expected est null', () => {
    expect(() => loadGoldenCases([{ ...casBase, expected: null }])).toThrow(/null/);
  });

  it('REFUSE un cas dont expected n a aucune valeur numerique comparable', () => {
    // structure non vide mais sans aucun nombre -> ne prouve aucun calcul.
    expect(() =>
      loadGoldenCases([{ ...casBase, expected: { libelle: 'ok', flag: true } }]),
    ).toThrow(/aucune valeur numerique/);
  });

  it('accepte un expected imbrique avec au moins une valeur numerique', () => {
    expect(() =>
      loadGoldenCases([{ ...casBase, expected: { bloc: { tassement: 1.2 } } }]),
    ).not.toThrow();
  });
});

describe('assertExpectedIsComparable', () => {
  it('throw sur objet vide, tableau vide, null, undefined', () => {
    expect(() => assertExpectedIsComparable({})).toThrow();
    expect(() => assertExpectedIsComparable([])).toThrow();
    expect(() => assertExpectedIsComparable(null)).toThrow();
    expect(() => assertExpectedIsComparable(undefined)).toThrow();
  });

  it('throw si aucune feuille numerique', () => {
    expect(() => assertExpectedIsComparable({ a: 'x', b: [true, 'y'] })).toThrow(
      /aucune valeur numerique/,
    );
  });

  it('NaN compte comme valeur numerique comparable (sortie legitime)', () => {
    expect(() => assertExpectedIsComparable({ x: NaN })).not.toThrow();
  });

  it('accepte une feuille numerique meme profonde', () => {
    expect(() => assertExpectedIsComparable({ a: { b: { c: 0 } } })).not.toThrow();
  });
});

describe('assertProvenanceIsExternal', () => {
  it('throw si la provenance correspond (insensible a la casse / espaces)', () => {
    expect(() => assertProvenanceIsExternal('  Burmister.TS ', 'burmister.ts')).toThrow(
      /SOUS TEST/,
    );
  });

  it('accepte une provenance externe', () => {
    expect(() =>
      assertProvenanceIsExternal('STARFIRE-kit-v1', ['burmister.ts', 'casagrande.ts']),
    ).not.toThrow();
  });

  it('ne fait rien si aucun module sous test n est declare', () => {
    expect(() => assertProvenanceIsExternal('peu-importe', undefined)).not.toThrow();
  });
});
