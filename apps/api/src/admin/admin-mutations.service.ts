import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { OrgStatus, Role } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { hashPassword } from '../auth/password';
import { PrismaService } from '../prisma/prisma.service';

/** Une ligne du journal d'audit (GET /admin/orgs/:orgId/audit). */
export interface AuditEntryView {
  id: string;
  actorUserId: string;
  action: string;
  targetOrgId: string | null;
  targetUserId: string | null;
  payload: unknown;
  createdAt: string; // ISO
}

/**
 * Vue LISTE MINIMISEE du journal GLOBAL (GET /admin/audit). Minimisation cote SERVEUR :
 * le `payload` JSONB brut (quota_before/after, delta, consommation, owner_user_id, slug,
 * entitlements...) n'est PAS exposé au client — seul le `motif` d'affichage remonte (la
 * seule cle que l'UI liste consomme, via extractMotif). Le detail COMPLET reste servi par
 * la route par-org (GET /admin/orgs/:orgId/audit, AuditEntryView) ou une future route detail
 * — jamais dans la liste globale (minimisation des donnees, CDP).
 */
export interface AuditListEntryView {
  id: string;
  actorUserId: string;
  action: string;
  targetOrgId: string | null;
  targetUserId: string | null;
  payload: { motif: string | null }; // minimisé : jamais les montants/owner/slug bruts
  createdAt: string; // ISO
}

// Ligne brute de admin_list_audit (snake_case = colonnes SQL).
interface AuditRow {
  id: string;
  actor_user_id: string;
  action: string;
  target_org_id: string | null;
  target_user_id: string | null;
  payload: unknown;
  created_at: Date;
}

// Roles attribuables par set_member_role (OWNER exclu, cf. admin-mutations.dto).
type AssignableRole = Exclude<Role, 'OWNER'>;

/**
 * AdminMutationsService — MUTATIONS money-adjacent du back-office (Lot 2). Chaque
 * ecriture privilegiee passe par une fonction SECURITY DEFINER (migration 0013,
 * owned roadsen_auth), appelee via `asAppRole` (role roadsen_app, SANS contexte
 * tenant applicatif — la fonction pose elle-meme app.current_org / app.auth_bootstrap
 * et les referme). MODELE identique a MembersService/AuthService.
 *
 * MONEY : adjust_quota / renew_subscription sont ATOMIQUES (UPDATE + trace dans la
 * MEME tx cote base) et IDEMPOTENTS (idempotency_key : une cle deja vue -> no-op, pas
 * de double-credit). ACTEUR = sub du JWT (passe par le controleur, jamais le corps —
 * lecon #42). Les fonctions RETURNS void -> `$executeRaw` ($queryRaw echouerait a
 * deserialiser le type `void`), sauf la LECTURE d'audit (RETURNS TABLE -> $queryRaw).
 *
 * ERREURS METIER : les fonctions plpgsql RAISE avec des marqueurs stables ; on les
 * mappe en HTTP (404/409/400). Meme discipline que MembersService (discrimination sur
 * le message, P0001 partage).
 */
@Injectable()
export class AdminMutationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * TOP-UP : ajuste le quota de `delta` (motif obligatoire). Idempotent sur
   * `idempotencyKey`. Refus si le quota resultant passe SOUS la consommation deja
   * engagee -> 400. Ne touche JAMAIS `consommation`.
   */
  async topUpQuota(args: {
    orgId: string;
    delta: number;
    motif: string;
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<void> {
    await this.callVoid(
      (tx) => tx.$executeRaw`
        SELECT adjust_quota(
          ${args.orgId}::uuid, ${args.delta}::int, ${args.motif}::text,
          ${args.actorUserId}::uuid, ${args.idempotencyKey}::text
        )
      `,
    );
  }

  /**
   * RENOUVELLEMENT : reset consommation a 0 + nouvelle fenetre (dateDebut/dateFin).
   * Idempotent. Le quota n'est pas touche (un changement de quota passe par topUpQuota).
   */
  async renewSubscription(args: {
    orgId: string;
    dateDebut: Date;
    dateFin: Date;
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<void> {
    await this.callVoid(
      (tx) => tx.$executeRaw`
        SELECT renew_subscription(
          ${args.orgId}::uuid, ${args.dateDebut}, ${args.dateFin},
          ${args.actorUserId}::uuid, ${args.idempotencyKey}::text
        )
      `,
    );
  }

  /**
   * ENTITLEMENTS : edite le pack + la liste de modules debloques. Ni quota ni fenetre
   * ni consommation. Idempotent.
   */
  async setEntitlements(args: {
    orgId: string;
    pack: string;
    entitlements: string[];
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<void> {
    await this.callVoid(
      (tx) => tx.$executeRaw`
        SELECT set_subscription_entitlements(
          ${args.orgId}::uuid, ${args.pack}::text, ${args.entitlements},
          ${args.actorUserId}::uuid, ${args.idempotencyKey}::text
        )
      `,
    );
  }

  /**
   * ROLE : change le role tenant d'un membre (OWNER exclu). Retrograder le dernier
   * OWNER actif -> 409 ; membre introuvable -> 404. Idempotent.
   */
  async setMemberRole(args: {
    orgId: string;
    userId: string;
    role: AssignableRole;
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<void> {
    await this.callVoid(
      (tx) => tx.$executeRaw`
        SELECT set_member_role(
          ${args.orgId}::uuid, ${args.userId}::uuid, ${args.role}::"Role",
          ${args.actorUserId}::uuid, ${args.idempotencyKey}::text
        )
      `,
    );
  }

  /**
   * RETRAIT (SOFT) : suspend le membre (is_active=false). Retirer le dernier OWNER
   * actif -> 409 ; membre introuvable -> 404. Idempotent. La reactivation se fait via
   * PATCH …/members/:userId (set_member_active, MembersService).
   */
  async removeMember(args: {
    orgId: string;
    userId: string;
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<void> {
    await this.callVoid(
      (tx) => tx.$executeRaw`
        SELECT remove_member(
          ${args.orgId}::uuid, ${args.userId}::uuid,
          ${args.actorUserId}::uuid, ${args.idempotencyKey}::text
        )
      `,
    );
  }

  /**
   * STATUT D'ORG : suspension / (re)activation / archivage. L'effet REEL est porte par
   * auth_user_has_membership (0013) au prochain appel. Org introuvable -> 404. Idempotent.
   */
  async setOrgStatus(args: {
    orgId: string;
    status: OrgStatus;
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<void> {
    await this.callVoid(
      (tx) => tx.$executeRaw`
        SELECT set_org_status(
          ${args.orgId}::uuid, ${args.status}::"OrgStatus",
          ${args.actorUserId}::uuid, ${args.idempotencyKey}::text
        )
      `,
    );
  }

  // ===================================================================
  //  VAGUE 2 — comptes GLOBAUX + rattachement d'abo + transfert d'OWNER.
  //  Meme discipline : DEFINER (0015), asAppRole, audit atomique, actor = sub JWT.
  // ===================================================================

  /**
   * DESACTIVATION / REACTIVATION GLOBALE d'un compte (users.is_active). Un SUPERADMIN qui se
   * desactive lui-meme -> 400 (garde base R0009). User introuvable -> 404. Idempotent.
   */
  async setUserActive(args: {
    userId: string;
    active: boolean;
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<void> {
    await this.callVoid(
      (tx) => tx.$executeRaw`
        SELECT admin_set_user_active(
          ${args.userId}::uuid, ${args.active}, ${args.actorUserId}::uuid,
          ${args.idempotencyKey}::text
        )
      `,
    );
  }

  /**
   * RESET du mot de passe (admin). Le hash argon2id est calcule ICI (MEME fonction que le
   * login) : aucun mot de passe en clair n'atteint la base. Le payload d'audit ne porte QUE le
   * motif (jamais le mdp ni le hash — garanti cote base). User introuvable -> 404.
   */
  async resetUserPassword(args: {
    userId: string;
    newPassword: string;
    motif?: string;
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<void> {
    const passwordHash = await hashPassword(args.newPassword);
    await this.callVoid(
      (tx) => tx.$executeRaw`
        SELECT admin_reset_user_password(
          ${args.userId}::uuid, ${passwordHash}::text, ${args.actorUserId}::uuid,
          ${args.motif ?? null}::text, ${args.idempotencyKey}::text
        )
      `,
    );
  }

  /**
   * IDENTITE : edite l'email + le nom d'un compte (0018). L'email est normalise + son unicite
   * TRANCHEE cote base (un email deja porte par un AUTRE user -> 409). User introuvable -> 404.
   * Le payload d'audit ne porte QUE email/nom avant/apres (aucun secret). Idempotent.
   */
  async updateUserIdentity(args: {
    userId: string;
    email: string;
    fullName: string;
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<void> {
    await this.callVoid(
      (tx) => tx.$executeRaw`
        SELECT admin_update_user_identity(
          ${args.userId}::uuid, ${args.email}::text, ${args.fullName}::text,
          ${args.actorUserId}::uuid, ${args.idempotencyKey}::text
        )
      `,
    );
  }

  /**
   * ROLE PLATEFORME : attribue / retire le role transverse (SUPERADMIN | SUPPORT | null) qui
   * ouvre le back-office (0018). SENSIBLE (RBAC). Invariants anti-lockout cote base : retirer le
   * DERNIER SUPERADMIN actif -> 409 ; se retrograder soi-meme -> 400. Effet immediat au prochain
   * appel (le RolesGuard relit le role en base). User introuvable -> 404. Idempotent.
   */
  async setPlatformRole(args: {
    userId: string;
    role: 'SUPERADMIN' | 'SUPPORT' | null;
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<void> {
    await this.callVoid(
      (tx) => tx.$executeRaw`
        SELECT admin_set_platform_role(
          ${args.userId}::uuid, ${args.role}::text,
          ${args.actorUserId}::uuid, ${args.idempotencyKey}::text
        )
      `,
    );
  }

  /**
   * RATTACHE un abonnement a une org EXISTANTE sans abo. Un abo ACTIF deja present -> 409 ;
   * org introuvable -> 404 ; fenetre invalide -> 400. Un abo EXPIRE est remplace. Idempotent.
   */
  async attachSubscription(args: {
    orgId: string;
    pack: string;
    entitlements: string[];
    dateDebut: Date;
    dateFin: Date;
    quota: number;
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<void> {
    await this.callVoid(
      (tx) => tx.$executeRaw`
        SELECT admin_attach_subscription(
          ${args.orgId}::uuid, ${args.pack}::text, ${args.entitlements},
          ${args.dateDebut}, ${args.dateFin}, ${args.quota}::int,
          ${args.actorUserId}::uuid, ${args.idempotencyKey}::text
        )
      `,
    );
  }

  /**
   * TRANSFERT d'OWNER : promeut le nouveau (OWNER), retrograde l'ancien (ADMIN). Le nouvel
   * owner doit etre un membre ACTIF -> sinon 400 (R0011). Idempotent + trace before/after.
   */
  async transferOwnership(args: {
    orgId: string;
    newOwnerUserId: string;
    actorUserId: string;
    idempotencyKey: string;
  }): Promise<void> {
    await this.callVoid(
      (tx) => tx.$executeRaw`
        SELECT admin_transfer_ownership(
          ${args.orgId}::uuid, ${args.newOwnerUserId}::uuid,
          ${args.actorUserId}::uuid, ${args.idempotencyKey}::text
        )
      `,
    );
  }

  /**
   * Journal d'audit d'une org (lecture SUPERADMIN via admin_list_audit, DEFINER).
   * Borne cote base (limit <= 100). Filtre sur target_org_id ; les filtres globaux
   * (action/acteur/periode) sont passes NULL ici (voir listGlobalAudit).
   */
  async listAudit(
    orgId: string,
    args: { limit?: number; offset?: number },
  ): Promise<AuditEntryView[]> {
    return this.queryAudit({
      orgId,
      limit: args.limit ?? 50,
      offset: args.offset ?? 0,
    });
  }

  /**
   * Journal d'audit GLOBAL (toutes orgs, admin_list_audit avec p_org_id NULL, 0014).
   * Filtres SQL bornes : action (marqueur exact), actor (uuid), from/to (fenetre). Borne
   * cote base (limit <= 100). Aucune ligne tenant brute : uniquement le journal admin.
   */
  async listGlobalAudit(args: {
    action?: string;
    actor?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }): Promise<AuditListEntryView[]> {
    const rows = await this.queryAudit({
      orgId: null,
      limit: args.limit ?? 50,
      offset: args.offset ?? 0,
      action: args.action ?? null,
      actor: args.actor ?? null,
      from: args.from ?? null,
      to: args.to ?? null,
    });
    // MINIMISATION cote serveur : on ne laisse remonter QUE le motif d'affichage ;
    // les montants/owner/slug bruts du payload ne quittent PAS le serveur par la liste.
    return rows.map((r) => ({
      id: r.id,
      actorUserId: r.actorUserId,
      action: r.action,
      targetOrgId: r.targetOrgId,
      targetUserId: r.targetUserId,
      payload: { motif: extractMotif(r.payload) },
      createdAt: r.createdAt,
    }));
  }

  /** Appel commun a admin_list_audit (per-org ou global). Filtres NULL = ignores en SQL. */
  private async queryAudit(args: {
    orgId: string | null;
    limit: number;
    offset: number;
    action?: string | null;
    actor?: string | null;
    from?: Date | null;
    to?: Date | null;
  }): Promise<AuditEntryView[]> {
    const rows = await this.prisma.asAppRole(
      (tx) => tx.$queryRaw<AuditRow[]>`
        SELECT id, actor_user_id, action, target_org_id, target_user_id, payload, created_at
        FROM admin_list_audit(
          ${args.orgId}::uuid, ${args.limit}::int, ${args.offset}::int,
          ${args.action ?? null}::text, ${args.actor ?? null}::uuid,
          ${args.from ?? null}::timestamptz, ${args.to ?? null}::timestamptz
        )
      `,
    );
    return rows.map((r) => ({
      id: r.id,
      actorUserId: r.actor_user_id,
      action: r.action,
      targetOrgId: r.target_org_id,
      targetUserId: r.target_user_id,
      payload: r.payload,
      createdAt: r.created_at.toISOString(),
    }));
  }

  /**
   * Execute une fonction DEFINER RETURNS void sous roadsen_app (asAppRole) et mappe les
   * RAISE metier en HTTP. Les marqueurs sont graves dans les fonctions plpgsql (0013).
   */
  private async callVoid(
    fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ): Promise<void> {
    try {
      await this.prisma.asAppRole(fn);
    } catch (err) {
      // 409 email deja utilise par un AUTRE compte (edition d'identite, R0012).
      if (rawMessageIncludes(err, 'email deja utilise')) {
        throw new ConflictException(
          'Cet email est déjà utilisé par un autre compte',
        );
      }
      // 409 anti-lockout plateforme : retirer/retrograder le dernier SUPERADMIN actif (R0013).
      // AVANT le needle 'anti-lockout' generique (message OWNER-specifique) : plus precis d'abord.
      if (rawMessageIncludes(err, 'dernier SUPERADMIN')) {
        throw new ConflictException(
          'Impossible : au moins un SUPERADMIN actif doit subsister',
        );
      }
      // 400 anti auto-retrogradation du role plateforme (on ne se retire pas son acces, R0014).
      if (rawMessageIncludes(err, 'auto-retrogradation')) {
        throw new BadRequestException(
          'Impossible de retirer votre propre accès plateforme',
        );
      }
      // 400 role plateforme invalide (defense de profondeur ; Zod barre deja).
      if (rawMessageIncludes(err, 'role plateforme invalide')) {
        throw new BadRequestException('Rôle plateforme invalide');
      }
      // 409 anti-lockout (retrograder/retirer le dernier OWNER actif).
      if (rawMessageIncludes(err, 'anti-lockout')) {
        throw new ConflictException(
          'Impossible : action sur le dernier propriétaire actif',
        );
      }
      // 400 escalade OWNER par une voie interdite (defense de profondeur, Zod barre deja).
      if (rawMessageIncludes(err, 'OWNER interdit')) {
        throw new BadRequestException(
          'Le rôle OWNER ne peut pas être attribué par cette voie',
        );
      }
      // 400 garde money : quota resultant < consommation engagee.
      if (rawMessageIncludes(err, 'quota resultant')) {
        throw new BadRequestException(
          'Quota résultant inférieur à la consommation déjà engagée',
        );
      }
      // 400 fenetre de renouvellement invalide (debut > fin).
      if (rawMessageIncludes(err, 'fenetre invalide')) {
        throw new BadRequestException('Fenêtre de renouvellement invalide');
      }
      // 400 anti auto-desactivation d'un SUPERADMIN (Vague 2, R0009).
      if (rawMessageIncludes(err, 'auto-desactivation')) {
        throw new BadRequestException(
          'Impossible de désactiver votre propre compte',
        );
      }
      // 409 rattachement d'abo alors qu'un abo ACTIF existe deja (Vague 2, R0010).
      if (rawMessageIncludes(err, 'abonnement actif deja present')) {
        throw new ConflictException(
          'Un abonnement actif existe déjà pour cette organisation',
        );
      }
      // 400 transfert d'OWNER vers un non-membre / membre inactif (Vague 2, R0011).
      if (rawMessageIncludes(err, 'membre actif')) {
        throw new BadRequestException(
          'Le nouveau propriétaire doit être un membre actif de cette organisation',
        );
      }
      // 404 cible introuvable (abonnement / membre / organisation / utilisateur).
      if (rawMessageIncludes(err, 'introuvable')) {
        throw new NotFoundException('Cible introuvable');
      }
      throw err;
    }
  }
}

/**
 * Extrait le `motif` d'affichage d'un payload d'audit JSONB (la seule cle exposee par la
 * liste globale minimisee). Retourne null si absent ou non-textuel : le reste du payload
 * (montants, owner, slug, entitlements...) ne quitte PAS le serveur par cette voie.
 */
function extractMotif(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'motif' in payload) {
    const motif = payload.motif;
    if (typeof motif === 'string') return motif;
  }
  return null;
}

/**
 * Vrai si le message d'erreur brut (RAISE EXCEPTION d'une fonction plpgsql, remonte
 * via P2010) contient `needle`. Les erreurs metier des fonctions 0013 partagent le
 * SQLSTATE applicatif ; on discrimine sur des marqueurs stables graves dans les
 * fonctions (miroir de MembersService.rawMessageIncludes, duplication assumee).
 */
function rawMessageIncludes(err: unknown, needle: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    typeof err.message === 'string' &&
    err.message.includes(needle)
  );
}
