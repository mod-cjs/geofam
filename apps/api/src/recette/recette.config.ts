/**
 * Configuration de l'environnement de RECETTE, en UN seul endroit (lue depuis
 * l'environnement au moment de l'appel — pas mise en cache au chargement du
 * module — afin que les tests puissent poser/retirer la cle entre les cas).
 */

import type { DeployEnv, ScienceStatus } from '@roadsen/shared';

/** En-tete HTTP porteur de la cle d'acces recette (en MINUSCULES : Node normalise). */
export const RECETTE_KEY_HEADER = 'x-recette-key';

/**
 * Environnement de deploiement, lu depuis `ROADSEN_ENV`. Defaut 'recette' :
 * cette phase est une RECETTE (pas encore de production). N'accepte que les
 * valeurs du contrat ; toute autre valeur retombe sur 'recette' (fail-safe :
 * on n'affiche jamais 'production' par accident).
 */
export function getDeployEnv(): DeployEnv {
  return process.env.ROADSEN_ENV === 'production' ? 'production' : 'recette';
}

/**
 * Etat scientifique expose par la sonde de sante. Tant que le kit cas-tests
 * STARFIRE n'est pas signe (MJ-6), la justesse n'est PAS validee : 'unsigned'.
 * Bascule en 'signed' uniquement quand `ROADSEN_SCIENCE_SIGNED=1` (geste
 * explicite, jamais par defaut).
 */
export function getScienceStatus(): ScienceStatus {
  return process.env.ROADSEN_SCIENCE_SIGNED === '1' ? 'signed' : 'unsigned';
}

/** Nom de la variable d'environnement portant la cle d'acces recette. */
export const RECETTE_API_KEY_ENV = 'RECETTE_API_KEY';

/**
 * Cle d'acces recette configuree, ou `null` si absente/vide. `null` => le guard
 * de recette est INERTE (cf. RecetteAccessGuard) et l'environnement n'est pas
 * verrouille par cle.
 */
export function getRecetteApiKey(): string | null {
  const v = process.env[RECETTE_API_KEY_ENV];
  return typeof v === 'string' && v.length > 0 ? v : null;
}
