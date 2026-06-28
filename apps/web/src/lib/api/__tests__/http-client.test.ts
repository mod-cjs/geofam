/**
 * Tests unitaires — vrai client HTTP ROADSEN (http-client.ts)
 *
 * DoD §9 : test-first, given/when/then, chemins erreur, zéro faux-vert.
 *
 * Stratégie : fetch est mocké via vi.stubGlobal ; aucun vrai backend requis.
 * Les tests couvrent :
 *  - Mapping Prisma → types front (adaptateurs)
 *  - Décodage JWT et dérivation X-Org-Id
 *  - Gestion 402 (EXPIRED / QUOTA) et 403 (MODULE_NOT_IN_PACK)
 *  - Refresh transparent sur 401
 *  - Invalidation cache entitlements sur 402/403 et après calcul/PV réussi
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  adaptCalcResult,
  adaptOfficialPv,
  adaptProject,
  adaptEntitlements,
  type PrismaCalcResult,
  type PrismaOfficialPv,
  type PrismaProject,
  type BackendEntitlements,
} from '../adapters';
import {
  decodeJwtPayload,
  deriveOrgId,
  httpLogin,
  httpGetEntitlements,
  httpRunCalc,
  httpListProjects,
  httpGetCalcResult,
  httpEmitPv,
  httpVerifyPv,
  httpDownloadPvPdf,
} from '../http-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    blob: async () => new Blob(),
  } as unknown as Response;
}

function makeErrorResponse(status: number, reason: string, message: string): Response {
  return makeResponse({ statusCode: status, reason, message }, status);
}

// JWT de test : payload = { sub, typ, orgs, iat, exp }
function makeJwt(payload: object): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fakesignature`;
}

// ---------------------------------------------------------------------------
// decodeJwtPayload
// ---------------------------------------------------------------------------

describe('decodeJwtPayload', () => {
  it('given un JWT valide, then décode le payload correctement', () => {
    const payload = {
      sub: 'usr_01',
      typ: 'access',
      orgs: [{ id: 'org_01', slug: 'be-routes-dakar', role: 'OWNER' }],
      iat: 1700000000,
      exp: 1700000300,
    };
    const token = makeJwt(payload);
    const claims = decodeJwtPayload(token);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe('usr_01');
    expect(claims?.orgs).toHaveLength(1);
    expect(claims?.orgs[0].slug).toBe('be-routes-dakar');
  });

  it('given un token malformé (pas 3 parties), then retourne null', () => {
    expect(decodeJwtPayload('notajwt')).toBeNull();
    expect(decodeJwtPayload('')).toBeNull();
    expect(decodeJwtPayload('a.b')).toBeNull();
  });

  it('given un payload non-JSON, then retourne null (pas d exception)', () => {
    const badToken = `eyJhbGciOiJIUzI1NiJ9.!!!notbase64!!!.sig`;
    expect(decodeJwtPayload(badToken)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deriveOrgId — résolution X-Org-Id depuis JWT
// ---------------------------------------------------------------------------

describe('deriveOrgId', () => {
  const token = makeJwt({
    sub: 'usr_01',
    typ: 'access',
    orgs: [
      { id: 'org_01', slug: 'be-routes-dakar', role: 'OWNER' },
      { id: 'org_02', slug: 'labo-thies', role: 'ENGINEER' },
    ],
    iat: 0,
    exp: 9999999999,
  });

  it('given un slug connu, then retourne l orgId correspondant', () => {
    expect(deriveOrgId(token, 'be-routes-dakar')).toBe('org_01');
    expect(deriveOrgId(token, 'labo-thies')).toBe('org_02');
  });

  it('given un slug inconnu, then retourne null (ne forge pas d orgId)', () => {
    expect(deriveOrgId(token, 'inconnu')).toBeNull();
  });

  it('given un token invalide, then retourne null', () => {
    expect(deriveOrgId('bad', 'be-routes-dakar')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Adaptateurs — mapping Prisma → types front
// ---------------------------------------------------------------------------

describe('adaptCalcResult — mapping input→params', () => {
  const prismaCalc: PrismaCalcResult = {
    id: 'calc_01',
    projectId: 'proj_01',
    orgId: 'org_01',
    engineId: 'burmister',
    label: 'Test calc',
    domain: 'CH',
    status: 'DONE',
    input: { layers: [{ h: 0.36 }] },
    output: { verdict: 'PASS', NE: 1243500, rows: [] },
    pvId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('given une ligne Prisma, then input est mappé vers params', () => {
    const result = adaptCalcResult(prismaCalc);
    expect(result.params).toEqual({ layers: [{ h: 0.36 }] });
  });

  it('given une ligne Prisma, then output est conservé tel quel', () => {
    const result = adaptCalcResult(prismaCalc);
    expect((result.output as { verdict?: string })?.verdict).toBe('PASS');
  });

  it('given pvId null, then pvId est undefined dans le type front', () => {
    const result = adaptCalcResult(prismaCalc);
    expect(result.pvId).toBeUndefined();
  });

  it('given pvId présent, then pvId est défini', () => {
    const result = adaptCalcResult({ ...prismaCalc, pvId: 'pv_01' });
    expect(result.pvId).toBe('pv_01');
  });

  it('given input null/undefined, then params est un objet vide', () => {
    const result = adaptCalcResult({ ...prismaCalc, input: null });
    expect(result.params).toEqual({});
  });
});

describe('adaptOfficialPv — sealHash tronqué à 8 caractères', () => {
  // Fixture alignée sur la forme RÉELLE du backend : tout sous `pv`, sceau = pv.hmac,
  // numéro = pv.pvNumber, auteur = pv.userId, params = JSON.parse(pv.inputCanonical).
  const prismaPv: PrismaOfficialPv = {
    pv: {
      id: 'pv_01',
      orgId: 'org_01',
      calcResultId: 'calc_01',
      projectId: 'proj_01',
      pvNumber: 'PV-2026-0001',
      userId: 'Amadou Diallo',
      projectName: 'Test Project',
      engineId: 'burmister',
      engineVersion: '1.0.0',
      engineSourceHash: 'sha256abc',
      inputCanonical: JSON.stringify({ layers: [] }),
      output: { verdict: 'PASS' },
      scienceStatus: 'OK',
      verdict: 'PASS',
      contentHash: 'contenthash01',
      hmac: 'abcdef1234567890fullhashvalue',
      sealedAt: '2026-01-01T00:00:00.000Z',
    },
    sealValid: true,
  };

  it('given un hmac complet, then hmacTruncated contient les 8 premiers caractères uniquement', () => {
    const result = adaptOfficialPv(prismaPv);
    expect(result.hmacTruncated).toBe('abcdef12');
    expect(result.hmacTruncated.length).toBe(8);
  });

  it('given pdfUrl absent du backend, then pdfUrl est undefined', () => {
    const result = adaptOfficialPv(prismaPv);
    expect(result.pdfUrl).toBeUndefined();
  });

  it('given inputCanonical JSON et output dans pv, then params et output sont extraits correctement', () => {
    const result = adaptOfficialPv(prismaPv);
    // params = JSON.parse(pv.inputCanonical)
    expect(result.params).toEqual({ layers: [] });
    // output = pv.output
    expect((result.output as { verdict?: string })?.verdict).toBe('PASS');
    // number = pv.pvNumber
    expect(result.number).toBe('PV-2026-0001');
    // sealedBy = pv.userId
    expect(result.sealedBy).toBe('Amadou Diallo');
  });
});

describe('adaptProject — domain string → ProjectDomain', () => {
  const raw: PrismaProject = {
    id: 'proj_01',
    orgId: 'org_01',
    name: 'Test',
    description: null,
    domain: 'CH',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'usr_01',
  };

  it('given description null, then description est undefined', () => {
    const result = adaptProject(raw);
    expect(result.description).toBeUndefined();
  });

  it('given un domaine valide, then le domaine est préservé', () => {
    expect(adaptProject({ ...raw, domain: 'FD' }).domain).toBe('FD');
    expect(adaptProject({ ...raw, domain: 'LB' }).domain).toBe('LB');
  });
});

describe('adaptEntitlements — forme ADR 0011', () => {
  const raw: BackendEntitlements = {
    orgId: 'org_01',
    pack: 'COMPLETE',
    modules: ['burmister', 'terzaghi'],
    expiresAt: '2027-01-01T00:00:00.000Z',
    expired: false,
    quota: { limit: 500, used: 137, remaining: 363 },
    serverTime: '2026-06-27T10:00:00.000Z',
  };

  it('given une réponse backend, then la forme front est identique', () => {
    const result = adaptEntitlements(raw);
    expect(result.orgId).toBe('org_01');
    expect(result.expired).toBe(false);
    expect(result.quota.remaining).toBe(363);
    expect(result.modules).toContain('burmister');
  });
});

// ---------------------------------------------------------------------------
// httpLogin — stockage tokens
// ---------------------------------------------------------------------------

describe('httpLogin', () => {
  const mockOrgs = [{ id: 'org_01', slug: 'be-routes-dakar', role: 'OWNER' }];
  const mockJwt = makeJwt({
    sub: 'usr_01',
    typ: 'access',
    orgs: mockOrgs,
    iat: 0,
    exp: 9999999999,
  });

  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('given des identifiants valides, when httpLogin, then stocke accessToken et refreshToken', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      makeResponse({
        accessToken: mockJwt,
        refreshToken: 'refresh.token',
        user: { id: 'usr_01', email: 'demo@starfire.sn', name: 'Amadou Diallo' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const result = await httpLogin({ email: 'demo@starfire.sn', password: 'pass' });
    expect(result.accessToken).toBe(mockJwt);
    expect(sessionStorage.getItem('roadsen_access_token')).toBe(mockJwt);
    expect(sessionStorage.getItem('roadsen_refresh_token')).toBe('refresh.token');
  });

  it('given un login réussi, when httpLogin, then les orgs JWT sont stockées en session', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      makeResponse({
        accessToken: mockJwt,
        refreshToken: 'refresh.token',
        user: { id: 'usr_01', email: 'demo@starfire.sn', name: 'Amadou Diallo' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    await httpLogin({ email: 'demo@starfire.sn', password: 'pass' });
    const stored = JSON.parse(sessionStorage.getItem('roadsen_orgs') ?? '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0].slug).toBe('be-routes-dakar');
  });

  it('given un 401, when httpLogin, then rejette avec statusCode 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          makeErrorResponse(401, 'UNAUTHORIZED', 'Identifiants incorrects'),
        ),
    );
    await expect(
      httpLogin({ email: 'x@x.com', password: 'wrong' }),
    ).rejects.toMatchObject({
      statusCode: 401,
      reason: 'UNAUTHORIZED',
    });
  });
});

// ---------------------------------------------------------------------------
// Gestion 402 / 403 — gating abonnement
// ---------------------------------------------------------------------------

describe('httpRunCalc — erreurs 402 et 403', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('roadsen_access_token', 'fake.token.value');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('given un 402 EXPIRED, when httpRunCalc, then rejette avec statusCode 402 et reason EXPIRED', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(makeErrorResponse(402, 'EXPIRED', 'Abonnement expiré')),
    );
    await expect(
      httpRunCalc('org_01', 'proj_01', {
        engineId: 'burmister',
        label: 'Test',
        params: {},
      }),
    ).rejects.toMatchObject({
      statusCode: 402,
      reason: 'EXPIRED',
    });
  });

  it('given un 402 QUOTA, when httpRunCalc, then rejette avec statusCode 402 et reason QUOTA', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(makeErrorResponse(402, 'QUOTA', 'Quota épuisé')),
    );
    await expect(
      httpRunCalc('org_01', 'proj_01', {
        engineId: 'burmister',
        label: 'Test',
        params: {},
      }),
    ).rejects.toMatchObject({
      statusCode: 402,
      reason: 'QUOTA',
    });
  });

  it('given un 403 MODULE_NOT_IN_PACK, when httpRunCalc, then rejette avec statusCode 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          makeErrorResponse(403, 'MODULE_NOT_IN_PACK', 'Module verrouillé'),
        ),
    );
    await expect(
      httpRunCalc('org_01', 'proj_01', {
        engineId: 'terzaghi',
        label: 'Test',
        params: {},
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      reason: 'MODULE_NOT_IN_PACK',
    });
  });

  it('given un calcul réussi, when httpRunCalc, then retourne un CalcResult avec params (pas input)', async () => {
    const prismaCalc: PrismaCalcResult = {
      id: 'calc_new',
      projectId: 'proj_01',
      orgId: 'org_01',
      engineId: 'burmister',
      label: 'Test',
      domain: 'CH',
      status: 'DONE',
      input: { layers: [{ h: 0.36 }] },
      output: { verdict: 'PASS', NE: 1243500 },
      pvId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeResponse(prismaCalc)));

    const result = await httpRunCalc('org_01', 'proj_01', {
      engineId: 'burmister',
      label: 'Test',
      params: { layers: [{ h: 0.36 }] },
    });
    // Le mapping convertit input → params
    expect(result.params).toEqual({ layers: [{ h: 0.36 }] });
    expect(result.id).toBe('calc_new');
  });
});

// ---------------------------------------------------------------------------
// Refresh transparent sur 401
// ---------------------------------------------------------------------------

describe('refresh transparent sur 401', () => {
  const newAccessToken = 'new.access.token';
  const refreshToken = 'valid.refresh.token';

  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('roadsen_access_token', 'expired.access.token');
    sessionStorage.setItem('roadsen_refresh_token', refreshToken);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('given un 401 suivi d un refresh réussi, when httpListProjects, then retente et retourne les projets', async () => {
    const projects: PrismaProject[] = [
      {
        id: 'proj_01',
        orgId: 'org_01',
        name: 'Test',
        description: null,
        domain: 'CH',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        createdBy: 'usr_01',
      },
    ];

    const mockFetch = vi
      .fn()
      // 1er appel : /projects → 401
      .mockResolvedValueOnce(
        makeResponse({ statusCode: 401, reason: 'UNAUTHORIZED' }, 401),
      )
      // Refresh : /auth/refresh → 200 avec nouveaux tokens
      .mockResolvedValueOnce(
        makeResponse({ accessToken: newAccessToken, refreshToken: 'new.refresh' }),
      )
      // 2e appel : /projects avec nouveau token → 200
      .mockResolvedValueOnce(makeResponse(projects));

    vi.stubGlobal('fetch', mockFetch);

    const result = await httpListProjects('org_01');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('proj_01');
    // Le nouveau token est stocké
    expect(sessionStorage.getItem('roadsen_access_token')).toBe(newAccessToken);
  });

  it('given un 401 et un refresh qui échoue, when httpListProjects, then rejette avec 401 et efface les tokens', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeResponse({ statusCode: 401 }, 401))
      .mockResolvedValueOnce(makeResponse({}, 401)); // refresh échoue

    vi.stubGlobal('fetch', mockFetch);

    await expect(httpListProjects('org_01')).rejects.toMatchObject({ statusCode: 401 });
    expect(sessionStorage.getItem('roadsen_access_token')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cache entitlements — invalidation sur 402/403 et après calcul réussi
// ---------------------------------------------------------------------------

describe('cache entitlements — invalidation', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('roadsen_access_token', 'fake.token.value');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('given un calcul réussi, when httpRunCalc, then le prochain getEntitlements fait un vrai appel réseau', async () => {
    const prismaCalc: PrismaCalcResult = {
      id: 'calc_x',
      projectId: 'proj_01',
      orgId: 'org_01',
      engineId: 'burmister',
      label: 'x',
      domain: 'CH',
      status: 'DONE',
      input: {},
      output: null,
      pvId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const ent: BackendEntitlements = {
      orgId: 'org_01',
      pack: 'COMPLETE',
      modules: ['burmister'],
      expiresAt: '2027-01-01T00:00:00Z',
      expired: false,
      quota: { limit: 500, used: 138, remaining: 362 },
      serverTime: new Date().toISOString(),
    };

    const mockFetch = vi
      .fn()
      // Premier appel getEntitlements → mis en cache
      .mockResolvedValueOnce(makeResponse(ent))
      // runCalc → succès (invalide le cache)
      .mockResolvedValueOnce(makeResponse(prismaCalc))
      // Deuxième appel getEntitlements → doit refetch (cache invalidé)
      .mockResolvedValueOnce(
        makeResponse({ ...ent, quota: { limit: 500, used: 138, remaining: 362 } }),
      );

    vi.stubGlobal('fetch', mockFetch);

    await httpGetEntitlements('org_01');
    await httpRunCalc('org_01', 'proj_01', {
      engineId: 'burmister',
      label: 'x',
      params: {},
    });
    await httpGetEntitlements('org_01');

    // 3 appels réseau au total (pas 2, car le cache a été invalidé après runCalc)
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// httpEmitPv — mapping PrismaOfficialPv → OfficialPv
// ---------------------------------------------------------------------------

describe('httpEmitPv — mapping retour', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('roadsen_access_token', 'fake.token');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('given un 200 avec PrismaOfficialPv, when httpEmitPv, then hmacTruncated est bien tronqué à 8 chars', async () => {
    // Forme RÉELLE : tout imbriqué sous `pv`, sceau = pv.hmac.
    const rawPv: PrismaOfficialPv = {
      pv: {
        id: 'pv_new',
        orgId: 'org_01',
        calcResultId: 'calc_01',
        projectId: 'proj_01',
        pvNumber: 'PV-2026-0003',
        userId: 'Amadou Diallo',
        projectName: 'Test Project',
        engineId: 'burmister',
        engineVersion: '1.0.0',
        engineSourceHash: 'sha256abc',
        inputCanonical: '{}',
        output: { verdict: 'PASS' },
        scienceStatus: 'OK',
        verdict: 'PASS',
        contentHash: 'contenthash03',
        hmac: 'deadbeef1234567890abcdef',
        sealedAt: new Date().toISOString(),
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeResponse(rawPv)));

    const result = await httpEmitPv('org_01', 'proj_01', { calcResultId: 'calc_01' });
    expect(result.hmacTruncated).toBe('deadbeef');
    expect(result.hmacTruncated.length).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// httpGetCalcResult — chemin négatif 404
// ---------------------------------------------------------------------------

describe('httpGetCalcResult — chemin négatif', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('roadsen_access_token', 'fake.token');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('given un 404, when httpGetCalcResult, then rejette avec statusCode 404 et reason NOT_FOUND', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(makeErrorResponse(404, 'NOT_FOUND', 'Calcul introuvable')),
    );
    await expect(
      httpGetCalcResult('org_01', 'proj_01', 'calc_inexistant'),
    ).rejects.toMatchObject({
      statusCode: 404,
      reason: 'NOT_FOUND',
    });
  });
});

// ---------------------------------------------------------------------------
// Bug A — httpRunCalc : body = req.params à la racine (pas d'enveloppe {label,params})
// ---------------------------------------------------------------------------

describe('httpRunCalc — contrat body (Bug A)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('roadsen_access_token', 'fake.token');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('given un calcul lancé, when httpRunCalc, then fetch est appelé avec req.params directement comme body (sans enveloppe label/params)', async () => {
    const prismaCalc: PrismaCalcResult = {
      id: 'calc_body_test',
      projectId: 'proj_01',
      orgId: 'org_01',
      engineId: 'burmister',
      label: 'Test body',
      domain: 'CH',
      status: 'DONE',
      input: { layers: [{ h: 0.12 }] },
      output: { verdict: 'PASS', NE: 1000000 },
      pvId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockFetch = vi.fn().mockResolvedValueOnce(makeResponse(prismaCalc));
    vi.stubGlobal('fetch', mockFetch);

    const inputParams = { layers: [{ mat: 'BBSG1', E: 5400, nu: 0.35, h: 0.06 }] };
    await httpRunCalc('org_01', 'proj_01', {
      engineId: 'burmister',
      label: 'Ne doit pas être dans le body',
      params: inputParams,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, callOptions] = mockFetch.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(callOptions.body as string) as unknown;

    // Le body doit être req.params directement — pas d'enveloppe { label, params }
    expect((sentBody as Record<string, unknown>)['label']).toBeUndefined();
    expect((sentBody as Record<string, unknown>)['params']).toBeUndefined();
    expect((sentBody as Record<string, unknown>)['layers']).toEqual(inputParams.layers);
  });
});

// ---------------------------------------------------------------------------
// Bug B — httpDownloadPvPdf : URL avec projectId dans le path, X-Org-Id dans l'en-tête
// ---------------------------------------------------------------------------

describe('httpDownloadPvPdf — contrat URL + headers (Bug B)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('roadsen_access_token', 'fake.token');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('given un téléchargement PDF, when httpDownloadPvPdf, then fetch est appelé avec le bon path et X-Org-Id', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      blob: async () => new Blob(['%PDF'], { type: 'application/pdf' }),
    } as unknown as Response);
    vi.stubGlobal('fetch', mockFetch);

    await httpDownloadPvPdf('org_01', 'proj_42', 'pv_99');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    // Le path doit inclure projectId et pvId
    expect(url).toContain('/projects/proj_42/pvs/pv_99/pdf');
    // L'en-tête X-Org-Id doit être posé
    const headers = options.headers as Record<string, string>;
    expect(headers['X-Org-Id']).toBe('org_01');
  });

  it('given un 404, when httpDownloadPvPdf, then rejette avec statusCode 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        blob: async () => new Blob(),
      } as unknown as Response),
    );
    await expect(httpDownloadPvPdf('org_01', 'proj_42', 'pv_inexistant')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

// ---------------------------------------------------------------------------
// Bug C — httpVerifyPv : GET /projects/:id/pvs/:id (pas /pvs/:id/verify), mappe sealValid→intact
// ---------------------------------------------------------------------------

describe('httpVerifyPv — contrat endpoint + mapping sealValid (Bug C)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('roadsen_access_token', 'fake.token');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('given un appel de vérification, when httpVerifyPv, then fetch appelle GET /projects/:id/pvs/:id (pas /pvs/:id/verify)', async () => {
    const rawPv: PrismaOfficialPv = {
      pv: {
        id: 'pv_01',
        orgId: 'org_01',
        calcResultId: 'calc_01',
        projectId: 'proj_01',
        pvNumber: 'PV-2026-0001',
        userId: 'Amadou Diallo',
        projectName: 'Test',
        engineId: 'burmister',
        engineVersion: '1.0.0',
        engineSourceHash: 'sha',
        inputCanonical: '{}',
        output: { verdict: 'PASS' },
        scienceStatus: 'OK',
        verdict: 'PASS',
        contentHash: 'ch01',
        hmac: 'abcdef1234567890',
        sealedAt: '2026-01-01T00:00:00.000Z',
      },
      sealValid: true,
    };

    const mockFetch = vi.fn().mockResolvedValueOnce(makeResponse(rawPv));
    vi.stubGlobal('fetch', mockFetch);

    await httpVerifyPv('org_01', 'proj_01', 'pv_01');

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    // Doit appeler /projects/proj_01/pvs/pv_01 — PAS /pvs/pv_01/verify
    expect(url).toContain('/projects/proj_01/pvs/pv_01');
    expect(url).not.toContain('/verify');
  });

  it('given sealValid=true dans la réponse, when httpVerifyPv, then intact=true dans VerifyPvResponse', async () => {
    const rawPv: PrismaOfficialPv = {
      pv: {
        id: 'pv_02',
        orgId: 'org_01',
        calcResultId: 'calc_01',
        projectId: 'proj_01',
        pvNumber: 'PV-2026-0002',
        userId: 'Amadou Diallo',
        projectName: 'Test',
        engineId: 'burmister',
        engineVersion: '1.0.0',
        engineSourceHash: 'sha',
        inputCanonical: '{}',
        output: {},
        scienceStatus: 'OK',
        verdict: 'PASS',
        contentHash: 'ch02',
        hmac: 'deadbeef12345678',
        sealedAt: '2026-01-01T00:00:00.000Z',
      },
      sealValid: true,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeResponse(rawPv)));

    const result = await httpVerifyPv('org_01', 'proj_01', 'pv_02');
    expect(result.pvId).toBe('pv_02');
    expect(result.intact).toBe(true);
    expect(result.verifiedAt).toBeTruthy(); // timestamp ISO présent
  });

  it('given sealValid=false dans la réponse, when httpVerifyPv, then intact=false (ne forge pas de faux vrai)', async () => {
    const rawPv: PrismaOfficialPv = {
      pv: {
        id: 'pv_03',
        orgId: 'org_01',
        calcResultId: 'calc_01',
        projectId: 'proj_01',
        pvNumber: 'PV-2026-0003',
        userId: 'Amadou Diallo',
        projectName: 'Test',
        engineId: 'burmister',
        engineVersion: '1.0.0',
        engineSourceHash: 'sha',
        inputCanonical: '{}',
        output: {},
        scienceStatus: 'OK',
        verdict: 'PASS',
        contentHash: 'ch03',
        hmac: 'cafebabe12345678',
        sealedAt: '2026-01-01T00:00:00.000Z',
      },
      sealValid: false,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeResponse(rawPv)));

    const result = await httpVerifyPv('org_01', 'proj_01', 'pv_03');
    expect(result.intact).toBe(false);
  });

  it('given sealValid absent (champ optionnel), when httpVerifyPv, then intact=false par défaut (fail-closed)', async () => {
    const rawPv: PrismaOfficialPv = {
      pv: {
        id: 'pv_04',
        orgId: 'org_01',
        calcResultId: 'calc_01',
        projectId: 'proj_01',
        pvNumber: 'PV-2026-0004',
        userId: 'Amadou Diallo',
        projectName: 'Test',
        engineId: 'burmister',
        engineVersion: '1.0.0',
        engineSourceHash: 'sha',
        inputCanonical: '{}',
        output: {},
        scienceStatus: 'OK',
        verdict: 'PASS',
        contentHash: 'ch04',
        hmac: 'ffffffff12345678',
        sealedAt: '2026-01-01T00:00:00.000Z',
      },
      // sealValid intentionnellement absent
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeResponse(rawPv)));

    const result = await httpVerifyPv('org_01', 'proj_01', 'pv_04');
    // sealValid ?? false → doit valoir false (jamais "intact" par défaut)
    expect(result.intact).toBe(false);
  });
});
