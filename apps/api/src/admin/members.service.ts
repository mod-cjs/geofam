import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Role } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/** Vue d'un membre pour le back-office (GET /admin/orgs/:orgId/members). */
export interface OrgMemberView {
  userId: string;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  calculsMois: number; // calculs consommes ce mois-ci (usage_ledger), tracés au userId
}

// SQLSTATE PostgreSQL : violation d'unicite (ré-ajout d'un membre) / de FK
// (userId ou orgId inexistant lors de l'INSERT du membership).
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';

// Ligne brute renvoyee par list_org_members (snake_case = colonnes SQL).
interface MemberRow {
  user_id: string;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
}

/**
 * MembersService — accès contrôlés multi-membres (P1, admin-géré). Le back-office
 * SUPERADMIN attache/suspend/liste les membres d'une organisation EXISTANTE.
 *
 * ISOLATION / leçon #42 : `orgId` vient TOUJOURS du path (org existante, validée
 * en amont), `userId` d'un compte EXISTANT — JAMAIS une identité arbitraire du
 * corps. L'écriture d'identité passe par les fonctions SECURITY DEFINER dédiées
 * (provision_member / set_member_active, migration 0010), seule voie sanctionnée
 * hors tenant pour le runtime NOBYPASSRLS (barrière B1). On lit l'identité via
 * `asAppRole` (transaction dédiée, rôle roadsen_app, sans contexte tenant) — jamais
 * dans un withTenant (invariant d'auth 0007). Le comptage d'usage mensuel, lui,
 * est une donnée TENANT (usage_ledger) : lu via withTenant sous roadsen_app.
 */
@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Attache `userId` à l'org `orgId` avec `role` (≠ OWNER). Renvoie l'id du
   * membership créé. Un ré-ajout (couple déjà membre) -> 409 générique ; un
   * userId (ou orgId) inexistant -> 400 borné (FK), sans divulguer lequel.
   */
  async provisionMember(
    orgId: string,
    userId: string,
    role: AddableRole,
  ): Promise<string> {
    try {
      const rows = await this.prisma.asAppRole(
        (tx) => tx.$queryRaw<{ provision_member: string }[]>`
          SELECT provision_member(${orgId}::uuid, ${userId}::uuid, ${role}::"Role")
        `,
      );
      return rows[0].provision_member;
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        // orgId/userId inexistant : refus borné, sans révéler lequel.
        throw new BadRequestException(
          'Organisation ou utilisateur introuvable',
        );
      }
      if (isUniqueViolation(err)) {
        // Déjà membre : 409 générique (pas de fuite d'existence de membership).
        throw new ConflictException(
          'Ce compte est déjà membre de cette organisation',
        );
      }
      throw err;
    }
  }

  /**
   * Suspend (false) ou réactive (true) le membre (`orgId`, `userId`). Un membre
   * introuvable -> 404 ; le dernier OWNER actif que l'on tente de suspendre ->
   * 409 (anti-lockout, porté par set_member_active).
   */
  async setMemberActive(
    orgId: string,
    userId: string,
    isActive: boolean,
  ): Promise<void> {
    try {
      // set_member_active RETURNS void. On l'appelle via $executeRaw (et NON $queryRaw) :
      // $queryRaw tente de désérialiser la colonne renvoyée et ÉCHOUE sur le type `void`
      // (« Failed to deserialize column of type 'void' ») -> 500. $executeRaw exécute
      // l'instruction sans matérialiser de colonne ; les effets (UPDATE) et un éventuel
      // RAISE (anti-lockout / introuvable) se propagent normalement. (provision_member
      // RETURNS uuid -> lui reste en $queryRaw, l'uuid se désérialise sans problème.)
      await this.prisma.asAppRole(
        (tx) => tx.$executeRaw`
          SELECT set_member_active(${orgId}::uuid, ${userId}::uuid, ${isActive})
        `,
      );
    } catch (err) {
      if (rawMessageIncludes(err, 'anti-lockout')) {
        throw new ConflictException(
          'Impossible de suspendre le dernier propriétaire actif',
        );
      }
      if (rawMessageIncludes(err, 'introuvable')) {
        throw new NotFoundException(
          'Membre introuvable dans cette organisation',
        );
      }
      throw err;
    }
  }

  /**
   * Liste les membres de l'org (identité via list_org_members, DEFINER) enrichie
   * du nombre de calculs consommés ce mois-ci (usage_ledger, donnée tenant lue via
   * withTenant). Deux voies distinctes (identité vs données), fusionnées ici : on
   * ne mélange jamais lecture d'identité et de données dans un même DEFINER.
   */
  async listMembers(orgId: string): Promise<OrgMemberView[]> {
    const members = await this.prisma.asAppRole(
      (tx) => tx.$queryRaw<MemberRow[]>`
        SELECT user_id, email, full_name, role, is_active
        FROM list_org_members(${orgId}::uuid)
      `,
    );

    // Comptage d'usage du mois courant (now() base), tracé au userId dans le
    // ledger. Lecture TENANT sous roadsen_app (RLS scope à l'org courante).
    const usage = await this.prisma.withTenant(
      orgId,
      (tx) =>
        tx.$queryRaw<{ user_id: string; n: number }[]>`
        SELECT user_id, count(*)::int AS n
        FROM usage_ledger
        WHERE created_at >= date_trunc('month', now())
        GROUP BY user_id
      `,
    );
    const countByUser = new Map(usage.map((u) => [u.user_id, u.n]));

    return members.map((m) => ({
      userId: m.user_id,
      email: m.email,
      fullName: m.full_name,
      role: m.role,
      isActive: m.is_active,
      calculsMois: countByUser.get(m.user_id) ?? 0,
    }));
  }
}

/** Rôles attribuables par provision_member (OWNER exclu, cf. members.dto). */
type AddableRole = Exclude<Role, 'OWNER'>;

/** Détecte une violation d'unicité PostgreSQL (23505) remontée via $queryRaw. */
function isUniqueViolation(err: unknown): boolean {
  return hasSqlState(err, PG_UNIQUE_VIOLATION);
}

/** Détecte une violation de clé étrangère PostgreSQL (23503). */
function isForeignKeyViolation(err: unknown): boolean {
  return hasSqlState(err, PG_FOREIGN_KEY_VIOLATION);
}

/**
 * Vrai si l'erreur Prisma porte le SQLSTATE PostgreSQL donné. Prisma enveloppe
 * l'erreur PG d'un `$queryRaw` dans une PrismaClientKnownRequestError (code P2010
 * = raw query failed) ; le SQLSTATE d'origine est dans `meta.code`. Voie
 * principale + repli sur le message (robustesse inter-versions Prisma). Mirroir
 * de l'helper d'AuthService (même discipline, duplication assumée localement).
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

/**
 * Vrai si le message d'erreur brut (RAISE EXCEPTION d'une fonction plpgsql,
 * remonté via P2010) contient `needle`. Les erreurs métier de set_member_active
 * (« introuvable » / « anti-lockout ») partagent le SQLSTATE P0001 (raise_exception)
 * et ne se distinguent que par leur message ; on discrimine sur des marqueurs
 * stables gravés dans la fonction (migration 0010).
 */
function rawMessageIncludes(err: unknown, needle: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    typeof err.message === 'string' &&
    err.message.includes(needle)
  );
}
