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
    // sauf si explicitement autorise (cle EN TROP cote actual seulement)
    expect(compareGolden({ a: 1 }, { a: 1, b: 2 }, { allowExtraKeys: true }).equal).toBe(
      true,
    );
  });

  it('M1 : allowExtraKeys n autorise PAS une cle ATTENDUE manquante dans actual', () => {
    // deflexion attendue mais absente d actual -> reste une diff malgre allowExtraKeys.
    const r = compareGolden(
      { deflexion: 100, tassement: 12 },
      { deflexion: 100 },
      { allowExtraKeys: true },
    );
    expect(r.equal).toBe(false);
    expect(r.diffs.some((d) => d.path === 'tassement')).toBe(true);
    expect(r.diffs[0]?.reason).toMatch(/attendue manquante/);
  });

  it('M1 : allowExtraKeys ignore bien une cle EN TROP cote actual', () => {
    const r = compareGolden(
      { deflexion: 100 },
      { deflexion: 100, debug: 999 },
      { allowExtraKeys: true },
    );
    expect(r.equal).toBe(true);
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

  // --- Semantique NaN (critere 2) ---

  it('NaN ATTENDU & actual NaN -> MATCH (NaN est une sortie legitime)', () => {
    const r = compareGolden({ x: NaN }, { x: NaN });
    expect(r.equal).toBe(true);
  });

  it('NaN attendu mais valeur finie obtenue -> ecart', () => {
    const r = compareGolden({ x: NaN }, { x: 0 });
    expect(r.equal).toBe(false);
    expect(r.diffs[0]?.reason).toMatch(/NaN attendu/);
  });

  it('NaN inattendu (fini attendu) -> defaut, jamais tolere meme tolerance enorme', () => {
    const r = compareGolden({ x: 1 }, { x: NaN }, { defaultTolerance: { abs: 1e9 } });
    expect(r.equal).toBe(false);
    expect(r.diffs[0]?.reason).toMatch(/NaN inattendu/);
  });

  // --- Mode exact (critere 2) ---

  it('mode exact : rejette tout ecart meme si abs/rel sont fournis', () => {
    const r = compareGolden(
      { x: 10 },
      { x: 10.0001 },
      { defaultTolerance: { exact: true, abs: 1, rel: 1 } },
    );
    expect(r.equal).toBe(false);
    expect(r.diffs[0]?.reason).toMatch(/exact/);
  });

  it('mode exact par chemin : strict sur un champ, tolerant sur un autre', () => {
    const r = compareGolden(
      { strict: 5, souple: 100 },
      { strict: 5, souple: 100.5 },
      {
        defaultTolerance: { abs: 1 },
        toleranceByPath: { strict: { exact: true } },
      },
    );
    expect(r.equal).toBe(true);
  });

  // --- Bascule rel->abs pres de zero (critere 2) ---

  it('near-zero : la borne rel devient inoperante, rejette sans abs', () => {
    // expected = 0 -> rel*|0| = 0 ; sans abs, tout ecart est rejete.
    const r = compareGolden({ x: 0 }, { x: 1e-6 }, { defaultTolerance: { rel: 0.5 } });
    expect(r.equal).toBe(false);
  });

  it('near-zero : seule la borne abs peut accepter un ecart pres de zero', () => {
    const r = compareGolden(
      { x: 0 },
      { x: 1e-6 },
      { defaultTolerance: { rel: 0.5, abs: 1e-5 } },
    );
    expect(r.equal).toBe(true);
  });

  it('hors near-zero : la borne rel fonctionne normalement', () => {
    // expected = 1 (>= seuil) : rel 50% accepte 1.4
    const r = compareGolden({ x: 1 }, { x: 1.4 }, { defaultTolerance: { rel: 0.5 } });
    expect(r.equal).toBe(true);
  });

  // --- Anti faux-vert : types mixtes / longueurs (criteres points a challenger) ---

  it('types mixtes (nombre vs string) -> ecart, jamais un faux match', () => {
    expect(compareGolden({ x: 1 }, { x: '1' }).equal).toBe(false);
  });

  it('objet attendu vs nombre obtenu -> ecart', () => {
    expect(compareGolden({ x: { a: 1 } }, { x: 5 }).equal).toBe(false);
  });

  it('tableau plus court cote actual : les elements manquants sont des ecarts', () => {
    const r = compareGolden([1, 2, 3], [1, 2]);
    expect(r.equal).toBe(false);
    // au moins l ecart de longueur + l element absent
    expect(r.diffs.length).toBeGreaterThanOrEqual(1);
  });
});
