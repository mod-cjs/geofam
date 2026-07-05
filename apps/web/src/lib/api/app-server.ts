/**
 * Couche API serveur — GET /auth/me (profil + appartenances), pour la page
 * index `/app` (redirection vers la 1re org de l'utilisateur).
 *
 * Même patron que admin-server.ts : lecture du token depuis le cookie
 * JS-readable `roadsen_access_token` via `next/headers`. Server Components
 * uniquement — jamais importé dans un Client Component.
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 */

import { cookies } from 'next/headers';

const TOKEN_COOKIE = 'roadsen_access_token';

const API_BASE =
  (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_API_BASE_URL : undefined) ?? '';

export interface MembershipView {
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: string;
}

export interface UserProfile {
  userId: string;
  email: string;
  fullName: string;
  platformRole: string | null;
  memberships: MembershipView[];
}

/**
 * Profil de l'utilisateur courant + ses appartenances. Renvoie null si pas de
 * token, si le backend renvoie une erreur (401 = session expirée), ou si le
 * réseau est indisponible — la page appelante décide alors du repli (login).
 */
export async function getMyProfile(): Promise<UserProfile | null> {
  let token: string | null = null;
  try {
    const cookieStore = await cookies();
    token = cookieStore.get(TOKEN_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
  if (!token) return null;

  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return res.json() as Promise<UserProfile>;
  } catch {
    return null;
  }
}
