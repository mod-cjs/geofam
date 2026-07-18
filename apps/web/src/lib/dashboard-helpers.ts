/**
 * Helpers purs — dashboard d'organisation (`/app/[orgSlug]`).
 *
 * Aucun endpoint org-wide de listing des PV n'existe côté backend (PV listés
 * par projet uniquement — GET /projects/:id/pvs). Le dashboard agrège donc les
 * PV des projets les plus récents côté client, plutôt que d'ajouter un
 * endpoint (hors périmètre de ce lot). `mergeRecentPvs` isole cette logique
 * pure pour qu'elle soit testable sans rendu React.
 *
 * Aucune formule de calcul, aucun import moteur.
 */

import type { OfficialPv, Project } from './api/types';

export interface RecentPvEntry extends OfficialPv {
  /** Nom du projet résolu — libellé de repli si le projet est introuvable. */
  projectName: string;
}

const FALLBACK_PROJECT_NAME = 'Projet';

/**
 * Fusionne les PV de plusieurs projets, triés par date de scellement
 * décroissante, avec le nom du projet attaché, bornés à `limit`.
 */
export function mergeRecentPvs(
  pvsByProject: OfficialPv[][],
  projects: Pick<Project, 'id' | 'name'>[],
  limit: number,
): RecentPvEntry[] {
  const nameById = new Map(projects.map((p) => [p.id, p.name]));

  return pvsByProject
    .flat()
    .map((pv) => ({ ...pv, projectName: nameById.get(pv.projectId) ?? FALLBACK_PROJECT_NAME }))
    .sort((a, b) => new Date(b.sealedAt).getTime() - new Date(a.sealedAt).getTime())
    .slice(0, limit);
}

/** Trie une liste de projets par updatedAt décroissant, sans muter l'entrée. */
export function sortProjectsByRecency(projects: Project[]): Project[] {
  return [...projects].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}
