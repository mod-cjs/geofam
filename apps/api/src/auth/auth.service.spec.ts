import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PrismaService } from '../prisma/prisma.service';

import { AuthService } from './auth.service';
import { hashPassword, verifyPassword } from './password';
import type { TokenService } from './token.service';

// On mocke le hachage : le test du login ne doit dependre ni d'argon2 ni d'un
// vrai hash. verifyPassword/hashPassword deviennent des espions pilotes.
jest.mock('./password', () => ({
  verifyPassword: jest.fn(),
  hashPassword: jest.fn(),
}));
const verifyPasswordMock = verifyPassword as jest.MockedFunction<
  typeof verifyPassword
>;
const hashPasswordMock = hashPassword as jest.MockedFunction<
  typeof hashPassword
>;

/** Fabrique une erreur Prisma "raw query failed" portant un SQLSTATE PG donne. */
function rawPgError(sqlState: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    `raw query failed (SQLSTATE ${sqlState})`,
    { code: 'P2010', clientVersion: 'test', meta: { code: sqlState } },
  );
}

/**
 * Stub PrismaService pour les tests unitaires d'AuthService. Toutes les lectures
 * d'identite « a froid » passent par `asAppRole((tx) => tx.$queryRaw...)` (cf.
 * migration 0007). Le stub execute le callback avec un `tx` dont `$queryRaw` est
 * LE MEME mock que `prisma.$queryRaw` -> les `mockResolvedValue(...)`/`mockRejectedValue(...)`
 * des tests pilotent indifferemment les appels directs ET ceux via asAppRole.
 */
type PrismaStub = { $queryRaw: jest.Mock; asAppRole: jest.Mock };
function makePrismaStub(): PrismaStub {
  // Defaut [] : loadOrgClaims (login/refresh) appelle $queryRaw meme quand un
  // test ne s'interesse pas aux memberships -> il doit recevoir un tableau (et
  // non undefined). Les tests qui pilotent les lignes surchargent ce defaut.
  const queryRaw = jest.fn().mockResolvedValue([]);
  return {
    $queryRaw: queryRaw,
    asAppRole: jest.fn((fn: (tx: { $queryRaw: jest.Mock }) => unknown) =>
      fn({ $queryRaw: queryRaw }),
    ),
  };
}

/**
 * Non-regression A3 — anti-timing / 401 generique au login.
 *
 * Trois causes d'echec (email inconnu, mauvais mdp, compte inactif) doivent
 * produire la MEME UnauthorizedException generique, et verifyPassword doit
 * TOUJOURS etre appele (pas de court-circuit qui creerait un oracle de timing
 * ou d'enumeration).
 */
describe('AuthService.login', () => {
  let prisma: PrismaStub;
  let tokens: { signAccess: jest.Mock; signRefresh: jest.Mock };
  let service: AuthService;

  const activeUser = {
    id: 'user-1',
    password_hash: '$argon2id$hash',
    is_active: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = makePrismaStub();
    tokens = {
      signAccess: jest.fn().mockResolvedValue('access-token'),
      signRefresh: jest.fn().mockResolvedValue('refresh-token'),
    };
    service = new AuthService(
      prisma as unknown as PrismaService,
      tokens as unknown as TokenService,
    );
  });

  describe('given un email inconnu', () => {
    it('leve la 401 generique ET appelle quand meme verifyPassword (anti-timing)', async () => {
      prisma.$queryRaw.mockResolvedValue([]); // aucun user
      verifyPasswordMock.mockResolvedValue(false);

      await expect(service.login('absent@x.io', 'pw')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      // L'invariant central : verifyPassword est appele meme sans user
      // (avec un hash null), sinon le temps de reponse trahit l'inexistence.
      expect(verifyPasswordMock).toHaveBeenCalledTimes(1);
      expect(verifyPasswordMock).toHaveBeenCalledWith(null, 'pw');
    });
  });

  describe('given un mauvais mot de passe', () => {
    it('leve la 401 generique apres avoir appele verifyPassword', async () => {
      prisma.$queryRaw.mockResolvedValue([activeUser]);
      verifyPasswordMock.mockResolvedValue(false);

      await expect(
        service.login('user@x.io', 'mauvais'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(verifyPasswordMock).toHaveBeenCalledTimes(1);
      expect(verifyPasswordMock).toHaveBeenCalledWith(
        '$argon2id$hash',
        'mauvais',
      );
    });
  });

  describe('given un compte inactif (mdp pourtant correct)', () => {
    it('leve la 401 generique ET a bien appele verifyPassword (pas de court-circuit sur is_active)', async () => {
      prisma.$queryRaw.mockResolvedValue([{ ...activeUser, is_active: false }]);
      // Le mdp est correct : seul is_active doit bloquer, mais sans
      // court-circuiter verifyPassword (sinon oracle de timing actif/inactif).
      verifyPasswordMock.mockResolvedValue(true);

      await expect(service.login('user@x.io', 'bon')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(verifyPasswordMock).toHaveBeenCalledTimes(1);
      expect(tokens.signAccess).not.toHaveBeenCalled();
    });
  });

  describe('les trois echecs sont indistinguables', () => {
    it('renvoie le MEME message generique pour email inconnu / mauvais mdp / compte inactif', async () => {
      const messages: string[] = [];

      // 1) email inconnu
      prisma.$queryRaw.mockResolvedValueOnce([]);
      verifyPasswordMock.mockResolvedValueOnce(false);
      // 2) mauvais mdp
      prisma.$queryRaw.mockResolvedValueOnce([activeUser]);
      verifyPasswordMock.mockResolvedValueOnce(false);
      // 3) compte inactif
      prisma.$queryRaw.mockResolvedValueOnce([
        { ...activeUser, is_active: false },
      ]);
      verifyPasswordMock.mockResolvedValueOnce(true);

      for (const creds of [
        ['absent@x.io', 'pw'],
        ['user@x.io', 'mauvais'],
        ['user@x.io', 'bon'],
      ] as const) {
        try {
          await service.login(creds[0], creds[1]);
          throw new Error('aurait du lever');
        } catch (e) {
          messages.push((e as Error).message);
        }
      }

      // Aucun message ne distingue la cause d'echec.
      expect(new Set(messages).size).toBe(1);
      expect(messages[0]).toBe('Identifiants invalides');
    });
  });

  describe('given des identifiants valides', () => {
    it('emet une paire de tokens (access + refresh) pour le bon userId', async () => {
      prisma.$queryRaw.mockResolvedValue([activeUser]);
      verifyPasswordMock.mockResolvedValue(true);

      await expect(service.login('user@x.io', 'bon')).resolves.toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      // signAccess recoit (userId, orgs). Ici les lignes mockees n'ont pas de
      // org_id/org_slug -> orgs = [] (le claim `orgs` reste vide). signRefresh
      // reste minimal (userId seul).
      expect(tokens.signAccess).toHaveBeenCalledWith('user-1', []);
      expect(tokens.signRefresh).toHaveBeenCalledWith('user-1');
    });

    it('given un user multi-org : signe l access avec orgs = {id,slug,role} FRAIS (ADR 0010)', async () => {
      // 1er appel $queryRaw : lookup de login (auth_find_user_by_email).
      // 2e appel : loadOrgClaims (auth_get_user_profile) -> 2 memberships.
      prisma.$queryRaw
        .mockResolvedValueOnce([activeUser])
        .mockResolvedValueOnce([
          {
            user_id: 'user-1',
            email: 'u@x.io',
            full_name: 'U',
            platform_role: null,
            org_id: 'o1',
            org_name: 'Org 1',
            org_slug: 'org-1',
            membership_role: 'OWNER',
          },
          {
            user_id: 'user-1',
            email: 'u@x.io',
            full_name: 'U',
            platform_role: null,
            org_id: 'o2',
            org_name: 'Org 2',
            org_slug: 'org-2',
            membership_role: 'ENGINEER',
          },
        ]);
      verifyPasswordMock.mockResolvedValue(true);

      await service.login('u@x.io', 'bon');

      // Le claim `orgs` est la PHOTO des memberships : id (= X-Org-Id), slug
      // (= [orgSlug] URL), role (gating UI). PAS de nom d'org, pas d'email.
      expect(tokens.signAccess).toHaveBeenCalledWith('user-1', [
        { id: 'o1', slug: 'org-1', role: 'OWNER' },
        { id: 'o2', slug: 'org-2', role: 'ENGINEER' },
      ]);
    });

    it('given un user SANS membership : orgs = [] (claim vide, pas d erreur)', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([activeUser])
        .mockResolvedValueOnce([
          {
            user_id: 'user-1',
            email: 'u@x.io',
            full_name: 'U',
            platform_role: 'SUPERADMIN',
            org_id: null,
            org_name: null,
            org_slug: null,
            membership_role: null,
          },
        ]);
      verifyPasswordMock.mockResolvedValue(true);

      await service.login('u@x.io', 'bon');
      expect(tokens.signAccess).toHaveBeenCalledWith('user-1', []);
    });
  });
});

/**
 * Non-regression — refresh stateless.
 */
describe('AuthService.refresh', () => {
  let prisma: PrismaStub;
  let tokens: {
    verify: jest.Mock;
    signAccess: jest.Mock;
    signRefresh: jest.Mock;
  };
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = makePrismaStub();
    tokens = {
      verify: jest.fn(),
      signAccess: jest.fn().mockResolvedValue('new-access'),
      signRefresh: jest.fn().mockResolvedValue('new-refresh'),
    };
    service = new AuthService(
      prisma as unknown as PrismaService,
      tokens as unknown as TokenService,
    );
  });

  it('rejette (401) un refresh token invalide', async () => {
    tokens.verify.mockResolvedValue(null);
    await expect(service.refresh('bidon')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(tokens.signAccess).not.toHaveBeenCalled();
  });

  it('verifie le token AVEC le type refresh (pas access) puis emet une nouvelle paire', async () => {
    tokens.verify.mockResolvedValue('user-7');
    // 1er $queryRaw : auth_get_user_state -> compte ACTIF et existant (M3).
    // 2e $queryRaw : loadOrgClaims (auth_get_user_profile) -> aucune org.
    prisma.$queryRaw
      .mockResolvedValueOnce([{ user_id: 'user-7', is_active: true }])
      .mockResolvedValueOnce([]);
    await expect(service.refresh('ok')).resolves.toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
    expect(tokens.verify).toHaveBeenCalledWith('ok', 'refresh');
    // Au refresh aussi, `orgs` est reconstruit a partir de la base (ADR 0010 §3).
    // La ligne mockee n'a pas d'org -> orgs = []. L'essentiel : signAccess est
    // bien appele avec le sub du refresh et une photo orgs (re)chargee, pas figee.
    expect(tokens.signAccess).toHaveBeenCalledWith('user-7', []);
  });

  // M3 — le refresh n'est plus aveugle a l'etat du compte. Un compte desactive
  // ou supprime depuis l'emission du refresh ne doit plus reemettre de tokens.
  describe('M3 — revalidation de l etat du compte au refresh', () => {
    it('refresh d un user DESACTIVE (is_active=false) -> 401, AUCUN token emis', async () => {
      tokens.verify.mockResolvedValue('user-off');
      // auth_get_user_state renvoie le user mais is_active=false.
      prisma.$queryRaw.mockResolvedValueOnce([
        { user_id: 'user-off', is_active: false },
      ]);

      await expect(service.refresh('ok')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      // Aucun nouveau token : ni access ni refresh ne sont signes.
      expect(tokens.signAccess).not.toHaveBeenCalled();
      expect(tokens.signRefresh).not.toHaveBeenCalled();
      // On NE va PAS jusqu'au rechargement des memberships : un seul $queryRaw
      // (la verif d'etat) a court-circuite la suite.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('refresh d un user SUPPRIME (auth_get_user_state -> 0 ligne) -> 401, AUCUN token', async () => {
      tokens.verify.mockResolvedValue('user-gone');
      // user supprime depuis l'emission du refresh -> zero ligne.
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await expect(service.refresh('ok')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(tokens.signAccess).not.toHaveBeenCalled();
      expect(tokens.signRefresh).not.toHaveBeenCalled();
    });

    it('refresh d un user ACTIF -> tokens emis avec memberships FRAIS (ADR 0010)', async () => {
      tokens.verify.mockResolvedValue('user-9');
      prisma.$queryRaw
        // 1) auth_get_user_state -> compte actif.
        .mockResolvedValueOnce([{ user_id: 'user-9', is_active: true }])
        // 2) loadOrgClaims -> 1 membership frais (rechargé, pas figé du token).
        .mockResolvedValueOnce([
          {
            user_id: 'user-9',
            email: 'u9@x.io',
            full_name: 'U9',
            platform_role: null,
            org_id: 'o9',
            org_name: 'Org 9',
            org_slug: 'org-9',
            membership_role: 'ENGINEER',
          },
        ]);

      await expect(service.refresh('ok')).resolves.toEqual({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      });
      // L'access est signe avec la photo FRAICHE des orgs (rechargee au refresh).
      expect(tokens.signAccess).toHaveBeenCalledWith('user-9', [
        { id: 'o9', slug: 'org-9', role: 'ENGINEER' },
      ]);
      expect(tokens.signRefresh).toHaveBeenCalledWith('user-9');
    });
  });
});

/**
 * Onboarding SUPERADMIN — provisionUser : hachage avant persistance + mapping
 * borne du conflit d'email (anti-enumeration).
 */
describe('AuthService.provisionUser', () => {
  let prisma: PrismaStub;
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = makePrismaStub();
    service = new AuthService(
      prisma as unknown as PrismaService,
      {} as unknown as TokenService,
    );
    hashPasswordMock.mockResolvedValue('$argon2id$HASHED');
  });

  it('hache le mot de passe AVANT de le persister (jamais le clair en base)', async () => {
    prisma.$queryRaw.mockResolvedValue([{ provision_user: 'new-uid' }]);

    await expect(
      service.provisionUser('a@x.io', 'clair-secret', 'Alice'),
    ).resolves.toBe('new-uid');

    // Le clair est passe a hashPassword, et c'est le HASH (pas le clair) qui
    // alimente la requete : on verifie qu'aucun parametre lie n'est le clair.
    expect(hashPasswordMock).toHaveBeenCalledWith('clair-secret');
    // $queryRaw est appele en tag de template : (strings, ...values). Les
    // parametres lies sont donc tout sauf le 1er element (le tableau de chaines).
    const firstCall = prisma.$queryRaw.mock.calls[0] as unknown[];
    const params = firstCall.slice(1);
    expect(params).toContain('$argon2id$HASHED');
    expect(params).not.toContain('clair-secret');
  });

  it('mappe une violation d unicite (23505) en 409 BORNE generique', async () => {
    prisma.$queryRaw.mockRejectedValue(rawPgError('23505'));

    await expect(
      service.provisionUser('dup@x.io', 'pw-long-enough', 'Dup'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('le message du 409 ne divulgue PAS l email en conflit (anti-enumeration)', async () => {
    prisma.$queryRaw.mockRejectedValue(rawPgError('23505'));
    try {
      await service.provisionUser('secret@x.io', 'pw-long-enough', 'Dup');
      throw new Error('aurait du lever');
    } catch (e) {
      expect((e as Error).message).not.toContain('secret@x.io');
    }
  });

  it('propage une erreur INATTENDUE (ni 23505) sans la masquer', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('boom inattendu'));
    await expect(
      service.provisionUser('a@x.io', 'pw-long-enough', 'A'),
    ).rejects.toThrow('boom inattendu');
  });
});

/**
 * Onboarding SUPERADMIN — provisionOrg : mapping borne des erreurs base
 * (owner inexistant = 400 ; slug pris = 409 ; reste propage).
 */
describe('AuthService.provisionOrg', () => {
  let prisma: PrismaStub;
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = makePrismaStub();
    service = new AuthService(
      prisma as unknown as PrismaService,
      {} as unknown as TokenService,
    );
  });

  it('renvoie l uuid de l org creee dans le cas nominal', async () => {
    prisma.$queryRaw.mockResolvedValue([{ provision_org: 'org-uid' }]);
    await expect(
      service.provisionOrg('BE', 'be-slug', 'owner-uid'),
    ).resolves.toBe('org-uid');
  });

  it('mappe un owner INEXISTANT (FK 23503) en 400 BORNE', async () => {
    prisma.$queryRaw.mockRejectedValue(rawPgError('23503'));
    await expect(
      service.provisionOrg('BE', 'be-slug', 'ghost-uid'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('mappe un slug DEJA pris (23505) en 409', async () => {
    prisma.$queryRaw.mockRejectedValue(rawPgError('23505'));
    await expect(
      service.provisionOrg('BE', 'slug-pris', 'owner-uid'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

/**
 * /auth/me — getProfile : agregation des memberships, user sans org, user absent.
 */
describe('AuthService.getProfile', () => {
  let prisma: PrismaStub;
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = makePrismaStub();
    service = new AuthService(
      prisma as unknown as PrismaService,
      {} as unknown as TokenService,
    );
  });

  it('agrege plusieurs lignes en un profil + liste de memberships', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        user_id: 'u1',
        email: 'u1@x.io',
        full_name: 'U1',
        platform_role: null,
        org_id: 'o1',
        org_name: 'Org 1',
        org_slug: 'org-1',
        membership_role: 'OWNER',
      },
      {
        user_id: 'u1',
        email: 'u1@x.io',
        full_name: 'U1',
        platform_role: null,
        org_id: 'o2',
        org_name: 'Org 2',
        org_slug: 'org-2',
        membership_role: 'ENGINEER',
      },
    ]);

    const profile = await service.getProfile('u1');
    expect(profile).not.toBeNull();
    expect(profile!.userId).toBe('u1');
    expect(profile!.platformRole).toBeNull();
    expect(profile!.memberships).toHaveLength(2);
    expect(profile!.memberships.map((m) => m.orgId)).toEqual(['o1', 'o2']);
    expect(profile!.memberships[1].role).toBe('ENGINEER');
  });

  it('un user SANS org (org_* NULL) -> profil avec zero membership', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        user_id: 'admin',
        email: 'admin@x.io',
        full_name: 'Admin',
        platform_role: 'SUPERADMIN',
        org_id: null,
        org_name: null,
        org_slug: null,
        membership_role: null,
      },
    ]);

    const profile = await service.getProfile('admin');
    expect(profile!.platformRole).toBe('SUPERADMIN');
    expect(profile!.memberships).toEqual([]);
  });

  it('un user INTROUVABLE (zero ligne) -> null', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await expect(service.getProfile('absent')).resolves.toBeNull();
  });
});
