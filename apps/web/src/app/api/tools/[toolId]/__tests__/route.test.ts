/**
 * Tests — route handler `GET /api/tools/:toolId` (ADR 0015, distribution des
 * clones d'outils).
 *
 * DoD §9 : given/when/then, chemins négatifs (401 sans session, 403 sans
 * entitlement, 404 outil/clone inconnu) testés autant que le chemin heureux.
 * `node:fs/promises` est mocké — ce test ne dépend PAS de la présence réelle
 * d'un clone sous `src/tools-cloned/` (artefact produit par
 * `scripts/clone-tool.mjs`, hors périmètre de cet agent).
 */

import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockReadFile } = vi.hoisted(() => ({ mockReadFile: vi.fn() }));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  default: { readFile: mockReadFile },
}));

function makeRequest(
  toolId: string,
  opts: { authHeader?: string; cookie?: string; orgId?: string | null } = {},
): NextRequest {
  const qs =
    opts.orgId === undefined
      ? '?orgId=org_01'
      : opts.orgId === null
        ? ''
        : `?orgId=${opts.orgId}`;
  const url = `http://localhost:3000/api/tools/${toolId}${qs}`;
  const headers: Record<string, string> = {};
  if (opts.authHeader) headers['authorization'] = opts.authHeader;
  if (opts.cookie) headers['cookie'] = opts.cookie;
  return new NextRequest(url, { headers });
}

function ctx(toolId: string) {
  return { params: Promise.resolve({ toolId }) };
}

beforeEach(() => {
  mockReadFile.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Mode mock (par défaut, NEXT_PUBLIC_API_BASE_URL absente) — importé une fois,
// aucune bascule d'env nécessaire pour ces cas.
// ---------------------------------------------------------------------------

describe('GET /api/tools/:toolId — session requise', () => {
  it('given aucune Authorization ni cookie, when GET, then 401 UNAUTHORIZED', async () => {
    const { GET } = await import('../route');
    const res = await GET(makeRequest('terzaghi'), ctx('terzaghi'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.reason).toBe('UNAUTHORIZED');
  });
});

describe('GET /api/tools/:toolId — paramètres', () => {
  it('given orgId absent de la query, when GET, then 400', async () => {
    const { GET } = await import('../route');
    const res = await GET(
      makeRequest('terzaghi', { authHeader: 'Bearer token-abc', orgId: null }),
      ctx('terzaghi'),
    );
    expect(res.status).toBe(400);
  });

  it('given un toolId inconnu du catalogue, when GET, then 404 (avant même la vérif entitlement)', async () => {
    const { GET } = await import('../route');
    const res = await GET(
      makeRequest('outil-inexistant', { authHeader: 'Bearer token-abc' }),
      ctx('outil-inexistant'),
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/tools/:toolId — mode démo (mock), entitlement + clone', () => {
  it('given session + orgId + clone présent, when GET terzaghi, then 200 + CSP + nosniff + corps HTML', async () => {
    mockReadFile.mockResolvedValue('<html>fixture-clone</html>');
    const { GET } = await import('../route');
    const res = await GET(
      makeRequest('terzaghi', { authHeader: 'Bearer token-abc' }),
      ctx('terzaghi'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    const text = await res.text();
    expect(text).toBe('<html>fixture-clone</html>');
  });

  it('given session valide via cookie roadsen_access_token (sans header Authorization), when GET, then 200', async () => {
    mockReadFile.mockResolvedValue('<html>fixture-clone</html>');
    const { GET } = await import('../route');
    const res = await GET(
      makeRequest('terzaghi', { cookie: 'roadsen_access_token=cookie-token' }),
      ctx('terzaghi'),
    );
    expect(res.status).toBe(200);
  });

  it('given session mais fichier clone absent (ENOENT), when GET, then 404 clone indisponible', async () => {
    mockReadFile.mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );
    const { GET } = await import('../route');
    const res = await GET(
      makeRequest('terzaghi', { authHeader: 'Bearer token-abc' }),
      ctx('terzaghi'),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.reason).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// Mode réel (NEXT_PUBLIC_API_BASE_URL posée) — la constante USE_REAL_BACKEND
// est figée à l'import du module : on doit stubber l'env AVANT un import
// dynamique frais (vi.resetModules) pour que la bascule prenne effet.
// ---------------------------------------------------------------------------

describe('GET /api/tools/:toolId — mode réel, entitlement backend', () => {
  it('given le backend renvoie des entitlements SANS le module terzaghi, when GET, then 403 MODULE_NOT_IN_PACK', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          orgId: 'org_01',
          pack: 'ROUTES',
          modules: ['burmister'],
          expiresAt: new Date(Date.now() + 1000 * 3600 * 24 * 30).toISOString(),
          expired: false,
          quota: { limit: 200, used: 10, remaining: 190 },
          serverTime: new Date().toISOString(),
        }),
      })),
    );
    vi.resetModules();
    const { GET } = await import('../route');
    const res = await GET(
      makeRequest('terzaghi', { authHeader: 'Bearer token-abc' }),
      ctx('terzaghi'),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.reason).toBe('MODULE_NOT_IN_PACK');
    vi.unstubAllGlobals();
  });

  it('given le backend renvoie des entitlements AVEC le module terzaghi, when GET, then 200', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          orgId: 'org_01',
          pack: 'COMPLETE',
          modules: ['burmister', 'terzaghi'],
          expiresAt: new Date(Date.now() + 1000 * 3600 * 24 * 30).toISOString(),
          expired: false,
          quota: { limit: 200, used: 10, remaining: 190 },
          serverTime: new Date().toISOString(),
        }),
      })),
    );
    mockReadFile.mockResolvedValue('<html>fixture-clone</html>');
    vi.resetModules();
    const { GET } = await import('../route');
    const res = await GET(
      makeRequest('terzaghi', { authHeader: 'Bearer token-abc' }),
      ctx('terzaghi'),
    );
    expect(res.status).toBe(200);
    vi.unstubAllGlobals();
  });

  it('given le backend rejette la requête entitlements (401), when GET, then 401 session invalide', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401 })),
    );
    vi.resetModules();
    const { GET } = await import('../route');
    const res = await GET(
      makeRequest('terzaghi', { authHeader: 'Bearer token-invalide' }),
      ctx('terzaghi'),
    );
    expect(res.status).toBe(401);
    vi.unstubAllGlobals();
  });
});
