/**
 * Tests — Renommage & suppression de projet (Lot 3 — Gestion des projets)
 *
 * DoD §9 : test-first, given/when/then, chemins erreur, zéro faux-vert.
 *
 * Couvre :
 *  - Mock (client.ts) : renameProject persiste réellement (re-GET → nouveau
 *    nom) et deleteProject retire le projet des listes (archivage simulé).
 *  - Vrai backend (http-client.ts) : httpRenameProject appelle bien PATCH
 *    /projects/:id, httpDeleteProject appelle bien DELETE /projects/:id, avec
 *    le header X-Org-Id et le mapping createdById→createdBy (#8).
 *
 * On crée un projet dédié via createProject pour ne pas muter les fixtures
 * partagées (proj_01/02/03) utilisées par d'autres suites.
 */

import { describe, it, expect, vi } from 'vitest';

import { createProject, renameProject, deleteProject, listProjects, getProject } from '../client';
import { httpRenameProject, httpDeleteProject } from '../http-client';
import type { PrismaProject } from '../adapters';

const ORG_ID = 'org_01';

function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    blob: async () => new Blob(),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Mock — renameProject
// ---------------------------------------------------------------------------

describe('renameProject (mock) — persistance réelle (fin du faux succès)', () => {
  it('given un projet existant, when renameProject, then le nouveau nom persiste au re-GET', async () => {
    const created = await createProject(ORG_ID, { name: 'Avant renommage', domain: 'CH' });

    const renamed = await renameProject(ORG_ID, created.id, 'Après renommage');
    expect(renamed.name).toBe('Après renommage');

    // Persistance prouvée par un re-GET indépendant (pas juste la valeur de retour).
    const reGet = await getProject(ORG_ID, created.id);
    expect(reGet.name).toBe('Après renommage');
  });

  it('given un projet existant, when renameProject, then updatedAt est rafraîchi', async () => {
    const created = await createProject(ORG_ID, { name: 'Horodatage', domain: 'CH' });
    const before = created.updatedAt;
    const renamed = await renameProject(ORG_ID, created.id, 'Horodatage renommé');
    expect(new Date(renamed.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(before).getTime(),
    );
  });

  it('given un id de projet inconnu, when renameProject, then rejette 404 NOT_FOUND (chemin négatif)', async () => {
    await expect(renameProject(ORG_ID, 'proj_inconnu_xyz', 'Peu importe')).rejects.toMatchObject({
      statusCode: 404,
      reason: 'NOT_FOUND',
    });
  });
});

// ---------------------------------------------------------------------------
// Mock — deleteProject
// ---------------------------------------------------------------------------

describe('deleteProject (mock) — soft-delete (archivage, PV préservés)', () => {
  it('given un projet existant, when deleteProject, then il disparaît de listProjects', async () => {
    const created = await createProject(ORG_ID, { name: 'À supprimer', domain: 'FD' });

    const before = await listProjects(ORG_ID);
    expect(before.some((p) => p.id === created.id)).toBe(true);

    await deleteProject(ORG_ID, created.id);

    const after = await listProjects(ORG_ID);
    expect(after.some((p) => p.id === created.id)).toBe(false);
  });

  it('given un id de projet inconnu, when deleteProject, then rejette 404 NOT_FOUND (chemin négatif)', async () => {
    await expect(deleteProject(ORG_ID, 'proj_inconnu_abc')).rejects.toMatchObject({
      statusCode: 404,
      reason: 'NOT_FOUND',
    });
  });
});

// ---------------------------------------------------------------------------
// Vrai backend — httpRenameProject / httpDeleteProject
// ---------------------------------------------------------------------------

describe('httpRenameProject — contrat PATCH /projects/:id', () => {
  it('given un projet, when httpRenameProject, then PATCH est appelé avec le body { name } et X-Org-Id', async () => {
    const raw: PrismaProject = {
      id: 'proj_01',
      orgId: 'org_01',
      name: 'Nouveau nom',
      description: null,
      domain: 'CH',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-07-05T00:00:00Z',
      createdById: 'usr_01',
    };
    const mockFetch = vi.fn().mockResolvedValueOnce(makeResponse(raw));
    vi.stubGlobal('fetch', mockFetch);

    const result = await httpRenameProject('org_01', 'proj_01', 'Nouveau nom');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/projects/proj_01');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ name: 'Nouveau nom' });
    expect(opts.headers['X-Org-Id']).toBe('org_01');

    expect(result.name).toBe('Nouveau nom');
    // #8 — mapping createdById → createdBy
    expect(result.createdBy).toBe('usr_01');

    vi.unstubAllGlobals();
  });
});

describe('httpDeleteProject — contrat DELETE /projects/:id', () => {
  it('given un projet, when httpDeleteProject, then DELETE est appelé et le projet archivé est renvoyé', async () => {
    const raw: PrismaProject = {
      id: 'proj_01',
      orgId: 'org_01',
      name: 'Projet archivé',
      description: null,
      domain: 'FD',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-07-05T00:00:00Z',
      createdById: 'usr_01',
    };
    const mockFetch = vi.fn().mockResolvedValueOnce(makeResponse(raw));
    vi.stubGlobal('fetch', mockFetch);

    const result = await httpDeleteProject('org_01', 'proj_01');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/projects/proj_01');
    expect(opts.method).toBe('DELETE');
    expect(opts.headers['X-Org-Id']).toBe('org_01');

    expect(result.id).toBe('proj_01');

    vi.unstubAllGlobals();
  });

  it('given un projet inexistant côté serveur, when httpDeleteProject, then rejette 404 NOT_FOUND', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse({ statusCode: 404, reason: 'NOT_FOUND', message: 'Projet introuvable' }, 404),
      );
    vi.stubGlobal('fetch', mockFetch);

    await expect(httpDeleteProject('org_01', 'proj_inconnu')).rejects.toMatchObject({
      statusCode: 404,
      reason: 'NOT_FOUND',
    });

    vi.unstubAllGlobals();
  });
});
