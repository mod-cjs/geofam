import { describe, it, expect } from 'vitest';

import { matchesDomain } from '../project-domain';
import type { Project } from '../types';

/**
 * matchesDomain — prédicat de filtrage des projets par domaine métier (CH/FD/LB).
 *
 * Règle (bug « swap mock->réel ») : chaque logiciel ne montre que les projets de
 * SON domaine, MAIS un projet legacy (domain=null, créé avant la colonne) a un
 * domaine INCONNU -> on le rend sélectionnable partout (honnête) plutôt
 * qu'invisible partout. Un domaine explicitement DIFFÉRENT est exclu.
 */
function proj(domain: Project['domain']): Project {
  return {
    id: 'p',
    orgId: 'o',
    name: 'n',
    domain,
    createdAt: '',
    updatedAt: '',
    createdBy: 'u',
  };
}

describe('matchesDomain', () => {
  it('given un projet du MÊME domaine, then true', () => {
    expect(matchesDomain(proj('FD'), 'FD')).toBe(true);
  });

  it('given un projet legacy (domain=null), then true pour N IMPORTE quel domaine', () => {
    expect(matchesDomain(proj(null), 'FD')).toBe(true);
    expect(matchesDomain(proj(null), 'CH')).toBe(true);
    expect(matchesDomain(proj(null), 'LB')).toBe(true);
  });

  it('given un projet d un AUTRE domaine explicite, then false', () => {
    expect(matchesDomain(proj('CH'), 'FD')).toBe(false);
    expect(matchesDomain(proj('LB'), 'FD')).toBe(false);
  });
});
