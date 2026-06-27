import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { AuthService } from '../auth/auth.service';
import { NoTenant, Roles } from '../auth/decorators';
import type { CreateOrgDto, CreateUserDto } from '../auth/dto';
import { createOrgSchema, createUserSchema } from '../auth/dto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

/**
 * AdminController — back-office plateforme (onboarding SUPERADMIN).
 *
 * DECISION TITULAIRE : la creation d'utilisateurs et d'organisations est un
 * ONBOARDING SUPERADMIN (pas de self-service). Un SUPERADMIN plateforme cree les
 * comptes, puis les organisations, et DESIGNE l'OWNER (un utilisateur EXISTANT).
 *
 * Gardes (chaine globale, cf. app.module) :
 *  - @NoTenant : routes AUTHENTIFIEES mais HORS tenant (un SUPERADMIN
 *    n'appartient a aucune organisation). Le TenantGuard ne resout donc aucune
 *    org ; l'identite (JWT) reste exigee par le JwtAuthGuard.
 *  - @Roles(SUPERADMIN) : SEUL le role PLATEFORME SUPERADMIN passe. Le RolesGuard
 *    resout ce role (auth_get_platform_role) sans avoir besoin de req.tenant.
 *    Tout autre role (y compris OWNER/ADMIN d'une org) -> 403. C'est l'unique
 *    enforcement de l'escalade : aucun non-SUPERADMIN ne cree d'org/user.
 *
 * Les ecritures passent par les fonctions SECURITY DEFINER dediees
 * (provision_user / provision_org), seules voies sanctionnees hors tenant.
 * Aucune donnee de privilege (owner, role) n'est crue depuis le corps au-dela de
 * la validation Zod : l'autorisation tient au RolesGuard, pas a la charge utile.
 */
@Controller('admin')
@NoTenant()
@Roles('SUPERADMIN')
export class AdminController {
  constructor(
    private readonly auth: AuthService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * Cree un utilisateur. Renvoie 201 + l'id cree. Le mot de passe initial est
   * hache cote service (argon2id) ; un email deja pris -> 409 generique (le
   * service ne divulgue pas quel email existe).
   */
  @Post('users')
  @HttpCode(HttpStatus.CREATED)
  async createUser(
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserDto,
  ): Promise<{ userId: string }> {
    const userId = await this.auth.provisionUser(
      body.email,
      body.password,
      body.fullName,
    );
    return { userId };
  }

  /**
   * Cree une organisation et son 1er membership OWNER (atomique, via
   * provision_org). `ownerUserId` doit etre un user EXISTANT (sinon 400 borne) ;
   * un slug deja pris -> 409. Renvoie 201 + l'id de l'org.
   */
  @Post('orgs')
  @HttpCode(HttpStatus.CREATED)
  async createOrg(
    @Body(new ZodValidationPipe(createOrgSchema)) body: CreateOrgDto,
  ): Promise<{ orgId: string }> {
    const orgId = await this.auth.provisionOrg(
      body.name,
      body.slug,
      body.ownerUserId,
    );
    // Provisionnement de l'abonnement (ADR 0009/0011, manuel P1) — si fourni.
    // Idempotent cote base (ON CONFLICT org_id DO NOTHING) -> sans danger si la
    // route est rejouee. Une org sans subscription reste creee (le calcul/PV sera
    // barre en 403 NoSubscription tant qu'un abonnement n'est pas pose).
    if (body.subscription) {
      await this.subscriptions.provision({
        orgId,
        pack: body.subscription.pack,
        entitlements: body.subscription.entitlements,
        dateDebut: body.subscription.dateDebut,
        dateFin: body.subscription.dateFin,
        quota: body.subscription.quota,
      });
    }
    return { orgId };
  }
}
