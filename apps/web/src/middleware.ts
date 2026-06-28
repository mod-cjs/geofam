/**
 * Middleware Next.js — double mode : mock Phase 1 / vrai backend.
 *
 * MODE RÉEL (NEXT_PUBLIC_API_BASE_URL définie) — ADR 0010 :
 *  - Lit l'access token depuis le cookie `roadsen_access_token` (JS-readable).
 *    Ce cookie est posé par http-client.ts au login/refresh et effacé au logout.
 *    DETTE : passer en httpOnly + Route Handler proxy avant mise en production.
 *  - Vérifie le JWT HS256 avec jose (jwtVerify, secret = JWT_SECRET côté serveur).
 *    algorithms:['HS256'] rejette explicitement alg:none et toute confusion d'alg.
 *  - Extrait le claim `orgs:[{id,slug,role}]` du payload.
 *  - Valide que `[orgSlug]` de l'URL appartient aux orgs du token.
 *  - Injecte X-Org-Id (et X-Org-Slug) dans les headers sortants.
 *  - Token absent/expiré/invalide → redirect /login?returnTo=...
 *  - Slug non-membre → redirect silencieux vers première org (anti-énumération).
 *
 * MODE MOCK (NEXT_PUBLIC_API_BASE_URL absente) :
 *  - Lit le cookie `roadsen_mock_auth` (posé par LoginClient en démo).
 *  - MOCK_ORGS codés en dur, comportement identique à l'original.
 *  - Aucun appel jose, aucune vérification cryptographique.
 *
 * MÉCANISME DE TOKEN (mode réel) :
 *  - Le cookie `roadsen_access_token` est JS-readable (non httpOnly).
 *  - http-client.ts le pose lors de storeTokens() et l'efface dans clearTokens().
 *  - sessionStorage reste le stockage principal pour l'en-tête Authorization côté client.
 *  - max-age=900 (15 min) aligne le cookie sur la TTL type d'un access token ;
 *    le refresh transparent de http-client.ts renouvelle le cookie avant expiration.
 */

import { jwtVerify } from 'jose';
import { type NextRequest, NextResponse } from 'next/server';

import type { OrgClaim } from '@/lib/api/types';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Nom du cookie portant l'access token en mode réel. */
const TOKEN_COOKIE = 'roadsen_access_token';

/** Orgs connues dans le mock (en prod : claims JWT). */
const MOCK_ORGS: Record<string, string> = {
  'be-routes-dakar': 'org_01',
  'labo-thies': 'org_02',
};

const PROTECTED_PREFIX = '/app/';
const AUTH_ROUTES = ['/login'];

// ---------------------------------------------------------------------------
// Helper : vérification JWT (mode réel uniquement)
// ---------------------------------------------------------------------------

/**
 * Vérifie un JWT HS256 et retourne le payload, ou null si invalide/expiré/alg-confusion.
 * Utilise jose — conçu pour Edge runtime.
 * algorithms:['HS256'] garantit le rejet de alg:none et des algos non attendus.
 */
async function verifyAccessToken(
  token: string,
): Promise<{ sub?: string; orgs?: OrgClaim[] } | null> {
  const secret = process.env.JWT_SECRET;
  // Échoue-fermé si le secret n'est pas configuré
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
    });
    return payload as { sub?: string; orgs?: OrgClaim[] };
  } catch {
    // JWTExpired, JWTInvalid, JOSEAlgNotAllowed, etc. → token rejeté
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mode réel
// ---------------------------------------------------------------------------

async function realModeMiddleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const rawToken = request.cookies.get(TOKEN_COOKIE)?.value ?? null;

  // ---- Route racine ----
  if (pathname === '/') {
    if (!rawToken) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    const claims = await verifyAccessToken(rawToken);
    if (!claims?.orgs?.length) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
    const firstOrg = claims.orgs[0];
    return NextResponse.redirect(new URL(`/app/${firstOrg.slug}/projets`, request.url));
  }

  // ---- Routes auth (/login…) — si déjà authentifié → rediriger vers l'app ----
  if (AUTH_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'))) {
    if (rawToken) {
      const claims = await verifyAccessToken(rawToken);
      if (claims?.orgs?.length) {
        const firstOrg = claims.orgs[0];
        return NextResponse.redirect(
          new URL(`/app/${firstOrg.slug}/projets`, request.url),
        );
      }
    }
    return NextResponse.next();
  }

  // ---- Routes protégées /app/[orgSlug]/... ----
  if (pathname.startsWith(PROTECTED_PREFIX)) {
    // Token absent → login avec returnTo
    if (!rawToken) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('returnTo', pathname);
      return NextResponse.redirect(loginUrl);
    }

    // Token présent → vérification cryptographique
    const claims = await verifyAccessToken(rawToken);

    // Token invalide/expiré → login avec returnTo
    if (!claims) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('returnTo', pathname);
      return NextResponse.redirect(loginUrl);
    }

    // Extraire le slug depuis l'URL : /app/[orgSlug]/...
    const segments = pathname.split('/').filter(Boolean);
    const orgSlug = segments[1]; // segments[0]='app'

    // Vérifier que l'utilisateur est membre de cet org
    const org = claims.orgs?.find((o) => o.slug === orgSlug);

    if (!org) {
      // Slug non-membre → redirect silencieux vers première org (anti-énumération).
      // On ne révèle pas si l'org existe ou pas ; on ne redirige PAS vers /login.
      const firstOrg = claims.orgs?.[0];
      if (firstOrg) {
        return NextResponse.redirect(
          new URL(`/app/${firstOrg.slug}/projets`, request.url),
        );
      }
      // Aucune org dans le token → login
      return NextResponse.redirect(new URL('/login', request.url));
    }

    // Org validée — injecter X-Org-Id pour les Server Components / Route Handlers
    const response = NextResponse.next();
    response.headers.set('X-Org-Id', org.id);
    response.headers.set('X-Org-Slug', orgSlug);
    return response;
  }

  return NextResponse.next();
}

// ---------------------------------------------------------------------------
// Mode mock (comportement original conservé à l'identique)
// ---------------------------------------------------------------------------

function mockModeMiddleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Redirect racine → /login ou /app/[firstOrg]/projets
  if (pathname === '/') {
    const authCookie = request.cookies.get('roadsen_mock_auth');
    if (authCookie?.value) {
      return NextResponse.redirect(new URL('/app/be-routes-dakar/projets', request.url));
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Routes auth — si déjà connecté → redirect vers l'app
  if (AUTH_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'))) {
    const authCookie = request.cookies.get('roadsen_mock_auth');
    if (authCookie?.value) {
      return NextResponse.redirect(new URL('/app/be-routes-dakar/projets', request.url));
    }
    return NextResponse.next();
  }

  // Routes protégées /app/[orgSlug]/...
  if (pathname.startsWith(PROTECTED_PREFIX)) {
    const authCookie = request.cookies.get('roadsen_mock_auth');

    // Non authentifié → login avec returnTo
    if (!authCookie?.value) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('returnTo', pathname);
      return NextResponse.redirect(loginUrl);
    }

    // Extraire le slug
    const segments = pathname.split('/').filter(Boolean);
    const orgSlug = segments[1];

    if (orgSlug && MOCK_ORGS[orgSlug]) {
      const orgId = MOCK_ORGS[orgSlug];
      const response = NextResponse.next();
      response.headers.set('X-Org-Id', orgId);
      response.headers.set('X-Org-Slug', orgSlug);
      return response;
    }

    // Slug non membre → redirect silencieux vers première org (anti-énumération)
    return NextResponse.redirect(new URL('/app/be-routes-dakar/projets', request.url));
  }

  return NextResponse.next();
}

// ---------------------------------------------------------------------------
// Entrée principale
// ---------------------------------------------------------------------------

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Ignorer les assets statiques et les routes API internes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/api/')
  ) {
    return NextResponse.next();
  }

  // Bascule mode réel / mock — vérifiée à chaque appel (pas au chargement du module)
  // pour permettre les tests unitaires via vi.stubEnv / process.env direct.
  if (process.env.NEXT_PUBLIC_API_BASE_URL?.trim()) {
    return realModeMiddleware(request);
  }
  return mockModeMiddleware(request);
}

export const config = {
  matcher: [
    /*
     * Toutes les routes sauf :
     * - _next/static
     * - _next/image
     * - favicon.ico
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
