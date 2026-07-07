// @vitest-environment node
/**
 * Tests — evaluateGate / isQuotaLow (galerie + pages logiciel, gating tenant).
 * DoD §9 : given/when/then, fail-closed (jamais de fail-open sur données absentes).
 */

import { describe, it, expect } from 'vitest';

import { evaluateGate, isQuotaLow } from '../subscription-gate';
import type { EntitlementsResponse } from '../api/types';

function ent(over: Partial<EntitlementsResponse> = {}): EntitlementsResponse {
  return {
    orgId: 'org_1',
    pack: 'COMPLETE',
    modules: ['burmister', 'terzaghi', 'pieux', 'radier', 'pressiometre', 'labo'],
    expiresAt: '2027-01-01T00:00:00.000Z',
    expired: false,
    quota: { limit: 100, used: 10, remaining: 90 },
    serverTime: '2026-07-05T00:00:00.000Z',
    ...over,
  };
}

describe('evaluateGate', () => {
  it('GIVEN entitlements null (non chargés) — WHEN évalué — THEN bloqué fail-closed (pas fail-open)', () => {
    const gate = evaluateGate(null, 'burmister');
    expect(gate.allowed).toBe(false);
    expect(gate.reasons).toEqual(['NOT_INCLUDED']);
    expect(gate.message).toMatch(/non inclus/i);
  });

  it('GIVEN module dans modules[], abo actif, quota restant — WHEN évalué — THEN autorisé', () => {
    const gate = evaluateGate(ent(), 'terzaghi');
    expect(gate.allowed).toBe(true);
    expect(gate.reasons).toEqual([]);
    expect(gate.message).toBeNull();
  });

  it('GIVEN module absent de modules[] — WHEN évalué — THEN NOT_INCLUDED', () => {
    const gate = evaluateGate(ent({ modules: ['burmister'] }), 'pieux');
    expect(gate.allowed).toBe(false);
    expect(gate.reasons).toEqual(['NOT_INCLUDED']);
  });

  it('GIVEN abonnement expiré — WHEN évalué — THEN EXPIRED prioritaire même si module inclus', () => {
    const gate = evaluateGate(ent({ expired: true }), 'burmister');
    expect(gate.allowed).toBe(false);
    expect(gate.reasons[0]).toBe('EXPIRED');
  });

  it('GIVEN quota épuisé (remaining=0) — WHEN évalué — THEN QUOTA_EXHAUSTED', () => {
    const gate = evaluateGate(ent({ quota: { limit: 100, used: 100, remaining: 0 } }), 'burmister');
    expect(gate.allowed).toBe(false);
    expect(gate.reasons).toEqual(['QUOTA_EXHAUSTED']);
  });

  it('GIVEN expiré ET quota épuisé ET module non inclus — WHEN évalué — THEN toutes les raisons, EXPIRED en tête', () => {
    const gate = evaluateGate(
      ent({ expired: true, quota: { limit: 100, used: 100, remaining: 0 }, modules: [] }),
      'burmister',
    );
    expect(gate.reasons).toEqual(['EXPIRED', 'QUOTA_EXHAUSTED', 'NOT_INCLUDED']);
    expect(gate.message).toMatch(/expiré/i);
  });
});

describe('isQuotaLow', () => {
  it('GIVEN remaining/limit >= 10% — WHEN évalué — THEN false', () => {
    expect(isQuotaLow({ quota: { limit: 100, used: 80, remaining: 20 } })).toBe(false);
  });

  it('GIVEN remaining/limit < 10% — WHEN évalué — THEN true', () => {
    expect(isQuotaLow({ quota: { limit: 100, used: 95, remaining: 5 } })).toBe(true);
  });

  it('GIVEN limit=0 — WHEN évalué — THEN false (pas de division par zéro, pas d’alerte)', () => {
    expect(isQuotaLow({ quota: { limit: 0, used: 0, remaining: 0 } })).toBe(false);
  });

  it('GIVEN seuil personnalisé — WHEN évalué — THEN respecte le seuil fourni', () => {
    expect(isQuotaLow({ quota: { limit: 100, used: 70, remaining: 30 } }, 50)).toBe(true);
    expect(isQuotaLow({ quota: { limit: 100, used: 70, remaining: 30 } }, 20)).toBe(false);
  });
});
