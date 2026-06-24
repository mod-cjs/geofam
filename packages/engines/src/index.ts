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

// Moteur chaussees (burmister, AGEROUTE Senegal 2015) — module pur, recalcul
// serveur. Importe uniquement par apps/api (jamais le front, DoD §8).
//
// NB : terzaghi ET burmister exportent chacun le helper INTERNE
// `redactConfidentialWarning(s)`. Un `export *` des deux ferait un nom AMBIGU
// (TS2308). On re-exporte donc burmister de facon EXPLICITE (API publique
// uniquement) ; les redacteurs restent accessibles par import DIRECT du
// sous-module (./burmister/index.js) — c'est ainsi que les tests les utilisent,
// jamais via la racine du package.
export {
  BURMISTER_ENGINE_ID,
  BurmisterInputSchema,
  BurmisterOutputSchema,
  burmisterContract,
  BURMISTER_CONFIDENTIAL_MARKER,
  AGEROUTE_MATERIALS,
  BURMISTER_FIXTURES,
  runBurmister,
  type BurmisterInput,
  type BurmisterOutput,
  type BurmisterFixture,
} from './burmister/index.js';

// Moteur pressiometre Menard (NF EN ISO 22476-4) — module pur, recalcul serveur.
// Importe uniquement par apps/api (jamais le front, DoD §8).
//
// Meme raison que burmister : pressiometre exporte aussi `redactConfidentialWarning(s)`
// (nom commun aux 6 moteurs). Re-export EXPLICITE pour eviter l'ambiguite TS2308 ;
// le redacteur reste accessible par import DIRECT du sous-module en test.
export {
  PRESSIOMETRE_ENGINE_ID,
  PressiometreInputSchema,
  PressiometreOutputSchema,
  pressiometreContract,
  PRESSIOMETRE_CONFIDENTIAL_MARKER,
  PRESSIOMETRE_FIXTURES,
  runPressiometre,
  type PressiometreInput,
  type PressiometreOutput,
  type PressiometreFixture,
} from './pressiometre/index.js';

// Moteur PIEUX — fondations profondes (casagrande, NF P 94-262) — module pur,
// recalcul serveur. Importe uniquement par apps/api (jamais le front, DoD §8).
//
// Meme raison que burmister/pressiometre : pieux exporte aussi
// `redactConfidentialWarning(s)` (nom commun aux 6 moteurs). Re-export EXPLICITE pour
// eviter l'ambiguite TS2308 ; le redacteur reste accessible par import DIRECT du
// sous-module en test.
export {
  PIEUX_ENGINE_ID,
  PIEUX_DEFAULT_COEFFS,
  PieuxInputSchema,
  PieuxOutputSchema,
  pieuxContract,
  PIEUX_CONFIDENTIAL_MARKER,
  PIEUX_FIXTURES,
  runPieux,
  type PieuxInput,
  type PieuxOutput,
  type PieuxFixture,
} from './pieux/index.js';
