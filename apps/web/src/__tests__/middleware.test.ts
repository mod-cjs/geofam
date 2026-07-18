// @vitest-environment node
// Environnement Node (pas jsdom) : jose doit résoudre vers son build natif Node.js
// pour que jwtVerify utilise crypto.subtle Node.js — non disponible correctement
// dans jsdom v29 (la variante webapi de jose y échoue à la vérification HMAC).
// Ce fichier ne contient pas de code DOM, l'override est sans effet secondaire.

/**
 * Tests du middleware — mode réel (JWT HS256 via jose)
 *
 * DoD §9 : test-first, given/when/then, chemins négatifs, zéro faux-vert.
 *
 * Couverture :
 *  - Token HS256 valide + orgSlug membre → X-Org-Id injecté (chemin heureux)
 *  - Token expiré → redirect /login?returnTo=... (chemin négatif)
 *  - Slug non-membre → redirect silencieux vers première org (anti-énumération)
 *  - alg:none → rejeté par jose algorithms:['HS256'] → redirect /login
 *  - Absence de token → redirect /login?returnTo=...
 *
 * Mode mock (cookie roadsen_mock_auth) : comportement existant non retesté ici
 * (la navigation démo valide ce chemin).
 *
 * NOTE : next/server est mocké manuellement — l'Edge runtime n'est pas disponible
 * en environnement vitest/jsdom. jose utilise Web Crypto (Node 18+ natif).
 */

import { createHmac } from 'node:crypto';

import type { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeAll } from 'vitest';

// ---------------------------------------------------------------------------
// Types locaux des réponses simulées (retournées par le mock next/server)
// Les casts passent par unknown pour éviter les erreurs TS2352 liées à l'écart
// entre NextResponse<unknown> (types réels) et les objets mockés.
// ---------------------------------------------------------------------------

interface MockNextResponse {
  _type: 'next';
  headers: {
    set: (k: string, v: string) => void;
    get: (k: string) => string | null;
    _store: Map<string, string>;
  };
}

interface MockRedirectResponse {
  _type: 'redirect';
  destination: string;
}

type MockResponse = MockNextResponse | MockRedirectResponse;

function asMock(r: unknown): MockResponse {
  return r as unknown as MockResponse;
}

function asNext(r: unknown): MockNextResponse {
  const m = asMock(r);
  expect(m._type).toBe('next');
  return m as MockNextResponse;
}

function asRedirect(r: unknown): MockRedirectResponse {
  const m = asMock(r);
  expect(m._type).toBe('redirect');
  return m as MockRedirectResponse;
}

// ---------------------------------------------------------------------------
// Mock next/server — Edge runtime non disponible en vitest/jsdom.
// vi.mock est hissé automatiquement avant les imports du module testé.
// ---------------------------------------------------------------------------

vi.mock('next/server', () => ({
  NextResponse: {
    next: () => {
      const store = new Map<string, string>();
      return {
        _type: 'next' as const,
        headers: {
          set: (k: string, v: string) => {
            store.set(k, v);
          },
          get: (k: string) => store.get(k) ?? null,
          _store: store,
        },
      };
    },
    redirect: (url: URL | string) => ({
      _type: 'redirect' as const,
      destination: url instanceof URL ? url.toString() : url,
    }),
  },
}));

// ---------------------------------------------------------------------------
// Import du middleware — après le mock next/server
// ---------------------------------------------------------------------------

import { middleware } from '../middleware';

// ---------------------------------------------------------------------------
// Constantes et helpers de test
// ---------------------------------------------------------------------------

const TEST_SECRET = 'test-jwt-secret-roadsen-middleware-32b!';
const NOW = Math.floor(Date.now() / 1000);

const ORG_CLAIMS = [{ id: 'org_01', slug: 'be-routes-dakar', role: 'OWNER' as const }];

/**
 * Signe un JWT HS256 valide avec node:crypto (HMAC-SHA256).
 * Produit un token que jose/jwtVerify accepte en mode réel.
 * On évite SignJWT de jose ici car le webapi build de jose v6
 * utilise SubtleCrypto (crypto.subtle) incompatible avec jsdom+vitest.
 */
function signValidToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
    'base64url',
  );
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${header}.${body}`;
  const signature = createHmac('sha256', TEST_SECRET)
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${signature}`;
}

/**
 * Fabrique un JWT avec alg:none (signature vide).
 * jose doit rejeter ce token même si le payload serait sinon valide.
 */
function makeAlgNoneToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
    'base64url',
  );
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  // Signature vide — format JWT avec alg:none
  return `${header}.${body}.`;
}

/** Crée une fausse NextRequest (objet minimal compatible Edge runtime). */
function makeRequest(
  pathname: string,
  cookies: Record<string, string> = {},
): NextRequest {
  const url = `http://localhost:3000${pathname}`;
  return {
    url,
    nextUrl: new URL(url),
    cookies: {
      get: (name: string) =>
        cookies[name] !== undefined ? { value: cookies[name] } : undefined,
    },
  } as unknown as NextRequest;
}

// ---------------------------------------------------------------------------
// Activation du mode réel (NEXT_PUBLIC_API_BASE_URL + JWT_SECRET)
// ---------------------------------------------------------------------------

beforeAll(() => {
  process.env.NEXT_PUBLIC_API_BASE_URL = 'http://api.test';
  process.env.JWT_SECRET = TEST_SECRET;
});

// ---------------------------------------------------------------------------
// Suite 1 — Routes protégées /app/[orgSlug]/...
// ---------------------------------------------------------------------------

describe('middleware réel — route protégée /app/[orgSlug]/...', () => {
  it(
    'given un token HS256 valide et orgSlug membre, ' +
      'when GET /app/be-routes-dakar/projets, ' +
      'then la réponse passe (next) avec X-Org-Id=org_01',
    async () => {
      const token = signValidToken({
        sub: 'usr_01',
        typ: 'access',
        orgs: ORG_CLAIMS,
        iat: NOW,
        exp: NOW + 3600,
      });

      const req = makeRequest('/app/be-routes-dakar/projets', {
        roadsen_access_token: token,
      });
      const res = await middleware(req);

      const next = asNext(res);
      expect(next.headers.get('X-Org-Id')).toBe('org_01');
    },
  );

  it(
    'given un token HS256 expiré, ' +
      'when GET /app/be-routes-dakar/projets, ' +
      'then redirect vers /login avec returnTo=/app/be-routes-dakar/projets',
    async () => {
      const token = signValidToken({
        sub: 'usr_01',
        typ: 'access',
        orgs: ORG_CLAIMS,
        iat: 0,
        exp: 1, // expiré depuis 1970
      });

      const req = makeRequest('/app/be-routes-dakar/projets', {
        roadsen_access_token: token,
      });
      const res = await middleware(req);

      const redirect = asRedirect(res);
      const dest = new URL(redirect.destination);
      expect(dest.pathname).toBe('/login');
      expect(dest.searchParams.get('returnTo')).toBe('/app/be-routes-dakar/projets');
    },
  );

  it(
    'given un token valide mais orgSlug non-membre, ' +
      'when GET /app/org-inconnue/projets, ' +
      'then redirect silencieux vers première org (anti-énumération, pas /login)',
    async () => {
      const token = signValidToken({
        sub: 'usr_01',
        typ: 'access',
        orgs: ORG_CLAIMS,
        iat: NOW,
        exp: NOW + 3600,
      });

      const req = makeRequest('/app/org-inconnue/projets', {
        roadsen_access_token: token,
      });
      const res = await middleware(req);

      const redirect = asRedirect(res);
      const dest = new URL(redirect.destination);
      // Redirige vers la première org du token, PAS vers /login
      // (ne révèle pas si l'org existe — anti-énumération)
      expect(dest.pathname).toBe('/app/be-routes-dakar/projets');
      expect(dest.pathname).not.toBe('/login');
    },
  );

  it(
    'given un JWT avec alg:none (attaque par confusion d algorithme), ' +
      'when GET /app/be-routes-dakar/projets, ' +
      'then rejeté par jose algorithms:[HS256] → redirect /login',
    async () => {
      const token = makeAlgNoneToken({
        sub: 'usr_01',
        typ: 'access',
        orgs: ORG_CLAIMS,
        iat: NOW,
        exp: NOW + 3600,
      });

      const req = makeRequest('/app/be-routes-dakar/projets', {
        roadsen_access_token: token,
      });
      const res = await middleware(req);

      const redirect = asRedirect(res);
      const dest = new URL(redirect.destination);
      expect(dest.pathname).toBe('/login');
    },
  );

  it(
    'given aucun token dans les cookies, ' +
      'when GET /app/be-routes-dakar/projets, ' +
      'then redirect /login?returnTo=...',
    async () => {
      const req = makeRequest('/app/be-routes-dakar/projets', {});
      const res = await middleware(req);

      const redirect = asRedirect(res);
      const dest = new URL(redirect.destination);
      expect(dest.pathname).toBe('/login');
      expect(dest.searchParams.get('returnTo')).toBe('/app/be-routes-dakar/projets');
    },
  );
});

// ---------------------------------------------------------------------------
// Suite 2 — Route racine /
// ---------------------------------------------------------------------------

describe('middleware réel — route racine / (landing publique GEOFAM)', () => {
  it(
    'given aucun token, ' +
      'when GET /, ' +
      'then passe (next) — sert la landing publique (src/app/page.tsx), pas /login',
    async () => {
      const req = makeRequest('/', {});
      const res = await middleware(req);

      asNext(res);
    },
  );

  it(
    'given un token invalide/expiré, ' +
      'when GET /, ' +
      'then passe (next) — traité comme non authentifié, affiche la landing (pas de boucle /login)',
    async () => {
      const token = signValidToken({
        sub: 'usr_01',
        typ: 'access',
        orgs: ORG_CLAIMS,
        iat: 0,
        exp: 1, // expiré depuis 1970
      });
      const req = makeRequest('/', { roadsen_access_token: token });
      const res = await middleware(req);

      asNext(res);
    },
  );

  it('given un token valide, when GET /, then redirect vers première org', async () => {
    const token = await signValidToken({
      sub: 'usr_01',
      typ: 'access',
      orgs: ORG_CLAIMS,
      iat: NOW,
      exp: NOW + 3600,
    });
    const req = makeRequest('/', { roadsen_access_token: token });
    const res = await middleware(req);

    const redirect = asRedirect(res);
    expect(new URL(redirect.destination).pathname).toBe('/app/be-routes-dakar/projets');
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — Route /login
// ---------------------------------------------------------------------------

describe('middleware réel — route /login', () => {
  it('given aucun token, when GET /login, then passe (next) — affiche la page de login', async () => {
    const req = makeRequest('/login', {});
    const res = await middleware(req);
    asNext(res); // vérifie _type === 'next'
  });

  it('given un token valide, when GET /login, then redirect vers première org (déjà connecté)', async () => {
    const token = signValidToken({
      sub: 'usr_01',
      typ: 'access',
      orgs: ORG_CLAIMS,
      iat: NOW,
      exp: NOW + 3600,
    });
    const req = makeRequest('/login', { roadsen_access_token: token });
    const res = await middleware(req);

    const redirect = asRedirect(res);
    expect(new URL(redirect.destination).pathname).toBe('/app/be-routes-dakar/projets');
  });
});
