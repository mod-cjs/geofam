import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { AuthService } from '../auth/auth.service';
import { NoTenant, Roles } from '../auth/decorators';
import type { CreateOrgDto, CreateUserDto } from '../auth/dto';
import { createOrgSchema, createUserSchema } from '../auth/dto';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

import type { AddMemberDto, SetMemberActiveDto } from './members.dto';
import {
  addMemberSchema,
  memberOrgIdParam,
  memberUserIdParam,
  setMemberActiveSchema,
} from './members.dto';
import type { OrgMemberView } from './members.service';
import { MembersService } from './members.service';

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
    private readonly members: MembersService,
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

  /**
   * Attache un membre a une organisation EXISTANTE (accès contrôlés multi-membres,
   * P1). `orgId` vient du PATH (org existante), `userId` du corps (compte
   * existant) — jamais une identité arbitraire (leçon #42). `role` ∈ {ADMIN,
   * ENGINEER, TECHNICIAN, VIEWER} (OWNER refusé par le schema). Un ré-ajout ->
   * 409 ; un userId/orgId inexistant -> 400. Renvoie 201 + l'id du membership.
   */
  @Post('orgs/:orgId/members')
  @HttpCode(HttpStatus.CREATED)
  async addMember(
    @Param('orgId', new ZodValidationPipe(memberOrgIdParam)) orgId: string,
    @Body(new ZodValidationPipe(addMemberSchema)) body: AddMemberDto,
  ): Promise<{ membershipId: string }> {
    const membershipId = await this.members.provisionMember(
      orgId,
      body.userId,
      body.role,
    );
    return { membershipId };
  }

  /**
   * Suspend (isActive=false) ou réactive (true) un membre. La suspension prend
   * effet AU PROCHAIN APPEL (le TenantGuard relit le membership actif en base, cf.
   * ADR 0010) — aucune rotation de token. Anti-lockout : suspendre le dernier
   * OWNER actif -> 409. Membre introuvable -> 404.
   */
  @Patch('orgs/:orgId/members/:userId')
  async setMemberActive(
    @Param('orgId', new ZodValidationPipe(memberOrgIdParam)) orgId: string,
    @Param('userId', new ZodValidationPipe(memberUserIdParam)) userId: string,
    @Body(new ZodValidationPipe(setMemberActiveSchema))
    body: SetMemberActiveDto,
  ): Promise<{ userId: string; isActive: boolean }> {
    await this.members.setMemberActive(orgId, userId, body.isActive);
    return { userId, isActive: body.isActive };
  }

  /**
   * Liste les membres d'une organisation (identité + calculs du mois par membre).
   * Inclut les membres suspendus (pour les réactiver depuis le back-office).
   */
  @Get('orgs/:orgId/members')
  async listMembers(
    @Param('orgId', new ZodValidationPipe(memberOrgIdParam)) orgId: string,
  ): Promise<OrgMemberView[]> {
    return this.members.listMembers(orgId);
  }
}
