/**
 * Marqueur de confidentialite des moteurs (DoD 8).
 *
 * Chaque module moteur DOIT referencer ENGINE_BUNDLE_MARKER (ex. dans une
 * constante, un en-tete ou une assertion). C est une CHAINE LITTERALE stable :
 * un minifieur renomme les symboles mais ne reecrit pas le contenu des chaines.
 * Si du code moteur fuit dans le bundle navigateur, cette chaine fuit avec lui,
 * et l etape "Controle de confidentialite" de la CI (grep sur apps/web/.next)
 * fait echouer le build.
 *
 * NE JAMAIS importer ce fichier (ni quoi que ce soit de @roadsen/engines) depuis
 * apps/web : le garde-fou ESLint le bloque (1ere barriere). Ce marqueur est la
 * 2e barriere, au cas ou la 1ere serait contournee.
 */
export const ENGINE_BUNDLE_MARKER =
  '__ROADSEN_ENGINE_CONFIDENTIAL_DO_NOT_SHIP__' as const;
