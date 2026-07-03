/**
 * Tests — pieuxDescriptor.buildPayload avec array-rows (#109).
 *
 * TDD : tests écrits RED avant la migration du descripteur pieux.
 * Après migration : buildPayload attend flat['layers'] = JSON.stringify([...]).
 * Les clés plates layer1_xx/layer2_xx sont supprimées du descripteur.
 *
 * ⚠️ DoD §8 — ce fichier N'IMPORTE PAS @roadsen/engines.
 */
import { describe, it, expect } from 'vitest';

import { findDescriptor } from '../../engine-descriptors';

const descriptor = findDescriptor('pieux');
if (!descriptor) throw new Error('descripteur pieux introuvable');

/** Flat de base valide (hors couches). */
const BASE_FLAT: Record<string, unknown> = {
  projet: 'Test #109',
  pieu: 'Pieu foré Ø600',
  geom_section: 'circ',
  geom_g_B: '0.6',
  g_z0: '0.5',
  g_D: '12',
  cat: '2',
  meth: 'pmt',
  da: 'da2',
  sens: 'comp',
  essais: 'non',
  c_G: '800',
  c_Q: '200',
  o_nappe: '3',
  o_nprofil: '2',
  o_surf: '500',
  o_redis: 'non',
};

/** Une couche minimale valide (sol + épaisseur). */
const ONE_LAYER = JSON.stringify([
  { soil: 'argile', th: '10', pl: '0.6', em: '6', gamma: '', qc: '', c: '', phi: '' },
]);

describe('pieuxDescriptor.buildPayload — array-rows (#109)', () => {
  // ── Longueur du tableau layers ─────────────────────────────────────────────

  describe('Nombre de couches', () => {
    it(
      'given layers JSON avec 1 couche, ' +
        'when buildPayload, then payload.layers.length === 1',
      () => {
        const flat = { ...BASE_FLAT, layers: ONE_LAYER };
        const payload = descriptor.buildPayload(flat) as { layers: unknown[] };
        expect(Array.isArray(payload.layers)).toBe(true);
        expect(payload.layers).toHaveLength(1);
      },
    );

    it(
      'given layers JSON avec 3 couches, ' +
        'when buildPayload, then payload.layers.length === 3',
      () => {
        const layers = [
          {
            soil: 'argile',
            th: '4',
            pl: '0.4',
            em: '5',
            gamma: '17',
            qc: '',
            c: '',
            phi: '',
          },
          {
            soil: 'sable',
            th: '6',
            pl: '1.2',
            em: '12',
            gamma: '19',
            qc: '',
            c: '',
            phi: '',
          },
          {
            soil: 'marne',
            th: '5',
            pl: '2.0',
            em: '20',
            gamma: '21',
            qc: '',
            c: '',
            phi: '',
          },
        ];
        const flat = { ...BASE_FLAT, layers: JSON.stringify(layers) };
        const payload = descriptor.buildPayload(flat) as {
          layers: Array<Record<string, unknown>>;
        };
        expect(payload.layers).toHaveLength(3);
        expect(payload.layers[0].soil).toBe('argile');
        expect(payload.layers[1].soil).toBe('sable');
        expect(payload.layers[2].soil).toBe('marne');
      },
    );

    it(
      'given layers JSON avec 5 couches, ' +
        'when buildPayload, then payload.layers.length === 5',
      () => {
        const layers = Array.from({ length: 5 }, (_, i) => ({
          soil: 'argile',
          th: String(i + 1),
          pl: '0.5',
          em: '5',
          gamma: '',
          qc: '',
          c: '',
          phi: '',
        }));
        const flat = { ...BASE_FLAT, layers: JSON.stringify(layers) };
        const payload = descriptor.buildPayload(flat) as { layers: unknown[] };
        expect(payload.layers).toHaveLength(5);
      },
    );
  });

  // ── Champs obligatoires : soil et th ──────────────────────────────────────

  describe('Champs soil et th', () => {
    it(
      'given soil=craie et th=7, ' +
        'when buildPayload, then layers[0].soil === "craie" et th ≈ 7',
      () => {
        const layers = [
          {
            soil: 'craie',
            th: '7',
            pl: '1.5',
            em: '15',
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
        expect(payload.layers[0].soil).toBe('craie');
        expect(payload.layers[0].th).toBeCloseTo(7);
      },
    );
  });

  // ── Champ gamma (downdrag) ────────────────────────────────────────────────

  describe('Champ gamma (poids volumique / downdrag)', () => {
    it(
      'given gamma=18.5, ' +
        'when buildPayload, then layers[0].gamma est un nombre ≈ 18.5',
      () => {
        const layers = [
          {
            soil: 'argile',
            th: '5',
            pl: '',
            em: '',
            gamma: '18.5',
            qc: '',
            c: '',
            phi: '',
          },
        ];
        const flat = { ...BASE_FLAT, layers: JSON.stringify(layers) };
        const payload = descriptor.buildPayload(flat) as {
          layers: Array<Record<string, unknown>>;
        };
        expect(typeof payload.layers[0].gamma).toBe('number');
        expect(payload.layers[0].gamma).toBeCloseTo(18.5);
      },
    );

    it(
      'given gamma absent (vide), ' +
        'when buildPayload, then layers[0].gamma est undefined',
      () => {
        const layers = [
          { soil: 'sable', th: '5', pl: '1', em: '8', gamma: '', qc: '', c: '', phi: '' },
        ];
        const flat = { ...BASE_FLAT, layers: JSON.stringify(layers) };
        const payload = descriptor.buildPayload(flat) as {
          layers: Array<Record<string, unknown>>;
        };
        expect(payload.layers[0].gamma).toBeUndefined();
      },
    );

    it(
      'given 2 couches avec gamma, ' + 'when buildPayload, then les deux ont gamma',
      () => {
        const layers = [
          {
            soil: 'argile',
            th: '5',
            pl: '0.5',
            em: '5',
            gamma: '17',
            qc: '',
            c: '',
            phi: '',
          },
          {
            soil: 'sable',
            th: '7',
            pl: '1.2',
            em: '12',
            gamma: '20',
            qc: '',
            c: '',
            phi: '',
          },
        ];
        const flat = { ...BASE_FLAT, layers: JSON.stringify(layers) };
        const payload = descriptor.buildPayload(flat) as {
          layers: Array<Record<string, unknown>>;
        };
        expect(payload.layers).toHaveLength(2);
        expect(payload.layers[0].gamma).toBeCloseTo(17);
        expect(payload.layers[1].gamma).toBeCloseTo(20);
      },
    );
  });

  // ── Champ qc (CPT) ────────────────────────────────────────────────────────

  describe('Champ qc (méthode pénétrométrique CPT)', () => {
    it(
      'given qc=5.2 et meth=cpt, ' + 'when buildPayload, then layers[0].qc ≈ 5.2',
      () => {
        const layers = [
          {
            soil: 'sable',
            th: '8',
            pl: '',
            em: '',
            gamma: '',
            qc: '5.2',
            c: '',
            phi: '',
          },
        ];
        const flat = { ...BASE_FLAT, meth: 'cpt', layers: JSON.stringify(layers) };
        const payload = descriptor.buildPayload(flat) as {
          layers: Array<Record<string, unknown>>;
        };
        expect(typeof payload.layers[0].qc).toBe('number');
        expect(payload.layers[0].qc).toBeCloseTo(5.2);
      },
    );

    it('given qc absent, ' + 'when buildPayload, then layers[0].qc est undefined', () => {
      const layers = [
        {
          soil: 'argile',
          th: '5',
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
      expect(payload.layers[0].qc).toBeUndefined();
    });
  });

  // ── Champs c et phi (c-φ) ────────────────────────────────────────────────

  describe('Champs c et phi (méthode c-φ)', () => {
    it(
      'given c=15 et phi=28, ' +
        'when buildPayload (meth=cphi), then les deux sont des nombres',
      () => {
        const layers = [
          {
            soil: 'argile',
            th: '5',
            pl: '',
            em: '',
            gamma: '',
            qc: '',
            c: '15',
            phi: '28',
          },
        ];
        const flat = { ...BASE_FLAT, meth: 'cphi', layers: JSON.stringify(layers) };
        const payload = descriptor.buildPayload(flat) as {
          layers: Array<Record<string, unknown>>;
        };
        expect(payload.layers[0].c).toBeCloseTo(15);
        expect(payload.layers[0].phi).toBeCloseTo(28);
      },
    );

    it(
      'given c et phi absents, ' + 'when buildPayload, then undefined et pas de NaN',
      () => {
        const layers = [
          {
            soil: 'argile',
            th: '5',
            pl: '0.5',
            em: '5',
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
        expect(payload.layers[0].c).toBeUndefined();
        expect(payload.layers[0].phi).toBeUndefined();
        expect(JSON.stringify(payload)).not.toContain('NaN');
      },
    );
  });

  // ── Robustesse ────────────────────────────────────────────────────────────

  describe('Robustesse', () => {
    it(
      'given JSON malformé, ' +
        'when buildPayload, then ne crash pas et layers est un tableau',
      () => {
        const flat = { ...BASE_FLAT, layers: 'NOT_JSON{{{{' };
        expect(() => {
          const payload = descriptor.buildPayload(flat) as { layers: unknown[] };
          expect(Array.isArray(payload.layers)).toBe(true);
        }).not.toThrow();
      },
    );

    it('given layers absent du flat, ' + 'when buildPayload, then ne crash pas', () => {
      const flat = { ...BASE_FLAT }; // pas de clé 'layers'
      expect(() => descriptor.buildPayload(flat)).not.toThrow();
    });

    it(
      "given layers = JSON d'un objet (pas un tableau), " +
        'when buildPayload, then layers est un tableau vide ou valide',
      () => {
        const flat = { ...BASE_FLAT, layers: JSON.stringify({ soil: 'argile' }) };
        const payload = descriptor.buildPayload(flat) as { layers: unknown[] };
        expect(Array.isArray(payload.layers)).toBe(true);
      },
    );
  });

  // ── Confidentialité DoD §8 ────────────────────────────────────────────────

  describe('DoD §8 — Confidentialité', () => {
    it(
      'given un payload valide, ' +
        'when buildPayload, then aucun symbole moteur confidentiel dans les clés racine',
      () => {
        const flat = { ...BASE_FLAT, layers: ONE_LAYER };
        const payload = descriptor.buildPayload(flat) as Record<string, unknown>;
        const keys = Object.keys(payload);
        expect(keys).not.toContain('casagrande');
        expect(keys).not.toContain('qs_i');
        expect(keys).not.toContain('__ROADSEN_ENGINE_CONFIDENTIAL_DO_NOT_SHIP__');
      },
    );

    it(
      'given un payload valide, ' +
        'when JSON.stringify, then pas de marqueur confidentiel dans la sérialisation',
      () => {
        const flat = { ...BASE_FLAT, layers: ONE_LAYER };
        const payload = descriptor.buildPayload(flat);
        const serialized = JSON.stringify(payload);
        expect(serialized).not.toContain('__ROADSEN_ENGINE_CONFIDENTIAL_DO_NOT_SHIP__');
        expect(serialized).not.toContain('@roadsen/engines');
      },
    );
  });
});
