import type { Project, ProjectDomain } from './types';

/**
 * matchesDomain — prédicat de filtrage des projets par domaine métier.
 *
 * Chaque logiciel ne montre que les projets de SON domaine (CH/FD/LB). Exception
 * honnête : un projet LEGACY (domain=null, créé avant l'ajout de la colonne côté
 * base) a un domaine INCONNU -> on le rend sélectionnable dans TOUS les logiciels
 * plutôt qu'invisible partout (bug « swap mock->réel » : sans cette règle, un
 * `p.domain === 'FD'` sur un domain undefined/null vidait toutes les listes).
 */
export function matchesDomain(
  p: Pick<Project, 'domain'>,
  domain: ProjectDomain,
): boolean {
  return p.domain === domain || p.domain === null;
}
