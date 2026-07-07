/**
 * Catalogue CLIENT-SAFE des 6 logiciels GEOFAM (galerie + pages logiciel).
 *
 * Mapping id logiciel (marque, URL) -> engineId de GATE (celui vérifié par
 * SubscriptionGuard/assertAccess côté backend, = entitlements[] / ENGINE_DESCRIPTORS.id).
 * Bug déjà corrigé une fois côté SubscriptionEditor (stockage des mauvais slugs) —
 * ce module est la source UNIQUE de cette correspondance pour la galerie et les
 * pages logiciel, afin de ne pas la re-diverger.
 *
 * Aucune formule, aucun symbole de calcul : uniquement des métadonnées d'affichage.
 */

export interface SoftwareEntry {
  /** Identifiant de route/marque (URL /logiciels/<id>). */
  id: string;
  nom: string;
  tagline: string;
  domaine: string;
  accent: string;
  /** engineId de gate — DOIT correspondre à ENGINE_DESCRIPTORS[].id et aux entitlements[]. */
  engineId: string;
  /** false = pas encore d'interface (moteur intégré serveur, front à venir). */
  hasUi: boolean;
}

export const SOFTWARE_CATALOG: readonly SoftwareEntry[] = [
  {
    id: 'roadsens',
    nom: 'ROADSENS',
    tagline: 'Dimensionnement des chaussées',
    domaine: 'Burmister · AGEROUTE 2015',
    accent: '#1b3a5b',
    engineId: 'burmister',
    hasUi: true,
  },
  {
    id: 'terzaghi',
    nom: 'Terzaghi',
    tagline: 'Fondations superficielles',
    domaine: 'NF P 94-261 / Eurocode 7',
    accent: '#a65a1e',
    engineId: 'terzaghi',
    hasUi: true,
  },
  {
    id: 'casagrande',
    nom: 'CASAGRANDE',
    tagline: 'Fondations profondes — pieux',
    domaine: 'NF P 94-262 / Eurocode 7',
    accent: '#1f4e4a',
    engineId: 'pieux',
    hasUi: true,
  },
  {
    id: 'geoplaque',
    nom: 'GEOPLAQUE',
    tagline: 'Radier & plaque · 2D (bande/axi/triangulaire)',
    domaine: 'Éléments finis · EC7 annexe H',
    accent: '#5a3e7c',
    engineId: 'radier',
    hasUi: true,
  },
  {
    id: 'pressiopro',
    nom: 'PressioPro',
    tagline: 'Essai pressiométrique',
    domaine: 'Pressiomètre Ménard',
    accent: '#963b28',
    engineId: 'pressiometre',
    hasUi: true,
  },
  {
    id: 'fastlab',
    nom: 'FASTLAB',
    tagline: 'Classification laboratoire',
    domaine: 'GTR · NF P11-300',
    accent: '#6b7a2e',
    engineId: 'labo',
    hasUi: true,
  },
];

export function findSoftware(id: string): SoftwareEntry | undefined {
  return SOFTWARE_CATALOG.find((s) => s.id === id);
}

/** Résout l'engineId de gate à partir de l'id logiciel. Undefined si logiciel inconnu. */
export function engineIdForSoftware(id: string): string | undefined {
  return findSoftware(id)?.engineId;
}
