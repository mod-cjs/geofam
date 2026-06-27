/**
 * Middleware Next.js — MOCK Phase 1.
 *
 * En production (ADR 0010) :
 * - Vérifie le JWT HS256 (edge runtime, lib jose)
 * - Extrait orgs[], valide slug ↔ org membre
 * - Injecte X-Org-Id sur les requêtes API
 * - Redirige /login si token absent/expiré
 *
 * MOCK :
 * - Lit roadsen_access_token depuis sessionStorage n'est pas possible côté edge ;
 *   en mock, on vérifie le cookie roadsen_mock_auth.
 * - Si absent et route protégée → redirect /login
 * - Si orgSlug non connu → redirect /login
 * - Injecte X-Org-Id et X-Org-Slug dans les headers sortants.
 *
 * NOTE : le cookie est posé par la page de login (mock).
 */

import { type NextRequest, NextResponse } from 'next/server';

// Orgs connues dans le mock (en prod : claims JWT)
const MOCK_ORGS: Record<string, string> = {
  'be-routes-dakar': 'org_01',
  'labo-thies': 'org_02',
};

// Routes protégées — patterns qui nécessitent auth
const PROTECTED_PREFIX = '/app/';
const AUTH_ROUTES = ['/login'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Ignorer les assets statiques et les routes API internes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/api/')
  ) {
    return NextResponse.next();
  }

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
    // pathname = /app/[orgSlug]/...  → segments[0]='app', segments[1]=orgSlug
    const orgSlug = segments[1];

    if (orgSlug && MOCK_ORGS[orgSlug]) {
      const orgId = MOCK_ORGS[orgSlug];
      const response = NextResponse.next();
      // Injecter X-Org-Id pour les Server Components / Route Handlers
      response.headers.set('X-Org-Id', orgId);
      response.headers.set('X-Org-Slug', orgSlug);
      return response;
    }

    // Slug non membre → redirect silencieux vers première org (anti-énumération)
    return NextResponse.redirect(new URL('/app/be-routes-dakar/projets', request.url));
  }

  return NextResponse.next();
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
