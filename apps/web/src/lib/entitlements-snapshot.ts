/**
 * Amorçage stale-while-revalidate pour EntitlementsResponse.
 *
 * Au refresh (F5), la résolution orgId + le fetch entitlements sont tous les
 * deux post-montage (cf. org-context.ts) : sans amorçage, l'écran affiche des
 * squelettes pendant tout ce temps. On persiste le dernier EntitlementsResponse
 * connu par org (clé namespacée par orgSlug — connu synchronement depuis
 * l'URL, contrairement à orgId qui dépend du token) pour amorcer l'affichage
 * instantanément, puis on revalide en arrière-plan et on remplace.
 *
 * Fail-closed conservé : snapshot absent ou illisible -> null -> les
 * appelants retombent sur l'état "en cours de résolution" (squelette),
 * jamais sur un "Disponible" supposé. Le snapshot ne contient que des
 * réponses serveur réelles précédemment reçues (jamais une valeur inventée).
 */

import type { EntitlementsResponse } from './api/types';

const PREFIX = 'roadsen_entitlements_snapshot:';

/** Lit le dernier EntitlementsResponse connu pour cet orgSlug. Null si absent/invalide. */
export function readEntitlementsSnapshot(orgSlug: string): EntitlementsResponse | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + orgSlug);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Garde-fou minimal de forme — un snapshot corrompu/partiel ne doit pas
    // produire un état incohérent (ex. modules manquant -> gate KeyError-like).
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray(parsed.modules) ||
      typeof parsed.quota !== 'object'
    ) {
      return null;
    }
    return parsed as EntitlementsResponse;
  } catch {
    return null;
  }
}

/** Persiste le dernier EntitlementsResponse reçu du serveur pour cet orgSlug. */
export function writeEntitlementsSnapshot(
  orgSlug: string,
  ent: EntitlementsResponse,
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFIX + orgSlug, JSON.stringify(ent));
  } catch {
    /* storage indisponible/quota — pas bloquant, on continue sans amorçage */
  }
}
