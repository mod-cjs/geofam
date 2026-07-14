/**
 * Tests — indicateurs d'appréciation EC7 annexe H (radier GEOPLAQUE).
 *
 * Décision titulaire du 14/07 : reproduire À L'IDENTIQUE les indicateurs vert/
 * orange/rouge du client (fonctions `lvlSettle`/`lvlDiff`/`lvlBeta`/`chk`,
 * GEOPLAQUE_V10.html ~L.2480-2568), appliqués à nos valeurs DÉJÀ whitelistées
 * (rows du radier — cf. adapters.ts `buildRadierRows`).
 *
 * DoD §9 : given/when/then, chemins ok/warn/bad + bords exacts des seuils,
 * tolérance à l'absence de grandeur (jamais de NaN).
 */

import { describe, it, expect } from 'vitest';

import {
  levelSettlement,
  levelDifferential,
  levelDistortion,
  levelTilt,
  formatDistortionRatio,
  computeGeoplaqueEc7Indicators,
  type IndicatorLevel,
} from '../ec7-indicators';

import type { CalcOutputRow } from '@/lib/api/types';

function row(label: string, value: number | string, unit = 'mm'): CalcOutputRow {
  return { label, value, unit };
}

describe('levelSettlement — GEOPLAQUE_V10.html:2480 : mm<=25 ok, <=50 warn, sinon bad', () => {
  it.each<[number, IndicatorLevel]>([
    [0, 'ok'],
    [25, 'ok'],
    [25.01, 'warn'],
    [50, 'warn'],
    [50.01, 'bad'],
    [120, 'bad'],
  ])('given %d mm, then niveau = %s', (mm, expected) => {
    expect(levelSettlement(mm)).toBe(expected);
  });
});

describe('levelDifferential — GEOPLAQUE_V10.html:2481 : mm<=10 ok, <=20 warn, sinon bad', () => {
  it.each<[number, IndicatorLevel]>([
    [0, 'ok'],
    [10, 'ok'],
    [10.01, 'warn'],
    [20, 'warn'],
    [20.01, 'bad'],
  ])('given %d mm, then niveau = %s', (mm, expected) => {
    expect(levelDifferential(mm)).toBe(expected);
  });
});

describe('levelDistortion — GEOPLAQUE_V10.html:2482 : bv<=1/500 ok, <=1/150 warn, sinon bad (converti en ‰)', () => {
  // Notre grandeur est déjà en ‰ (= bv*1000, cf. adapters.ts buildRadierRows L.916-919 —
  // le solveur sort la distorsion en ‰, pas en radians bruts comme dans le HTML client).
  // 1/500 rad = 2 ‰ ; 1/150 rad = 1000/150 ‰ ≈ 6,667 ‰.
  const OK_BOUND = 2;
  const WARN_BOUND = 1000 / 150;

  it.each<[number, IndicatorLevel]>([
    [0, 'ok'],
    [OK_BOUND, 'ok'],
    [OK_BOUND + 0.001, 'warn'],
    [WARN_BOUND, 'warn'],
    [WARN_BOUND + 0.001, 'bad'],
    [50, 'bad'],
  ])('given %d ‰, then niveau = %s', (perMille, expected) => {
    expect(levelDistortion(perMille)).toBe(expected);
  });
});

describe('levelTilt — GEOPLAQUE_V10.html:2568 : tilt<=1/500 ok, <=1/150 warn, sinon bad (mêmes seuils que la distorsion)', () => {
  const OK_BOUND = 2;
  const WARN_BOUND = 1000 / 150;

  it.each<[number, IndicatorLevel]>([
    [OK_BOUND, 'ok'],
    [OK_BOUND + 0.001, 'warn'],
    [WARN_BOUND, 'warn'],
    [WARN_BOUND + 0.001, 'bad'],
  ])('given %d ‰, then niveau = %s', (perMille, expected) => {
    expect(levelTilt(perMille)).toBe(expected);
  });
});

describe('formatDistortionRatio — GEOPLAQUE_V10.html:2479 (ratio1), adapté ‰→"1/N"', () => {
  it('given 2 ‰ (= 1/500), then "1/500"', () => {
    expect(formatDistortionRatio(2)).toBe('1/500');
  });
  it('given 0 ou négatif, then "—" (comme le client)', () => {
    expect(formatDistortionRatio(0)).toBe('—');
    expect(formatDistortionRatio(-1)).toBe('—');
  });
  it('given non fini, then "—"', () => {
    expect(formatDistortionRatio(Number.NaN)).toBe('—');
    expect(formatDistortionRatio(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('computeGeoplaqueEc7Indicators — construit les indicateurs à partir des rows whitelistées', () => {
  it('given les 4 rows principales (wMax/diff/betaGov/tilt), then 4 indicateurs dans l’ordre EC7 du client', () => {
    const rows: CalcOutputRow[] = [
      row('Tassement maximal w_max', 6.25),
      row('Tassement différentiel', 4.1),
      row('Distorsion angulaire gouvernante β', 1.2, '‰'),
      row("Inclinaison d'ensemble ϖ", 0.8, '‰'),
    ];
    const ind = computeGeoplaqueEc7Indicators(rows);
    expect(ind.map((i) => i.key)).toEqual(['settlement', 'differential', 'beta', 'tilt']);
    expect(ind[0]).toMatchObject({
      label: 'Tassement total max',
      level: 'ok',
      repere: '≈ 50 mm',
    });
    expect(ind[0].valueLabel).toBe('6.3 mm');
    expect(ind[1]).toMatchObject({
      label: 'Tassement différentiel',
      level: 'ok',
      repere: '≈ 20 mm',
    });
    expect(ind[2]).toMatchObject({ label: 'Distorsion angulaire β', level: 'ok' });
    expect(ind[3]).toMatchObject({ label: "Inclinaison d'ensemble ϖ", level: 'ok' });
  });

  it('given une distorsion en zone ATTENTION, then verdictLabel = ATTENTION (verdict() du client, GEOPLAQUE_V10.html:1331)', () => {
    const rows: CalcOutputRow[] = [row('Distorsion angulaire gouvernante β', 4, '‰')];
    const ind = computeGeoplaqueEc7Indicators(rows);
    expect(ind[0]).toMatchObject({ level: 'warn', verdictLabel: 'ATTENTION' });
  });

  it('given un tassement en DÉPASSEMENT, then verdictLabel = DÉPASSEMENT', () => {
    const rows: CalcOutputRow[] = [row('Tassement maximal w_max', 80)];
    const ind = computeGeoplaqueEc7Indicators(rows);
    expect(ind[0]).toMatchObject({ level: 'bad', verdictLabel: 'DÉPASSEMENT' });
  });

  it('given des rows multi-plaques/multi-charges, then les indicateurs conditionnels apparaissent (ordre client)', () => {
    const rows: CalcOutputRow[] = [
      row('Tassement maximal w_max', 5),
      row('Distorsion entre plaques', 1, '‰'),
      row('Distorsion max entre charges voisines', 1.5, '‰'),
    ];
    const ind = computeGeoplaqueEc7Indicators(rows);
    expect(ind.map((i) => i.key)).toEqual(['settlement', 'beta-inter', 'beta-loads']);
  });

  it('given aucune row (grandeur pas encore exposée par le moteur/chantier moteur), then aucun indicateur — jamais de NaN', () => {
    expect(computeGeoplaqueEc7Indicators([])).toEqual([]);
  });

  it('given une row non numérique (valeur texte), then l’indicateur correspondant est omis (tolérant)', () => {
    const rows: CalcOutputRow[] = [
      row('Tassement maximal w_max', 'n/d' as unknown as number),
    ];
    expect(computeGeoplaqueEc7Indicators(rows)).toEqual([]);
  });

  it('given uniquement des rows sans rapport (autre moteur), then aucun indicateur — pas de faux positif', () => {
    const rows: CalcOutputRow[] = [row('Résistance de pointe R_b;k', 500, 'kN')];
    expect(computeGeoplaqueEc7Indicators(rows)).toEqual([]);
  });
});
