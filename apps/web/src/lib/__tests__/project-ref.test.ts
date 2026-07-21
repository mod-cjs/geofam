// @vitest-environment node
/**
 * Tests — project-ref (référence courte mnémonique d'un projet).
 *
 * DoD §9. Contrat verrouillé ici :
 *  - la référence est DÉRIVÉE de l'identité réelle du projet (domaine, année de
 *    création, id) — jamais d'un numéro de séquence inventé qui pourrait passer
 *    pour une référence officielle (le seul numéro officiel est celui du PV) ;
 *  - elle est DÉTERMINISTE : même projet -> même référence, toujours ;
 *  - elle est STABLE au renommage : renommer un projet ne change pas sa référence
 *    (sinon les références citées dans des échanges deviendraient fausses).
 */

import { describe, it, expect } from 'vitest';

import type { Project } from '../api/types';
import { projectRef } from '../project-ref';

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: '3f7a2c10-9b4e-4d21-8a55-1e2d3c4b5a6f',
    orgId: 'org-1',
    name: 'Route Nationale 2 — section Thiès',
    domain: 'CH',
    createdAt: '2026-04-11T09:42:00.000Z',
    updatedAt: '2026-04-11T09:42:00.000Z',
    createdBy: 'user-1',
    ...over,
  };
}

describe('projectRef — référence courte lisible dérivée du projet', () => {
  it('GIVEN un projet CH créé en 2026 — WHEN projectRef — THEN forme <DOMAINE>-<ANNÉE>-<SUFFIXE>', () => {
    const ref = projectRef(makeProject());
    expect(ref).toMatch(/^CH-2026-[0-9A-Z]{4}$/);
  });

  it('GIVEN le même projet — WHEN projectRef deux fois — THEN référence identique (déterminisme)', () => {
    const p = makeProject();
    expect(projectRef(p)).toBe(projectRef(p));
  });

  it('GIVEN un projet renommé — WHEN projectRef — THEN la référence NE change PAS (stabilité)', () => {
    const avant = projectRef(makeProject({ name: 'Ancien nom' }));
    const apres = projectRef(makeProject({ name: 'Tout autre nom' }));
    expect(apres).toBe(avant);
  });

  it('GIVEN deux projets d’id différents — WHEN projectRef — THEN suffixes différents', () => {
    const a = projectRef(makeProject({ id: 'aaaaaaaa-0000-0000-0000-000000000001' }));
    const b = projectRef(makeProject({ id: 'bbbbbbbb-0000-0000-0000-000000000002' }));
    expect(a).not.toBe(b);
  });

  it('GIVEN les domaines FD et LB — WHEN projectRef — THEN le préfixe suit le domaine', () => {
    expect(projectRef(makeProject({ domain: 'FD' }))).toMatch(/^FD-2026-/);
    expect(projectRef(makeProject({ domain: 'LB' }))).toMatch(/^LB-2026-/);
  });

  it('GIVEN un projet LEGACY sans domaine — WHEN projectRef — THEN préfixe neutre GEN, jamais d’exception', () => {
    expect(projectRef(makeProject({ domain: null }))).toMatch(/^GEN-2026-[0-9A-Z]{4}$/);
  });

  it('GIVEN une date de création d’une autre année — WHEN projectRef — THEN l’année suit createdAt', () => {
    expect(projectRef(makeProject({ createdAt: '2025-12-31T23:00:00.000Z' }))).toMatch(
      /^CH-2025-/,
    );
  });

  it('GIVEN un createdAt invalide — WHEN projectRef — THEN pas de NaN dans la référence', () => {
    const ref = projectRef(makeProject({ createdAt: 'pas-une-date' }));
    expect(ref).not.toContain('NaN');
    expect(ref).toMatch(/^CH-[0-9]{4}-[0-9A-Z]{4}$/);
  });
});
