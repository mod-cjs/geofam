// @vitest-environment node
// Environnement Node : OrgsPage est un Server Component async — appelé comme
// une fonction, il retourne des React elements (objets) sans exécuter le DOM.

/**
 * Tests — /admin/orgs, distinction panne backend / vide (audit Lot 5bis, §1).
 *
 * DoD §9 : test-first, given/when/then, chemins négatifs testés, zéro faux-vert.
 *
 * Couverture :
 *  - adminListOrgs { ok:false, reason:'unauthorized' } → redirect('/login')
 *  - adminListOrgs { ok:false, reason:'error' } → OrgListClient reçoit fetchError=true,
 *    le compteur "résultat(s)" n'affiche PAS "0 résultat" trompeur
 *  - adminListOrgs { ok:true, data:[] } → liste vide réelle, PAS de fetchError
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const { mockRedirect, mockAdminListOrgs, mockOrgListClient } = vi.hoisted(() => {
  const mockRedirect = vi.fn().mockImplementation((path: string) => {
    const err = new Error(`NEXT_REDIRECT:${path}`);
    (err as NodeJS.ErrnoException).code = 'NEXT_REDIRECT';
    throw err;
  });
  const mockAdminListOrgs = vi.fn();
  const mockOrgListClient = vi.fn(
    (_props: { orgs: unknown[]; fetchError?: boolean }) => null,
  );
  return { mockRedirect, mockAdminListOrgs, mockOrgListClient };
});

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));

vi.mock('@/lib/api/admin-server', () => ({
  adminListOrgs: mockAdminListOrgs,
}));

vi.mock('@/components/admin/OrgListClient', () => ({
  OrgListClient: mockOrgListClient,
}));

import OrgsPage from '../page';

describe('OrgsPage — résultat discriminé (§1, famine d\'erreurs)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedirect.mockImplementation((path: string) => {
      const err = new Error(`NEXT_REDIRECT:${path}`);
      (err as NodeJS.ErrnoException).code = 'NEXT_REDIRECT';
      throw err;
    });
  });

  it("GIVEN adminListOrgs renvoie reason 'unauthorized' — WHEN page rendue — THEN redirect /login appelé", async () => {
    mockAdminListOrgs.mockResolvedValue({ ok: false, reason: 'unauthorized' });

    await expect(OrgsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'NEXT_REDIRECT:/login',
    );
    expect(mockRedirect).toHaveBeenCalledWith('/login');
  });

  it("GIVEN adminListOrgs renvoie reason 'error' (backend KO) — WHEN page rendue — THEN OrgListClient reçoit fetchError=true et orgs=[]", async () => {
    mockAdminListOrgs.mockResolvedValue({ ok: false, reason: 'error' });

    const el = await OrgsPage({ searchParams: Promise.resolve({}) });
    renderToStaticMarkup(el);

    expect(mockOrgListClient).toHaveBeenCalledTimes(1);
    const props = mockOrgListClient.mock.calls[0][0] as { orgs: unknown[]; fetchError?: boolean };
    expect(props.fetchError).toBe(true);
    expect(props.orgs).toEqual([]);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('GIVEN adminListOrgs renvoie ok:true data:[] (liste réellement vide) — WHEN page rendue — THEN fetchError absent/false', async () => {
    mockAdminListOrgs.mockResolvedValue({ ok: true, data: [] });

    const el = await OrgsPage({ searchParams: Promise.resolve({}) });
    renderToStaticMarkup(el);

    const props = mockOrgListClient.mock.calls[0][0] as { orgs: unknown[]; fetchError?: boolean };
    expect(props.fetchError).toBeFalsy();
    expect(props.orgs).toEqual([]);
  });
});
