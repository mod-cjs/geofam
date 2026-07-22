/**
 * Fixtures partagées — tests de la liste des projets (écran 1, maquette
 * validée 21/07/2026). Un seul jeu de données pour éviter que chaque test
 * réinvente un projet légèrement différent (source d'écarts silencieux).
 */

import type { Project } from '@/lib/api/types';

export const ORG_ID = 'org-1';
export const ORG_SLUG = 'starfire';

export function projet(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-x',
    orgId: ORG_ID,
    name: 'Projet',
    domain: 'CH',
    createdAt: '2026-07-17T12:00:00.000Z',
    updatedAt: '2026-07-17T12:00:00.000Z',
    lastActivityAt: '2026-07-19T16:32:00.000Z',
    lastActivityKind: 'projet',
    createdBy: 'user-1',
    calcCount: 0,
    pvCount: 0,
    ...overrides,
  };
}

/**
 * 4 projets ACTIFS — mêmes proportions que la maquette (2 CH, 1 FD, 1 LB),
 * une description présente, une absente (pour couvrir « Aucune description »).
 */
export const PROJETS_ACTIFS: Project[] = [
  projet({
    id: 'p-ch1',
    name: 'Route Dakar-Thiès — dimensionnement',
    description: 'Chaussée neuve, section courante.',
    domain: 'CH',
    calcCount: 6,
    pvCount: 5,
    lastActivityKind: 'pv',
  }),
  projet({
    id: 'p-fd1',
    name: 'Pont de Mbodiène — fondations',
    description: 'Fondations profondes des appuis — pieux, semelles et radiers.',
    domain: 'FD',
    calcCount: 40,
    pvCount: 4,
    lastActivityKind: 'calcul',
  }),
  projet({
    id: 'p-lb1',
    name: 'Étude',
    description: 'Essais de laboratoire — reconnaissance préalable.',
    domain: 'LB',
    calcCount: 7,
    pvCount: 0,
    lastActivityKind: 'calcul',
  }),
  projet({
    id: 'p-ch2',
    name: 'Essai brut',
    domain: 'CH',
    calcCount: 2,
    pvCount: 1,
    lastActivityKind: 'calcul',
    // Pas de description — couvre « Aucune description. »
  }),
];

export const PROJETS_ARCHIVES: Project[] = [];
