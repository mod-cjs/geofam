/**
 * Nom mnémonique des calculs et des PV (décision titulaire, 22/07/2026).
 *
 * Aujourd'hui, tous les calculs/PV d'un même moteur s'affichent à l'identique
 * (aucun « nom »). On propose un nom mnémonique PAR DÉFAUT, renommable par le
 * client :
 *
 *   Logiciel · Projet · #n   —   ex. « CASAGRANDE · Pont de Mbodiène · #3 »
 *
 *  - Logiciel = nom COURT du logiciel (cf. `engine-labels.ts` `logicielCourtFor`,
 *    source unique SOFTWARE_CATALOG — « CASAGRANDE », « ROADSENS »…), jamais le
 *    nom métier long (« ROADSENS — Chaussées ») déjà utilisé ailleurs à l'écran.
 *  - Projet = nom du projet courant (contexte déjà disponible à l'appelant).
 *  - #n = position 1-based du calcul dans le PROJET, calculs ordonnés par date
 *    de création croissante (cf. `seqParCreation` ci-dessous — calculée sur
 *    l'ensemble COMPLET des calculs, jamais sur une liste déjà filtrée/paginée,
 *    sinon le numéro se déplacerait selon le filtre actif).
 *
 * `nomAffiche` ne fabrique JAMAIS ce mnémonique si un nom personnalisé existe
 * (`entite.name`) : le renommage client prime toujours. `undefined` et `null`
 * sont traités IDENTIQUEMENT (repli mnémonique) — un calcul/PV n'a pas la
 * distinction « nom pas encore connu » vs « pas de nom » qu'on trouve ailleurs
 * (ex. `Project.calcCount`) : l'absence de nom personnalisé n'est jamais une
 * anomalie à signaler, juste l'état par défaut.
 */

import { logicielCourtFor } from './engine-labels';

/** Sous-ensemble minimal requis pour calculer/afficher un nom mnémonique. */
export interface NommableEntity {
  name?: string | null;
  engineId: string;
}

/**
 * Nom affiché d'un calcul ou d'un PV : le nom personnalisé s'il existe
 * (non vide après trim), sinon le mnémonique `Logiciel · Projet · #n`.
 *
 * @param entite      calcul ou PV (name + engineId)
 * @param projectName nom du projet courant
 * @param seq         position 1-based dans le projet (cf. `seqParCreation`)
 */
export function nomAffiche(
  entite: NommableEntity,
  projectName: string,
  seq: number,
): string {
  if (entite.name != null && entite.name.trim().length > 0) return entite.name;
  return `${logicielCourtFor(entite.engineId)} · ${projectName} · #${seq}`;
}

/**
 * Variante COMPACTE pour une colonne étroite : `Logiciel · #n`, sans le nom du
 * projet (décision titulaire 22/07/2026).
 *
 * POURQUOI — vérifié dans l'application réelle : dans la colonne des calculs, le
 * nom complet était tronqué à « ROADSENS · Route Dakar-T… » sur TOUTES les
 * lignes, coupant précisément le `#n`, seule partie distinctive. Le nom du
 * projet y est de toute façon redondant : on est déjà DANS ce projet (fil
 * d'Ariane + bande projet au-dessus). Le nom COMPLET reste affiché là où la
 * place existe (en-tête du panneau de détail) et sur les PV.
 *
 * Un nom personnalisé prime toujours et n'est JAMAIS raccourci : le client l'a
 * choisi, on ne le réécrit pas.
 */
export function nomAfficheCompact(entite: NommableEntity, seq: number): string {
  if (entite.name != null && entite.name.trim().length > 0) return entite.name;
  return `${logicielCourtFor(entite.engineId)} · #${seq}`;
}

/**
 * Calcule la position 1-based de chaque élément dans une liste, ordonnée par
 * une date CROISSANTE (le plus ancien = #1). Renvoie une Map id -> seq pour un
 * lookup O(1) par l'appelant (React re-rend souvent ; ne pas retrier à chaque
 * ligne).
 *
 * `dateOf` reste un paramètre explicite (plutôt qu'un champ `createdAt` fixe)
 * car les calculs (`createdAt`) et les PV (`sealedAt`, pas de `createdAt`
 * propre) n'exposent pas le même nom de champ de date.
 *
 * TOUJOURS appliqué sur l'ensemble COMPLET des éléments d'un projet — jamais
 * sur une liste déjà filtrée/recherchée/paginée, sinon le numéro d'un élément
 * changerait selon le filtre actif (contradiction avec « position dans le
 * projet »).
 */
export function seqParCreation<T extends { id: string }>(
  items: readonly T[],
  dateOf: (item: T) => string,
): Map<string, number> {
  const tries = [...items].sort(
    (a, b) => new Date(dateOf(a)).getTime() - new Date(dateOf(b)).getTime(),
  );
  const map = new Map<string, number>();
  tries.forEach((item, i) => map.set(item.id, i + 1));
  return map;
}
