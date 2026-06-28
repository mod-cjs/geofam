import { Injectable, Logger } from '@nestjs/common';
// Import VALEUR (et non `import type`) : NestJS resout la DI via la metadonnee
// du constructeur. Un `import type` est efface a la compilation -> injection KO.
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@prisma/client';

/**
 * Payload des tokens.
 *
 *  - `sub`  : id utilisateur (l'identite, unique source de verite cote serveur).
 *  - `typ`  : discrimine access vs refresh -> un refresh ne peut JAMAIS etre
 *             accepte comme access (et inversement). Sans ce champ, un refresh
 *             (TTL long) servirait d'access (escalade de duree de vie).
 *
 * Le REFRESH reste volontairement MINIMAL (`sub` + `typ`) : il ne fige aucune
 * appartenance ni aucun droit. C'est lui le pivot de la fraicheur (ADR 0010 §3).
 *
 * L'ACCESS porte EN PLUS un claim `orgs` = photo des memberships du user
 * (id/slug/role) a l'instant `iat` (ADR 0010). RAISON D'ETRE : permettre au
 * middleware Next (edge) de reconcilier `[orgSlug]` (URL) -> `X-Org-Id` (UUID)
 * et de gater l'UI SANS appel DB par requete.
 *
 * ⚠️ INVARIANT DE SECURITE (ADR 0010 §1/§5) : `orgs` est un claim « POUR LE
 * CLIENT ». Le SERVEUR L'IGNORE pour l'autorisation. Le `TenantGuard` relit le
 * membership en base a chaque requete et le `RolesGuard` relit le role : une
 * revocation prend donc effet IMMEDIATEMENT cote acces, independamment de la
 * photo `orgs`. Le TTL d'access court (5 min) borne la staleness de l'AFFICHAGE
 * du slug ; il ne touche jamais a la fraicheur de l'ACCES (DB-temps-reel).
 */
export type TokenType = 'access' | 'refresh';

/** Entree de la photo `orgs` (un membership) — id/slug/role uniquement. */
export interface OrgClaim {
  /** UUID de l'org = ce qui partira en `X-Org-Id`. */
  id: string;
  /** Identifiant d'URL lu par le middleware dans `[orgSlug]`. */
  slug: string;
  /** Role tenant — sert UNIQUEMENT au gating UI ; le RBAC serveur relit en base. */
  role: Role;
}

export interface AccessClaims {
  sub: string;
  typ: 'access';
  /** Photo des memberships a `iat` (ADR 0010). Absent = user sans org. */
  orgs: OrgClaim[];
}
export interface RefreshClaims {
  sub: string;
  typ: 'refresh';
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly secret = requiredEnv('JWT_SECRET');
  // TTL d'access COURT (ADR 0010 §3) : borne la staleness de la photo `orgs`
  // (affichage du slug) a <= 5 min. N'affecte PAS la fraicheur de l'ACCES, qui
  // reste DB-temps-reel (TenantGuard/RolesGuard relisent en base a chaque appel).
  private readonly accessTtl = process.env.JWT_ACCESS_TTL ?? '5m';
  private readonly refreshTtl = process.env.JWT_REFRESH_TTL ?? '7d';

  constructor(private readonly jwt: JwtService) {}

  /**
   * Emet l'access token. `orgs` = photo FRAICHE des memberships (rechargee en
   * base par l'appelant a CHAQUE login ET refresh, cf. AuthService.issueTokens).
   * On la signe telle quelle : la signature HS256 protege `orgs` contre toute
   * falsification cliente (un membership ajoute a la main casse la signature ->
   * rejet au verify, cote serveur ET cote middleware edge — ADR 0010 §4 T4).
   */
  signAccess(userId: string, orgs: OrgClaim[]): Promise<string> {
    return this.jwt.signAsync(
      { typ: 'access', orgs },
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
