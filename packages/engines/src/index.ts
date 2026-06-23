/**
 * Point d entree de @roadsen/engines (CONFIDENTIEL, COTE SERVEUR UNIQUEMENT).
 *
 * Pour l instant n exporte que le REGISTRE des versions de moteur (metadonnees
 * de tracabilite : ni formule ni symbole de calcul). Les modules de calcul
 * extraits viendront s ajouter ici, importes uniquement par apps/api.
 */
export * from './registry/registry.js';

// Moteur fondation superficielle (terzaghi, NF P 94-261) — module pur, recalcul
// serveur. Importe uniquement par apps/api (jamais le front, DoD §8).
export * from './terzaghi/index.js';
