/**
 * Tests — page PressioPro (pressiomètre Ménard).
 * DoD §9 : given/when/then. DoD §8 : buildPressioProPayload PUR = essai borné,
 * aucune grandeur de résultat (pL/EM/catégorie viennent du serveur).
 */

import { describe, it, expect } from 'vitest';

import {
  buildPressioProPayload,
  buildAppareillagePayload,
  countAppPoints,
  SONDE_CATALOGUE,
  GAINE_CATALOGUE,
  vsForSonde,
  aForGaine,
  buildProfilRow,
  pressioCurvePoints,
  type PressioProForm,
  type AppRow,
} from '../page';

import type { NormalizedCalcOutput, CalcOutputRow } from '@/lib/api/types';

function form(over: Partial<PressioProForm> = {}): PressioProForm {
  return {
    projet: 'Sondage BH-01',
    label: 'BH-01 / 3,0 m',
    a: '0.5',
    Ph: '0',
    Pe: '0',
    V0: '535',
    k0: '0.5',
    gamma: '19',
    nappe: '0',
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
    // a : le champ est en cm³/MPa (unité normative NF EN ISO 22476-4, cf. label UI) ;
    // le moteur consomme a en cm³/bar (contract.ts : « déjà /10 par l'appelant »).
    // 0,5 cm³/MPa -> 0,05 cm³/bar. C'est le /10 de getParams() (HTML l.678).
    expect(p.params).toEqual({ a: 0.05, Ph: 0, Pe: 0, V0: 535, k0: 0.5 });
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

describe('buildPressioProPayload — conversion du coefficient a (cm³/MPa champ → cm³/bar moteur)', () => {
  // MAJEUR-1 : le HTML getParams() (l.678) fait `a: num('p_a',0) / 10` — la saisie/le
  // calibrage appliqué sont en cm³/MPa (unité normative affichée), le moteur travaille en
  // bar donc attend cm³/bar. Sans ce /10, l'inertie a est ×10 trop grande et le
  // dépouillement (corrections Vc = Vr − a·P) est FAUX.
  it('divise a par 10 (cm³/MPa → cm³/bar) — fidélité getParams() du HTML', () => {
    const params = buildPressioProPayload(form({ a: '3.0' })).params as Record<
      string,
      number
    >;
    expect(params.a).toBeCloseTo(0.3, 10); // 3,0 cm³/MPa -> 0,30 cm³/bar
  });

  it('a = 0 (calibrage non renseigné) reste 0 — aucune correction de volume', () => {
    const params = buildPressioProPayload(form({ a: '0' })).params as Record<
      string,
      number
    >;
    expect(params.a).toBe(0);
  });

  it('a vide -> 0 (défaut), pas de NaN', () => {
    const params = buildPressioProPayload(form({ a: '' })).params as Record<
      string,
      number
    >;
    expect(params.a).toBe(0);
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

  it('extrait z (profondeur) et les grandeurs déjà en MPa du dépouillement serveur (correctif 14/07)', () => {
    // Les rows p_L/p_L*/p_f sont DÉJÀ en MPa côté adaptateur (bar→MPa fait une fois,
    // adapters.ts buildPressiometreRows) — buildProfilRow ne reconvertit plus (sinon
    // double conversion). p_f colonne = BRUT (comme la table Profil du client).
    const out = outputWith([
      { label: 'Pression limite p_L', value: 4.3911, unit: 'MPa' },
      { label: 'Pression limite nette p_L*', value: 4.2011, unit: 'MPa' },
      { label: 'Pression de fluage nette p_f*', value: 2.11, unit: 'MPa' },
      { label: 'Pression de fluage p_f', value: 2.3, unit: 'MPa' },
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
    expect(r!.pL_MPa).toBe(4.3911);
    expect(r!.pLNette_MPa).toBe(4.2011);
    expect(r!.pf_MPa).toBe(2.3); // BRUT, pas la nette (2.11)
    expect(r!.ratio).toBe(7.7574);
    expect(r!.alpha).toBe(0.67);
    expect(r!.categorie).toBe('Sol mou (cat. B)');
  });

  it('renvoie null si la sortie n’a pas de résultat exploitable (fail-safe)', () => {
    expect(buildProfilRow('2.0 m', null)).toBeNull();
    expect(buildProfilRow('2.0 m', outputWith([]))).toBeNull();
  });
});

describe('pressioCurvePoints — BUG MAJEUR fluage (priorité 1)', () => {
  // Le fluage normatif NF EN ISO 22476-4 est Δ60/30 = V₆₀−V₃₀ (l'onglet Mesures le
  // calcule déjà correctement). La courbe Résultats utilisait V₆₀−V₁₅ par erreur.
  it('given V15/V30/V60 mesurés, when on construit les points, then c = V60−V30 (pas V60−V15)', () => {
    const rows = [
      { p: '2', v15: '90', v30: '95', v60: '100' },
      { p: '4', v15: '130', v30: '135', v60: '145' },
    ];
    const pts = pressioCurvePoints(rows);
    expect(pts).toHaveLength(2);
    expect(pts[0].c).toBe(5); // 100 - 95, PAS 100 - 90 (= 10)
    expect(pts[1].c).toBe(10); // 145 - 135, PAS 145 - 130 (= 15)
  });

  it('exclut les paliers sans pression ou volume à 30 s renseignés', () => {
    const rows = [
      { p: '', v15: '90', v30: '95', v60: '100' },
      { p: '2', v15: '', v30: '', v60: '' },
      { p: '4', v15: '130', v30: '135', v60: '145' },
    ];
    expect(pressioCurvePoints(rows)).toHaveLength(1);
  });
});

describe('buildAppareillagePayload — étalonnage / calibrage (appareillage serveur)', () => {
  const rows = (arr: Array<[string, string]>): AppRow[] =>
    arr.map(([p, v60]) => ({ p, v60 }));

  it('mappe UNIQUEMENT les points (P, V60) en nombres + label borné à 40 car.', () => {
    const p = buildAppareillagePayload(
      rows([
        ['0.2', '525'],
        ['0.4', '548'],
        ['0.6', '574'],
      ]),
      {
        projet: 'Sondage BH-01',
        label: 'x'.repeat(60),
      },
    );
    expect(p.projet).toBe('Sondage BH-01');
    expect((p.label as string).length).toBe(40);
    expect(p.rows).toEqual([
      { p: 0.2, v60: 525 },
      { p: 0.4, v60: 548 },
      { p: 0.6, v60: 574 },
    ]);
  });

  it('ÉCARTE les lignes vides (P ou V60 non renseigné) — parité filtre HTML', () => {
    const p = buildAppareillagePayload(
      rows([
        ['1', '10'],
        ['', ''],
        ['2', '20'],
        ['3', ''],
        ['', '30'],
      ]),
      {
        label: 'Calibrage',
      },
    );
    expect(p.rows).toEqual([
      { p: 1, v60: 10 },
      { p: 2, v60: 20 },
    ]);
  });

  it('label par défaut si vide', () => {
    const p = buildAppareillagePayload(rows([['1', '1']]), { label: '' });
    expect(p.label).toBe('Appareillage');
  });

  it('ne contient AUCUNE grandeur de résultat (Vs/Pe/a côté serveur) — DoD §8', () => {
    const p = buildAppareillagePayload(
      rows([
        ['1', '1'],
        ['2', '2'],
        ['3', '3'],
      ]),
      { label: 'Étalonnage' },
    );
    for (const forbidden of [
      'Vs',
      'Pe',
      'a',
      'R2',
      'rms',
      'c0',
      'c1',
      'c2',
      'residuals',
      'pts',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(p, forbidden)).toBe(false);
    }
  });
});

describe('countAppPoints — garde « ≥ 3 points » côté UI', () => {
  const rows = (arr: Array<[string, string]>): AppRow[] =>
    arr.map(([p, v60]) => ({ p, v60 }));

  it('compte les seuls points complets (P et V60 renseignés)', () => {
    expect(
      countAppPoints(
        rows([
          ['1', '1'],
          ['', ''],
          ['2', '2'],
        ]),
      ),
    ).toBe(2);
    expect(
      countAppPoints(
        rows([
          ['1', '1'],
          ['2', '2'],
          ['3', '3'],
        ]),
      ),
    ).toBe(3);
    expect(
      countAppPoints(
        rows([
          ['1', ''],
          ['', '2'],
        ]),
      ),
    ).toBe(0);
  });
});

describe('buildPressioProPayload — DoD §8', () => {
  it('ne contient aucune grandeur de RÉSULTAT (pL/EM/catégorie côté serveur)', () => {
    const p = buildPressioProPayload(form({ pf_idx: 2, plm_idx: 5 }));
    for (const forbidden of [
      'pL',
      'pLNette',
      'EM',
      'ratioEMpL',
      'categorieLibelle',
      'alpha',
      'Ey',
      'sigH0',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(p, forbidden)).toBe(false);
    }
  });
});
