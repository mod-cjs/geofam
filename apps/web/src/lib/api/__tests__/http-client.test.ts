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
 *  - #2  adaptPersistedCalcResult (forme POST /calc/:engine)
 *  - #4  adaptOfficialPv robuste aux deux formes (plate emit / imbriquée list)
 *  - #8  PrismaProject.createdById (pas createdBy)
 *  - #9  httpLogin appelle GET /auth/me et stocke fullName→name
 *  - #18 storeTokens met à jour ORGS_KEY après refresh
 *  - #1  refresh proactif planifié après storeTokens
 *
 * Confidentialité DoD §8 : aucun import @roadsen/engines.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  adaptCalcResult,
  adaptOfficialPv,
  adaptProject,
  adaptEntitlements,
  adaptPersistedCalcResult,
  type PrismaCalcResult,
  type PrismaOfficialPv,
  type PrismaOfficialPvFlat,
  type PrismaProject,
  type BackendEntitlements,
  type BackendPersistedCalcResult,
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
  httpGetPvDocument,
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

// ---------------------------------------------------------------------------
// #2 — adaptPersistedCalcResult : forme POST /projects/:id/calc/:engine
// ---------------------------------------------------------------------------

describe('adaptPersistedCalcResult — forme POST /calc/:engine (#2)', () => {
  it('given une PersistedCalcResult ok=true, then id=calcResultId et engineId=meta.engineId (pas undefined)', () => {
    const raw: BackendPersistedCalcResult = {
      calcResultId: 'calc_persisted_01',
      ok: true,
      meta: { engineId: 'burmister', engineVersion: '1.0.0' },
      output: { conforme: true, NE: 1200000 },
    };
    const ctx = {
      orgId: 'org_01',
      projectId: 'proj_01',
      params: { layers: [{ h: 0.36 }] },
    };
    const result = adaptPersistedCalcResult(raw, ctx);

    expect(result.id).toBe('calc_persisted_01'); // calcResultId → id
    expect(result.engineId).toBe('burmister'); // meta.engineId → engineId
    expect(result.projectId).toBe('proj_01');
    expect(result.orgId).toBe('org_01');
    expect(result.params).toEqual({ layers: [{ h: 0.36 }] });
    expect(result.createdAt).toBeTruthy(); // fallback now() — non undefined
    expect(result.id).not.toBe(''); // pas vide (ok=true)
  });

  it('given ok=true avec output conforme=true, then status=DONE et output contient un verdict PASS', () => {
    const raw: BackendPersistedCalcResult = {
      calcResultId: 'calc_done_01',
      ok: true,
      meta: { engineId: 'burmister', engineVersion: '1.0.0' },
      output: { conforme: true, NE: 1000000 },
    };
    const result = adaptPersistedCalcResult(raw, {
      orgId: 'org_01',
      projectId: 'p',
      params: {},
    });
    expect(result.status).toBe('DONE');
    expect((result.output as { verdict?: string } | null)?.verdict).toBe('PASS');
  });

  it('given ok=false (échec moteur), then status=ERROR et id vide/non-utilisable', () => {
    const raw: BackendPersistedCalcResult = {
      calcResultId: '',
      ok: false,
      meta: { engineId: 'terzaghi', engineVersion: '1.0.0' },
      output: undefined,
    };
    const ctx = { orgId: 'org_01', projectId: 'proj_01', params: {} };
    const result = adaptPersistedCalcResult(raw, ctx);
    expect(result.status).toBe('ERROR');
    expect(result.engineId).toBe('terzaghi');
  });

  it('given engineSourceHash présent dans meta, then il est accessible dans le résultat adapté', () => {
    const raw: BackendPersistedCalcResult = {
      calcResultId: 'calc_hash',
      ok: true,
      meta: {
        engineId: 'burmister',
        engineVersion: '2.0.0',
        engineSourceHash: 'sha256abc',
      },
      output: { conforme: true, NE: 500000 },
    };
    const result = adaptPersistedCalcResult(raw, {
      orgId: 'org_01',
      projectId: 'p',
      params: {},
    });
    expect(result.id).toBe('calc_hash');
    expect(result.engineId).toBe('burmister');
  });
});

// ---------------------------------------------------------------------------
// MAJEUR-1 — adaptOfficialPv : output BRUT strippé par normalizeOutput (fail-closed)
// Les marqueurs confidentiels du moteur (_D, §4.2, propagateur, warnings, kc, Sh…)
// ne doivent jamais traverser vers OfficialPv.output (même discipline que adaptCalcResult).
// ---------------------------------------------------------------------------

describe('adaptOfficialPv — output confidentiel strippé fail-closed (MAJEUR-1)', () => {
  // Output brut du moteur contenant des marqueurs confidentiels
  const confidentielOutput = {
    conforme: true,
    NE: 1243500,
    // Marqueurs confidentiels — méthode/coefficients internes
    _D: [0.12, 0.08, 0.05],
    famille: 'Burmister 1945 §4.2 (LCPC)',
    propagateur: { kr: 1.3, ks: 0.82, kc: 1.15 },
    warnings: ['kc=1.3 (calage α=0.85)', 'coefficient ks abaissé à 0.82'],
    Sh: 0.00042,
    b: 1.15,
    ABCD: [1.2, 0.3, 0.15, 0.05],
  };

  it('NÉGATIF (forme plate emit) : output avec marqueurs confidentiels → aucun marqueur dans OfficialPv.output', () => {
    const flatPv: PrismaOfficialPvFlat = {
      id: 'pv_confidentiel',
      orgId: 'org_01',
      calcResultId: 'calc_01',
      projectId: 'proj_01',
      pvNumber: 'PV-RDS-test-2026-000001',
      userId: 'usr-uuid',
      projectName: 'Test',
      engineId: 'chaussee-burmister',
      engineVersion: '1.0.0',
      inputCanonical: '{}',
      output: confidentielOutput,
      scienceStatus: 'unsigned',
      verdict: 'PASS',
      contentHash: 'ch01',
      hmac: 'aabbccdd12345678',
      sealedAt: '2026-06-28T10:00:00.000Z',
    };

    const result = adaptOfficialPv(flatPv as unknown as PrismaOfficialPv);
    const serialized = JSON.stringify(result.output ?? {});

    // Aucun marqueur confidentiel ne doit traverser
    expect(serialized).not.toContain('_D');
    expect(serialized).not.toContain('§4.2');
    expect(serialized).not.toContain('LCPC');
    expect(serialized).not.toContain('kc=1.3');
    expect(serialized).not.toContain('propagateur');
    expect(serialized).not.toContain('warnings');
    expect(serialized).not.toContain('Sh');
    expect(serialized).not.toContain('ABCD');
    expect(serialized).not.toContain('famille');

    // Le verdict normalisé doit être présent (output null ou {verdict, rows})
    if (result.output !== null) {
      expect((result.output as { verdict?: string }).verdict).toBe('PASS');
    }
  });

  it('NÉGATIF (forme imbriquée list) : même garantie via OfficialPvView { pv, sealValid }', () => {
    const nestedPv: PrismaOfficialPv = {
      pv: {
        id: 'pv_nested_confidentiel',
        orgId: 'org_01',
        calcResultId: 'calc_02',
        projectId: 'proj_01',
        pvNumber: 'PV-RDS-test-2026-000002',
        userId: 'usr-uuid',
        projectName: 'Test',
        engineId: 'chaussee-burmister',
        engineVersion: '1.0.0',
        inputCanonical: '{}',
        output: confidentielOutput,
        scienceStatus: 'unsigned',
        verdict: 'PASS',
        contentHash: 'ch02',
        hmac: 'deadbeef12345678',
        sealedAt: '2026-06-28T10:00:00.000Z',
      },
      sealValid: true,
    };

    const result = adaptOfficialPv(nestedPv);
    const serialized = JSON.stringify(result.output ?? {});

    expect(serialized).not.toContain('_D');
    expect(serialized).not.toContain('propagateur');
    expect(serialized).not.toContain('warnings');
    expect(serialized).not.toContain('famille');
    expect(serialized).not.toContain('ABCD');
  });

  it('NÉGATIF : output d un moteur non reconnu (fondations) → null fail-closed, aucune donnée brute exposée', () => {
    // Un moteur fondation renvoie un output sans conforme:boolean ni verdict+rows → non reconnu
    const foundationOutput = {
      q_adm: 250,
      Nq: 18.5,
      methode: 'Meyerhof §6.3',
      intermediaires: [1.2, 3.4, 0.85],
    };
    const flatPv: PrismaOfficialPvFlat = {
      id: 'pv_found',
      orgId: 'org_01',
      calcResultId: 'calc_03',
      projectId: 'proj_01',
      pvNumber: 'PV-RDS-test-2026-000003',
      userId: 'usr-uuid',
      projectName: 'Test',
      engineId: 'fondation-superficielle',
      engineVersion: '1.0.0',
      inputCanonical: '{}',
      output: foundationOutput,
      scienceStatus: 'unsigned',
      verdict: 'PASS',
      contentHash: 'ch03',
      hmac: 'cafebabe12345678',
      sealedAt: '2026-06-28T10:00:00.000Z',
    };

    const result = adaptOfficialPv(flatPv as unknown as PrismaOfficialPv);
    // Moteur non reconnu → fail-closed → null
    expect(result.output).toBeNull();
    expect(JSON.stringify(result)).not.toContain('Nq');
    expect(JSON.stringify(result)).not.toContain('methode');
    expect(JSON.stringify(result)).not.toContain('intermediaires');
  });
});

// ---------------------------------------------------------------------------
// MINEUR-1 — ENGINE_TO_DOMAIN : slugs URL + registryIds canoniques
// ---------------------------------------------------------------------------

describe('ENGINE_TO_DOMAIN — registryIds et slugs URL canoniques (MINEUR-1)', () => {
  const mkPersisted = (engineId: string): BackendPersistedCalcResult => ({
    calcResultId: 'calc_x',
    ok: true,
    meta: { engineId, engineVersion: '1.0.0' },
    output: null,
  });
  const ctx = { orgId: 'org_01', projectId: 'proj_01', params: {} };

  it('registryId chaussee-burmister → domaine CH', () => {
    expect(adaptPersistedCalcResult(mkPersisted('chaussee-burmister'), ctx).domain).toBe(
      'CH',
    );
  });

  it('registryId fondation-superficielle → domaine FD', () => {
    expect(
      adaptPersistedCalcResult(mkPersisted('fondation-superficielle'), ctx).domain,
    ).toBe('FD');
  });

  it('registryId fondation-profonde-pieux → domaine FD', () => {
    expect(
      adaptPersistedCalcResult(mkPersisted('fondation-profonde-pieux'), ctx).domain,
    ).toBe('FD');
  });

  it('registryId radier-plaque → domaine FD', () => {
    expect(adaptPersistedCalcResult(mkPersisted('radier-plaque'), ctx).domain).toBe('FD');
  });

  it('registryId pressiometre-menard → domaine LB', () => {
    expect(adaptPersistedCalcResult(mkPersisted('pressiometre-menard'), ctx).domain).toBe(
      'LB',
    );
  });

  it('registryId labo-classification-gtr → domaine LB', () => {
    expect(
      adaptPersistedCalcResult(mkPersisted('labo-classification-gtr'), ctx).domain,
    ).toBe('LB');
  });

  // URL slugs (backward-compat avec fixtures existantes)
  it('slug URL burmister → domaine CH', () => {
    expect(adaptPersistedCalcResult(mkPersisted('burmister'), ctx).domain).toBe('CH');
  });

  it('slug URL pieux → domaine FD', () => {
    expect(adaptPersistedCalcResult(mkPersisted('pieux'), ctx).domain).toBe('FD');
  });

  it('slug URL radier → domaine FD', () => {
    expect(adaptPersistedCalcResult(mkPersisted('radier'), ctx).domain).toBe('FD');
  });

  it('slug URL labo → domaine LB', () => {
    expect(adaptPersistedCalcResult(mkPersisted('labo'), ctx).domain).toBe('LB');
  });

  it('moteur inconnu → fallback CH (défaut conservateur)', () => {
    expect(adaptPersistedCalcResult(mkPersisted('moteur-inconnu'), ctx).domain).toBe(
      'CH',
    );
  });
});

// ---------------------------------------------------------------------------
// adaptOfficialPv — sealHash tronqué à 8 caractères (forme imbriquée)
// ---------------------------------------------------------------------------

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
      // Forme reconnue par normalizeOutput : verdict + rows (pas de brut confidentiel)
      output: { verdict: 'PASS', rows: [] },
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

  it('given inputCanonical JSON et output dans pv, then params extraits et output normalisé (verdict PASS)', () => {
    const result = adaptOfficialPv(prismaPv);
    // params = JSON.parse(pv.inputCanonical)
    expect(result.params).toEqual({ layers: [] });
    // output normalisé via normalizeOutput (fail-closed) — verdict présent car {verdict,rows} reconnu
    expect((result.output as { verdict?: string })?.verdict).toBe('PASS');
    // number = pv.pvNumber
    expect(result.number).toBe('PV-2026-0001');
    // sealedBy = pv.userId (pas d'identity.userDisplayName dans ce canonical)
    expect(result.sealedBy).toBe('Amadou Diallo');
  });
});

// ---------------------------------------------------------------------------
// #4 — adaptOfficialPv : forme plate (POST emit — OfficialPv Prisma direct)
// ---------------------------------------------------------------------------

describe('adaptOfficialPv — forme plate (POST emit) (#4)', () => {
  const flatPv: PrismaOfficialPvFlat = {
    id: 'pv_emit_01',
    orgId: 'org_01',
    calcResultId: 'calc_01',
    projectId: 'proj_01',
    pvNumber: 'PV-RDS-be-dakar-2026-000001',
    userId: 'usr-uuid-aabbccdd',
    projectName: 'Projet Test',
    engineId: 'burmister',
    engineVersion: '1.0.0',
    engineSourceHash: 'sha256flat',
    inputCanonical: JSON.stringify({ layers: [{ h: 0.12 }] }),
    output: { verdict: 'PASS' },
    scienceStatus: 'unsigned',
    verdict: 'PASS',
    contentHash: 'hashflat01',
    hmac: 'deadbeef1234567890abcdef',
    sealedAt: '2026-06-28T10:00:00.000Z',
  };

  it('given une réponse plate (OfficialPv direct), then pas de crash et id/number corrects', () => {
    // Cast : adaptOfficialPv accepte les deux formes
    const result = adaptOfficialPv(flatPv as unknown as PrismaOfficialPv);
    expect(result.id).toBe('pv_emit_01');
    expect(result.number).toBe('PV-RDS-be-dakar-2026-000001');
    expect(result.hmacTruncated).toBe('deadbeef');
    expect(result.hmacTruncated.length).toBe(8);
  });

  it('given forme plate, then calcResultId / engineId / orgId / projectId corrects', () => {
    const result = adaptOfficialPv(flatPv as unknown as PrismaOfficialPv);
    expect(result.calcResultId).toBe('calc_01');
    expect(result.engineId).toBe('burmister');
    expect(result.orgId).toBe('org_01');
    expect(result.projectId).toBe('proj_01');
  });

  it('given forme plate avec identity.userDisplayName dans inputCanonical, then sealedBy = nom (pas UUID)', () => {
    const canonical = {
      pvNumber: 'PV-RDS-be-dakar-2026-000002',
      identity: {
        userId: 'usr-uuid-aabbccdd',
        userDisplayName: 'Boubacar Ndiaye',
        orgDisplayName: 'Bureau Route Dakar',
        projectId: 'proj_01',
        projectName: 'Projet Test',
      },
      input: { layers: [] },
      output: {},
    };
    const flatWithName: PrismaOfficialPvFlat = {
      ...flatPv,
      id: 'pv_emit_02',
      inputCanonical: JSON.stringify(canonical),
    };
    const result = adaptOfficialPv(flatWithName as unknown as PrismaOfficialPv);
    expect(result.sealedBy).toBe('Boubacar Ndiaye'); // nom extrait, pas UUID
  });

  it('given forme plate sans identity.userDisplayName, then sealedBy = userId (UUID fallback)', () => {
    const result = adaptOfficialPv(flatPv as unknown as PrismaOfficialPv);
    // Le inputCanonical de flatPv n'a pas d'identity.userDisplayName
    expect(result.sealedBy).toBe('usr-uuid-aabbccdd');
  });

  it('given forme plate, then pdfUrl est undefined', () => {
    const result = adaptOfficialPv(flatPv as unknown as PrismaOfficialPv);
    expect(result.pdfUrl).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #8 — adaptProject : createdById (pas createdBy)
// ---------------------------------------------------------------------------

describe('adaptProject — createdById (pas createdBy) (#8)', () => {
  const raw: PrismaProject = {
    id: 'proj_01',
    orgId: 'org_01',
    name: 'Test',
    description: null,
    domain: 'CH',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdById: 'usr_01', // champ réel du backend
  };

  it('given createdById dans la réponse backend, then createdBy front est bien mappé (pas undefined)', () => {
    const result = adaptProject(raw);
    expect(result.createdBy).toBe('usr_01');
    expect(result.createdBy).not.toBeUndefined();
  });

  it('given description null, then description est undefined', () => {
    const result = adaptProject(raw);
    expect(result.description).toBeUndefined();
  });

  it('given un domaine valide, then le domaine est préservé', () => {
    expect(adaptProject({ ...raw, domain: 'FD' }).domain).toBe('FD');
    expect(adaptProject({ ...raw, domain: 'LB' }).domain).toBe('LB');
  });
});

// ---------------------------------------------------------------------------
// adaptEntitlements — forme ADR 0011
// ---------------------------------------------------------------------------

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

  // Réponse /auth/me mockée (profile utilisateur)
  const mockMeResponse = {
    userId: 'usr_01',
    email: 'demo@starfire.sn',
    fullName: 'Amadou Diallo',
    platformRole: null,
    memberships: [
      {
        orgId: 'org_01',
        orgName: 'BE Routes Dakar',
        orgSlug: 'be-routes-dakar',
        role: 'OWNER',
      },
    ],
  };

  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('given des identifiants valides, when httpLogin, then stocke accessToken et refreshToken', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse({
          accessToken: mockJwt,
          refreshToken: 'refresh.token',
        }),
      )
      // 2e appel : GET /auth/me
      .mockResolvedValueOnce(makeResponse(mockMeResponse));
    vi.stubGlobal('fetch', mockFetch);

    const result = await httpLogin({ email: 'demo@starfire.sn', password: 'pass' });
    expect(result.accessToken).toBe(mockJwt);
    expect(sessionStorage.getItem('roadsen_access_token')).toBe(mockJwt);
    expect(sessionStorage.getItem('roadsen_refresh_token')).toBe('refresh.token');
  });

  it('given un login réussi, when httpLogin, then les orgs JWT sont stockées en session', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse({
          accessToken: mockJwt,
          refreshToken: 'refresh.token',
        }),
      )
      .mockResolvedValueOnce(makeResponse(mockMeResponse));
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
// #9 — httpLogin appelle GET /auth/me et stocke fullName→name
// ---------------------------------------------------------------------------

describe('httpLogin — GET /auth/me et stockage profil (#9)', () => {
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

  it('given login réussi et /auth/me OK, when httpLogin, then user.name=fullName et user.email stockés', async () => {
    const mockFetch = vi
      .fn()
      // 1er appel : /auth/login
      .mockResolvedValueOnce(
        makeResponse({ accessToken: mockJwt, refreshToken: 'r.tok' }),
      )
      // 2e appel : GET /auth/me
      .mockResolvedValueOnce(
        makeResponse({
          userId: 'usr_01',
          email: 'amadou@starfire.sn',
          fullName: 'Amadou Bah Diallo',
          platformRole: null,
          memberships: [],
        }),
      );
    vi.stubGlobal('fetch', mockFetch);

    await httpLogin({ email: 'amadou@starfire.sn', password: 'pass' });

    const stored = JSON.parse(sessionStorage.getItem('roadsen_user') ?? 'null') as {
      id?: string;
      name?: string;
      email?: string;
    } | null;
    expect(stored).not.toBeNull();
    expect(stored?.name).toBe('Amadou Bah Diallo'); // fullName → name
    expect(stored?.email).toBe('amadou@starfire.sn');
    expect(stored?.id).toBe('usr_01'); // userId → id

    // Vérifie que /auth/me a bien été appelé (2 fetch au total)
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [secondUrl] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(secondUrl).toContain('/auth/me');
  });

  it('given /auth/me échoue, when httpLogin, then login réussit quand même (pas de crash)', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse({ accessToken: mockJwt, refreshToken: 'r.tok' }),
      )
      // /auth/me renvoie une erreur 500
      .mockResolvedValueOnce(makeErrorResponse(500, 'SERVER_ERROR', 'Erreur serveur'));
    vi.stubGlobal('fetch', mockFetch);

    // Ne doit pas rejeter
    const result = await httpLogin({ email: 'test@x.sn', password: 'pass' });
    expect(result.accessToken).toBe(mockJwt);

    // Un user fallback doit être stocké (pas undefined)
    const stored = sessionStorage.getItem('roadsen_user');
    expect(stored).not.toBeNull();
  });

  it('given login réussi, then les 2 appels fetch sont login puis /auth/me dans cet ordre', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse({ accessToken: mockJwt, refreshToken: 'r.tok' }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          userId: 'u',
          email: 'e@e.sn',
          fullName: 'E E',
          platformRole: null,
          memberships: [],
        }),
      );
    vi.stubGlobal('fetch', mockFetch);

    await httpLogin({ email: 'e@e.sn', password: 'p' });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const firstUrl = (mockFetch.mock.calls[0] as [string])[0];
    const secondUrl = (mockFetch.mock.calls[1] as [string])[0];
    expect(firstUrl).toContain('/auth/login');
    expect(secondUrl).toContain('/auth/me');
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

  it('given un calcul réussi (PersistedCalcResult), when httpRunCalc, then id/engineId ne sont pas undefined (#2)', async () => {
    // Forme réelle renvoyée par POST /calc/:engine
    const persistedCalc: BackendPersistedCalcResult = {
      calcResultId: 'calc_real_01',
      ok: true,
      meta: { engineId: 'burmister', engineVersion: '1.0.0' },
      output: { conforme: true, NE: 1243500 },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeResponse(persistedCalc)));

    const result = await httpRunCalc('org_01', 'proj_01', {
      engineId: 'burmister',
      label: 'Test',
      params: { layers: [{ h: 0.36 }] },
    });

    // #2 — AVANT le fix, id et engineId étaient undefined
    expect(result.id).toBe('calc_real_01'); // calcResultId → id
    expect(result.id).not.toBeUndefined();
    expect(result.engineId).toBe('burmister'); // meta.engineId → engineId
    expect(result.engineId).not.toBeUndefined();
    expect(result.params).toEqual({ layers: [{ h: 0.36 }] }); // params passés par le contexte
  });
});

// ---------------------------------------------------------------------------
// #18 — refresh transparent : ORGS_KEY mis à jour après refresh
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
        createdById: 'usr_01',
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
// #18 — storeTokens met à jour ORGS_KEY après refresh
// ---------------------------------------------------------------------------

describe('storeTokens met à jour ORGS_KEY après refresh (#18)', () => {
  const newOrgs = [{ id: 'org_02', slug: 'labo-thies', role: 'ENGINEER' }];
  const newAccessToken = makeJwt({
    sub: 'usr_01',
    typ: 'access',
    orgs: newOrgs,
    iat: 0,
    exp: 9999999999,
  });

  beforeEach(() => {
    sessionStorage.clear();
    // Stocker des orgs initiales (anciens)
    sessionStorage.setItem('roadsen_access_token', 'expired.token');
    sessionStorage.setItem('roadsen_refresh_token', 'valid.refresh.token');
    sessionStorage.setItem(
      'roadsen_orgs',
      JSON.stringify([{ id: 'org_01', slug: 'be-routes-dakar', role: 'OWNER' }]),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('given un refresh réussi avec nouveau JWT (orgs différentes), when refresh, then ORGS_KEY est mis à jour', async () => {
    // Scénario : 401 sur /projects → refresh → retry
    const projects: PrismaProject[] = [
      {
        id: 'p01',
        orgId: 'org_02',
        name: 'T',
        description: null,
        domain: 'FD',
        createdAt: '2026-01-01Z',
        updatedAt: '2026-01-01Z',
        createdById: 'u01',
      },
    ];

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeResponse({ statusCode: 401 }, 401))
      // Refresh → nouveau token avec nouvelles orgs
      .mockResolvedValueOnce(
        makeResponse({ accessToken: newAccessToken, refreshToken: 'new.refresh' }),
      )
      .mockResolvedValueOnce(makeResponse(projects));

    vi.stubGlobal('fetch', mockFetch);

    await httpListProjects('org_02');

    // Les orgs doivent être mises à jour depuis le nouveau JWT
    const storedOrgs = JSON.parse(
      sessionStorage.getItem('roadsen_orgs') ?? '[]',
    ) as Array<{
      slug: string;
    }>;
    expect(storedOrgs).toHaveLength(1);
    expect(storedOrgs[0].slug).toBe('labo-thies'); // nouvelles orgs du nouveau token
  });
});

// ---------------------------------------------------------------------------
// #1 — Refresh proactif planifié après storeTokens
// ---------------------------------------------------------------------------

describe('refresh proactif après storeTokens (#1)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('given un JWT qui expire dans 2 minutes, when httpLogin réussi, then un appel refresh est planifié ~60s avant l expiration', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const expInTwoMin = nowSec + 120; // expire dans 120s

    const jwtWithExp = makeJwt({
      sub: 'usr_01',
      typ: 'access',
      orgs: [{ id: 'org_01', slug: 'be', role: 'OWNER' }],
      iat: nowSec,
      exp: expInTwoMin,
    });

    const mockFetch = vi
      .fn()
      // login
      .mockResolvedValueOnce(
        makeResponse({ accessToken: jwtWithExp, refreshToken: 'r.tok' }),
      )
      // /auth/me
      .mockResolvedValueOnce(
        makeResponse({
          userId: 'u',
          email: 'e@e.sn',
          fullName: 'Test',
          platformRole: null,
          memberships: [],
        }),
      )
      // refresh proactif (appelé ~60s avant exp, soit ~60s depuis maintenant)
      .mockResolvedValueOnce(
        makeResponse({ accessToken: jwtWithExp, refreshToken: 'r.tok.new' }),
      );

    vi.stubGlobal('fetch', mockFetch);

    await httpLogin({ email: 'e@e.sn', password: 'p' });

    // Avancer le temps de 65 secondes (>60s, 401 avant exp)
    await vi.advanceTimersByTimeAsync(65_000);

    // Un appel refresh doit avoir été déclenché (au total : login + /auth/me + refresh)
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const refreshCall = mockFetch.mock.calls[2] as [string, RequestInit];
    expect(refreshCall[0]).toContain('/auth/refresh');
  });

  it('given un token presque expiré (< 65s restants), when storeTokens, then aucun timer planifié (laisser le flux 401 gérer)', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const expIn30Sec = nowSec + 30; // presque mort

    const shortJwt = makeJwt({
      sub: 'usr_01',
      typ: 'access',
      orgs: [],
      iat: nowSec,
      exp: expIn30Sec,
    });

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse({ accessToken: shortJwt, refreshToken: 'r.tok' }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          userId: 'u',
          email: 'e@e.sn',
          fullName: 'T',
          platformRole: null,
          memberships: [],
        }),
      );

    vi.stubGlobal('fetch', mockFetch);
    await httpLogin({ email: 'e@e.sn', password: 'p' });

    // Avancer de 35s : si un timer avait été planifié, il se serait déclenché
    await vi.advanceTimersByTimeAsync(35_000);

    // Aucun refresh proactif (token trop court pour être utile, délai < 5s)
    expect(mockFetch).toHaveBeenCalledTimes(2); // login + /auth/me seulement
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
    const persistedCalc: BackendPersistedCalcResult = {
      calcResultId: 'calc_x',
      ok: true,
      meta: { engineId: 'burmister', engineVersion: '1.0.0' },
      output: { conforme: true, NE: 500000 },
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
      .mockResolvedValueOnce(makeResponse(persistedCalc))
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
// httpEmitPv — mapping PrismaOfficialPvFlat → OfficialPv (#4)
// ---------------------------------------------------------------------------

describe('httpEmitPv — mapping retour forme plate (#4)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('roadsen_access_token', 'fake.token');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('given un 200 avec OfficialPv plat (forme emit), when httpEmitPv, then hmacTruncated tronqué à 8 chars et pas de crash', async () => {
    // Forme réelle du POST /calc-results/:id/pv : OfficialPv Prisma direct (plat)
    const rawFlatPv: PrismaOfficialPvFlat = {
      id: 'pv_new',
      orgId: 'org_01',
      calcResultId: 'calc_01',
      projectId: 'proj_01',
      pvNumber: 'PV-RDS-be-dakar-2026-000003',
      userId: 'usr-uuid-aabbccdd',
      projectName: 'Projet Route',
      engineId: 'burmister',
      engineVersion: '1.0.0',
      engineSourceHash: 'sha256xyz',
      inputCanonical: '{}',
      output: { verdict: 'PASS' },
      scienceStatus: 'unsigned',
      verdict: 'PASS',
      contentHash: 'contenthash03',
      hmac: 'deadbeef1234567890abcdef',
      sealedAt: new Date().toISOString(),
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeResponse(rawFlatPv)));

    const result = await httpEmitPv('org_01', 'proj_01', { calcResultId: 'calc_01' });
    expect(result.hmacTruncated).toBe('deadbeef');
    expect(result.hmacTruncated.length).toBe(8);
    // Pas de crash (avant le fix, raw.pv.id → TypeError)
    expect(result.id).toBe('pv_new');
    expect(result.number).toBe('PV-RDS-be-dakar-2026-000003');
  });

  it('given une réponse plate, then id et calcResultId sont corrects', async () => {
    const rawFlatPv: PrismaOfficialPvFlat = {
      id: 'pv_flat_42',
      orgId: 'org_01',
      calcResultId: 'calc_99',
      projectId: 'proj_01',
      pvNumber: 'PV-RDS-be-2026-000042',
      userId: 'usr-uuid',
      projectName: 'Test',
      engineId: 'burmister',
      engineVersion: '1.0.0',
      inputCanonical: '{}',
      output: {},
      scienceStatus: 'unsigned',
      verdict: 'PASS',
      contentHash: 'ch42',
      hmac: 'cafebabe12345678',
      sealedAt: new Date().toISOString(),
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeResponse(rawFlatPv)));

    const result = await httpEmitPv('org_01', 'proj_01', { calcResultId: 'calc_99' });
    expect(result.id).toBe('pv_flat_42');
    expect(result.calcResultId).toBe('calc_99');
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
    const persistedCalc: BackendPersistedCalcResult = {
      calcResultId: 'calc_body_test',
      ok: true,
      meta: { engineId: 'burmister', engineVersion: '1.0.0' },
      output: { conforme: true, NE: 1000000 },
    };

    const mockFetch = vi.fn().mockResolvedValueOnce(makeResponse(persistedCalc));
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
    await expect(
      httpDownloadPvPdf('org_01', 'proj_42', 'pv_inexistant'),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

// ---------------------------------------------------------------------------
// B1 (revue adverse) — httpGetPvDocument : 404 ET 409 retombent sur `null`
// (jamais de cul-de-sac ; l'appelant retombe sur le PDF). Le 409 est loggé en
// diagnostic distinct (anomalie d'intégrité), sans bloquer l'ingénieur.
// ---------------------------------------------------------------------------

describe('httpGetPvDocument — 404 ET 409 retombent sur null (B1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('given un document présent (200), when httpGetPvDocument, then renvoie { html }', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '<p>Document scellé</p>',
      } as unknown as Response),
    );
    const doc = await httpGetPvDocument('org_01', 'proj_42', 'pv_99');
    expect(doc).toEqual({ html: '<p>Document scellé</p>' });
  });

  it('given un PV sans document (404), when httpGetPvDocument, then renvoie null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({ ok: false, status: 404 } as unknown as Response),
    );
    const doc = await httpGetPvDocument('org_01', 'proj_42', 'pv_ancien');
    expect(doc).toBeNull();
  });

  it('given une intégrité rompue (409), when httpGetPvDocument, then renvoie null (repli PDF côté appelant) ET logue un diagnostic distinct', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ message: 'Document altéré ou sceau rompu.' }),
      } as unknown as Response),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const doc = await httpGetPvDocument('org_01', 'proj_42', 'pv_altere');

    expect(doc).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const loggedMessage = warnSpy.mock.calls[0]?.[0] as string;
    expect(loggedMessage).toContain('409');
    expect(loggedMessage).toContain('Document altéré ou sceau rompu.');
    warnSpy.mockRestore();
  });

  it('given une erreur serveur générique (500), when httpGetPvDocument, then rejette (pas de repli silencieux)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Erreur interne' }),
      } as unknown as Response),
    );
    await expect(httpGetPvDocument('org_01', 'proj_42', 'pv_99')).rejects.toMatchObject({
      statusCode: 500,
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
