/**
 * Tests — Couche mock API : gating abonnement (ADR 0011)
 *
 * DoD §9 : test-first, given/when/then, chemins erreur, zéro faux-vert.
 *
 * Testé :
 *  - getMockEntitlements : forme + invariants de quota par scénario ;
 *  - runCalc : refus 402 (expiré / quota), refus 403 (module hors pack) ;
 *  - emitPv : refus 422 (calcul non DONE).
 *
 * PAS de mock de la couche réseau — on appelle les fonctions directement.
 * Le scénario de démo est piloté via localStorage (cf. getActiveScenario).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getMockEntitlements } from '../mock-data';
import type { DemoScenario } from '../mock-data';
import { runCalc, emitPv } from '../client';
import type { CalcRequest, EmitPvRequest } from '../types';

// ---------------------------------------------------------------------------
// getMockEntitlements — contrat ADR 0011
// ---------------------------------------------------------------------------

describe('getMockEntitlements', () => {
  describe('scénario "active"', () => {
    it('given scénario actif, then expired est false et quota.remaining > 0', () => {
      const e = getMockEntitlements('active');
      expect(e.expired).toBe(false);
      expect(e.quota.remaining).toBeGreaterThan(0);
      expect(e.modules.length).toBeGreaterThan(0);
      expect(e.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('given scénario actif, then les 6 modules sont déverrouillés', () => {
      const e = getMockEntitlements('active');
      const expected = ['burmister', 'pressiometre', 'terzaghi', 'casagrande', 'geoplaque', 'fastlab'];
      for (const m of expected) {
        expect(e.modules).toContain(m);
      }
    });
  });

  describe('scénario "expired"', () => {
    it('given scénario expiré, then expired est true', () => {
      const e = getMockEntitlements('expired');
      expect(e.expired).toBe(true);
    });

    it('given scénario expiré, then quota.limit > 0 (le quota n est pas le problème)', () => {
      const e = getMockEntitlements('expired');
      // L abonnement est expiré même si du quota reste — expired prime
      expect(e.quota.limit).toBeGreaterThan(0);
    });
  });

  describe('scénario "quota-exhausted"', () => {
    it('given quota épuisé, then expired est false mais remaining est 0', () => {
      const e = getMockEntitlements('quota-exhausted');
      expect(e.expired).toBe(false);
      expect(e.quota.remaining).toBe(0);
      expect(e.quota.used).toBeGreaterThanOrEqual(e.quota.limit);
    });
  });

  describe('scénario "module-locked"', () => {
    it('given module verrouillé, then expired est false et certains modules manquent', () => {
      const e = getMockEntitlements('module-locked');
      expect(e.expired).toBe(false);
      // En module-locked, seul burmister (chaussées) est disponible
      expect(e.modules).toContain('burmister');
      // Les moteurs fondations ne sont pas dans la liste
      expect(e.modules).not.toContain('terzaghi');
      expect(e.modules).not.toContain('casagrande');
    });
  });

  describe('contrat de forme ADR 0011', () => {
    const scenarios: DemoScenario[] = ['active', 'expired', 'quota-exhausted', 'module-locked'];

    it.each(scenarios)(
      'given scénario %s, then la réponse a la forme { modules, expired, quota{limit,used,remaining}, serverTime }',
      (scenario) => {
        const e = getMockEntitlements(scenario);
        // modules
        expect(Array.isArray(e.modules)).toBe(true);
        // expired
        expect(typeof e.expired).toBe('boolean');
        // quota
        expect(typeof e.quota).toBe('object');
        expect(typeof e.quota.limit).toBe('number');
        expect(typeof e.quota.used).toBe('number');
        expect(typeof e.quota.remaining).toBe('number');
        expect(e.quota.remaining).toBe(e.quota.limit - e.quota.used);
        // serverTime = ISO 8601
        expect(e.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      }
    );

    it('given tout scénario, then quota.remaining = limit - used (invariant)', () => {
      for (const s of scenarios) {
        const e = getMockEntitlements(s);
        expect(e.quota.remaining, `scénario ${s} : remaining ≠ limit - used`).toBe(
          e.quota.limit - e.quota.used
        );
      }
    });

    it('given tout scénario, then quota.used ≤ quota.limit', () => {
      for (const s of scenarios) {
        const e = getMockEntitlements(s);
        expect(e.quota.used, `scénario ${s} : used > limit`).toBeLessThanOrEqual(e.quota.limit);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// runCalc / emitPv — enforcement réel des refus (ADR 0011)
//
// getActiveScenario() lit window.location.search puis localStorage.
// En jsdom search est vide → on pilote le scénario par localStorage.
// ---------------------------------------------------------------------------

const DEMO_SCENARIO_KEY = 'roadsen_demo_scenario';

function setScenario(s: DemoScenario) {
  window.localStorage.setItem(DEMO_SCENARIO_KEY, s);
}

interface ApiError {
  statusCode: number;
  reason: string;
  message: string;
}

const BURMISTER_REQ: CalcRequest = {
  engineId: 'burmister',
  label: 'Test gating',
  params: { layers: [{ h: 0.36 }] },
} as CalcRequest;

describe('runCalc — refus de gating', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it('given un abonnement expiré, when runCalc, then rejette 402 EXPIRED', async () => {
    setScenario('expired');
    await expect(runCalc('org_01', 'proj_01', BURMISTER_REQ)).rejects.toMatchObject({
      statusCode: 402,
      reason: 'EXPIRED',
    } satisfies Partial<ApiError>);
  });

  it('given un quota épuisé, when runCalc, then rejette 402 QUOTA', async () => {
    setScenario('quota-exhausted');
    await expect(runCalc('org_01', 'proj_01', BURMISTER_REQ)).rejects.toMatchObject({
      statusCode: 402,
      reason: 'QUOTA',
    } satisfies Partial<ApiError>);
  });

  it('given un module hors pack (terzaghi en pack ROUTES), when runCalc, then rejette 403 MODULE_NOT_IN_PACK', async () => {
    setScenario('module-locked'); // pack ROUTES → modules: [burmister, pressiometre]
    const lockedReq = { ...BURMISTER_REQ, engineId: 'terzaghi' } as CalcRequest;
    await expect(runCalc('org_01', 'proj_01', lockedReq)).rejects.toMatchObject({
      statusCode: 403,
      reason: 'MODULE_NOT_IN_PACK',
    } satisfies Partial<ApiError>);
  });

  it('given un module inclus en pack ROUTES (burmister), when runCalc, then PAS de refus module (contre-épreuve)', async () => {
    setScenario('module-locked');
    // burmister EST dans le pack ROUTES → doit aboutir (verdict PASS/FAIL, pas un refus)
    const res = await runCalc('org_01', 'proj_01', BURMISTER_REQ);
    expect(res.status).toBe('DONE');
    const verdict = (res.output as { verdict?: string } | null)?.verdict;
    expect(['PASS', 'FAIL']).toContain(verdict);
  });
});

describe('emitPv — refus 422 sur calcul non DONE', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setScenario('active');
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it('given un calcul DRAFT (calc_03), when emitPv, then rejette 422 SERVER_ERROR', async () => {
    // calc_03 est en statut DRAFT dans MOCK_CALCULS → émission impossible
    const req: EmitPvRequest = { calcResultId: 'calc_03' } as EmitPvRequest;
    await expect(emitPv('org_01', 'proj_01', req)).rejects.toMatchObject({
      statusCode: 422,
      reason: 'SERVER_ERROR',
    } satisfies Partial<ApiError>);
  });

  it('given un calcResultId inconnu, when emitPv, then rejette 404 NOT_FOUND (chemin négatif)', async () => {
    const req: EmitPvRequest = { calcResultId: 'calc_inexistant' } as EmitPvRequest;
    await expect(emitPv('org_01', 'proj_01', req)).rejects.toMatchObject({
      statusCode: 404,
      reason: 'NOT_FOUND',
    } satisfies Partial<ApiError>);
  });
});

// ---------------------------------------------------------------------------
// Déterminisme du verdict (sentinelle anti-aléatoire)
//
// Règle mock (client.ts:mockShouldFail) : burmister, somme épaisseurs < 0,20 m
// → FAIL ; ≥ 0,20 m → PASS. JAMAIS d'aléatoire. On observe runCalc.
// ---------------------------------------------------------------------------

describe('runCalc — déterminisme du verdict burmister (jamais aléatoire)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setScenario('active');
  });
  afterEach(() => window.localStorage.clear());

  function verdictOf(res: Awaited<ReturnType<typeof runCalc>>): string | undefined {
    return (res.output as { verdict?: string } | null)?.verdict;
  }

  it('given épaisseur totale < 0,20 m (0,08), then verdict FAIL', async () => {
    const req = { ...BURMISTER_REQ, params: { layers: [{ h: 0.08 }] } } as CalcRequest;
    const res = await runCalc('org_01', 'proj_01', req);
    expect(verdictOf(res)).toBe('FAIL');
  });

  it('given épaisseur totale ≥ 0,20 m (0,36), then verdict PASS', async () => {
    const req = { ...BURMISTER_REQ, params: { layers: [{ h: 0.06 }, { h: 0.10 }, { h: 0.20 }] } } as CalcRequest;
    const res = await runCalc('org_01', 'proj_01', req);
    expect(verdictOf(res)).toBe('PASS');
  });

  it('given exactement 0,20 m (seuil), then verdict PASS (borne incluse, < strict)', async () => {
    const req = { ...BURMISTER_REQ, params: { layers: [{ h: 0.20 }] } } as CalcRequest;
    const res = await runCalc('org_01', 'proj_01', req);
    expect(verdictOf(res)).toBe('PASS');
  });

  it('given le MÊME payload deux fois, then le verdict est identique (déterministe)', async () => {
    const req = { ...BURMISTER_REQ, params: { layers: [{ h: 0.08 }] } } as CalcRequest;
    const a = verdictOf(await runCalc('org_01', 'proj_01', req));
    const b = verdictOf(await runCalc('org_01', 'proj_01', req));
    expect(a).toBe(b);
    expect(a).toBe('FAIL');
  });
});
