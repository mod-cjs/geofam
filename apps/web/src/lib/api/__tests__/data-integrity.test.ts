/**
 * Tests — intégrité des données mock (sentinelles de non-régression)
 *
 * DoD §9 : isolation tenant, cohérence des IDs moteurs.
 *
 *  - Isolation négative : listProjects(org_02) ne renvoie JAMAIS de données org_01.
 *    Devient ROUGE si un écran (ou le mock) cesse de filtrer par orgId.
 *  - Cohérence IDs moteurs : chaque engineId d'entitlements a un descripteur,
 *    et réciproquement (casagrande/geoplaque/fastlab inclus).
 *    Devient ROUGE si descripteurs et vocabulaire d'entitlements divergent (#7).
 */

import { describe, it, expect } from 'vitest';
import { listProjects } from '../client';
import { getMockEntitlements, MOCK_PROJECTS } from '../mock-data';
import { ENGINE_DESCRIPTORS } from '../../engine-descriptors';

// ---------------------------------------------------------------------------
// Isolation négative — un tenant ne voit jamais les données d'un autre
// ---------------------------------------------------------------------------

describe('Isolation tenant — listProjects filtre par orgId', () => {
  it('given org_02, when listProjects, then aucun projet n appartient à org_01', async () => {
    const projects = await listProjects('org_02');
    // Le mock ne contient que des projets org_01 : org_02 doit donc être vide,
    // et SURTOUT ne jamais contenir d'orgId étranger.
    for (const p of projects) {
      expect(p.orgId).toBe('org_02');
      expect(p.orgId).not.toBe('org_01');
    }
  });

  it('given org_02, when listProjects, then la liste ne fuit aucun id de projet org_01', async () => {
    const org01Ids = MOCK_PROJECTS.filter((p) => p.orgId === 'org_01').map((p) => p.id);
    expect(org01Ids.length).toBeGreaterThan(0); // garde-fou : le jeu de données est non vide
    const projects = await listProjects('org_02');
    const leaked = projects.filter((p) => org01Ids.includes(p.id));
    expect(leaked, 'des projets org_01 ont fuité dans la réponse org_02').toHaveLength(0);
  });

  it('given org_01, when listProjects, then on récupère bien ses projets (contre-épreuve)', async () => {
    const projects = await listProjects('org_01');
    expect(projects.length).toBeGreaterThan(0);
    expect(projects.every((p) => p.orgId === 'org_01')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cohérence des IDs moteurs — descripteurs ↔ entitlements
// ---------------------------------------------------------------------------

describe('Cohérence IDs moteurs — ENGINE_DESCRIPTORS ↔ entitlements', () => {
  const descriptorIds = ENGINE_DESCRIPTORS.map((d) => d.id);
  // 'active' = pack COMPLETE → les 6 moteurs
  const entitlementModules = getMockEntitlements('active').modules;

  it('given chaque engineId d entitlements, then il existe un descripteur correspondant', () => {
    for (const m of entitlementModules) {
      expect(descriptorIds, `aucun descripteur pour l'engineId "${m}"`).toContain(m);
    }
  });

  it('given chaque descripteur, then son id figure dans les entitlements pack COMPLETE', () => {
    for (const id of descriptorIds) {
      expect(entitlementModules, `descripteur "${id}" absent des entitlements`).toContain(id);
    }
  });

  it('given les deux ensembles, then ils sont strictement égaux (bijection)', () => {
    expect([...descriptorIds].sort()).toEqual([...entitlementModules].sort());
  });

  it('given le vocabulaire d entitlements, then casagrande/geoplaque/fastlab ont un descripteur (#7)', () => {
    for (const id of ['casagrande', 'geoplaque', 'fastlab']) {
      expect(descriptorIds).toContain(id);
    }
  });

  it('given les descripteurs, then aucun ne porte un ancien id (pieux/radier/labo) — anti-régression #7', () => {
    for (const stale of ['pieux', 'radier', 'labo']) {
      expect(descriptorIds, `id obsolète "${stale}" réintroduit`).not.toContain(stale);
    }
  });
});
