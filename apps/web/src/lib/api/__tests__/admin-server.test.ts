// @vitest-environment node
// Environnement Node : ces fonctions utilisent next/headers (cookies()), pas de DOM.

/**
 * Tests — admin-server.ts, distinction panne backend / vide (audit Lot 5bis, §1).
 *
 * DoD §9 : test-first, given/when/then, chemins négatifs testés, zéro faux-vert.
 *
 * Couverture :
 *  - Pas de token → { ok:false, reason:'unauthorized' }
 *  - 401 / 403 backend → { ok:false, reason:'unauthorized' }
 *  - 5xx backend → { ok:false, reason:'error' } (PAS confondu avec une liste vide)
 *  - Réseau indisponible (fetch throw) → { ok:false, reason:'error' }
 *  - Succès (200, tableau vide) → { ok:true, data:[] } — vide ≠ erreur
 *  - Succès (200, tableau non vide) → { ok:true, data:[...] }
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCookies } = vi.hoisted(() => ({ mockCookies: vi.fn() }));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { adminListOrgs } from '../admin-server';

function givenToken(token: string | null) {
  mockCookies.mockResolvedValue({
    get: (name: string) => (name === 'roadsen_access_token' && token ? { value: token } : undefined),
  });
}

describe('adminListOrgs — résultat discriminé (panne backend ≠ vide)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GIVEN pas de token — WHEN adminListOrgs appelé — THEN reason 'unauthorized'", async () => {
    givenToken(null);

    const result = await adminListOrgs();

    expect(result).toEqual({ ok: false, reason: 'unauthorized' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("GIVEN backend renvoie 401 — WHEN adminListOrgs appelé — THEN reason 'unauthorized'", async () => {
    givenToken('tok');
    mockFetch.mockResolvedValue({ ok: false, status: 401 });

    const result = await adminListOrgs();

    expect(result).toEqual({ ok: false, reason: 'unauthorized' });
  });

  it("GIVEN backend renvoie 403 — WHEN adminListOrgs appelé — THEN reason 'unauthorized'", async () => {
    givenToken('tok');
    mockFetch.mockResolvedValue({ ok: false, status: 403 });

    const result = await adminListOrgs();

    expect(result).toEqual({ ok: false, reason: 'unauthorized' });
  });

  it("GIVEN backend renvoie 500 — WHEN adminListOrgs appelé — THEN reason 'error' (PAS 'unauthorized', PAS liste vide silencieuse)", async () => {
    givenToken('tok');
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const result = await adminListOrgs();

    expect(result).toEqual({ ok: false, reason: 'error' });
  });

  it("GIVEN le réseau est indisponible (fetch throw) — WHEN adminListOrgs appelé — THEN reason 'error'", async () => {
    givenToken('tok');
    mockFetch.mockRejectedValue(new Error('network down'));

    const result = await adminListOrgs();

    expect(result).toEqual({ ok: false, reason: 'error' });
  });

  it('GIVEN backend renvoie 200 avec une liste VIDE — WHEN adminListOrgs appelé — THEN ok:true, data:[] (vide ≠ erreur)', async () => {
    givenToken('tok');
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => [] });

    const result = await adminListOrgs();

    expect(result).toEqual({ ok: true, data: [] });
  });

  it('GIVEN backend renvoie 200 avec des organisations — WHEN adminListOrgs appelé — THEN ok:true, data non vide', async () => {
    givenToken('tok');
    const orgs = [{ id: 'o1', name: 'Org 1', slug: 'org-1', status: 'ACTIVE', createdAt: '2026-01-01', nbMembres: 2, subscription: null }];
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => orgs });

    const result = await adminListOrgs();

    expect(result).toEqual({ ok: true, data: orgs });
  });
});
