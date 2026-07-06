import { Injectable, NotFoundException } from '@nestjs/common';
import { verifySeal } from '@roadsen/shared';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Supervision PV cross-tenant (Vague 3) — GET /admin/pvs, GET /admin/pvs/:id.
 * La liste ne renvoie que des MÉTADONNÉES (pas de output/input_canonical/hmac).
 * Le détail récupère les champs de sceau via la DEFINER admin_get_pv puis
 * RE-VÉRIFIE le sceau côté serveur (secret PV_SIGNING_SECRET) — seul `sealValid`
 * (booléen) + les métadonnées remontent au navigateur (pas le HMAC brut).
 */
export interface PvListItem {
  pvId: string;
  pvNumber: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  projectName: string;
  engineId: string;
  engineVersion: string;
  scienceStatus: string;
  verdict: string;
  sealedAt: string;
}

export interface PvDetailView {
  pvId: string;
  pvNumber: string;
  orgId: string;
  orgName: string;
  projectName: string;
  engineId: string;
  engineVersion: string;
  scienceStatus: string;
  verdict: string;
  sealedAt: string;
  sealValid: boolean;
}

interface PvListRow {
  pv_id: string;
  pv_number: string;
  org_id: string;
  org_name: string;
  org_slug: string;
  project_name: string;
  engine_id: string;
  engine_version: string;
  science_status: string;
  verdict: string;
  sealed_at: Date;
}

interface PvGetRow {
  pv_id: string;
  pv_number: string;
  org_id: string;
  org_name: string;
  project_name: string;
  engine_id: string;
  engine_version: string;
  science_status: string;
  verdict: string;
  sealed_at: Date;
  input_canonical: string;
  content_hash: string;
  hmac: string;
}

@Injectable()
export class AdminPvService {
  constructor(private readonly prisma: PrismaService) {}

  async listPvs(args: { limit: number; offset: number; q?: string }): Promise<PvListItem[]> {
    const rows = await this.prisma.asAppRole(
      (tx) => tx.$queryRaw<PvListRow[]>`
        SELECT pv_id, pv_number, org_id, org_name, org_slug, project_name,
               engine_id, engine_version, science_status, verdict, sealed_at
        FROM admin_list_pvs(${args.limit}::int, ${args.offset}::int, ${args.q ?? null}::text)
      `,
    );
    return rows.map((r) => ({
      pvId: r.pv_id,
      pvNumber: r.pv_number,
      orgId: r.org_id,
      orgName: r.org_name,
      orgSlug: r.org_slug,
      projectName: r.project_name,
      engineId: r.engine_id,
      engineVersion: r.engine_version,
      scienceStatus: r.science_status,
      verdict: r.verdict,
      sealedAt: r.sealed_at.toISOString(),
    }));
  }

  async getPv(pvId: string): Promise<PvDetailView> {
    const rows = await this.prisma.asAppRole(
      (tx) => tx.$queryRaw<PvGetRow[]>`
        SELECT pv_id, pv_number, org_id, org_name, project_name, engine_id,
               engine_version, science_status, verdict, sealed_at,
               input_canonical, content_hash, hmac
        FROM admin_get_pv(${pvId}::uuid)
      `,
    );
    if (rows.length === 0) throw new NotFoundException('PV introuvable');
    const r = rows[0];
    const secret = process.env.PV_SIGNING_SECRET;
    // Sceau ré-vérifié serveur ; à défaut de secret configuré, on ne prétend pas valide.
    const sealValid = secret
      ? verifySeal(r.input_canonical, r.content_hash, r.hmac, secret)
      : false;
    return {
      pvId: r.pv_id,
      pvNumber: r.pv_number,
      orgId: r.org_id,
      orgName: r.org_name,
      projectName: r.project_name,
      engineId: r.engine_id,
      engineVersion: r.engine_version,
      scienceStatus: r.science_status,
      verdict: r.verdict,
      sealedAt: r.sealed_at.toISOString(),
      sealValid,
    };
  }
}
