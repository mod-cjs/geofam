/**
 * Tests — page PressioPro (pressiomètre Ménard).
 * DoD §9 : given/when/then. DoD §8 : buildPressioProPayload PUR = essai borné,
 * aucune grandeur de résultat (pL/EM/catégorie viennent du serveur).
 */

import { describe, it, expect } from 'vitest';

import {
  buildPressioProPayload,
  SONDE_CATALOGUE,
  GAINE_CATALOGUE,
  vsForSonde,
  aForGaine,
  buildProfilRow,
  type PressioProForm,
} from '../page';
import type { NormalizedCalcOutput, CalcOutputRow } from '@/lib/api/types';

function form(over: Partial<PressioProForm> = {}): PressioProForm {
  return {
    projet: 'Sondage BH-01', label: 'BH-01 / 3,0 m',
    a: '0.5', Ph: '0', Pe: '0', V0: '535', k0: '0.5',
    gamma: '19', nappe: '0',
    rows: [
      { p: '2', v15: '90', v30: '95', v60: '100' },
      { p: '4', v15: '130', v30: '135', v60: '140' },
      { p: '6', v15: '175', v30: '182', v60: '189' },
      { p: '8', v15: '230', v30: '245', v60: '262' },
    ],
    ...over,
  };
}

describe('buildPressioProPayload — structure', () => {
  it('mappe params (appareillage) et paliers en nombres', () => {
    const p = buildPressioProPayload(form());
    expect(p.params).toEqual({ a: 0.5, Ph: 0, Pe: 0, V0: 535, k0: 0.5 });
    expect(p.gamma).toBe(19);
    expect(p.rows).toEqual([
      { p: 2, v15: 90, v30: 95, v60: 100 },
      { p: 4, v15: 130, v30: 135, v60: 140 },
      { p: 6, v15: 175, v30: 182, v60: 189 },
      { p: 8, v15: 230, v30: 245, v60: 262 },
    ]);
  });

  it('V0/k0 par défaut si champ vide ; label borné à 40 car.', () => {
    const p = buildPressioProPayload(form({ V0: '', k0: '', label: 'x'.repeat(60) }));
    const params = p.params as Record<string, number>;
    expect(params.V0).toBe(535);
    expect(params.k0).toBe(0.5);
    expect((p.label as string).length).toBe(40);
  });
});

describe('buildPressioProPayload — sélection manuelle des seuils p0/pf', () => {
  it('passe pf_idx/plm_idx au moteur quand des seuils manuels sont choisis (≥ 0)', () => {
    const p = buildPressioProPayload(form({ pf_idx: 2, plm_idx: 5 }));
    expect(p.pf_idx).toBe(2);
    expect(p.plm_idx).toBe(5);
  });

  it('omet les seuils quand ils sont en mode automatique (-1 ou absent)', () => {
    const auto = buildPressioProPayload(form({ pf_idx: -1, plm_idx: -1 }));
    expect(Object.prototype.hasOwnProperty.call(auto, 'pf_idx')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(auto, 'plm_idx')).toBe(false);
    const none = buildPressioProPayload(form());
    expect(Object.prototype.hasOwnProperty.call(none, 'pf_idx')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(none, 'plm_idx')).toBe(false);
  });
});

describe('catalogue de sondes & gaines (auto-Vs / auto-a)', () => {
  it('propose ~20 sondes couvrant les diamètres Ø 44 à Ø 90 + autres', () => {
    expect(SONDE_CATALOGUE.length).toBeGreaterThanOrEqual(18);
    // valeurs Vs de reference de l'outil d'origine
    expect(vsForSonde('Ø 60 — Standard')).toBe(535);
    expect(vsForSonde('Ø 44 — Tube fendu avec passe')).toBe(280);
    expect(vsForSonde('Ø 90 — Grande cavité (roche)')).toBe(1200);
    expect(vsForSonde('Pencel (Ø 32 mm)')).toBe(100);
  });

  it('vsForSonde renvoie null pour une sonde inconnue (fail-safe, pas de défaut inventé)', () => {
    expect(vsForSonde('sonde-inexistante')).toBeNull();
  });

  it('propose les types de gaine documentaires avec leur coefficient a indicatif', () => {
    expect(GAINE_CATALOGUE.length).toBeGreaterThanOrEqual(5);
    expect(aForGaine('Gaine 3 mm (standard)')).toBe(0.65);
    expect(aForGaine('Gaine métallique à lamelles')).toBe(0.15);
  });
});

describe('buildProfilRow — agrégation multi-profondeurs (résultats serveur)', () => {
  function outputWith(rows: CalcOutputRow[]): NormalizedCalcOutput {
    return { verdict: 'NA', rows };
  }

  it('extrait z (profondeur) du libellé et les grandeurs affichées du dépouillement serveur', () => {
    const out = outputWith([
      { label: 'Pression limite p_L', value: 43.911, unit: 'bar' },
      { label: 'Module pressiométrique E_M', value: 3.4064, unit: 'MPa' },
      { label: 'Rapport E_M / p_L*', value: 7.7574, unit: '' },
      { label: 'Coefficient rhéologique α (Ménard)', value: 0.67, unit: '' },
      { label: 'Module d’Young E_y = E_M/α', value: 5.0842, unit: 'MPa' },
      { label: 'Catégorie de sol', value: 'Sol mou (cat. B)', unit: '' },
    ]);
    const r = buildProfilRow('4.0 m', out);
    expect(r).not.toBeNull();
    expect(r!.z).toBe(4);
    expect(r!.EM).toBe(3.4064);
    expect(r!.pL_MPa).toBeCloseTo(4.3911, 4); // bar → MPa
    expect(r!.ratio).toBe(7.7574);
    expect(r!.alpha).toBe(0.67);
    expect(r!.categorie).toBe('Sol mou (cat. B)');
  });

  it('renvoie null si la sortie n’a pas de résultat exploitable (fail-safe)', () => {
    expect(buildProfilRow('2.0 m', null)).toBeNull();
    expect(buildProfilRow('2.0 m', outputWith([]))).toBeNull();
  });
});

describe('buildPressioProPayload — DoD §8', () => {
  it('ne contient aucune grandeur de RÉSULTAT (pL/EM/catégorie côté serveur)', () => {
    const p = buildPressioProPayload(form({ pf_idx: 2, plm_idx: 5 }));
    for (const forbidden of ['pL', 'pLNette', 'EM', 'ratioEMpL', 'categorieLibelle', 'alpha', 'Ey', 'sigH0']) {
      expect(Object.prototype.hasOwnProperty.call(p, forbidden)).toBe(false);
    }
  });
});
