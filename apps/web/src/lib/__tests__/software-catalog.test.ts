// @vitest-environment node
/**
 * Tests — SOFTWARE_CATALOG (mapping id logiciel -> engineId de gate).
 * DoD §9 : sentinelle du bug déjà corrigé une fois (SubscriptionEditor stockait
 * les mauvais slugs) — verrouille la correspondance id galerie -> slug de gate.
 */

import { describe, it, expect } from 'vitest';

import { SOFTWARE_CATALOG, findSoftware, engineIdForSoftware } from '../software-catalog';

describe('SOFTWARE_CATALOG — mapping id logiciel -> engineId de gate', () => {
  it('GIVEN les 6 logiciels — WHEN on lit engineId — THEN correspond au slug de gate attendu', () => {
    const expected: Record<string, string> = {
      roadsens: 'burmister',
      terzaghi: 'terzaghi',
      casagrande: 'pieux',
      geoplaque: 'radier',
      pressiopro: 'pressiometre',
      fastlab: 'labo',
    };
    for (const [id, engineId] of Object.entries(expected)) {
      expect(engineIdForSoftware(id)).toBe(engineId);
    }
  });

  it('GIVEN un id inconnu — WHEN engineIdForSoftware — THEN undefined (pas de fallback silencieux)', () => {
    expect(engineIdForSoftware('inexistant')).toBeUndefined();
    expect(findSoftware('inexistant')).toBeUndefined();
  });

  it('GIVEN le catalogue — WHEN on vérifie l’unicité — THEN 6 entrées, ids et engineIds uniques', () => {
    expect(SOFTWARE_CATALOG).toHaveLength(6);
    const ids = SOFTWARE_CATALOG.map((s) => s.id);
    const engineIds = SOFTWARE_CATALOG.map((s) => s.engineId);
    expect(new Set(ids).size).toBe(6);
    expect(new Set(engineIds).size).toBe(6);
  });
});
