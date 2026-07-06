/**
 * Tests — page FASTLAB (classification GTR / NF P11-300 + essais de labo).
 * DoD §9 : given/when/then. DoD §8 : buildFastlabPayload PUR = mesures brutes de
 * labo uniquement, aucune grandeur de résultat (classe/params viennent du serveur).
 *
 * COUVERTURE CORRECTNESS (audit de fidélité FASTLAB7) :
 *  - BLOQUANT 1 : l'onglet CBR/IPI ne DOIT PLUS alimenter les entrées de cisaillement
 *    (ci_*) — le misroute fabriquait des c′/φ′ faux à partir de « points CBR ».
 *  - BLOQUANT 1 bis : le type d'essai IPI doit être atteignable (cbType='ipi').
 *  - BLOQUANT 2 : l'onglet Cisaillement direct DÉDIÉ alimente ci_N/ci_P/ci_R/ci_rho/
 *    ci_w/ci_nat + géométrie (boîte ci_shape/ci_dim OU annulaire ci_Ra/ci_Ri).
 */

import { describe, it, expect } from 'vitest';

import { buildFastlabPayload, type FastlabForm } from '../page';

interface CiSpec { N: string; P: string; R: string; rho: string; w: string; nat: string }
const emptyCi = (): CiSpec => ({ N: '', P: '', R: '', rho: '', w: '', nat: '' });
const emptyCisail = (): FastlabForm['cisail'] => ({
  method: 'box', shape: 'sq', dim: '', Ra: '', Ri: '', rs: '', specs: [emptyCi(), emptyCi(), emptyCi(), emptyCi()],
});

function form(over: Partial<FastlabForm> = {}): FastlabForm {
  return {
    ident: { ref: 'SC2', nature: 'Limon', chantier: '' },
    water: [{ t: '20', h: '138', s: '120' }, { t: '', h: '', s: '' }, { t: '', h: '', s: '' }],
    gr_M: '1000',
    sieves: { gr_2: '90', gr_0_08: '30', gr_20: '' },
    ll: [{ x: '15', t: '15', h: '29', s: '25' }, { x: '', t: '', h: '', s: '' }, { x: '', t: '', h: '', s: '' }, { x: '', t: '', h: '', s: '' }],
    pl: [{ t: '10', h: '16', s: '15' }, { t: '', h: '', s: '' }],
    vbs: { conc: '10', prise1: '30', frac1: '100', w1: '4', V1: '101', prise2: '', frac2: '', w2: '', V2: '' },
    prMould: 'A', prType: 'n',
    prPoints: [{ mh: '1836.6', t: '18', h: '74', s: '68' }, { mh: '', t: '', h: '', s: '' }],
    cbType: 'cbr',
    cisail: {
      method: 'box', shape: 'sq', dim: '60', Ra: '', Ri: '', rs: '2.65',
      specs: [
        { N: '0.36', P: '0.197', R: '', rho: '1950', w: '18.5', nat: 'Limon argileux brun' },
        emptyCi(), emptyCi(), emptyCi(),
      ],
    },
    extra: { oe_H0: '20', la_M: '5000', tu_s3_1: '50', empty: '' },
    ...over,
  };
}

describe('buildFastlabPayload — structure', () => {
  it('mappe identification, eau, granulo, Atterberg aux clés moteur', () => {
    const p = buildFastlabPayload(form());
    expect(p.m_ref).toBe('SC2');
    expect(p.m_nature).toBe('Limon');
    expect(p.w_t1).toBe('20');
    expect(p.w_h1).toBe('138');
    expect(p.gr_M).toBe('1000');
    expect(p.gr_2).toBe('90');
    expect(p.ll_x1).toBe('15');
    expect(p.pl_t1).toBe('10');
  });

  it('mappe VBS + Proctor + type CBR aux clés moteur', () => {
    const p = buildFastlabPayload(form());
    expect(p.v_conc).toBe('10');
    expect(p.v_prise1).toBe('30');
    expect(p.pr_mould).toBe('A');
    expect(p.prType).toBe('n');
    expect(p.pr_mh1).toBe('1836.6');
    // Le type d'essai portance alimente cbType (et NON une clé de cisaillement).
    expect(p.cbType).toBe('cbr');
  });

  it('répand les sections additionnelles (extra) aux clés moteur, omet les vides', () => {
    const p = buildFastlabPayload(form());
    expect(p.oe_H0).toBe('20');
    expect(p.la_M).toBe('5000');
    expect(p.tu_s3_1).toBe('50');
    expect('empty' in p).toBe(false);
  });

  it('omet les champs vides (pas de clé bruit)', () => {
    const p = buildFastlabPayload(form());
    expect('m_chantier' in p).toBe(false);
    expect('w_t2' in p).toBe(false);
    expect('gr_20' in p).toBe(false);
    expect('ll_x2' in p).toBe(false);
  });
});

describe('buildFastlabPayload — anti-misroute CBR↔cisaillement (BLOQUANT 1)', () => {
  // Un onglet « CBR / IPI » renseigné SEUL ne doit produire AUCUNE entrée de
  // cisaillement (ci_* / ciMethod / ci_shape). Sinon le moteur calcule des c′/φ′
  // faux à partir de mesures de portance — c'est le défaut corrigé.
  it('un onglet CBR renseigné seul ne fabrique AUCUNE entrée de cisaillement', () => {
    const p = buildFastlabPayload(form({
      cbType: 'cbr',
      cisail: emptyCisail(),
      extra: {
        cb_cible: '95', cb_s25: '13.35', cb_s5: '20', cb_K: '1',
        cb_tot0: '4200', cb_moule0: '2100', cb_vol0: '2124', cb_w0: '11',
        cb_pen_0_6: '5.2', cb_pen_0_9: '7.8', cb_H00: '127', cb_gonf0: '0.4',
      },
    }));
    const ciKeys = Object.keys(p).filter((k) => k === 'ciMethod' || k === 'ci_shape' || k.startsWith('ci_'));
    expect(ciKeys, `entrées de cisaillement fabriquées par l'onglet CBR : ${ciKeys.join(', ')}`).toEqual([]);
    // Les vraies mesures CBR (cb_*) passent bien, elles.
    expect(p.cb_tot0).toBe('4200');
    expect(p.cb_pen_0_6).toBe('5.2');
    expect(p.cbType).toBe('cbr');
  });

  it("le type d'essai IPI est atteignable (cbType togglable)", () => {
    expect(buildFastlabPayload(form({ cbType: 'ipi' })).cbType).toBe('ipi');
    expect(buildFastlabPayload(form({ cbType: 'cbr' })).cbType).toBe('cbr');
  });
});

describe('buildFastlabPayload — cisaillement direct dédié (BLOQUANT 2)', () => {
  it('mode boîte : mappe géométrie ci_shape/ci_dim + ci_N/ci_P/ci_R/ci_rho/ci_w/ci_nat', () => {
    const p = buildFastlabPayload(form({
      cisail: {
        method: 'box', shape: 'sq', dim: '60', Ra: '', Ri: '', rs: '2.65',
        specs: [
          { N: '0.36', P: '0.197', R: '0.150', rho: '1950', w: '18.5', nat: 'Limon' },
          { N: '0.72', P: '0.365', R: '0.300', rho: '1965', w: '18.0', nat: 'Limon' },
          { N: '1.08', P: '0.533', R: '0.450', rho: '1940', w: '18.8', nat: 'Limon' },
          emptyCi(),
        ],
      },
    }));
    expect(p.ciMethod).toBe('box');
    expect(p.ci_shape).toBe('sq');
    expect(p.ci_dim).toBe('60');
    expect(p.ci_rs).toBe('2.65');
    expect(p.ci_N1).toBe('0.36');
    expect(p.ci_P1).toBe('0.197');
    expect(p.ci_R1).toBe('0.150');
    expect(p.ci_rho1).toBe('1950');
    expect(p.ci_w1).toBe('18.5');
    expect(p.ci_nat1).toBe('Limon');
    expect(p.ci_N3).toBe('1.08');
    expect('ci_Ra' in p).toBe(false);
    expect('ci_Ri' in p).toBe(false);
  });

  it('mode annulaire : mappe ci_Ra/ci_Ri (pas ci_dim/ci_shape)', () => {
    const p = buildFastlabPayload(form({
      cisail: {
        method: 'ring', shape: 'sq', dim: '60', Ra: '50', Ri: '25', rs: '2.7',
        specs: [{ N: '0.5', P: '0.3', R: '', rho: '', w: '', nat: '' }, emptyCi(), emptyCi(), emptyCi()],
      },
    }));
    expect(p.ciMethod).toBe('ring');
    expect(p.ci_Ra).toBe('50');
    expect(p.ci_Ri).toBe('25');
    expect(p.ci_N1).toBe('0.5');
    expect('ci_dim' in p).toBe(false);
    expect('ci_shape' in p).toBe(false);
  });
});

describe('buildFastlabPayload — DoD §8 (ALLOWLIST fail-closed)', () => {
  // ALLOWLIST (et non denylist) suite au challenge : TOUTE clé du payload doit être une
  // mesure brute / un toggle CONNU. Une clé inconnue (ex. futur champ de RÉSULTAT
  // classe/ip/vbs...) fait ECHOUER le test — fail-closed, pas de liste noire a maintenir.
  const ALLOWED_PREFIX = /^(m_|w_|gr_|ll_|pl_|v_|pr_|ci_|cb_|oe_|tu_|tc_|es_|la_|md_|mc_|sz_|su_|pe_|uc_|rs_|rs2_|d_|di_|dd_|ra_)/;
  const ALLOWED_TOGGLES = new Set([
    'gr_M', 'prType', 'ciMethod', 'ci_shape', 'laVar', 'mdeVar', 'mdeMode', 'mdeWet',
    'permMode', 'su_type', 'rsMethod', 'cbType', 'densMethod', 'densShape',
  ]);

  it('toute clé du payload est une mesure/toggle connu (aucune grandeur de résultat)', () => {
    const p = buildFastlabPayload(form());
    const inconnues = Object.keys(p).filter((k) => !ALLOWED_PREFIX.test(k) && !ALLOWED_TOGGLES.has(k));
    expect(inconnues, `clés hors allowlist (fuite de résultat ?) : ${inconnues.join(', ')}`).toEqual([]);
  });

  it('aucune clé de résultat connue ne fuit', () => {
    const p = buildFastlabPayload(form());
    for (const forbidden of ['classe', 'ip', 'wl', 'wp', 'vbs', 'p80', 'dmax', 'code', 'path', 'cbr', 'mde', 'rhos', 'es', 'la', 'c_cis', 'phi_cis']) {
      expect(Object.prototype.hasOwnProperty.call(p, forbidden)).toBe(false);
    }
  });
});
