// @vitest-environment node
// Environnement Node : AdminDashboardPage est un Server Component async —
// appelé comme une fonction, il retourne des React elements (objets).

/**
 * Tests — /admin (tableau de bord plateforme, remplace l'ancien redirect).
 *
 * DoD §9 : test-first, given/when/then, chemins négatifs testés, zéro faux-vert.
 *
 * Couverture :
 *  - Stats indisponibles (backend KO) → panneau d'erreur rendu, pas de crash
 *  - Stats disponibles, aucune alerte → message "sain" rendu
 *  - Stats disponibles avec alertes (expirés/expirant/quota 90%/sans abo) → alertes rendues
 *  - Flux d'activité vide → message "aucune activité"
 *  - Flux d'activité avec entrées → entrées rendues
 */

import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const { mockGetStats, mockListGlobalAudit } = vi.hoisted(() => ({
  mockGetStats: vi.fn(),
  mockListGlobalAudit: vi.fn(),
}));

vi.mock('@/lib/api/admin-server', () => ({
  adminGetStats: mockGetStats,
  adminListGlobalAudit: mockListGlobalAudit,
}));

import AdminDashboardPage from '../page';

const HEALTHY_STATS = {
  orgs: { active: 3, suspended: 1, archived: 0 },
  usersTotal: 10,
  membershipsActive: 12,
  pvTotal: 42,
  quota: { allouTotal: 1000, consommeTotal: 200 },
  abonnements: { expirant30j: 0, expires: 0, orgsSansAbo: 0, orgsQuota90pct: 0 },
};

describe('AdminDashboardPage — landing back-office (§1 vague B)', () => {
  it('GIVEN adminGetStats renvoie null (backend KO) — WHEN page rendue — THEN panneau erreur affiché', async () => {
    mockGetStats.mockResolvedValue(null);
    mockListGlobalAudit.mockResolvedValue([]);

    const el = await AdminDashboardPage();
    const html = renderToStaticMarkup(el);

    expect(html).toContain('Impossible de charger les statistiques');
  });

  it('GIVEN stats saines (aucune alerte) — WHEN page rendue — THEN message "aucune alerte" affiché', async () => {
    mockGetStats.mockResolvedValue(HEALTHY_STATS);
    mockListGlobalAudit.mockResolvedValue([]);

    const el = await AdminDashboardPage();
    const html = renderToStaticMarkup(el);

    expect(html).toContain('Aucune alerte');
    expect(html).toContain('Organisations actives');
  });

  it('GIVEN abonnements expirés + expirant + quota 90% + sans abo — WHEN page rendue — THEN les 4 alertes affichées', async () => {
    mockGetStats.mockResolvedValue({
      ...HEALTHY_STATS,
      abonnements: { expirant30j: 2, expires: 1, orgsSansAbo: 3, orgsQuota90pct: 5 },
    });
    mockListGlobalAudit.mockResolvedValue([]);

    const el = await AdminDashboardPage();
    const html = renderToStaticMarkup(el);

    expect(html).toContain('abonnement expiré');
    expect(html).toContain('expirant sous 30 jours');
    expect(html).toContain('≥ 90 % de quota');
    expect(html).toContain('sans abonnement');
  });

  it('GIVEN aucune activité récente — WHEN page rendue — THEN message "Aucune activité récente"', async () => {
    mockGetStats.mockResolvedValue(HEALTHY_STATS);
    mockListGlobalAudit.mockResolvedValue([]);

    const el = await AdminDashboardPage();
    const html = renderToStaticMarkup(el);

    expect(html).toContain('Aucune activité récente');
  });

  it('GIVEN des entrées d\'audit récentes — WHEN page rendue — THEN les actions apparaissent dans le flux', async () => {
    mockGetStats.mockResolvedValue(HEALTHY_STATS);
    mockListGlobalAudit.mockResolvedValue([
      {
        id: 'a1',
        actorUserId: 'u1',
        action: 'QUOTA_TOPUP',
        targetOrgId: 'o1',
        targetUserId: null,
        payload: { motif: 'ajustement' },
        createdAt: new Date().toISOString(),
      },
    ]);

    const el = await AdminDashboardPage();
    const html = renderToStaticMarkup(el);

    expect(html).toContain('QUOTA_TOPUP');
    expect(html).not.toContain('Aucune activité récente');
  });
});
