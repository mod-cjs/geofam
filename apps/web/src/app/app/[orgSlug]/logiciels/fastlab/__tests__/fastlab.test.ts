/**
 * Tests — page FASTLAB (classification GTR / NF P11-300).
 * DoD §9 : given/when/then. DoD §8 : buildFastlabPayload PUR = mesures brutes de
 * labo uniquement, aucune grandeur de résultat (classe/params viennent du serveur).
 */

import { describe, it, expect } from 'vitest';

import { buildFastlabPayload, type FastlabForm } from '../page';

function form(over: Partial<FastlabForm> = {}): FastlabForm {
  return {
    ident: { ref: 'SC2', nature: 'Limon', chantier: '' },
    water: [{ t: '20', h: '138', s: '120' }, { t: '', h: '', s: '' }, { t: '', h: '', s: '' }],
    gr_M: '1000',
    sieves: { gr_2: '90', gr_0_08: '30', gr_20: '' },
    ll: [{ x: '15', t: '15', h: '29', s: '25' }, { x: '', t: '', h: '', s: '' }, { x: '', t: '', h: '', s: '' }, { x: '', t: '', h: '', s: '' }],
    pl: [{ t: '10', h: '16', s: '15' }, { t: '', h: '', s: '' }],
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

  it('omet les champs vides (pas de clé bruit)', () => {
    const p = buildFastlabPayload(form());
    expect('m_chantier' in p).toBe(false);
    expect('w_t2' in p).toBe(false);
    expect('gr_20' in p).toBe(false);
    expect('ll_x2' in p).toBe(false);
  });
});

describe('buildFastlabPayload — DoD §8', () => {
  it('ne contient aucune grandeur de RÉSULTAT (classe/Ip/VBS côté serveur)', () => {
    const p = buildFastlabPayload(form());
    for (const forbidden of ['classe', 'ip', 'wl', 'wp', 'vbs', 'p80', 'dmax', 'code', 'path']) {
      expect(Object.prototype.hasOwnProperty.call(p, forbidden)).toBe(false);
    }
  });
});
