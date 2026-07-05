import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Tableau de bord plateforme (GET /admin/stats) — AGREGATS cross-tenant SEULEMENT.
 * Objet plat type : compteurs d'orgs par statut, users, memberships actifs, PV emis,
 * quota alloue/consomme total, sante des abonnements. AUCUNE ligne tenant brute
 * (minimisation CDP). Source : admin_platform_stats (DEFINER, 0014).
 */
export interface PlatformStats {
  orgs: { active: number; suspended: number; archived: number };
  usersTotal: number;
  membershipsActive: number;
  pvTotal: number;
  quota: { allouTotal: number; consommeTotal: number };
  abonnements: {
    expirant30j: number;
    expires: number;
    orgsSansAbo: number;
    orgsQuota90pct: number;
  };
}

// Ligne brute (une seule) renvoyee par admin_platform_stats. count()/sum() -> bigint.
interface StatsRow {
  orgs_active: bigint;
  orgs_suspended: bigint;
  orgs_archived: bigint;
  users_total: bigint;
  memberships_active: bigint;
  pv_total: bigint;
  quota_alloue_total: bigint;
  quota_consomme_total: bigint;
  abos_expirant_30j: bigint;
  abos_expires: bigint;
  orgs_sans_abo: bigint;
  orgs_quota_90pct: bigint;
}

/**
 * AdminStatsService — lecture du tableau de bord. La DEFINER admin_platform_stats
 * agrege l'IDENTITE (organizations/users/memberships) ET les DONNEES money/PV
 * (subscriptions/official_pvs) cross-tenant, sous le drapeau bootstrap (0014). Appel
 * sous asAppRole (role roadsen_app, sans contexte tenant) : la fonction pose/ferme
 * elle-meme le drapeau + un contexte factice. On ne renvoie que des SCALAIRES.
 */
@Injectable()
export class AdminStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async platformStats(): Promise<PlatformStats> {
    const rows = await this.prisma.asAppRole(
      (tx) => tx.$queryRaw<StatsRow[]>`
        SELECT orgs_active, orgs_suspended, orgs_archived, users_total,
               memberships_active, pv_total, quota_alloue_total, quota_consomme_total,
               abos_expirant_30j, abos_expires, orgs_sans_abo, orgs_quota_90pct
        FROM admin_platform_stats()
      `,
    );
    const r = rows[0];
    return {
      orgs: {
        active: Number(r.orgs_active),
        suspended: Number(r.orgs_suspended),
        archived: Number(r.orgs_archived),
      },
      usersTotal: Number(r.users_total),
      membershipsActive: Number(r.memberships_active),
      pvTotal: Number(r.pv_total),
      quota: {
        allouTotal: Number(r.quota_alloue_total),
        consommeTotal: Number(r.quota_consomme_total),
      },
      abonnements: {
        expirant30j: Number(r.abos_expirant_30j),
        expires: Number(r.abos_expires),
        orgsSansAbo: Number(r.orgs_sans_abo),
        orgsQuota90pct: Number(r.orgs_quota_90pct),
      },
    };
  }
}
