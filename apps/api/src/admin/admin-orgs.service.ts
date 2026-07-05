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
  subscription: OrgSubscriptionSummary | null;
  usage: OrgUsage;
}

// Lignes brutes des DEFINER (snake_case = colonnes SQL). count() -> bigint (JS BigInt).
interface OrgRow {
  id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  created_at: Date;
  nb_membres: bigint;
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
  quota: number;
  consommation: number;
  date_fin: Date;
  expired: boolean;
}

/**
 * AdminOrgsService — console de LECTURE back-office SUPERADMIN (Lot 1).
 *
 * DECOUPLAGE IDENTITE / DONNEES (invariant 0007, cf. migration 0012) : l'IDENTITE
 * des orgs (organizations + memberships) se lit CROSS-TENANT via des fonctions
 * SECURITY DEFINER appelees sous `asAppRole` (JAMAIS withTenant — sinon la RLS
 * FORCE rendrait 0 ligne). Le RESUME D'ABONNEMENT et l'USAGE sont des DONNEES
 * TENANT (subscriptions / usage_ledger, sans branche bootstrap) : ils se lisent
 * via `withTenant(orgId)` (roadsen_app a le GRANT ; RLS scope a l'org). On ne
 * melange jamais les deux dans un meme appel.
 *
 * COUT DE LA LISTE (choix assume) : `admin_list_orgs` renvoie l'identite en UNE
 * passe DEFINER ; le resume d'abo est ensuite charge PAR ORG via withTenant
 * (une courte transaction par ligne de la page). C'est un N+1 BORNE par la
 * pagination (limit <= 100). On l'assume plutot que de joindre subscriptions dans
 * le DEFINER, ce qui violerait la separation identite/donnees (subscriptions n'a
 * ni GRANT roadsen_auth ni branche bootstrap ; sa policy RAISE hors contexte).
 * A revoir avec ingenieur-securite si un single-pass devenait necessaire.
 */
@Injectable()
export class AdminOrgsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly members: MembersService,
  ) {}

  /**
   * Liste paginee des organisations (identite + nb membres via admin_list_orgs),
   * chaque ligne enrichie de son resume d'abonnement (withTenant, borne par la page).
   */
  async listOrgs(args: {
    q?: string;
    limit?: number;
    offset?: number;
  }): Promise<AdminOrgListItem[]> {
    const limit = args.limit ?? 20;
    const offset = args.offset ?? 0;
    const q = args.q ?? null;

    // Identite cross-tenant : DEFINER sous asAppRole (drapeau pose dans la fonction).
    const rows = await this.prisma.asAppRole(
      (tx) => tx.$queryRaw<OrgRow[]>`
        SELECT id, name, slug, status, created_at, nb_membres
        FROM admin_list_orgs(${limit}::int, ${offset}::int, ${q}::text)
      `,
    );

    // Enrichissement abo PAR ORG (donnee tenant). N+1 borne par la page.
    const items: AdminOrgListItem[] = [];
    for (const r of rows) {
      const subscription = await this.loadSubscription(r.id);
      items.push({
        id: r.id,
        name: r.name,
        slug: r.slug,
        status: r.status,
        createdAt: r.created_at.toISOString(),
        nbMembres: Number(r.nb_membres),
        subscription,
      });
    }
    return items;
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
  ): Promise<OrgSubscriptionSummary | null> {
    return this.prisma.withTenant(orgId, async (tx) => {
      const rows = await tx.$queryRaw<SubRow[]>`
        SELECT pack, quota, consommation, date_fin, (now() > date_fin) AS expired
        FROM subscriptions
        LIMIT 1
      `;
      const r = rows[0];
      if (!r) return null;
      return {
        pack: r.pack,
        quota: r.quota,
        consommation: r.consommation,
        remaining: Math.max(0, r.quota - r.consommation),
        dateFin: r.date_fin.toISOString(),
        expired: r.expired,
      };
    });
  }
}
