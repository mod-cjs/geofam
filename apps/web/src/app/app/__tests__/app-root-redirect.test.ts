// @vitest-environment node
// Environnement Node : AppRootPage est un Server Component async — appelé
// comme une fonction, il ne rend jamais de DOM (redirect() lance).

/**
 * Tests — /app (redirection vers la 1re org de l'utilisateur, fix bug 404).
 *
 * DoD §9 : test-first, given/when/then, chemins négatifs testés, zéro faux-vert.
 *
 * Couverture :
 *  - Profil introuvable (pas de token / session expirée) → redirect('/login')
 *  - Profil SANS aucune org (SUPERADMIN pur) → redirect('/admin') — plus de 404
 *  - Profil AVEC ≥ 1 org → redirect(`/app/{slug de la 1re org}`)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRedirect, mockGetMyProfile } = vi.hoisted(() => {
  const mockRedirect = vi.fn().mockImplementation((path: string) => {
    const err = new Error(`NEXT_REDIRECT:${path}`);
    (err as NodeJS.ErrnoException).code = 'NEXT_REDIRECT';
    throw err;
  });
  const mockGetMyProfile = vi.fn();
  return { mockRedirect, mockGetMyProfile };
});

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));

vi.mock('@/lib/api/app-server', () => ({
  getMyProfile: mockGetMyProfile,
}));

import AppRootPage from '../page';

describe('AppRootPage — redirection /app (fix 404 lien "Retour à l\'app")', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedirect.mockImplementation((path: string) => {
      const err = new Error(`NEXT_REDIRECT:${path}`);
      (err as NodeJS.ErrnoException).code = 'NEXT_REDIRECT';
      throw err;
    });
  });

  it('GIVEN getMyProfile retourne null (pas de token/session expirée) — WHEN page rendue — THEN redirect /login', async () => {
    mockGetMyProfile.mockResolvedValue(null);

    await expect(AppRootPage()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(mockRedirect).toHaveBeenCalledWith('/login');
    expect(mockRedirect).toHaveBeenCalledTimes(1);
  });

  it('GIVEN profil SANS aucune org (SUPERADMIN pur) — WHEN page rendue — THEN redirect /admin (jamais 404)', async () => {
    mockGetMyProfile.mockResolvedValue({
      userId: 'u1',
      email: 'super@roadsen.io',
      fullName: 'Super Admin',
      platformRole: 'SUPERADMIN',
      memberships: [],
    });

    await expect(AppRootPage()).rejects.toThrow('NEXT_REDIRECT:/admin');
    expect(mockRedirect).toHaveBeenCalledWith('/admin');
  });

  it('GIVEN profil avec 1 org — WHEN page rendue — THEN redirect /app/{slug}', async () => {
    mockGetMyProfile.mockResolvedValue({
      userId: 'u2',
      email: 'owner@bet.sn',
      fullName: 'BET Owner',
      platformRole: null,
      memberships: [{ orgId: 'o1', orgName: 'BET Demo', orgSlug: 'bet-demo', role: 'OWNER' }],
    });

    await expect(AppRootPage()).rejects.toThrow('NEXT_REDIRECT:/app/bet-demo');
    expect(mockRedirect).toHaveBeenCalledWith('/app/bet-demo');
  });

  it('GIVEN profil avec plusieurs orgs — WHEN page rendue — THEN redirect vers la 1re (ordre memberships)', async () => {
    mockGetMyProfile.mockResolvedValue({
      userId: 'u3',
      email: 'multi@bet.sn',
      fullName: 'Multi Org',
      platformRole: null,
      memberships: [
        { orgId: 'o1', orgName: 'Alpha', orgSlug: 'alpha', role: 'OWNER' },
        { orgId: 'o2', orgName: 'Beta', orgSlug: 'beta', role: 'VIEWER' },
      ],
    });

    await expect(AppRootPage()).rejects.toThrow('NEXT_REDIRECT:/app/alpha');
    expect(mockRedirect).not.toHaveBeenCalledWith('/app/beta');
  });
});
