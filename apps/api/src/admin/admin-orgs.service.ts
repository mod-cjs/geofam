import { Injectable, NotFoundException } from '@nestjs/common';
import type { OrgStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import type { OrgMemberView } from './members.service';
import { MembersService } from './members.service';

/** Resume d'abonnement d'une org (donnee tenant, lue via withTenant). */
export interface OrgSubscriptionSummary {
  pack: string;
  quota: number;
  consommation: number;
  remaining: number;
  dateFin: string; // ISO (source serveur : date_fin)
  expired: boolean; // now() base > date_fin (jamais l'horloge cliente, TM-1)
}

/**
 * Detail d'abonnement (GET /admin/orgs/:id) : resume + LISTE REELLE des entitlements
 * (modules/moteurs debloques, colonne subscriptions.entitlements). Le resume de LISTE
 * (admin_list_orgs) ne porte PAS cette liste ; seul le DETAIL l'expose. Necessaire au
 * modal d'edition des modules qui, sans elle, re-approxime les entitlements depuis le
 * pack et ECRASE les vrais a l'enregistrement (corruption). Source = lecture withTenant
 * scopee a l'org (meme voie que le reste du resume), pas un DEFINER cross-tenant.
 */
export interface OrgSubscriptionDetail extends OrgSubscriptionSummary {
  entitlements: string[];
}

/** Identite d'une org (back-office). */
export interface AdminOrgIdentity {
  id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  createdAt: string; // ISO
}

/** Une ligne de la liste GET /admin/orgs (identite + nb membres + resume abo). */
export interface AdminOrgListItem extends AdminOrgIdentity {
  nbMembres: number;
  subscription: OrgSubscriptionSummary | null;
}

/** Agregat d'usage d'une org sur le MOIS COURANT (donnee tenant, withTenant). */
export interface OrgUsage {
  quota: number | null; // null si l'org n'a pas d'abonnement
  consommation: number | null; // compteur materialise de l'abo (fenetre courante)
  remaining: number | null;
  monthStart: string; // ISO : date_trunc('month', now()) base
  byKind: { CALC: number; PV: number }; // ventilation du mois courant (ledger)
  byMember: { userId: string; count: number }[]; // par membre, mois courant
}

/** Detail composite GET /admin/orgs/:orgId. */
export interface AdminOrgDetail {
  org: AdminOrgIdentity;
  members: OrgMemberView[];
  // DETAIL (avec entitlements REELS), pas le resume : le modal Modules en a besoin.
  subscription: OrgSubscriptionDetail | null;
  usage: OrgUsage;
}

// Lignes brutes des DEFINER (snake_case = colonnes SQL). count() -> bigint (JS BigInt).
// La liste enrichie (admin_list_orgs, 0014) porte l'identite ET le resume d'abo joint
// (has_sub + colonnes d'abonnement, NULL si l'org n'a pas d'abonnement).
interface OrgRow {
  id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  created_at: Date;
  nb_membres: bigint;
  has_sub: boolean;
  pack: string | null;
  quota: number | null;
  consommation: number | null;
  date_fin: Date | null;
  expired: boolean | null;
}
interface OrgIdentityRow {
  id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  created_at: Date;
}
interface SubRow {
  pack: string;
  entitlements: string[];
  quota: number;
  consommation: number;
  date_fin: Date;
  expired: boolean;
}

/**
 * AdminOrgsService — console de LECTURE back-office SUPERADMIN (Lot 1).
 *
 * DECOUPLAGE IDENTITE / DONNEES (invariant 0007) : l'IDENTITE des orgs
 * (organizations + memberships) se lit CROSS-TENANT via des fonctions SECURITY
 * DEFINER appelees sous `asAppRole` (JAMAIS withTenant — sinon la RLS FORCE rendrait
 * 0 ligne). Pour le DETAIL d'une org (getOrgDetail), le RESUME D'ABONNEMENT et
 * l'USAGE restent lus via `withTenant(orgId)` (donnees tenant, RLS scope a l'org).
 *
 * LISTE — SINGLE-PASS (0014) : `admin_list_orgs` enrichi JOINT subscriptions et rend
 * identite + resume d'abo en UNE passe DEFINER, avec filtre/tri/pagination MONEY faits
 * en SQL (fin du N+1 de 0012 et du tri client-side sur une seule page). Ce join lit
 * subscriptions CROSS-TENANT via la branche de lecture bootstrap ajoutee en 0014 §1
 * (revue ingenieur-securite requise) ; la sortie ne porte que le resume deja visible
 * du SUPERADMIN dans le detail d'org. La separation identite/donnees est donc RELACHEE
 * POUR CETTE LECTURE (agregat back-office), pas pour les ecritures money.
 */
@Injectable()
export class AdminOrgsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly members: MembersService,
  ) {}

  /**
   * Liste paginee des organisations (identite + nb membres + RESUME D'ABO), en UNE
   * passe DEFINER (admin_list_orgs enrichi, 0014). Le tri/filtre/pagination sur les
   * champs d'abo (quota/expiration/statut d'abo) sont faits en SQL cote base : plus de
   * N+1 ni de tri client-side sur une seule page (cause de la pagination faussee).
   * Le join subscriptions est lu cross-tenant via la branche bootstrap (cf. 0014 §1) ;
   * la sortie ne contient que le resume deja montre au SUPERADMIN dans le detail d'org.
   */
  async listOrgs(args: {
    q?: string;
    limit?: number;
    offset?: number;
    status?: OrgStatus;
    sort?: string;
    subFilter?: string;
  }): Promise<AdminOrgListItem[]> {
    const limit = args.limit ?? 20;
    const offset = args.offset ?? 0;
    const q = args.q ?? null;
    const status = args.status ?? null;
    const sort = args.sort ?? null;
    const subFilter = args.subFilter ?? null;

    const rows = await this.prisma.asAppRole(
      (tx) => tx.$queryRaw<OrgRow[]>`
        SELECT id, name, slug, status, created_at, nb_membres,
               has_sub, pack, quota, consommation, date_fin, expired
        FROM admin_list_orgs(
          ${limit}::int, ${offset}::int, ${q}::text,
          ${status}::"OrgStatus", ${sort}::text, ${subFilter}::text
        )
      `,
    );

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      status: r.status,
      createdAt: r.created_at.toISOString(),
      nbMembres: Number(r.nb_membres),
      subscription: toSummary(r),
    }));
  }

  /**
   * Console d'abonnements (vue MONEY-centree) : meme DEFINER que listOrgs, filtree sur
   * une famille money (expired/expiring/noquota/nosub/withsub) et triable. Renvoie la
   * meme forme d'item (org + resume d'abo).
   */
  async listSubscriptions(args: {
    filter?: string;
    sort?: string;
    limit?: number;
    offset?: number;
  }): Promise<AdminOrgListItem[]> {
    return this.listOrgs({
      limit: args.limit,
      offset: args.offset,
      sort: args.sort,
      subFilter: args.filter,
    });
  }

  /**
   * Detail COMPOSITE d'une org : identite (admin_get_org) + membres (listMembers
   * existant, identite) + resume d'abo + usage du mois (withTenant). Un orgId
   * inconnu -> 404 (identite introuvable), sans divulguer d'autre information.
   */
  async getOrgDetail(orgId: string): Promise<AdminOrgDetail> {
    const org = await this.getOrgIdentity(orgId);
    if (!org) {
      throw new NotFoundException('Organisation introuvable');
    }
    // Membres : identite via list_org_members (DEFINER, deja porte par MembersService).
    const members = await this.members.listMembers(orgId);
    const subscription = await this.loadSubscription(orgId);
    const usage = await this.getUsage(orgId);
    return { org, members, subscription, usage };
  }

  /**
   * Agregat d'usage du MOIS COURANT (donnee tenant, withTenant). quota/consommation
   * viennent de l'abonnement (compteur materialise de la fenetre courante) ; la
   * ventilation CALC/PV et par membre vient du ledger (now() base, date_trunc mois).
   */
  async getUsage(orgId: string): Promise<OrgUsage> {
    return this.prisma.withTenant(orgId, async (tx) => {
      // Compteur d'abonnement (au plus 1 ligne, org_id UNIQUE ; RLS scope a l'org).
      const subRows = await tx.$queryRaw<
        { quota: number; consommation: number }[]
      >`
        SELECT quota, consommation FROM subscriptions LIMIT 1
      `;
      const sub = subRows[0];

      // Ancre de temps SERVEUR : debut du mois courant en base (jamais l'horloge app).
      const monthRows = await tx.$queryRaw<{ month_start: Date }[]>`
        SELECT date_trunc('month', now()) AS month_start
      `;
      const monthStart = monthRows[0].month_start.toISOString();

      // Ventilation par type (CALC/PV) sur le mois courant.
      const kindRows = await tx.$queryRaw<{ kind: string; n: number }[]>`
        SELECT kind, count(*)::int AS n
        FROM usage_ledger
        WHERE created_at >= date_trunc('month', now())
        GROUP BY kind
      `;
      const byKind = { CALC: 0, PV: 0 };
      for (const k of kindRows) {
        if (k.kind === 'CALC') byKind.CALC = k.n;
        else if (k.kind === 'PV') byKind.PV = k.n;
      }

      // Ventilation par membre sur le mois courant (userId + compte).
      const memberRows = await tx.$queryRaw<{ user_id: string; n: number }[]>`
        SELECT user_id, count(*)::int AS n
        FROM usage_ledger
        WHERE created_at >= date_trunc('month', now())
        GROUP BY user_id
        ORDER BY n DESC
      `;
      const byMember = memberRows.map((m) => ({
        userId: m.user_id,
        count: m.n,
      }));

      const quota = sub ? sub.quota : null;
      const consommation = sub ? sub.consommation : null;
      const remaining =
        sub != null ? Math.max(0, sub.quota - sub.consommation) : null;

      return {
        quota,
        consommation,
        remaining,
        monthStart,
        byKind,
        byMember,
      };
    });
  }

  /**
   * Identite d'UNE org via admin_get_org (DEFINER, asAppRole). `null` si inconnue.
   */
  private async getOrgIdentity(
    orgId: string,
  ): Promise<AdminOrgIdentity | null> {
    const rows = await this.prisma.asAppRole(
      (tx) => tx.$queryRaw<OrgIdentityRow[]>`
        SELECT id, name, slug, status, created_at
        FROM admin_get_org(${orgId}::uuid)
      `,
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      status: r.status,
      createdAt: r.created_at.toISOString(),
    };
  }

  /**
   * Resume d'abonnement d'une org (donnee tenant, withTenant). `null` si l'org
   * n'a pas d'abonnement (provisionnement manquant). expired evalue par now() base.
   */
  private async loadSubscription(
    orgId: string,
  ): Promise<OrgSubscriptionDetail | null> {
    return this.prisma.withTenant(orgId, async (tx) => {
      const rows = await tx.$queryRaw<SubRow[]>`
        SELECT pack, entitlements, quota, consommation, date_fin, (now() > date_fin) AS expired
        FROM subscriptions
        LIMIT 1
      `;
      const r = rows[0];
      if (!r) return null;
      return {
        pack: r.pack,
        // Liste REELLE des modules debloques (subscriptions.entitlements) : source
        // de verite du modal Modules. Sans elle, l'UI re-approxime depuis le pack et
        // ECRASE les vrais entitlements a l'enregistrement (BLOQUANT corrige ici).
        entitlements: r.entitlements,
        quota: r.quota,
        consommation: r.consommation,
        remaining: Math.max(0, r.quota - r.consommation),
        dateFin: r.date_fin.toISOString(),
        expired: r.expired,
      };
    });
  }
}

/**
 * Construit le resume d'abo a partir d'une ligne enrichie de admin_list_orgs (0014).
 * `null` si l'org n'a pas d'abonnement (has_sub=false -> colonnes d'abo NULL). `expired`
 * est evalue en base (now() > date_fin), jamais avec l'horloge cliente (TM-1).
 */
function toSummary(r: OrgRow): OrgSubscriptionSummary | null {
  if (
    !r.has_sub ||
    r.pack === null ||
    r.quota === null ||
    r.date_fin === null
  ) {
    return null;
  }
  const consommation = r.consommation ?? 0;
  return {
    pack: r.pack,
    quota: r.quota,
    consommation,
    remaining: Math.max(0, r.quota - consommation),
    dateFin: r.date_fin.toISOString(),
    expired: r.expired ?? false,
  };
}
