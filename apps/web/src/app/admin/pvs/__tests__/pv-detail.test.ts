// @vitest-environment node
// Server Component async — appelé comme une fonction, retourne des React elements.

/**
 * Tests — /admin/pvs/[pvId] (détail d'un PV, sortie du cul-de-sac de supervision).
 *
 * DoD §9 : test-first, given/when/then, chemin négatif (PV introuvable) testé.
 *
 * Couverture :
 *  - PV introuvable (adminGetPv renvoie null) -> notFound() appelé, pas de crash
 *  - sealValid=true -> badge "Sceau valide" rendu
 *  - sealValid=false -> badge "Sceau invalide" rendu (jamais un texte rassurant)
 */

import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const { mockGetPv, mockNotFound } = vi.hoisted(() => ({
  mockGetPv: vi.fn(),
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/api/admin-server', () => ({
  adminGetPv: mockGetPv,
}));

vi.mock('next/navigation', () => ({
  notFound: mockNotFound,
}));

import PvDetailPage from '../[pvId]/page';

const PV_OK = {
  pvId: 'pv_01',
  pvNumber: 'PV-2026-0001',
  orgId: 'org_01',
  orgName: 'STARFIRE',
  projectName: 'Route N2',
  engineId: 'burmister',
  engineVersion: '1.0.0',
  scienceStatus: 'SIGNED',
  verdict: 'CONFORME',
  sealedAt: '2026-06-01T10:00:00.000Z',
  sealValid: true,
};

describe('PvDetailPage — /admin/pvs/[pvId]', () => {
  it('given un pvId inconnu, when adminGetPv renvoie null, then notFound() est appelé (pas de crash)', async () => {
    mockGetPv.mockResolvedValueOnce(null);
    await expect(
      PvDetailPage({ params: Promise.resolve({ pvId: 'inconnu' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalledOnce();
  });

  it('given un PV au sceau valide, when rendu, then le badge "Sceau valide" est affiché', async () => {
    mockGetPv.mockResolvedValueOnce(PV_OK);
    const el = await PvDetailPage({ params: Promise.resolve({ pvId: 'pv_01' }) });
    const html = renderToStaticMarkup(el);
    expect(html).toContain('Sceau valide');
    expect(html).not.toContain('Sceau invalide');
    expect(html).toContain('PV-2026-0001');
    expect(html).toContain('STARFIRE');
  });

  it('given un PV au sceau cassé, when rendu, then le badge "Sceau invalide" est affiché (jamais un texte rassurant)', async () => {
    mockGetPv.mockResolvedValueOnce({ ...PV_OK, sealValid: false });
    const el = await PvDetailPage({ params: Promise.resolve({ pvId: 'pv_01' }) });
    const html = renderToStaticMarkup(el);
    expect(html).toContain('Sceau invalide');
    expect(html).not.toContain('Sceau valide');
  });
});
