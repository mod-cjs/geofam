// @vitest-environment node
/**
 * Tests — engine-labels (FX-10, source unique du nom métier humanisé).
 * DoD §9 : verrouille slugOf/metaOf + la cohérence avec SOFTWARE_CATALOG
 * (source du nom court de chaque logiciel dans la galerie GEOFAM).
 */

import { describe, it, expect } from 'vitest';

import { slugOf, metaOf } from '../engine-labels';
import { SOFTWARE_CATALOG } from '../software-catalog';

describe('slugOf — normalise le registryId backend vers le slug métier court', () => {
  it('GIVEN un registryId backend — WHEN slugOf — THEN slug court attendu', () => {
    expect(slugOf('chaussee-burmister')).toBe('burmister');
    expect(slugOf('fondation-superficielle')).toBe('terzaghi');
    expect(slugOf('fondation-terzaghi')).toBe('terzaghi');
    expect(slugOf('pressiometre-menard')).toBe('pressiometre');
    expect(slugOf('fondation-profonde-pieux')).toBe('pieux');
    expect(slugOf('radier-plaque')).toBe('radier');
    expect(slugOf('labo-classification-gtr')).toBe('labo');
  });

  it('GIVEN un slug déjà court (ou inconnu) — WHEN slugOf — THEN retourné tel quel (pas d’exception)', () => {
    expect(slugOf('burmister')).toBe('burmister');
    expect(slugOf('moteur-inconnu')).toBe('moteur-inconnu');
  });
});

describe('metaOf — nom métier humanisé', () => {
  it('GIVEN un registryId backend — WHEN metaOf — THEN nom métier humanisé (pas le slug brut)', () => {
    expect(metaOf('chaussee-burmister').nom).toBe('ROADSENS — Chaussées');
    expect(metaOf('fondation-superficielle').nom).toBe(
      'Terzaghi — Fondations superficielles',
    );
    expect(metaOf('fondation-profonde-pieux').nom).toBe('CASAGRANDE — Pieux');
    expect(metaOf('radier-plaque').nom).toBe('GEOPLAQUE — Radier');
    expect(metaOf('pressiometre-menard').nom).toBe('PressioPro — Pressiomètre');
    expect(metaOf('labo-classification-gtr').nom).toBe('FASTLAB — Laboratoire');
  });

  it('GIVEN un slug court directement — WHEN metaOf — THEN même résultat (idempotent)', () => {
    expect(metaOf('burmister').nom).toBe('ROADSENS — Chaussées');
  });

  it('GIVEN un engineId inconnu — WHEN metaOf — THEN repli sur l’id brut, jamais d’exception', () => {
    expect(metaOf('moteur-inconnu').nom).toBe('moteur-inconnu');
  });

  it('GIVEN les 6 logiciels de SOFTWARE_CATALOG — WHEN metaOf(engineId) — THEN le nom humanisé commence par le nom court du catalogue (cohérence galerie <-> mnémonique)', () => {
    for (const entry of SOFTWARE_CATALOG) {
      const nom = metaOf(entry.engineId).nom;
      // Le nom court de la galerie (ex. "PressioPro") doit être un préfixe du
      // nom humanisé ("PressioPro — Pressiomètre") — sentinelle anti-divergence.
      expect(nom.startsWith(entry.nom)).toBe(true);
    }
  });
});
