// @vitest-environment node
/**
 * P0-1 (suite de revue adverse) — INVALIDATION DU CACHE PROJET.
 *
 * DÉFAUT QUE CE TEST VERROUILLE
 * -----------------------------
 * Depuis que les compteurs viennent du projet (`calcCount` / `pvCount`) et non
 * plus d'un appel de liste, ils héritent du cache de `getProjectCached` — une
 * Map de module, SANS TTL, purgée uniquement au renommage et à la suppression.
 *
 * Ni la création d'un calcul ni l'émission d'un PV ne la purgeaient. Scénario
 * concret relevé en revue adverse :
 *   ouvrir un projet (pastille « Calculs 5 ») -> lancer un calcul -> l'onglet
 *   Calculs liste 6 lignes, la pastille 20 px au-dessus affiche toujours 5.
 * L'écran se contredit lui-même, et l'écart dure toute la session (seul un F5
 * le corrige).
 *
 * CONTRAT VERROUILLÉ (given/when/then)
 *  #1 lancer un calcul invalide le cache du projet concerné ;
 *  #2 sceller un PV l'invalide aussi ;
 *  #3 l'invalidation est CIBLÉE : le cache d'un autre projet n'est pas purgé
 *     (sinon on rechargerait tout le tenant à chaque calcul) ;
 *  #4 elle est scopée par organisation : la clé de cache inclut l'orgId.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Le module client lit `_USE_REAL_BACKEND` au chargement ; en test sans
// NEXT_PUBLIC_API_BASE_URL on est en mode mock, ce qui suffit : on teste la
// politique d'invalidation, pas le transport.
import {
  getProjectCached,
  runCalc,
  emitPv,
  __projectCacheSize,
  __projectCacheHas,
} from '../client';

const ORG = 'org-1';
const ORG_B = 'org-2';

describe('Cache projet — invalidation sur création de calcul / émission de PV', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('GIVEN un projet en cache — WHEN runCalc — THEN son entrée de cache est purgée', async () => {
    const projet = (await import('../mock-data')).MOCK_PROJECTS[0];
    await getProjectCached(ORG, projet.id);
    expect(__projectCacheHas(ORG, projet.id)).toBe(true);

    await runCalc(ORG, projet.id, {
      engineId: 'chaussee-burmister',
      label: 'essai',
      params: {},
    }).catch(() => {
      /* le résultat du calcul n'importe pas ici : seule l'invalidation compte */
    });

    // Sans purge, la pastille resterait sur l'ancien compte tant que dure la
    // session — l'onglet Calculs, lui, afficherait déjà la nouvelle ligne.
    expect(__projectCacheHas(ORG, projet.id)).toBe(false);
  });

  it('GIVEN un projet en cache — WHEN emitPv — THEN son entrée de cache est purgée', async () => {
    const projet = (await import('../mock-data')).MOCK_PROJECTS[0];
    await getProjectCached(ORG, projet.id);
    expect(__projectCacheHas(ORG, projet.id)).toBe(true);

    await emitPv(ORG, projet.id, { calcResultId: 'calc-1' } as never).catch(() => {
      /* idem : on ne teste pas le scellement, seulement l'invalidation */
    });

    expect(__projectCacheHas(ORG, projet.id)).toBe(false);
  });

  it('GIVEN deux projets en cache — WHEN runCalc sur l’un — THEN l’autre reste en cache', async () => {
    const mocks = (await import('../mock-data')).MOCK_PROJECTS;
    if (mocks.length < 2) return; // jeu de mock trop petit : rien à prouver ici
    const [a, b] = mocks;
    await getProjectCached(ORG, a.id);
    await getProjectCached(ORG, b.id);

    await runCalc(ORG, a.id, {
      engineId: 'chaussee-burmister',
      label: 'essai',
      params: {},
    }).catch(() => {});

    // Purge CIBLÉE : vider tout le cache rechargerait inutilement le tenant.
    expect(__projectCacheHas(ORG, a.id)).toBe(false);
    expect(__projectCacheHas(ORG, b.id)).toBe(true);
  });

  it('GIVEN le même projet vu depuis deux orgs — WHEN runCalc sur l’une — THEN l’autre n’est pas purgée', async () => {
    const projet = (await import('../mock-data')).MOCK_PROJECTS[0];
    await getProjectCached(ORG, projet.id);
    await getProjectCached(ORG_B, projet.id);
    const avant = __projectCacheSize();
    expect(avant).toBeGreaterThanOrEqual(2);

    await runCalc(ORG, projet.id, {
      engineId: 'chaussee-burmister',
      label: 'essai',
      params: {},
    }).catch(() => {});

    // La clé de cache est (orgId, projectId) : l'invalidation doit rester
    // scopée, sinon un tenant ferait recharger le cache d'un autre.
    expect(__projectCacheHas(ORG, projet.id)).toBe(false);
    expect(__projectCacheHas(ORG_B, projet.id)).toBe(true);
  });
});
