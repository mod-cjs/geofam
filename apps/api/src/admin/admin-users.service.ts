import { Injectable } from '@nestjs/common';
import type { PlatformRole } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/** Vue d'un utilisateur pour le back-office (GET /admin/users). */
export interface AdminUserView {
  userId: string;
  email: string;
  fullName: string;
  platformRole: PlatformRole | null;
  isActive: boolean;
  nbOrgs: number; // nombre d'organisations dont l'utilisateur est membre
}

// Ligne brute d'admin_search_users (snake_case = colonnes SQL). count() -> bigint.
interface UserRow {
  id: string;
  email: string;
  full_name: string;
  platform_role: PlatformRole | null;
  is_active: boolean;
  nb_orgs: bigint;
}

/**
 * AdminUsersService — recherche d'utilisateurs (identite) pour le back-office
 * SUPERADMIN (Lot 1). Cloture le workflow « ajouter un membre a une org
 * existante » (retrouver l'id d'un compte par email/nom).
 *
 * ISOLATION : lecture cross-tenant d'IDENTITE via la fonction SECURITY DEFINER
 * admin_search_users, appelee sous `asAppRole` (JAMAIS withTenant : la RLS FORCE
 * rendrait 0 ligne). Le password_hash n'est JAMAIS renvoye (colonnes minimales
 * cote fonction). Route @Roles(SUPERADMIN) : seul enforcement de l'acces.
 */
@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recherche d'utilisateurs par email/nom (ILIKE, borne cote fonction). Sans
   * filtre, renvoie les premiers utilisateurs (borne dure). Tri stable (email).
   */
  async searchUsers(args: {
    q?: string;
    limit?: number;
  }): Promise<AdminUserView[]> {
    const q = args.q ?? null;
    const limit = args.limit ?? 20;

    const rows = await this.prisma.asAppRole(
      (tx) => tx.$queryRaw<UserRow[]>`
        SELECT id, email, full_name, platform_role, is_active, nb_orgs
        FROM admin_search_users(${q}::text, ${limit}::int)
      `,
    );

    return rows.map((r) => ({
      userId: r.id,
      email: r.email,
      fullName: r.full_name,
      platformRole: r.platform_role,
      isActive: r.is_active,
      nbOrgs: Number(r.nb_orgs),
    }));
  }
}
