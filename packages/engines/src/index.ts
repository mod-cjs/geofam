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

// Moteur RADIER / PLAQUE sur sol multicouche elastique (GEOPLAQUE, EF) — module pur,
// recalcul serveur. Importe uniquement par apps/api (jamais le front, DoD §8).
//
// Meme raison que les autres : radier exporte aussi `redactConfidentialWarning(s)`
// (nom commun aux moteurs). Re-export EXPLICITE pour eviter l'ambiguite TS2308 ; le
// redacteur reste accessible par import DIRECT du sous-module en test.
export {
  RADIER_ENGINE_ID,
  RadierInputSchema,
  RadierOutputSchema,
  radierContract,
  RADIER_CONFIDENTIAL_MARKER,
  RADIER_FIXTURES,
  runRadier,
  type RadierInput,
  type RadierOutput,
  type RadierFixture,
} from './radier/index.js';

// Moteur FASTLAB — essais de labo & classification GTR (NF P 11-300) — module pur,
// recalcul serveur. Importe uniquement par apps/api (jamais le front, DoD §8).
//
// Meme raison que les autres : labo exporte aussi `redactConfidentialWarning(s)` (nom
// commun aux moteurs). Re-export EXPLICITE pour eviter l'ambiguite TS2308 ; le
// redacteur reste accessible par import DIRECT du sous-module en test.
export {
  LABO_ENGINE_ID,
  LaboInputSchema,
  LaboOutputSchema,
  laboContract,
  LABO_CONFIDENTIAL_MARKER,
  LABO_FIXTURES,
  runLabo,
  type LaboInput,
  type LaboOutput,
  type LaboFixture,
} from './labo/index.js';

// Moteur DEFORMATIONS PLANES / POUTRE (variante « bande » de GEOPLAQUE) — module pur,
// recalcul serveur. Importe uniquement par apps/api (jamais le front, DoD §8).
// Re-export EXPLICITE (comme les autres) : chaque moteur exporte `redactConfidentialWarning(s)`
// -> un `export *` ferait un nom AMBIGU (TS2308). Le redacteur reste accessible par import
// DIRECT du sous-module en test.
export {
  PLANE_STRAIN_ENGINE_ID,
  PlaneStrainInputSchema,
  PlaneStrainOutputSchema,
  planeStrainContract,
  PLANE_STRAIN_CONFIDENTIAL_MARKER,
  PLANE_STRAIN_FIXTURES,
  runPlaneStrain,
  type PlaneStrainInput,
  type PlaneStrainOutput,
  type PlaneStrainFixture,
} from './plane-strain/index.js';

// Moteur AXISYMETRIQUE (radier circulaire / plaque annulaire de GEOPLAQUE) — module pur,
// recalcul serveur. Importe uniquement par apps/api (jamais le front, DoD §8). Le contrat
// axi n'a pas de canal texte (sortie = scalaires) -> pas de redacteur exporte.
export {
  AXI_ENGINE_ID,
  AxiInputSchema,
  AxiOutputSchema,
  AXI_CONTRACT,
  AXI_CONFIDENTIAL_MARKER,
  AXI_FIXTURES,
  runAxi,
  type AxiInput,
  type AxiOutput,
  type AxiFixture,
} from './axi/index.js';

// Moteur RADIER TRIANGULAIRE (DKT, variante mailleur triangulaire de GEOPLAQUE) — module
// pur, recalcul serveur. Importe uniquement par apps/api (jamais le front, DoD §8).
// Re-export EXPLICITE (meme raison que les autres : `redactConfidentialWarning(s)` commun).
export {
  TRI_RAFT_ENGINE_ID,
  TriRaftInputSchema,
  TriRaftOutputSchema,
  triRaftContract,
  TRI_RAFT_CONFIDENTIAL_MARKER,
  TRI_RAFT_FIXTURES,
  runTriRaft,
  type TriRaftInput,
  type TriRaftOutput,
  type TriRaftFixture,
} from './tri-raft/index.js';
