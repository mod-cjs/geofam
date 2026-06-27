import { createHmac } from 'node:crypto';

import { JwtService } from '@nestjs/jwt';

import { TokenService } from './token.service';

/**
 * Non-regression A2 + densification B — TokenService.
 *
 * A2 : la signature impose HS256 et la verification REFUSE tout autre algo
 * (alg:none, alg-confusion). B : round-trip sign/verify, discrimination de type
 * access vs refresh, exigence d'un `sub` non vide.
 *
 * On utilise un JwtService REEL : la cible (algorithms:['HS256'] au verify) est
 * reellement exercee, aucun mock ne court-circuite la verification.
 */
const SECRET = 'secret-de-test-suffisamment-long-pour-hs256';

/** base64url sans padding, comme attendu par le format JWT. */
function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** Forge un JWT alg:none (signature vide) — doit etre rejete. */
function forgeAlgNone(sub: string): string {
  const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub, typ: 'access' }));
  return `${header}.${payload}.`;
}

/**
 * Forge un JWT dont l'en-tete annonce HS512 mais signe en HMAC-SHA512 avec le
 * meme secret. La signature est cryptographiquement valide pour HS512 ; seul le
 * verrou algorithms:['HS256'] doit le faire rejeter (alg-confusion).
 */
function forgeHs512(sub: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS512', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub, typ: 'access' }));
  const signingInput = `${header}.${payload}`;
  const sig = b64url(
    createHmac('sha512', SECRET).update(signingInput).digest(),
  );
  return `${signingInput}.${sig}`;
}

describe('TokenService', () => {
  let service: TokenService;

  beforeEach(() => {
    process.env.JWT_SECRET = SECRET;
    service = new TokenService(new JwtService({}));
  });

  describe("A2 — verrou d'algorithme", () => {
    it('rejette (null) un token forge en alg:none', async () => {
      const token = forgeAlgNone('user-1');
      await expect(service.verify(token, 'access')).resolves.toBeNull();
    });

    it('rejette (null) un token HS512 valide (alg-confusion) car seul HS256 est accepte', async () => {
      const token = forgeHs512('user-1');
      // Garde-fou du test : sans le verrou algorithms, ce token passerait.
      // Il est cryptographiquement valide en HS512 avec le bon secret.
      await expect(service.verify(token, 'access')).resolves.toBeNull();
    });

    it('signe effectivement en HS256 (en-tete alg=HS256)', async () => {
      const token = await service.signAccess('user-1', []);
      const headerJson = Buffer.from(token.split('.')[0], 'base64').toString(
        'utf8',
      );
      const header = JSON.parse(headerJson) as { alg: string };
      expect(header.alg).toBe('HS256');
    });
  });

  describe('B — round-trip et discrimination de type', () => {
    it('signAccess puis verify(access) renvoie le sub', async () => {
      const token = await service.signAccess('user-42', []);
      await expect(service.verify(token, 'access')).resolves.toBe('user-42');
    });

    it('signAccess embarque le claim `orgs` {id,slug,role} dans le payload (ADR 0010)', async () => {
      const orgs = [
        { id: 'o1', slug: 'org-1', role: 'OWNER' as const },
        { id: 'o2', slug: 'org-2', role: 'ENGINEER' as const },
      ];
      const token = await service.signAccess('user-42', orgs);
      const payloadJson = Buffer.from(token.split('.')[1], 'base64').toString(
        'utf8',
      );
      const payload = JSON.parse(payloadJson) as {
        typ: string;
        orgs: typeof orgs;
      };
      expect(payload.typ).toBe('access');
      expect(payload.orgs).toEqual(orgs);
    });

    it('le claim `orgs` falsifie sous un AUTRE secret est rejete au verify (ADR 0010 §4 T4)', async () => {
      // Attaque « j ajoute une org a la main » : sans le vrai secret, l attaquant
      // doit re-signer -> signature invalide -> rejet. Le pendant EDGE (jose,
      // meme secret) rejette de meme une signature KO ; c est le meme verrou.
      const foreign = new JwtService({});
      const forged = await foreign.signAsync(
        { typ: 'access', orgs: [{ id: 'x', slug: 'pirate', role: 'OWNER' }] },
        {
          secret: 'secret-de-l-attaquant',
          algorithm: 'HS256',
          subject: 'user-42',
        },
      );
      await expect(service.verify(forged, 'access')).resolves.toBeNull();
    });

    it('signRefresh puis verify(refresh) renvoie le sub', async () => {
      const token = await service.signRefresh('user-42');
      await expect(service.verify(token, 'refresh')).resolves.toBe('user-42');
    });

    it('rejette (null) un access token presente comme refresh', async () => {
      const access = await service.signAccess('user-42', []);
      await expect(service.verify(access, 'refresh')).resolves.toBeNull();
    });

    it('rejette (null) un refresh token presente comme access (anti-escalade de TTL)', async () => {
      const refresh = await service.signRefresh('user-42');
      await expect(service.verify(refresh, 'access')).resolves.toBeNull();
    });

    it('rejette (null) un token signe avec un autre secret', async () => {
      const foreign = new JwtService({});
      const token = await foreign.signAsync(
        { typ: 'access' },
        {
          secret: 'un-autre-secret-totalement-different',
          algorithm: 'HS256',
          subject: 'user-42',
        },
      );
      await expect(service.verify(token, 'access')).resolves.toBeNull();
    });

    it('rejette (null) un token sans sub', async () => {
      // Signe un payload valide (bon secret, HS256, bon typ) mais SANS subject.
      const noSub = new JwtService({});
      const token = await noSub.signAsync(
        { typ: 'access' },
        { secret: SECRET, algorithm: 'HS256' },
      );
      await expect(service.verify(token, 'access')).resolves.toBeNull();
    });

    it('rejette (null) un token expire', async () => {
      const expired = new JwtService({});
      const token = await expired.signAsync(
        { typ: 'access' },
        {
          secret: SECRET,
          algorithm: 'HS256',
          subject: 'user-42',
          expiresIn: '-1s',
        },
      );
      await expect(service.verify(token, 'access')).resolves.toBeNull();
    });
  });
});
