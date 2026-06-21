import { Injectable, Logger } from '@nestjs/common';
// Import VALEUR (et non `import type`) : NestJS resout la DI via la metadonnee
// du constructeur. Un `import type` est efface a la compilation -> injection KO.
import { JwtService } from '@nestjs/jwt';

/**
 * Payload des tokens. Volontairement MINIMAL :
 *  - `sub`  : id utilisateur (l'identite, unique source de verite cote serveur).
 *  - `typ`  : discrimine access vs refresh -> un refresh ne peut JAMAIS etre
 *             accepte comme access (et inversement). Sans ce champ, un refresh
 *             (TTL long) servirait d'access (escalade de duree de vie).
 * On NE met PAS d'org ni de role dans le token : l'org vient de la requete et
 * est re-verifiee a chaque appel (membership), les roles sont relus en base.
 * Ainsi une revocation de membership/role prend effet immediatement (le token
 * ne fige aucun droit).
 */
export type TokenType = 'access' | 'refresh';

export interface AccessClaims {
  sub: string;
  typ: 'access';
}
export interface RefreshClaims {
  sub: string;
  typ: 'refresh';
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly secret = requiredEnv('JWT_SECRET');
  private readonly accessTtl = process.env.JWT_ACCESS_TTL ?? '15m';
  private readonly refreshTtl = process.env.JWT_REFRESH_TTL ?? '7d';

  constructor(private readonly jwt: JwtService) {}

  signAccess(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { typ: 'access' },
      // expiresIn type ms.StringValue ('15m', '7d'...) : la valeur d'env est
      // un string libre -> cast assume (validee par configuration, pas par le client).
      {
        secret: this.secret,
        algorithm: 'HS256', // algo FIGE : pas d'alg-confusion ni 'none'
        expiresIn: this.accessTtl as unknown as number,
        subject: userId,
      },
    );
  }

  signRefresh(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { typ: 'refresh' },
      {
        secret: this.secret,
        algorithm: 'HS256', // algo FIGE : pas d'alg-confusion ni 'none'
        expiresIn: this.refreshTtl as unknown as number,
        subject: userId,
      },
    );
  }

  /**
   * Verifie signature + expiration ET le type attendu. Renvoie le `sub` ou
   * null si invalide (signature KO, expire, mauvais type). Jamais de throw :
   * l'appelant decide du code HTTP (401) sans fuite de detail.
   */
  async verify(token: string, expected: TokenType): Promise<string | null> {
    try {
      const payload = await this.jwt.verifyAsync<{
        sub?: string;
        typ?: string;
        // algorithms FIGE au verify : on n'accepte QUE HS256 (rejette 'none' et
        // toute tentative d'alg-confusion, independamment du defaut de la lib).
      }>(token, { secret: this.secret, algorithms: ['HS256'] });
      if (payload.typ !== expected) return null;
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        return null;
      }
      return payload.sub;
    } catch {
      return null;
    }
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    // Echec au boot plutot qu'au premier login : pas de demarrage sans secret.
    throw new Error(
      `${name} manquant : impossible de signer/verifier les JWT.`,
    );
  }
  return value;
}
