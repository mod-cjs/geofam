/**
 * Tests — outputsEquivalent (garde d'altération PV, tolérance sérialisation).
 *
 * DoD §9 : la fonction doit ACCEPTER le bruit de sérialisation Prisma JSONB
 * (17e chiffre significatif) et REFUSER toute altération réelle (valeur,
 * structure, texte, booléen, présence de clé).
 */
import { outputsEquivalent } from './output-equivalence';

describe('outputsEquivalent — bruit de sérialisation accepté', () => {
  it('given le cas RÉEL constaté e2e (NE 17 chiffres, perte Prisma), then équivalents', () => {
    // Number(...) : le littéral 17 chiffres déclencherait no-loss-of-precision.
    expect(
      outputsEquivalent(Number('1467314.8218242952'), 1467314.821824295),
    ).toBe(true);
  });

  it('given le même double des deux côtés, then équivalents (chemin rapide)', () => {
    expect(outputsEquivalent(0.375, 0.375)).toBe(true);
  });

  it('given des objets imbriqués identiques au bruit près, then équivalents', () => {
    // Number(...) : les littéraux longs déclencheraient no-loss-of-precision.
    const a = {
      fatigue: { valeur: Number('119.12000000000001'), ok: false },
      rows: [1e-7, 2],
    };
    const b = {
      fatigue: { valeur: 119.12, ok: false },
      rows: [Number('1.0000000000000002e-7'), 2],
    };
    expect(outputsEquivalent(a, b)).toBe(true);
  });
});

describe('outputsEquivalent — altérations réelles refusées', () => {
  it('given une valeur métier changée (NE trafiqué à 999999999), then NON équivalents', () => {
    expect(outputsEquivalent({ NE: 1467314.82 }, { NE: 999999999 })).toBe(
      false,
    );
  });

  it('given un écart relatif au-dessus de la tolérance (1e-9), then NON équivalents', () => {
    expect(outputsEquivalent(100, 100 * (1 + 1e-9))).toBe(false);
  });

  it('given un booléen inversé (conforme true→false), then NON équivalents', () => {
    expect(outputsEquivalent({ conforme: true }, { conforme: false })).toBe(
      false,
    );
  });

  it('given un texte modifié, then NON équivalents (texte = exact, jamais de tolérance)', () => {
    expect(
      outputsEquivalent({ famille: 'mixte' }, { famille: 'inverse' }),
    ).toBe(false);
  });

  it('given une clé supprimée, then NON équivalents (structure exacte)', () => {
    expect(outputsEquivalent({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  it('given une clé ajoutée, then NON équivalents', () => {
    expect(outputsEquivalent({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('given un tableau raccourci, then NON équivalents', () => {
    expect(outputsEquivalent({ rows: [1, 2, 3] }, { rows: [1, 2] })).toBe(
      false,
    );
  });

  it('given null contre 0, then NON équivalents (pas de coercition)', () => {
    expect(outputsEquivalent({ v: null }, { v: 0 })).toBe(false);
  });

  it('given un nombre contre une chaîne du même nombre, then NON équivalents', () => {
    expect(outputsEquivalent({ v: 1.5 }, { v: '1.5' })).toBe(false);
  });
});

describe('outputsEquivalent — bords', () => {
  it('undefined des deux côtés dans un objet = clé absente des deux côtés', () => {
    expect(outputsEquivalent({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });

  it('zéro exact des deux côtés', () => {
    expect(outputsEquivalent(0, 0)).toBe(true);
  });

  it('zéro contre epsilon : NON équivalents (échelle nulle interdite)', () => {
    expect(outputsEquivalent(0, 1e-15)).toBe(false);
  });
});
