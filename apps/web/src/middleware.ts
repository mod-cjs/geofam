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
 * ROUTE RACINE `/` (landing publique — cf. mission landing GEOFAM) :
 *  - Visiteur authentifié (token valide + ≥1 org) → redirect direct vers son app
 *    (`/app/[firstOrgSlug]/projets`), comme avant.
 *  - Visiteur NON authentifié (pas de token, token invalide/expiré, ou token sans
 *    org) → laissé passer (`NextResponse.next()`) : `/` sert alors la landing
 *    publique (`src/app/page.tsx`), pas un redirect vers /login. Un token
 *    invalide est traité comme « non authentifié » (jamais d'erreur ni de boucle
 *    de redirection) : au pire, la landing s'affiche à un utilisateur dont le
 *    token a expiré, ce qui est sans risque (page publique).
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
/** Préfixe du back-office SUPERADMIN. Protection 1er rideau (présence du token).
 *  La décision de privilège (SUPERADMIN) reste dans AdminLayout (Server Component). */
const ADMIN_PREFIX = '/admin';
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

  // ---- Route racine — landing publique (visiteur non authentifié) ou
  // redirect direct vers l'app (visiteur déjà connecté) ----
  if (pathname === '/') {
    if (!rawToken) {
      // Pas de token : sert la landing statique GEOFAM (public/landing.html)
      // via rewrite -> l'URL reste `/`, le HTML est servi tel quel.
      return NextResponse.rewrite(new URL('/landing.html', request.url));
    }
    const claims = await verifyAccessToken(rawToken);
    if (!claims?.orgs?.length) {
      // Token présent mais invalide/expiré/sans org : traité comme visiteur
      // non authentifié -> landing (jamais de redirect /login en boucle ici).
      return NextResponse.rewrite(new URL('/landing.html', request.url));
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

  // ---- Routes back-office /admin/** — 1er rideau : présence du token ----
  // La décision de privilège (SUPERADMIN vs non-SUPERADMIN) est dans AdminLayout
  // (Server Component) qui appelle GET /admin/me côté serveur. Ici on assure
  // simplement qu'un utilisateur non authentifié est renvoyé vers /login.
  if (pathname.startsWith(ADMIN_PREFIX + '/') || pathname === ADMIN_PREFIX) {
    if (!rawToken) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('returnTo', pathname);
      return NextResponse.redirect(loginUrl);
    }
    // Token présent : laisser passer — AdminLayout vérifie le rôle côté serveur.
    // Pas d'injection de X-Org-Id (le SUPERADMIN n'a pas d'org).
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

  // Route racine — landing publique (non authentifié) ou redirect vers l'app
  // (authentifié), symétrique au mode réel ci-dessus.
  if (pathname === '/') {
    const authCookie = request.cookies.get('roadsen_mock_auth');
    if (authCookie?.value) {
      return NextResponse.redirect(new URL('/app/be-routes-dakar/projets', request.url));
    }
    return NextResponse.rewrite(new URL('/landing.html', request.url));
  }

  // Routes auth — si déjà connecté → redirect vers l'app
  if (AUTH_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'))) {
    const authCookie = request.cookies.get('roadsen_mock_auth');
    if (authCookie?.value) {
      return NextResponse.redirect(new URL('/app/be-routes-dakar/projets', request.url));
    }
    return NextResponse.next();
  }

  // Routes back-office /admin/** (mode mock) — 1er rideau token
  if (pathname.startsWith(ADMIN_PREFIX + '/') || pathname === ADMIN_PREFIX) {
    const authCookie = request.cookies.get('roadsen_mock_auth');
    if (!authCookie?.value) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('returnTo', pathname);
      return NextResponse.redirect(loginUrl);
    }
    // En mode mock, AdminLayout appelle GET /admin/me (backend absent) → null →
    // il redirige vers /login. Le back-office n'est accessible qu'en mode réel.
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
  // (dont les fichiers .html de public/ — ex. landing.html, offline.html —
  // servis tels quels, sans logique d'auth : la cible d'un rewrite `/` ->
  // /landing.html doit passer sans être re-routée.)
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/api/') ||
    pathname.endsWith('.html')
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
