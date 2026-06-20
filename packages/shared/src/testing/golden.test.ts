/**
 * Tests du comparateur golden lui-meme.
 *
 * Un outil de test qui sert de filet de securite aux moteurs DOIT etre prouve :
 * on verifie qu il DETECTE les ecarts (echoue pour la bonne raison) et qu il
 * REFUSE l auto-reference (anti faux-vert).
 */
import { describe, expect, it } from 'vitest';

import { compareGolden } from './golden.js';

describe('compareGolden', () => {
  it('egalite stricte par defaut : meme structure -> equal', () => {
    const r = compareGolden({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } });
    expect(r.equal).toBe(true);
    expect(r.diffs).toHaveLength(0);
  });

  it('detecte un ecart numerique sous egalite stricte', () => {
    const r = compareGolden({ x: 10 }, { x: 10.0001 });
    expect(r.equal).toBe(false);
    expect(r.diffs[0]?.path).toBe('x');
  });

  it('tolerance absolue : accepte un petit ecart, refuse un grand', () => {
    expect(
      compareGolden({ x: 10 }, { x: 10.05 }, { defaultTolerance: { abs: 0.1 } }).equal,
    ).toBe(true);
    expect(
      compareGolden({ x: 10 }, { x: 10.5 }, { defaultTolerance: { abs: 0.1 } }).equal,
    ).toBe(false);
  });

  it('tolerance relative : echelle avec la grandeur attendue', () => {
    // 1% de 1000 = 10
    expect(
      compareGolden({ x: 1000 }, { x: 1009 }, { defaultTolerance: { rel: 0.01 } }).equal,
    ).toBe(true);
    expect(
      compareGolden({ x: 1000 }, { x: 1020 }, { defaultTolerance: { rel: 0.01 } }).equal,
    ).toBe(false);
  });

  it('tolerance par chemin : surcharge la tolerance par defaut', () => {
    const r = compareGolden(
      { deflexion: 100, autre: 5 },
      { deflexion: 101, autre: 5 },
      { toleranceByPath: { deflexion: { abs: 2 } } },
    );
    expect(r.equal).toBe(true);
  });

  it('NaN inattendu est un defaut, jamais tolere', () => {
    const r = compareGolden({ x: 1 }, { x: NaN }, { defaultTolerance: { abs: 1e9 } });
    expect(r.equal).toBe(false);
  });

  it('cle manquante / supplementaire est une difference', () => {
    expect(compareGolden({ a: 1, b: 2 }, { a: 1 }).equal).toBe(false);
    expect(compareGolden({ a: 1 }, { a: 1, b: 2 }).equal).toBe(false);
    // sauf si explicitement autorise
    expect(compareGolden({ a: 1 }, { a: 1, b: 2 }, { allowExtraKeys: true }).equal).toBe(
      true,
    );
  });

  it('compare les tableaux element par element (longueur incluse)', () => {
    expect(compareGolden([1, 2, 3], [1, 2, 3]).equal).toBe(true);
    expect(compareGolden([1, 2], [1, 2, 3]).equal).toBe(false);
    expect(compareGolden([1, 2, 3], [1, 9, 3]).equal).toBe(false);
  });

  it('ANTI auto-reference : refuse de comparer un objet a lui-meme', () => {
    const same = { x: 1 };
    expect(() => compareGolden(same, same)).toThrow(/MEME reference/);
  });
});
