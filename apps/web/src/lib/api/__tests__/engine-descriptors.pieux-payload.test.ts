/**
 * Tests — pieuxDescriptor.buildPayload : émission des champs optionnels par couche.
 *
 * Mis à jour (#109) : le descripteur pieux utilise désormais array-rows.
 * flat['layers'] = JSON.stringify([...]) remplace les clés plates layer1_xx/layer2_xx.
 *
 * Ces tests maintiennent la couverture des comportements originaux (MAJEUR-1) :
 *   - gamma (poids volumique, downdrag)
 *   - qc (résistance de pointe CPT)
 *   - c et phi (méthode c-φ)
 *
 * ⚠️ DoD §8 — ce fichier N'IMPORTE PAS @roadsen/engines.
 */
import { describe, it, expect } from 'vitest';

import { findDescriptor } from '../../engine-descriptors';

const descriptor = findDescriptor('pieux');
if (!descriptor) throw new Error('descripteur pieux introuvable');

/** Flat de base valide — hors couches (array-rows). */
const BASE_FLAT: Record<string, unknown> = {
  projet: 'Test',
  pieu: '',
  geom_section: 'circ',
  geom_g_B: '0.6',
  g_z0: '0',
  g_D: '15',
  cat: '1',
  meth: 'pmt',
  da: 'da2',
  sens: 'comp',
  essais: 'non',
  c_G: '150',
  c_Q: '50',
  o_nappe: '100',
  o_nprofil: '1',
  o_surf: '0',
  o_redis: 'non',
};

describe('pieuxDescriptor.buildPayload — émission de gamma par couche (downdrag)', () => {
  it(
    'given layer avec gamma=18, ' +
      'when buildPayload, then layers[0].gamma est un nombre fini',
    () => {
      const layers = [
        {
          soil: 'argile',
          th: '10',
          pl: '0.6',
          em: '6',
          gamma: '18',
          qc: '',
          c: '',
          phi: '',
        },
      ];
      const flat = { ...BASE_FLAT, layers: JSON.stringify(layers) };
      const payload = descriptor.buildPayload(flat) as {
        layers: Array<Record<string, unknown>>;
      };
      expect(Array.isArray(payload.layers)).toBe(true);
      expect(payload.layers.length).toBeGreaterThan(0);
      const l0 = payload.layers[0];
      expect(typeof l0.gamma, 'gamma doit être un number').toBe('number');
      expect(Number.isFinite(l0.gamma as number)).toBe(true);
      expect(l0.gamma).toBeCloseTo(18);
    },
  );

  it(
    'given layer sans gamma (vide), ' +
      'when buildPayload, then layers[0].gamma est undefined',
    () => {
      const layers = [
        {
          soil: 'argile',
          th: '10',
          pl: '0.6',
          em: '6',
          gamma: '',
          qc: '',
          c: '',
          phi: '',
        },
      ];
      const flat = { ...BASE_FLAT, layers: JSON.stringify(layers) };
      const payload = descriptor.buildPayload(flat) as {
        layers: Array<Record<string, unknown>>;
      };
      expect(payload.layers[0].gamma).toBeUndefined();
    },
  );

  it(
    'given deux couches avec gamma, ' +
      'when buildPayload, then les deux couches ont gamma',
    () => {
      const layers = [
        { soil: 'argile', th: '5', pl: '', em: '', gamma: '18', qc: '', c: '', phi: '' },
        { soil: 'sable', th: '5', pl: '', em: '', gamma: '20', qc: '', c: '', phi: '' },
      ];
      const flat = { ...BASE_FLAT, layers: JSON.stringify(layers) };
      const payload = descriptor.buildPayload(flat) as {
        layers: Array<Record<string, unknown>>;
      };
      expect(payload.layers).toHaveLength(2);
      expect(payload.layers[0].gamma).toBeCloseTo(18);
      expect(payload.layers[1].gamma).toBeCloseTo(20);
    },
  );
});

describe('pieuxDescriptor.buildPayload — émission de qc par couche (méthode CPT)', () => {
  it(
    'given qc=5.2 et meth=cpt, ' +
      'when buildPayload, then layers[0].qc est un nombre fini',
    () => {
      const layers = [
        { soil: 'sable', th: '10', pl: '', em: '', gamma: '', qc: '5.2', c: '', phi: '' },
      ];
      const flat = { ...BASE_FLAT, meth: 'cpt', layers: JSON.stringify(layers) };
      const payload = descriptor.buildPayload(flat) as {
        layers: Array<Record<string, unknown>>;
      };
      expect(typeof payload.layers[0].qc).toBe('number');
      expect(payload.layers[0].qc).toBeCloseTo(5.2);
    },
  );

  it('given qc absent, when buildPayload, then layers[0].qc est undefined', () => {
    const layers = [
      { soil: 'argile', th: '10', pl: '0.6', em: '6', gamma: '', qc: '', c: '', phi: '' },
    ];
    const flat = { ...BASE_FLAT, layers: JSON.stringify(layers) };
    const payload = descriptor.buildPayload(flat) as {
      layers: Array<Record<string, unknown>>;
    };
    expect(payload.layers[0].qc).toBeUndefined();
  });
});

describe('pieuxDescriptor.buildPayload — émission de c et phi par couche (méthode c-φ)', () => {
  it(
    'given c=15 et phi=28, ' +
      'when buildPayload, then layers[0].c et layers[0].phi sont des nombres finis',
    () => {
      const layers = [
        {
          soil: 'argile',
          th: '10',
          pl: '',
          em: '',
          gamma: '',
          qc: '',
          c: '15',
          phi: '28',
        },
      ];
      const flat = {
        ...BASE_FLAT,
        meth: 'cphi',
        layers: JSON.stringify(layers),
      };
      const payload = descriptor.buildPayload(flat) as {
        layers: Array<Record<string, unknown>>;
      };
      expect(typeof payload.layers[0].c).toBe('number');
      expect(payload.layers[0].c).toBeCloseTo(15);
      expect(typeof payload.layers[0].phi).toBe('number');
      expect(payload.layers[0].phi).toBeCloseTo(28);
    },
  );

  it('given c et phi absents, when buildPayload, then undefined (pas de NaN)', () => {
    const layers = [
      { soil: 'argile', th: '10', pl: '0.6', em: '6', gamma: '', qc: '', c: '', phi: '' },
    ];
    const flat = { ...BASE_FLAT, layers: JSON.stringify(layers) };
    const payload = descriptor.buildPayload(flat) as {
      layers: Array<Record<string, unknown>>;
    };
    expect(payload.layers[0].c).toBeUndefined();
    expect(payload.layers[0].phi).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('NaN');
  });
});
