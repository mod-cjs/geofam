/**
 * Source unique de résolution orgSlug → orgId.
 *
 * En mock : lookup statique sur MOCK_ORGS.
 * Au câblage backend : remplacer UNIQUEMENT `resolveOrgId` —
 *   lire l'orgId depuis les claims JWT (sub claim + orgs[]) ou
 *   depuis l'en-tête X-Org-Id fourni par le TenantGuard serveur.
 *
 * Aucun écran ne doit importer 'org_01' en dur.
 */

import { MOCK_ORGS } from './api/mock-data';

/**
 * Résout un orgSlug en orgId.
 *
 * Retourne null si le slug n'est pas reconnu.
 * Les appelants doivent gérer le cas null (affichage d'erreur, redirection).
 */
export function resolveOrgId(orgSlug: string): string | null {
  // Swap point : en prod, lire depuis les claims JWT stockés en session.
  const org = MOCK_ORGS.find((o) => o.slug === orgSlug);
  return org?.id ?? null;
}

/**
 * Hook React : résout l'orgSlug du contexte de route en orgId.
 *
 * Usage : const orgId = useOrgId(orgSlug);
 *
 * Retourne null tant que la résolution n'est pas disponible (rare en mock
 * car c'est synchrone ; prévu pour le swap async JWT).
 *
 * Swap backend : la résolution deviendra async (fetch claims) ;
 * modifier uniquement `resolveOrgId` ci-dessus.
 */
export function useOrgId(orgSlug: string): string | null {
  // En mock la résolution est synchrone — pas besoin de useState/useEffect.
  // Au câblage, si la résolution devient async, ajouter useState + useEffect ici.
  return resolveOrgId(orgSlug);
}
