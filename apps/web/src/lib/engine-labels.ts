/**
 * FX-10 — Noms mnémoniques des moteurs, source UNIQUE.
 *
 * Le backend persiste l'engineId comme registryId brut (ex.
 * 'chaussee-burmister') — jamais un nom métier. Ce module centralise :
 *  - la normalisation registryId -> slug métier court (aligné sur
 *    `SoftwareEntry.engineId` de software-catalog.ts, la galerie des 6
 *    logiciels GEOFAM) ;
 *  - le nom métier humanisé pour l'affichage (« ROADSENS — Chaussées »).
 *
 * Utilisé par CalculsClient, la Vue d'ensemble et PV & Livrables — plus de
 * copie locale de ce mapping (auparavant dupliqué uniquement dans
 * CalculsClient, ce qui laissait les autres écrans afficher le slug brut).
 */

// registryId (persisté backend) → slug métier court (route logiciel + libellé).
const ENGINE_ID_ALIAS: Record<string, string> = {
  'chaussee-burmister': 'burmister',
  'fondation-superficielle': 'terzaghi',
  'pressiometre-menard': 'pressiometre',
  'fondation-profonde-pieux': 'pieux',
  // GEOPLAQUE = UN logiciel à 4 modes, persistés avec des registryId distincts.
  // Les 4 mappent vers « radier » (le logiciel), sinon les 3 non-plaque
  // échappaient à la chip GEOPLAQUE (compteur faux : 26+7+4 != 40) et
  // s'affichaient avec leur registryId brut (« axi-plaque » à l'écran).
  'radier-plaque': 'radier',
  'axi-plaque': 'radier',
  'plane-strain': 'radier',
  'radier-tri': 'radier',
  'labo-classification-gtr': 'labo',
  'fondation-terzaghi': 'terzaghi',
};

// slug → nom métier du logiciel. Alignés sur `SOFTWARE_CATALOG[].nom`
// (software-catalog.ts) ; suffixe descriptif propre à cet affichage (le
// catalogue porte une tagline plus longue, pas réutilisable telle quelle).
const ENGINE_META: Record<string, { nom: string }> = {
  burmister: { nom: 'ROADSENS — Chaussées' },
  terzaghi: { nom: 'Terzaghi — Fondations superficielles' },
  pieux: { nom: 'CASAGRANDE — Pieux' },
  radier: { nom: 'GEOPLAQUE — Radier' },
  pressiometre: { nom: 'PressioPro — Pressiomètre' },
  labo: { nom: 'FASTLAB — Laboratoire' },
};

/** Normalise un registryId backend (ou un slug déjà court) vers le slug métier. */
export function slugOf(engineId: string): string {
  return ENGINE_ID_ALIAS[engineId] ?? engineId;
}

/**
 * Métadonnées d'affichage pour un engineId/registryId. Un moteur inconnu
 * retombe sur l'id brut (jamais d'exception) — mêmes garanties défensives que
 * DomainTag pour un domaine inconnu.
 */
export function metaOf(engineId: string): { nom: string } {
  return ENGINE_META[slugOf(engineId)] ?? { nom: engineId };
}
