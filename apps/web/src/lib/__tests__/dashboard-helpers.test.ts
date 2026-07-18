// @vitest-environment node
/**
 * Tests — helpers purs du dashboard d'organisation (item PRODUIT #1).
 * DoD §9 : given/when/then, chemins négatifs testés, zéro faux-vert.
 *
 * `mergeRecentPvs` agrège les PV de plusieurs projets (aucun endpoint org-wide
 * de listing PV côté backend — cf. mission « zéro nouveau backend ») : trié
 * par date de scellement décroissante, résolu avec le nom du projet, borné à
 * `limit`.
 */

import { describe, it, expect } from 'vitest';

import { mergeRecentPvs, sortProjectsByRecency } from '../dashboard-helpers';
import type { OfficialPv, Project } from '../api/types';

function pv(over: Partial<OfficialPv> = {}): OfficialPv {
  return {
    id: 'pv_1',
    number: 'PV-2026-0001',
    orgId: 'org_1',
    projectId: 'proj_1',
    calcResultId: 'calc_1',
    engineId: 'burmister',
    hmacTruncated: 'abcd1234',
    sealedAt: '2026-07-01T00:00:00.000Z',
    sealedBy: 'Amadou Diallo',
    params: {},
    output: {},
    ...over,
  };
}

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'proj_1',
    orgId: 'org_1',
    name: 'Route A12',
    domain: 'CH',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'u1',
    ...over,
  };
}

describe('mergeRecentPvs', () => {
  it('given des PV de plusieurs projets — when fusionnés — then triés par sealedAt décroissant', () => {
    const projects = [project({ id: 'p1', name: 'Route A12' }), project({ id: 'p2', name: 'Fondation B' })];
    const pvsByProject = [
      [pv({ id: 'pv_old', projectId: 'p1', sealedAt: '2026-06-01T00:00:00.000Z' })],
      [pv({ id: 'pv_new', projectId: 'p2', sealedAt: '2026-07-10T00:00:00.000Z' })],
    ];

    const merged = mergeRecentPvs(pvsByProject, projects, 5);

    expect(merged.map((p) => p.id)).toEqual(['pv_new', 'pv_old']);
  });

  it('given le nom du projet résolu via son id — when fusionné — then projectName est attaché à chaque entrée', () => {
    const projects = [project({ id: 'p1', name: 'Route A12' })];
    const merged = mergeRecentPvs([[pv({ projectId: 'p1' })]], projects, 5);

    expect(merged[0].projectName).toBe('Route A12');
  });

  it('given un projet introuvable dans la liste fournie (projet supprimé entre-temps) — when fusionné — then un libellé de repli est utilisé plutôt qu’un plantage', () => {
    const merged = mergeRecentPvs([[pv({ projectId: 'inconnu' })]], [], 5);

    expect(merged[0].projectName).toBe('Projet');
  });

  it('given plus de PV que la limite — when fusionné — then borné à `limit`', () => {
    const projects = [project({ id: 'p1' })];
    const many = Array.from({ length: 8 }, (_, i) =>
      pv({ id: `pv_${i}`, projectId: 'p1', sealedAt: `2026-07-0${(i % 9) + 1}T00:00:00.000Z` }),
    );

    const merged = mergeRecentPvs([many], projects, 3);

    expect(merged).toHaveLength(3);
  });

  it('given aucun PV (organisation neuve) — when fusionné — then tableau vide (pas d’exception)', () => {
    expect(mergeRecentPvs([], [], 5)).toEqual([]);
  });
});

describe('sortProjectsByRecency', () => {
  it('given des projets à updatedAt différents — when triés — then le plus récent en premier', () => {
    const projects = [
      project({ id: 'old', updatedAt: '2026-01-01T00:00:00.000Z' }),
      project({ id: 'new', updatedAt: '2026-07-15T00:00:00.000Z' }),
    ];

    const sorted = sortProjectsByRecency(projects);

    expect(sorted.map((p) => p.id)).toEqual(['new', 'old']);
  });

  it('given un tableau vide — when trié — then tableau vide (pas d’exception)', () => {
    expect(sortProjectsByRecency([])).toEqual([]);
  });

  it('given un tableau de projets — when trié — then la liste d’origine n’est pas mutée', () => {
    const projects = [
      project({ id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' }),
      project({ id: 'b', updatedAt: '2026-07-15T00:00:00.000Z' }),
    ];
    const original = [...projects];

    sortProjectsByRecency(projects);

    expect(projects).toEqual(original);
  });
});
