import { Injectable, UnauthorizedException } from '@nestjs/common';

// Imports VALEUR (DI NestJS) — jamais `import type` sur un service injecte.
import type { PlatformRole, Role } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { verifyPassword } from './password';
import { TokenService } from './token.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface UserRow {
  id: string;
  password_hash: string | null;
  is_active: boolean;
}

/**
 * AuthService — login (verif mdp + emission tokens), refresh, et resolution
 * d'appartenance (membership) utilisee par le guard tenant.
 *
 * NB lecture hors RLS : login et check membership ont lieu AVANT tout contexte
 * tenant. On passe par les fonctions SECURITY DEFINER de la migration 0003
 * (auth_find_user_by_email / auth_user_has_membership), seule voie sanctionnee
 * pour ces lectures "a froid" sans role BYPASSRLS. On N'utilise PAS withTenant
 * ici (pas d'org en main). Aucune autre requete ne lit users/memberships hors
 * scope.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Verifie email + mot de passe ; emet une paire de tokens. Toute cause
   * d'echec (email inconnu, mauvais mdp, compte inactif, hash absent) produit
   * la MEME 401 generique : aucun oracle d'enumeration.
   */
  async login(email: string, password: string): Promise<TokenPair> {
    const rows = await this.prisma.$queryRaw<UserRow[]>`
      SELECT id, password_hash, is_active
      FROM auth_find_user_by_email(${email})
    `;
    const user = rows[0];

    // Anti-timing / anti-enumeration : on execute TOUJOURS verifyPassword (meme
    // si user absent OU inactif), puis on combine les booleens. Aucun
    // court-circuit ne doit differencier "email inconnu" / "compte inactif" /
    // "mauvais mot de passe" par le temps de reponse. verifyPassword(null, ...)
    // renvoie false sans throw.
    const pwOk = await verifyPassword(user?.password_hash ?? null, password);

    if (!user || !user.is_active || !pwOk) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    return this.issueTokens(user.id);
  }

  /**
   * Echange un refresh token valide contre une nouvelle paire (rotation des
   * deux tokens). STATELESS pour le socle : pas de table de revocation.
   * TODO(follow-up) : refresh DB-backed (table refresh_tokens sous RLS si
   * portee tenant, ou table noyau hors-tenant + jti) pour rotation/revocation
   * reelle (logout, vol de token). Voir points a challenger.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const sub = await this.tokens.verify(refreshToken, 'refresh');
    if (!sub) {
      throw new UnauthorizedException('Refresh token invalide');
    }
    // On NE re-verifie pas l'existence/etat du user en base ici (lookup par id
    // hors scope = nouvelle voie DEFINER). Le compromis stateless est assume :
    // un compte desactive garde un refresh valide jusqu'a expiration. C'est le
    // meme angle mort que tout JWT stateless ; la mitigation (revocation) est le
    // follow-up DB-backed ci-dessus. Documente, pas masque.
    return this.issueTokens(sub);
  }

  /**
   * Renvoie le role tenant si `userId` est membre de `orgId`, sinon null.
   * Utilise par le TenantGuard AVANT de poser app.current_org (fail-closed).
   */
  async membershipRole(userId: string, orgId: string): Promise<Role | null> {
    const rows = await this.prisma.$queryRaw<{ role: Role }[]>`
      SELECT role FROM auth_user_has_membership(${userId}::uuid, ${orgId}::uuid)
    `;
    return rows[0]?.role ?? null;
  }

  /**
   * Role PLATEFORME du user (SUPERADMIN/SUPPORT) ou null. Lu via DEFINER
   * (users illisible hors org). Utilise par le RolesGuard quand une route
   * autorise un PlatformRole.
   */
  async platformRole(userId: string): Promise<PlatformRole | null> {
    const rows = await this.prisma.$queryRaw<
      { auth_get_platform_role: PlatformRole | null }[]
    >`SELECT auth_get_platform_role(${userId}::uuid)`;
    return rows[0]?.auth_get_platform_role ?? null;
  }

  private async issueTokens(userId: string): Promise<TokenPair> {
    const [accessToken, refreshToken] = await Promise.all([
      this.tokens.signAccess(userId),
      this.tokens.signRefresh(userId),
    ]);
    return { accessToken, refreshToken };
  }
}
