import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

// Imports VALEUR (DI NestJS) — jamais `import type` sur un service injecte.
import type { PlatformRole, Role } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { hashPassword, verifyPassword } from './password';
import type { OrgClaim } from './token.service';
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

/** Appartenance d'un user a une organisation (pour /auth/me). */
export interface MembershipView {
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: Role;
}

/** Profil renvoye par GET /auth/me : identite + orgs de l'utilisateur. */
export interface UserProfile {
  userId: string;
  email: string;
  fullName: string;
  platformRole: PlatformRole | null;
  memberships: MembershipView[];
}

// Forme brute renvoyee par auth_get_user_profile (1 ligne / membership ; org_*
// NULL si le user n'a aucun membership). Snake_case = colonnes SQL.
interface ProfileRow {
  user_id: string;
  email: string;
  full_name: string;
  platform_role: PlatformRole | null;
  org_id: string | null;
  org_name: string | null;
  org_slug: string | null;
  membership_role: Role | null;
}

// SQLSTATE PostgreSQL d'une violation d'unicite (ici : users.email / org.slug).
const PG_UNIQUE_VIOLATION = '23505';
// SQLSTATE d'une violation de cle etrangere (ici : ownerUserId inexistant lors de
// l'INSERT du membership OWNER par provision_org).
const PG_FOREIGN_KEY_VIOLATION = '23503';

/**
 * AuthService — login (verif mdp + emission tokens), refresh, et resolution
 * d'appartenance (membership) utilisee par le guard tenant.
 *
 * NB lecture hors RLS : login et check membership ont lieu AVANT tout contexte
 * tenant. On passe par les fonctions SECURITY DEFINER (auth_find_user_by_email /
 * auth_user_has_membership / ...), seule voie sanctionnee pour ces lectures "a
 * froid" sans BYPASSRLS (modele 0007 : drapeau fail-closed + privilege identite
 * porte par roadsen_auth). On N'utilise PAS withTenant ici (pas d'org en main) :
 * on utilise `prisma.asAppRole(...)`, qui execute la requete dans une transaction
 * SOUS le role roadsen_app (barriere B1 : meme connecte comme proprietaire managed,
 * un acces DIRECT a l'identite echouerait ; seules les fonctions DEFINER passent).
 * Aucune autre requete ne lit users/memberships hors scope.
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
    // asAppRole : la requete tourne SOUS roadsen_app (barriere B1) meme si la
    // connexion physique est le proprietaire managed. La fonction DEFINER
    // (owned roadsen_auth) franchit la RLS d'identite ; un acces direct echouerait.
    const rows = await this.prisma.asAppRole(
      (tx) => tx.$queryRaw<UserRow[]>`
        SELECT id, password_hash, is_active
        FROM auth_find_user_by_email(${email})
      `,
    );
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
    const rows = await this.prisma.asAppRole(
      (tx) => tx.$queryRaw<{ role: Role }[]>`
        SELECT role FROM auth_user_has_membership(${userId}::uuid, ${orgId}::uuid)
      `,
    );
    return rows[0]?.role ?? null;
  }

  /**
   * Role PLATEFORME du user (SUPERADMIN/SUPPORT) ou null. Lu via DEFINER
   * (users illisible hors org). Utilise par le RolesGuard quand une route
   * autorise un PlatformRole.
   */
  async platformRole(userId: string): Promise<PlatformRole | null> {
    const rows = await this.prisma.asAppRole(
      (tx) => tx.$queryRaw<{ auth_get_platform_role: PlatformRole | null }[]>`
        SELECT auth_get_platform_role(${userId}::uuid)
      `,
    );
    return rows[0]?.auth_get_platform_role ?? null;
  }

  /**
   * Cree un utilisateur (onboarding SUPERADMIN). Le mot de passe en clair est
   * hache ICI (argon2id, MEME fonction que le login) : aucun secret en clair ne
   * sort de ce service ni n'atteint la base. La creation passe par la fonction
   * SECURITY DEFINER provision_user (0005), seule voie d'ecriture "a froid" hors
   * tenant pour le runtime NOBYPASSRLS.
   *
   * Unicite de l'email : la contrainte UNIQUE(email) tranche cote base ; on NE
   * fait PAS de SELECT prealable (oracle + course). Une violation 23505 est
   * traduite en 409 BORNEE — message GENERIQUE, sans confirmer quel email existe
   * (anti-enumeration, coherent avec le 401 generique du login).
   *
   * @returns l'uuid du user cree.
   */
  async provisionUser(
    email: string,
    password: string,
    fullName: string,
  ): Promise<string> {
    const passwordHash = await hashPassword(password);
    try {
      const rows = await this.prisma.asAppRole(
        (tx) => tx.$queryRaw<{ provision_user: string }[]>`
          SELECT provision_user(${email}, ${passwordHash}, ${fullName})
        `,
      );
      return rows[0].provision_user;
    } catch (err) {
      if (isUniqueViolation(err)) {
        // 409 sans divulguer l'email en conflit : on ne confirme pas une
        // existence de compte a un appelant (meme SUPERADMIN -> pas d'oracle
        // exploitable si la route etait un jour mal protegee).
        throw new ConflictException('Création impossible : conflit de compte');
      }
      throw err;
    }
  }

  /**
   * Cree une organisation (onboarding SUPERADMIN) et son 1er membership OWNER,
   * de maniere atomique, via la fonction SECURITY DEFINER provision_org (0002/0004).
   *
   * ENFORCEMENT (cf. note 0004) : `ownerUserId` est le 1er OWNER DESIGNE par le
   * SUPERADMIN — un user EXISTANT. La fonction ne fait PAS confiance a une
   * identite cliente : ce service n'est appele QUE depuis la route @Roles(SUPERADMIN).
   * L'existence du user est garantie par la FK memberships_user_id_fkey : un
   * ownerUserId inexistant leve une violation FK (23503), traduite en 400 BORNEE
   * (« propriétaire introuvable ») plutot qu'une 500. Un slug deja pris leve une
   * unicite (23505) -> 409.
   *
   * @returns l'uuid de l'organisation creee.
   */
  async provisionOrg(
    name: string,
    slug: string,
    ownerUserId: string,
  ): Promise<string> {
    try {
      const rows = await this.prisma.asAppRole(
        (tx) => tx.$queryRaw<{ provision_org: string }[]>`
          SELECT provision_org(${name}, ${slug}, ${ownerUserId}::uuid)
        `,
      );
      return rows[0].provision_org;
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        // Owner designe inexistant : refus explicite mais SANS revelation au-dela
        // de "introuvable" (pas de detail SQL/colonne ; cf. AllExceptionsFilter).
        throw new BadRequestException('Propriétaire désigné introuvable');
      }
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'Création impossible : conflit (slug déjà pris)',
        );
      }
      throw err;
    }
  }

  /**
   * Profil + appartenances d'un user, pour GET /auth/me. Lu via la fonction
   * DEFINER auth_get_user_profile (0005) : "users"/"memberships" etant sous RLS
   * scopee par org courant, ce profil "a froid" (avant selection d'org) ne peut
   * etre lu autrement par le runtime. `userId` DOIT etre le sub du JWT verifie
   * (jamais une valeur cliente) -> un user ne lit que SON propre profil.
   *
   * @returns le profil, ou null si le user est introuvable (cas anormal : token
   *          verifie mais user supprime depuis -> l'appelant repond 401).
   */
  async getProfile(userId: string): Promise<UserProfile | null> {
    const rows = await this.prisma.asAppRole(
      (tx) => tx.$queryRaw<ProfileRow[]>`
        SELECT user_id, email, full_name, platform_role,
               org_id, org_name, org_slug, membership_role
        FROM auth_get_user_profile(${userId}::uuid)
      `,
    );
    const first = rows[0];
    if (!first) return null;

    // Une ligne par membership ; org_* NULL = user sans aucune org. On agrege
    // les memberships en filtrant les lignes "sans org" (LEFT JOIN a vide).
    const memberships: MembershipView[] = rows
      .filter((r): r is ProfileRow & { org_id: string } => r.org_id !== null)
      .map((r) => ({
        orgId: r.org_id,
        orgName: r.org_name ?? '',
        orgSlug: r.org_slug ?? '',
        role: r.membership_role as Role,
      }));

    return {
      userId: first.user_id,
      email: first.email,
      fullName: first.full_name,
      platformRole: first.platform_role,
      memberships,
    };
  }

  /**
   * Charge la photo FRAICHE des memberships du user (id/slug/role), pour le
   * claim `orgs` de l'access token (ADR 0010). Reutilise la fonction DEFINER
   * auth_get_user_profile (deja la voie de getProfile) -> aucune nouvelle voie
   * de lecture d'identite. Appele a CHAQUE login ET refresh : au refresh, `orgs`
   * est donc reconstruit a partir de la base (mecanisme de fraicheur ADR 0010 §3).
   *
   * Un user sans aucun membership -> [] (claim `orgs` vide, pas d'erreur).
   */
  private async loadOrgClaims(userId: string): Promise<OrgClaim[]> {
    const rows = await this.prisma.asAppRole(
      (tx) => tx.$queryRaw<ProfileRow[]>`
        SELECT user_id, email, full_name, platform_role,
               org_id, org_name, org_slug, membership_role
        FROM auth_get_user_profile(${userId}::uuid)
      `,
    );
    // Une ligne par membership ; org_* NULL = user sans org (LEFT JOIN a vide).
    // Test de VERITE (org_id && org_slug) plutot que `!== null` : robuste aux
    // lignes sans ces cles. Un membership n'est retenu que s'il porte un id ET
    // un slug exploitables (sinon il ne pourrait servir ni X-Org-Id ni l'URL).
    return rows
      .filter(
        (r): r is ProfileRow & { org_id: string; org_slug: string } =>
          Boolean(r.org_id) && Boolean(r.org_slug),
      )
      .map((r) => ({
        id: r.org_id,
        slug: r.org_slug,
        role: r.membership_role as Role,
      }));
  }

  private async issueTokens(userId: string): Promise<TokenPair> {
    // `orgs` chargees AVANT de signer l'access : photo fraiche a chaque emission
    // (login ET refresh). Le refresh, lui, reste minimal (signRefresh n'a pas
    // d'orgs) -> il ne fige aucune appartenance.
    const orgs = await this.loadOrgClaims(userId);
    const [accessToken, refreshToken] = await Promise.all([
      this.tokens.signAccess(userId, orgs),
      this.tokens.signRefresh(userId),
    ]);
    return { accessToken, refreshToken };
  }
}

/**
 * Detecte une violation d'unicite PostgreSQL (SQLSTATE 23505) remontee a travers
 * un `$queryRaw`. Prisma enveloppe l'erreur PG brute dans une
 * PrismaClientKnownRequestError (code P2010 = raw query failed) ; le SQLSTATE
 * d'origine est expose dans `meta.code`. On verifie cette voie principale, avec
 * un repli sur la chaine du message (robustesse si la forme du meta change).
 */
function isUniqueViolation(err: unknown): boolean {
  return hasSqlState(err, PG_UNIQUE_VIOLATION);
}

/** Detecte une violation de cle etrangere PostgreSQL (SQLSTATE 23503). */
function isForeignKeyViolation(err: unknown): boolean {
  return hasSqlState(err, PG_FOREIGN_KEY_VIOLATION);
}

/**
 * Vrai si l'erreur Prisma porte le SQLSTATE PostgreSQL donne. Prisma enveloppe
 * l'erreur PG d'un `$queryRaw` dans une PrismaClientKnownRequestError (code
 * P2010 = raw query failed) ; le SQLSTATE d'origine est dans `meta.code`. On
 * verifie cette voie principale, avec repli sur le message (robustesse si la
 * forme du meta evolue entre versions de Prisma).
 */
function hasSqlState(err: unknown, sqlState: string): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = err.meta as { code?: unknown } | undefined;
    if (meta?.code === sqlState) return true;
    if (typeof err.message === 'string' && err.message.includes(sqlState)) {
      return true;
    }
  }
  return false;
}
