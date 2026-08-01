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

import { deriveOrgId } from './api/http-client';
import { MOCK_ORGS } from './api/mock-data';

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

/** Résultat de résolution incluant l'état « en cours ». */
export interface OrgIdResolution {
  orgId: string | null;
  /**
   * false tant que la résolution post-montage n'a pas eu lieu (mode réel
   * uniquement — le token n'est disponible qu'après hydratation). true en
   * mode mock (résolution synchrone) et true en mode réel une fois l'effet
   * de montage passé, que l'orgId ait été trouvé ou non.
   *
   * Sert à distinguer « en cours de résolution » de « résolu à null » — les
   * deux étaient auparavant indiscernables (orgId=null dans les deux cas),
   * ce qui provoquait un flash de mauvais contenu (badges « Non inclus »,
   * sidebar vide) au F5 tant que le token n'était pas encore lu.
   */
  ready: boolean;
}

/**
 * Hook React : résout l'orgSlug en orgId, avec état de résolution explicite.
 *
 * En mode réel la résolution dépend du token côté client → on initialise
 * `ready=false` (sûr en SSR) et on re-résout au montage via useEffect (le
 * token est alors disponible). En mock c'est synchrone (`ready=true` d'emblée).
 */
export function useOrgIdReady(orgSlug: string): OrgIdResolution {
  const [state, setState] = useState<OrgIdResolution>(() =>
    REAL_BACKEND
      ? { orgId: null, ready: false }
      : { orgId: resolveOrgId(orgSlug), ready: true },
  );
  useEffect(() => {
    setState({ orgId: resolveOrgId(orgSlug), ready: true });
  }, [orgSlug]);
  return state;
}

/**
 * Hook React : résout l'orgSlug en orgId (signature historique, conservée
 * pour tous les appelants existants). Ne distingue pas « en cours » de
 * « résolu à null » — les appelants qui ont besoin de cette distinction
 * (ex. galerie logiciels, sidebar : éviter un flash de mauvais contenu)
 * doivent utiliser `useOrgIdReady` à la place.
 */
export function useOrgId(orgSlug: string): string | null {
  return useOrgIdReady(orgSlug).orgId;
}
