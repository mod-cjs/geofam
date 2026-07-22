/**
 * P0-9 — SUPPRESSION DÉFINITIVE (contrat client — mode mock).
 *
 * `deleteProjectPermanently` (client.ts) est irréversible, à la différence de
 * `deleteProject` (archivage). Contrat serveur (posé en parallèle par un autre
 * agent) : 200 + projet supprimé · 409 si le projet porte un PV scellé · 404
 * tenant-safe sinon. Ces tests couvrent le comportement du MODE MOCK, seul
 * exerçable ici sans backend réel.
 *
 * CONTRAT VERROUILLÉ (given/when/then)
 *  #1 un id inexistant → 404 NOT_FOUND, rien n'est modifié ;
 *  #2 un projet portant un PV scellé → 409, message exploitable, rien retiré ;
 *  #3 un projet SANS PV → retiré de la liste, projet renvoyé.
 */

import { describe, it, expect } from 'vitest';

import { deleteProjectPermanently } from '@/lib/api/client';
import { MOCK_PROJECTS, MOCK_PVS } from '@/lib/api/mock-data';

const ORG = 'org_01';

describe('deleteProjectPermanently — mode mock', () => {
  it('#1 GIVEN un id inexistant — WHEN on supprime définitivement — THEN 404 NOT_FOUND', async () => {
    const before = MOCK_PROJECTS.length;
    await expect(
      deleteProjectPermanently(ORG, 'proj_inexistant_xyz'),
    ).rejects.toMatchObject({ statusCode: 404, reason: 'NOT_FOUND' });
    expect(MOCK_PROJECTS).toHaveLength(before);
  });

  it('#2 GIVEN un projet portant un PV scellé — WHEN on supprime définitivement — THEN 409 avec un message exploitable, rien n’est retiré', async () => {
    const before = MOCK_PROJECTS.length;
    // proj_01 porte pv_01 (fixture MOCK_PVS) — condition du test.
    expect(MOCK_PVS.some((v) => v.projectId === 'proj_01')).toBe(true);

    let caught: { statusCode?: number; message?: string } | undefined;
    try {
      await deleteProjectPermanently(ORG, 'proj_01');
    } catch (err) {
      caught = err as { statusCode?: number; message?: string };
    }
    expect(caught?.statusCode).toBe(409);
    expect(caught?.message ?? '').toMatch(/pv/i);
    // Rien de retiré : le refus doit être total, pas une suppression partielle.
    expect(MOCK_PROJECTS).toHaveLength(before);
    expect(MOCK_PROJECTS.some((p) => p.id === 'proj_01')).toBe(true);
  });

  it('#3 GIVEN un projet SANS PV — WHEN on supprime définitivement — THEN il est retiré et renvoyé', async () => {
    const temp = {
      id: 'proj_test_hard_delete_ok',
      orgId: ORG,
      name: 'Projet jetable — test suppression définitive',
      domain: 'CH' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'usr_01',
    };
    MOCK_PROJECTS.push(temp);
    expect(MOCK_PVS.some((v) => v.projectId === temp.id)).toBe(false);

    const removed = await deleteProjectPermanently(ORG, temp.id);
    expect(removed.id).toBe(temp.id);
    expect(MOCK_PROJECTS.some((p) => p.id === temp.id)).toBe(false);
  });
});
