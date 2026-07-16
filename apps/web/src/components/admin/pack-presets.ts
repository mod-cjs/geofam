/**
 * Presets de modules par pack — source UNIQUE partagée entre le wizard
 * d'onboarding (/admin/orgs/new) et l'éditeur d'abonnement (SubscriptionEditor).
 *
 * Décision titulaire 14/07 : le choix d'un pack DOIT pré-remplir les modules
 * débloqués (diagnostic « packs pas appliqués » — le pack n'était qu'une
 * étiquette indépendante des entitlements ; une org affichait COMPLETE avec
 * 1 seul module actif).
 *
 * Presets alignés sur la grille commerciale du devis DEV-RDS-001 et le
 * mapping moteur GeoSuite (cf. mémoire geosuite-engine-mapping) :
 *  - ROUTES      : chaussées (Burmister / ROADSENS).
 *  - FONDATIONS  : fondation superficielle (Terzaghi) + fondation profonde
 *                  (CASAGRANDE = pieux). Radier (GEOPLAQUE) et pressiomètre
 *                  (PressioPro) sont hors périmètre du Pack Fondations.
 *  - COMPLETE    : les 6 moteurs (Plateforme complète).
 *
 * Slugs = ceux vérifiés par SubscriptionGuard (gate de calcul), PAS les noms
 * de logiciels GeoSuite (casagrande/geoplaque/pressiopro/fastlab).
 */
export const PACK_NAMES = ['ROUTES', 'FONDATIONS', 'COMPLETE'] as const;
export type PackName = (typeof PACK_NAMES)[number];

export const PACK_PRESETS: Record<PackName, string[]> = {
  ROUTES: ['burmister'],
  FONDATIONS: ['terzaghi', 'pieux'],
  COMPLETE: ['burmister', 'terzaghi', 'pieux', 'radier', 'pressiometre', 'labo'],
};

/** Modules connus (slug de gate + libellé lisible), pour les cases à cocher. */
export const ALL_ENTITLEMENTS = [
  { slug: 'burmister', label: 'ROADSENS — Chaussées' },
  { slug: 'terzaghi', label: 'Terzaghi — Fondations superficielles' },
  { slug: 'pieux', label: 'CASAGRANDE — Pieux' },
  { slug: 'radier', label: 'GEOPLAQUE — Radier & plaque' },
  { slug: 'pressiometre', label: 'PressioPro — Pressiomètre' },
  { slug: 'labo', label: 'FASTLAB — Labo GTR' },
] as const;

/** Garde de type : `value` est un nom de pack connu. */
export function isPackName(value: string): value is PackName {
  return (PACK_NAMES as readonly string[]).includes(value);
}

/**
 * true si `entitlements` diverge de l'ensemble standard du pack (comparaison
 * d'ensemble, ordre indifférent). Sert uniquement à l'avertissement non
 * bloquant de personnalisation — jamais à bloquer une action.
 */
export function isCustomizedVsPack(
  pack: string,
  entitlements: readonly string[],
): boolean {
  const preset = isPackName(pack) ? PACK_PRESETS[pack] : [];
  if (preset.length !== entitlements.length) return true;
  const presetSet = new Set(preset);
  return entitlements.some((e) => !presetSet.has(e));
}

/** Avertissement sobre, non bloquant — texte exact (mission titulaire 14/07). */
export function customPackWarning(pack: string): string {
  return `Contenu personnalisé — ne correspond pas au pack ${pack} standard`;
}
