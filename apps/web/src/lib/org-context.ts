/**
 * Source unique de résolution orgSlug → orgId.
 *
 * - Mode réel (NEXT_PUBLIC_API_BASE_URL posée) : dérive l'orgId depuis le claim
 *   `orgs` du JWT stocké (sessionStorage ou cookie) — `deriveOrgId`.
 * - Mode mock : lookup statique sur MOCK_ORGS.
 *
 * Aucun écran ne doit importer 'org_01' en dur.
 */

import { useEffect, useState } from 'react';
import { MOCK_ORGS } from './api/mock-data';
import { deriveOrgId } from './api/http-client';

const REAL_BACKEND = !!process.env.NEXT_PUBLIC_API_BASE_URL;

/** Token d'accès côté client : sessionStorage (même onglet) puis cookie (cross-onglet). */
function clientAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  const ss = window.sessionStorage?.getItem('roadsen_access_token');
  if (ss) return ss;
  if (typeof document !== 'undefined') {
    const m = document.cookie.match(/(?:^|;\s*)roadsen_access_token=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

/**
 * Résout un orgSlug en orgId. Retourne null si non résolu (token absent côté
 * serveur en mode réel, ou slug inconnu). Les appelants gèrent le cas null.
 */
export function resolveOrgId(orgSlug: string): string | null {
  if (REAL_BACKEND) {
    const token = clientAccessToken();
    return token ? deriveOrgId(token, orgSlug) : null;
  }
  return MOCK_ORGS.find((o) => o.slug === orgSlug)?.id ?? null;
}

/**
 * Hook React : résout l'orgSlug en orgId.
 *
 * En mode réel la résolution dépend du token côté client → on initialise à null
 * (sûr en SSR) et on re-résout au montage via useEffect (le token est alors
 * disponible). En mock c'est synchrone.
 */
export function useOrgId(orgSlug: string): string | null {
  const [orgId, setOrgId] = useState<string | null>(() =>
    REAL_BACKEND ? null : resolveOrgId(orgSlug),
  );
  useEffect(() => {
    setOrgId(resolveOrgId(orgSlug));
  }, [orgSlug]);
  return orgId;
}
