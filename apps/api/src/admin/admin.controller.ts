import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { PlatformRole } from '@prisma/client';

import { AuthService } from '../auth/auth.service';
import { NoTenant, Roles } from '../auth/decorators';
import type { CreateOrgDto, CreateUserDto } from '../auth/dto';
import { createOrgSchema, createUserSchema } from '../auth/dto';
import type { AuthedRequest } from '../auth/request-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

import type {
  GlobalAuditQuery,
  ListPvsQuery,
  ListOrgsQuery,
  ListSubscriptionsQuery,
  SearchUsersQuery,
} from './admin.dto';
import {
  globalAuditQuerySchema,
  listPvsQuerySchema,
  listOrgsQuerySchema,
  listSubscriptionsQuerySchema,
  orgIdParam,
  searchUsersQuerySchema,
} from './admin.dto';
import type { PlatformStats } from './admin-stats.service';
import { AdminPvService, type PvDetailView, type PvListItem } from './admin-pv.service';
import { AdminStatsService } from './admin-stats.service';
import type {
  AuditEntryView,
  AuditListEntryView,
} from './admin-mutations.service';
import { AdminMutationsService } from './admin-mutations.service';
import type {
  AttachSubscriptionDto,
  AuditQuery,
  EntitlementsDto,
  RenewDto,
  ResetPasswordDto,
  SetOrgStatusDto,
  SetPlatformRoleDto,
  SetRoleDto,
  SetUserActiveDto,
  TopUpDto,
  TransferOwnerDto,
  UpdateUserIdentityDto,
} from './admin-mutations.dto';
import {
  attachSubscriptionSchema,
  auditQuerySchema,
  entitlementsSchema,
  mutOrgIdParam,
  mutUserGlobalIdParam,
  mutUserIdParam,
  renewSchema,
  resetPasswordSchema,
  setOrgStatusSchema,
  setPlatformRoleSchema,
  setRoleSchema,
  setUserActiveSchema,
  topUpSchema,
  transferOwnerSchema,
  updateUserIdentitySchema,
} from './admin-mutations.dto';
import type {
  AdminOrgDetail,
  AdminOrgListItem,
  OrgUsage,
} from './admin-orgs.service';
import { AdminOrgsService } from './admin-orgs.service';
import type { AdminUserDetail, AdminUserView } from './admin-users.service';
import { AdminUsersService } from './admin-users.service';
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
    private readonly orgs: AdminOrgsService,
    private readonly users: AdminUsersService,
    private readonly mutations: AdminMutationsService,
    private readonly stats: AdminStatsService,
    private readonly pvs: AdminPvService,
  ) {}

  /**
   * GET /admin/stats — tableau de bord plateforme. AGREGATS cross-tenant SEULEMENT
   * (aucune ligne tenant brute) : orgs par statut, users, memberships actifs, PV emis,
   * quota alloue/consomme total, sante des abonnements. Source : admin_platform_stats.
   */
  @Get('stats')
  async platformStats(): Promise<PlatformStats> {
    return this.stats.platformStats();
  }

  /**
   * GET /admin/audit?action=&actor=&from=&to=&limit=&offset= — journal d'audit GLOBAL
   * (toutes orgs). Filtres SQL bornes ; borne cote base (limit <= 100). SUPERADMIN-only.
   * MINIMISATION : le payload brut n'est PAS renvoye dans la liste (seul le motif) — cf.
   * AuditListEntryView / listGlobalAudit. Le detail complet reste sur la route par-org.
   */
  @Get('audit')
  async globalAudit(
    @Query(new ZodValidationPipe(globalAuditQuerySchema))
    query: GlobalAuditQuery,
  ): Promise<AuditListEntryView[]> {
    return this.mutations.listGlobalAudit(query);
  }

  /**
   * GET /admin/subscriptions?filter=&sort=&limit=&offset= — console d'abonnements
   * (vue money-centree des orgs). Reutilise admin_list_orgs enrichi (join subscriptions).
   */
  @Get('subscriptions')
  async listSubscriptions(
    @Query(new ZodValidationPipe(listSubscriptionsQuerySchema))
    query: ListSubscriptionsQuery,
  ): Promise<AdminOrgListItem[]> {
    return this.orgs.listSubscriptions(query);
  }

  /**
   * GET /admin/pvs?q=&limit=&offset= — supervision PV cross-tenant (metadonnees
   * seulement, recherche par numero). Source : admin_list_pvs (DEFINER, role-gate 0014).
   */
  @Get('pvs')
  async listPvs(
    @Query(new ZodValidationPipe(listPvsQuerySchema)) query: ListPvsQuery,
  ): Promise<PvListItem[]> {
    return this.pvs.listPvs({
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
      q: query.q,
    });
  }

  /**
   * GET /admin/pvs/:pvId — detail d'un PV + verification du sceau (recalculee serveur).
   * Ne renvoie que metadonnees + sealValid (le HMAC brut ne quitte pas le serveur).
   */
  @Get('pvs/:pvId')
  async getPv(
    @Param('pvId', ParseUUIDPipe) pvId: string,
  ): Promise<PvDetailView> {
    return this.pvs.getPv(pvId);
  }

  /**
   * GET /admin/me — role PLATEFORME de l'appelant, pour la garde du shell /admin
   * cote front (Server Component). @Roles(SUPERADMIN) herite de la classe : un
   * non-SUPERADMIN recoit 403 (le front le traite en redirect/404 anti-enum). Le
   * corps { platformRole } confirme le role a un appelant autorise. L'identite
   * vient du SUB du JWT verifie (req.auth.userId) — jamais d'une valeur cliente.
   */
  @Get('me')
  async me(
    @Req() req: AuthedRequest,
  ): Promise<{ platformRole: PlatformRole | null }> {
    const userId = req.auth?.userId;
    if (!userId) {
      throw new UnauthorizedException('Non authentifie');
    }
    const platformRole = await this.auth.platformRole(userId);
    return { platformRole };
  }

  /**
   * GET /admin/orgs?q=&limit=&offset=&status=&sort= — inventaire pagine des
   * organisations (identite + nb membres + resume d'abonnement), en UNE passe DEFINER
   * (admin_list_orgs enrichi, 0014). Filtre par statut + tri { name|createdAt|quota|
   * expiration } faits EN SQL (cf. service). SUPERADMIN-only.
   */
  @Get('orgs')
  async listOrgs(
    @Query(new ZodValidationPipe(listOrgsQuerySchema)) query: ListOrgsQuery,
  ): Promise<AdminOrgListItem[]> {
    return this.orgs.listOrgs(query);
  }

  /**
   * GET /admin/orgs/:orgId — detail COMPOSITE d'une org (identite + membres +
   * abonnement + usage du mois). Un orgId inconnu -> 404.
   */
  @Get('orgs/:orgId')
  async getOrg(
    @Param('orgId', new ZodValidationPipe(orgIdParam)) orgId: string,
  ): Promise<AdminOrgDetail> {
    return this.orgs.getOrgDetail(orgId);
  }

  /**
   * GET /admin/orgs/:orgId/usage — agregat d'usage du mois courant (consommation/
   * quota, ventilation CALC/PV, par membre). Donnee tenant, lue via withTenant.
   */
  @Get('orgs/:orgId/usage')
  async getOrgUsage(
    @Param('orgId', new ZodValidationPipe(orgIdParam)) orgId: string,
  ): Promise<OrgUsage> {
    return this.orgs.getUsage(orgId);
  }

  /**
   * GET /admin/users?q=&limit= — recherche d'utilisateurs par email/nom (identite,
   * admin_search_users DEFINER). Clot le workflow « ajouter un membre a une org ».
   */
  @Get('users')
  async searchUsers(
    @Query(new ZodValidationPipe(searchUsersQuerySchema))
    query: SearchUsersQuery,
  ): Promise<AdminUserView[]> {
    return this.users.searchUsers(query);
  }

  /**
   * GET /admin/users/:userId — fiche d'un utilisateur : identite + ses appartenances
   * (org + role + statut). Lecture d'IDENTITE (admin_get_user DEFINER). 404 si inconnu.
   */
  @Get('users/:userId')
  async getUser(@Param('userId', ParseUUIDPipe) userId: string): Promise<AdminUserDetail> {
    const detail = await this.users.getUser(userId);
    if (!detail) throw new NotFoundException('Utilisateur introuvable');
    return detail;
  }

  /**
   * Cree un utilisateur. Renvoie 201 + l'id cree. Le mot de passe initial est
   * hache cote service (argon2id) ; un email deja pris -> 409 generique (le
   * service ne divulgue pas quel email existe).
   */
  @Post('users')
  @HttpCode(HttpStatus.CREATED)
  async createUser(
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserDto,
    @Req() req: AuthedRequest,
  ): Promise<{ userId: string }> {
    const userId = await this.auth.provisionUser(
      body.email,
      body.password,
      body.fullName,
      this.actor(req),
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
    @Req() req: AuthedRequest,
  ): Promise<{ orgId: string }> {
    const orgId = await this.auth.provisionOrg(
      body.name,
      body.slug,
      body.ownerUserId,
      this.actor(req),
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
    @Req() req: AuthedRequest,
  ): Promise<AdminOrgDetail> {
    await this.members.provisionMember(orgId, body.userId, body.role, this.actor(req));
    // Renvoie le detail FRAIS (avec le nouveau membre) — comme les autres mutations
    // membres : le front (onMutated) reconstruit la table depuis detail.members. Avant,
    // addMember renvoyait { membershipId } -> la table ne se rafraichissait pas (bug e2e W4).
    return this.orgs.getOrgDetail(orgId);
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
    @Req() req: AuthedRequest,
  ): Promise<{ userId: string; isActive: boolean }> {
    await this.members.setMemberActive(
      orgId,
      userId,
      body.isActive,
      this.actor(req),
    );
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

  // ===================================================================
  //  MUTATIONS money-adjacent (Lot 2). Chaque action TRACE un audit
  //  (admin_audit_log) et est IDEMPOTENTE sur `Idempotency-Key`. L'ACTEUR
  //  est le sub du JWT verifie (req.auth.userId), JAMAIS le corps (lecon #42).
  //  Reponse = detail COMPOSITE frais de l'org (numeros a jour pour le front).
  // ===================================================================

  /**
   * POST /admin/orgs/:orgId/subscription/topup — ajuste le quota (motif obligatoire).
   * Quota resultant < consommation -> 400. MONEY : l'en-tete `Idempotency-Key` est
   * OBLIGATOIRE (absent -> 400) — pas d'auto-generation : un retry reseau sans cle =
   * DOUBLE credit. Le front genere une cle stable par action.
   */
  @Post('orgs/:orgId/subscription/topup')
  async topUp(
    @Param('orgId', new ZodValidationPipe(mutOrgIdParam)) orgId: string,
    @Body(new ZodValidationPipe(topUpSchema)) body: TopUpDto,
    @Req() req: AuthedRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<AdminOrgDetail> {
    await this.mutations.topUpQuota({
      orgId,
      delta: body.delta,
      motif: body.motif,
      actorUserId: this.actor(req),
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
    return this.orgs.getOrgDetail(orgId);
  }

  /**
   * POST /admin/orgs/:orgId/subscription/renew — reset consommation + nouvelle fenetre.
   * Fenetre invalide (debut > fin) -> 400 (Zod + base). MONEY : `Idempotency-Key`
   * OBLIGATOIRE (absent -> 400) — un renew rejoue sans cle re-remettrait la
   * consommation a 0 (perte de trace de conso). Cle stable par action cote front.
   */
  @Post('orgs/:orgId/subscription/renew')
  async renew(
    @Param('orgId', new ZodValidationPipe(mutOrgIdParam)) orgId: string,
    @Body(new ZodValidationPipe(renewSchema)) body: RenewDto,
    @Req() req: AuthedRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<AdminOrgDetail> {
    await this.mutations.renewSubscription({
      orgId,
      dateDebut: body.dateDebut,
      dateFin: body.dateFin,
      actorUserId: this.actor(req),
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
    });
    return this.orgs.getOrgDetail(orgId);
  }

  /**
   * PATCH /admin/orgs/:orgId/subscription/entitlements — edite pack + modules debloques.
   */
  @Patch('orgs/:orgId/subscription/entitlements')
  async setEntitlements(
    @Param('orgId', new ZodValidationPipe(mutOrgIdParam)) orgId: string,
    @Body(new ZodValidationPipe(entitlementsSchema)) body: EntitlementsDto,
    @Req() req: AuthedRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<AdminOrgDetail> {
    await this.mutations.setEntitlements({
      orgId,
      pack: body.pack,
      entitlements: body.entitlements,
      actorUserId: this.actor(req),
      idempotencyKey: resolveIdempotencyKey(idempotencyKey),
    });
    return this.orgs.getOrgDetail(orgId);
  }

  /**
   * PATCH /admin/orgs/:orgId/members/:userId/role — change le role tenant (OWNER exclu).
   * Retrograder le dernier OWNER actif -> 409 ; membre introuvable -> 404.
   */
  @Patch('orgs/:orgId/members/:userId/role')
  async setMemberRole(
    @Param('orgId', new ZodValidationPipe(mutOrgIdParam)) orgId: string,
    @Param('userId', new ZodValidationPipe(mutUserIdParam)) userId: string,
    @Body(new ZodValidationPipe(setRoleSchema)) body: SetRoleDto,
    @Req() req: AuthedRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<AdminOrgDetail> {
    await this.mutations.setMemberRole({
      orgId,
      userId,
      role: body.role,
      actorUserId: this.actor(req),
      idempotencyKey: resolveIdempotencyKey(idempotencyKey),
    });
    return this.orgs.getOrgDetail(orgId);
  }

  /**
   * DELETE /admin/orgs/:orgId/members/:userId — retrait SOFT (is_active=false).
   * Retirer le dernier OWNER actif -> 409 ; membre introuvable -> 404. Reactivation via
   * PATCH …/members/:userId (isActive=true).
   */
  @Delete('orgs/:orgId/members/:userId')
  async removeMember(
    @Param('orgId', new ZodValidationPipe(mutOrgIdParam)) orgId: string,
    @Param('userId', new ZodValidationPipe(mutUserIdParam)) userId: string,
    @Req() req: AuthedRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<AdminOrgDetail> {
    await this.mutations.removeMember({
      orgId,
      userId,
      actorUserId: this.actor(req),
      idempotencyKey: resolveIdempotencyKey(idempotencyKey),
    });
    return this.orgs.getOrgDetail(orgId);
  }

  /**
   * PATCH /admin/orgs/:orgId/status — suspension / (re)activation / archivage. L'effet
   * REEL (perte d'acces des membres) est au PROCHAIN APPEL (auth function redefinie, 0013).
   */
  @Patch('orgs/:orgId/status')
  async setOrgStatus(
    @Param('orgId', new ZodValidationPipe(mutOrgIdParam)) orgId: string,
    @Body(new ZodValidationPipe(setOrgStatusSchema)) body: SetOrgStatusDto,
    @Req() req: AuthedRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<AdminOrgDetail> {
    await this.mutations.setOrgStatus({
      orgId,
      status: body.status,
      actorUserId: this.actor(req),
      idempotencyKey: resolveIdempotencyKey(idempotencyKey),
    });
    return this.orgs.getOrgDetail(orgId);
  }

  /**
   * GET /admin/orgs/:orgId/audit — journal d'audit de l'org (mutations tracees).
   */
  @Get('orgs/:orgId/audit')
  async listAudit(
    @Param('orgId', new ZodValidationPipe(mutOrgIdParam)) orgId: string,
    @Query(new ZodValidationPipe(auditQuerySchema)) query: AuditQuery,
  ): Promise<AuditEntryView[]> {
    return this.mutations.listAudit(orgId, query);
  }

  // ===================================================================
  //  VAGUE 2 — comptes GLOBAUX + rattachement d'abo + transfert d'OWNER.
  //  Chaque route @NoTenant @Roles(SUPERADMIN) (herite) ; l'ACTEUR est le sub du
  //  JWT (this.actor(req)), JAMAIS le corps (lecon #42) ; chaque action est TRACEE.
  // ===================================================================

  /**
   * PATCH /admin/users/:userId/active — desactive (false) / reactive (true) un compte
   * GLOBALEMENT. L'effet est immediat au prochain login/refresh (is_active relu en base).
   * Anti auto-desactivation : un SUPERADMIN qui se coupe l'acces -> 400. User introuvable -> 404.
   */
  @Patch('users/:userId/active')
  async setUserActive(
    @Param('userId', new ZodValidationPipe(mutUserGlobalIdParam))
    userId: string,
    @Body(new ZodValidationPipe(setUserActiveSchema)) body: SetUserActiveDto,
    @Req() req: AuthedRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<{ userId: string; active: boolean }> {
    await this.mutations.setUserActive({
      userId,
      active: body.active,
      actorUserId: this.actor(req),
      idempotencyKey: resolveIdempotencyKey(idempotencyKey),
    });
    return { userId, active: body.active };
  }

  /**
   * POST /admin/users/:userId/reset-password — reset admin du mot de passe (hache
   * argon2id cote service ; ni le mdp ni le hash ne sont tracees). Renvoie 200. Mdp faible
   * (<12) -> 400 (Zod). User introuvable -> 404.
   */
  @Post('users/:userId/reset-password')
  @HttpCode(HttpStatus.OK)
  async resetUserPassword(
    @Param('userId', new ZodValidationPipe(mutUserGlobalIdParam))
    userId: string,
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordDto,
    @Req() req: AuthedRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<{ userId: string }> {
    await this.mutations.resetUserPassword({
      userId,
      newPassword: body.newPassword,
      motif: body.motif,
      actorUserId: this.actor(req),
      idempotencyKey: resolveIdempotencyKey(idempotencyKey),
    });
    return { userId };
  }

  /**
   * PATCH /admin/users/:userId — edite l'IDENTITE d'un compte (email + nom). L'email est
   * normalise (lower/trim) ; un email deja porte par un AUTRE compte -> 409 ; user introuvable
   * -> 404. L'audit ne trace QUE email/nom avant/apres (aucun secret). Idempotency-Key optionnel.
   */
  @Patch('users/:userId')
  async updateUserIdentity(
    @Param('userId', new ZodValidationPipe(mutUserGlobalIdParam))
    userId: string,
    @Body(new ZodValidationPipe(updateUserIdentitySchema))
    body: UpdateUserIdentityDto,
    @Req() req: AuthedRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<{ userId: string }> {
    await this.mutations.updateUserIdentity({
      userId,
      email: body.email,
      fullName: body.fullName,
      actorUserId: this.actor(req),
      idempotencyKey: resolveIdempotencyKey(idempotencyKey),
    });
    return { userId };
  }

  /**
   * PATCH /admin/users/:userId/platform-role — attribue / retire le role PLATEFORME
   * (SUPERADMIN | SUPPORT | null). SENSIBLE (RBAC du back-office) : retirer le DERNIER
   * SUPERADMIN actif -> 409 ; se retrograder soi-meme -> 400. L'effet est immediat au
   * prochain appel (le RolesGuard relit le role en base). User introuvable -> 404.
   */
  @Patch('users/:userId/platform-role')
  async setPlatformRole(
    @Param('userId', new ZodValidationPipe(mutUserGlobalIdParam))
    userId: string,
    @Body(new ZodValidationPipe(setPlatformRoleSchema))
    body: SetPlatformRoleDto,
    @Req() req: AuthedRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<{ userId: string; platformRole: PlatformRole | null }> {
    await this.mutations.setPlatformRole({
      userId,
      role: body.role,
      actorUserId: this.actor(req),
      idempotencyKey: resolveIdempotencyKey(idempotencyKey),
    });
    return { userId, platformRole: body.role };
  }

  /**
   * POST /admin/orgs/:orgId/subscription — rattache un abonnement a une org EXISTANTE sans
   * abo (une org sans abo est barree 403 a vie par le SubscriptionGuard). Un abo ACTIF deja
   * present -> 409 ; org introuvable -> 404. Renvoie 201 + le detail composite frais de l'org.
   */
  @Post('orgs/:orgId/subscription')
  @HttpCode(HttpStatus.CREATED)
  async attachSubscription(
    @Param('orgId', new ZodValidationPipe(mutOrgIdParam)) orgId: string,
    @Body(new ZodValidationPipe(attachSubscriptionSchema))
    body: AttachSubscriptionDto,
    @Req() req: AuthedRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<AdminOrgDetail> {
    await this.mutations.attachSubscription({
      orgId,
      pack: body.pack,
      entitlements: body.entitlements,
      dateDebut: body.dateDebut,
      dateFin: body.dateFin,
      quota: body.quota,
      actorUserId: this.actor(req),
      idempotencyKey: resolveIdempotencyKey(idempotencyKey),
    });
    return this.orgs.getOrgDetail(orgId);
  }

  /**
   * PATCH /admin/orgs/:orgId/owner — transfert d'OWNER : promeut `newOwnerUserId` (OWNER) et
   * retrograde l'ancien (ADMIN). Le nouvel owner DOIT etre un membre actif -> sinon 400.
   * Renvoie le detail composite frais de l'org.
   */
  @Patch('orgs/:orgId/owner')
  async transferOwnership(
    @Param('orgId', new ZodValidationPipe(mutOrgIdParam)) orgId: string,
    @Body(new ZodValidationPipe(transferOwnerSchema)) body: TransferOwnerDto,
    @Req() req: AuthedRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<AdminOrgDetail> {
    await this.mutations.transferOwnership({
      orgId,
      newOwnerUserId: body.newOwnerUserId,
      actorUserId: this.actor(req),
      idempotencyKey: resolveIdempotencyKey(idempotencyKey),
    });
    return this.orgs.getOrgDetail(orgId);
  }

  /**
   * Acteur d'une mutation = SUB du JWT verifie (req.auth.userId), JAMAIS le corps
   * (lecon #42 : l'identite privilegiee vient du serveur). Absence de sub -> 401.
   */
  private actor(req: AuthedRequest): string {
    const userId = req.auth?.userId;
    if (!userId) {
      throw new UnauthorizedException('Non authentifie');
    }
    return userId;
  }
}

/**
 * Resout la cle d'idempotence pour les mutations NON-money (role/retrait/statut/
 * entitlements) : en-tete `Idempotency-Key` fourni par le client (voie standard, retries
 * surs), sinon on en GENERE une (chaque appel devient unique -> pas d'idempotence, mais la
 * contrainte UNIQUE de admin_audit_log tient toujours). Le client DOIT reutiliser la MEME
 * cle pour rejouer sans double-effet une action donnee.
 */
function resolveIdempotencyKey(header?: string): string {
  const trimmed = header?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : randomUUID();
}

/**
 * EXIGE la cle d'idempotence pour les mutations MONEY (topup / renew) : l'auto-generation
 * y est INTERDITE (un retry reseau sans en-tete = double credit / reset de conso). En-tete
 * absent ou vide -> 400 explicite. Le front genere une cle stable par action.
 */
function requireIdempotencyKey(header?: string): string {
  const trimmed = header?.trim();
  if (!trimmed || trimmed.length === 0) {
    throw new BadRequestException(
      'En-tête Idempotency-Key requis pour cette opération money',
    );
  }
  return trimmed;
}
