import { UnauthorizedException } from '@nestjs/common';

import type { PrismaService } from '../prisma/prisma.service';

import { AuthService } from './auth.service';
import { verifyPassword } from './password';
import type { TokenService } from './token.service';

// On mocke le hachage : le test du login ne doit dependre ni d'argon2 ni d'un
// vrai hash. verifyPassword devient un espion dont on pilote le retour.
jest.mock('./password', () => ({
  verifyPassword: jest.fn(),
}));
const verifyPasswordMock = verifyPassword as jest.MockedFunction<
  typeof verifyPassword
>;

/**
 * Non-regression A3 — anti-timing / 401 generique au login.
 *
 * Trois causes d'echec (email inconnu, mauvais mdp, compte inactif) doivent
 * produire la MEME UnauthorizedException generique, et verifyPassword doit
 * TOUJOURS etre appele (pas de court-circuit qui creerait un oracle de timing
 * ou d'enumeration).
 */
describe('AuthService.login', () => {
  let prisma: { $queryRaw: jest.Mock };
  let tokens: { signAccess: jest.Mock; signRefresh: jest.Mock };
  let service: AuthService;

  const activeUser = {
    id: 'user-1',
    password_hash: '$argon2id$hash',
    is_active: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = { $queryRaw: jest.fn() };
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
      expect(tokens.signAccess).toHaveBeenCalledWith('user-1');
      expect(tokens.signRefresh).toHaveBeenCalledWith('user-1');
    });
  });
});

/**
 * Non-regression — refresh stateless.
 */
describe('AuthService.refresh', () => {
  let prisma: { $queryRaw: jest.Mock };
  let tokens: {
    verify: jest.Mock;
    signAccess: jest.Mock;
    signRefresh: jest.Mock;
  };
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = { $queryRaw: jest.fn() };
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
    await expect(service.refresh('ok')).resolves.toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
    expect(tokens.verify).toHaveBeenCalledWith('ok', 'refresh');
    expect(tokens.signAccess).toHaveBeenCalledWith('user-7');
  });
});
