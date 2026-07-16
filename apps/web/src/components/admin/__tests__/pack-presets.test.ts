// @vitest-environment node
// Logique pure (pas de DOM).

/**
 * Tests — PACK_PRESETS (source unique pack -> modules), mission titulaire 14/07.
 *
 * DoD §9 : test-first, given/when/then, sentinelle de non-régression.
 * Diagnostic corrigé : « packs pas appliqués » — le pack n'était qu'une étiquette
 * indépendante des entitlements (une org affichait COMPLETE avec 1 seul module).
 */

import { describe, it, expect } from 'vitest';

import {
  PACK_PRESETS,
  PACK_NAMES,
  isPackName,
  isCustomizedVsPack,
  customPackWarning,
} from '../pack-presets';

describe('PACK_PRESETS — grille commerciale DEV-RDS-001 + mapping GeoSuite', () => {
  it('GIVEN le pack ROUTES — THEN un seul module : burmister', () => {
    expect(PACK_PRESETS.ROUTES).toEqual(['burmister']);
  });

  it('GIVEN le pack FONDATIONS — THEN terzaghi + pieux seulement (pas radier/pressiometre)', () => {
    // Sentinelle : vire rouge si radier/pressiometre sont réintroduits sans décision explicite.
    expect(PACK_PRESETS.FONDATIONS).toEqual(['terzaghi', 'pieux']);
  });

  it('GIVEN le pack COMPLETE — THEN les 6 moteurs', () => {
    expect(PACK_PRESETS.COMPLETE).toEqual([
      'burmister',
      'terzaghi',
      'pieux',
      'radier',
      'pressiometre',
      'labo',
    ]);
  });

  it('GIVEN PACK_NAMES — THEN couvre exactement les clés de PACK_PRESETS', () => {
    expect(PACK_NAMES).toEqual(['ROUTES', 'FONDATIONS', 'COMPLETE']);
    expect(Object.keys(PACK_PRESETS).sort()).toEqual([...PACK_NAMES].sort());
  });
});

describe('isPackName — garde de type', () => {
  it('GIVEN un nom de pack connu — THEN true', () => {
    expect(isPackName('ROUTES')).toBe(true);
    expect(isPackName('FONDATIONS')).toBe(true);
    expect(isPackName('COMPLETE')).toBe(true);
  });

  it('GIVEN une valeur inconnue — THEN false', () => {
    expect(isPackName('CUSTOM')).toBe(false);
    expect(isPackName('')).toBe(false);
  });
});

describe('isCustomizedVsPack — détection de personnalisation (avertissement non bloquant)', () => {
  it('GIVEN entitlements = preset exact du pack (même ordre) — THEN false', () => {
    expect(isCustomizedVsPack('ROUTES', ['burmister'])).toBe(false);
    expect(
      isCustomizedVsPack('COMPLETE', [
        'burmister',
        'terzaghi',
        'pieux',
        'radier',
        'pressiometre',
        'labo',
      ]),
    ).toBe(false);
  });

  it('GIVEN entitlements = preset exact du pack (ordre différent) — THEN false (ordre indifférent)', () => {
    expect(isCustomizedVsPack('FONDATIONS', ['pieux', 'terzaghi'])).toBe(false);
  });

  it('GIVEN un module en moins que le preset — THEN true', () => {
    // Sentinelle du bug diagnostiqué : COMPLETE avec 1 seul module -> divergence détectée.
    expect(isCustomizedVsPack('COMPLETE', ['burmister'])).toBe(true);
  });

  it('GIVEN un module en plus que le preset — THEN true', () => {
    expect(isCustomizedVsPack('ROUTES', ['burmister', 'terzaghi'])).toBe(true);
  });

  it('GIVEN même nombre de modules mais ensemble différent — THEN true', () => {
    expect(isCustomizedVsPack('FONDATIONS', ['terzaghi', 'radier'])).toBe(true);
  });

  it('GIVEN un pack inconnu — THEN toute liste non vide est considérée personnalisée', () => {
    expect(isCustomizedVsPack('CUSTOM', ['burmister'])).toBe(true);
    expect(isCustomizedVsPack('CUSTOM', [])).toBe(false);
  });
});

describe('customPackWarning — texte exact (mission titulaire 14/07)', () => {
  it('GIVEN un pack — THEN message sobre avec le nom du pack', () => {
    expect(customPackWarning('COMPLETE')).toBe(
      'Contenu personnalisé — ne correspond pas au pack COMPLETE standard',
    );
    expect(customPackWarning('ROUTES')).toBe(
      'Contenu personnalisé — ne correspond pas au pack ROUTES standard',
    );
  });
});
