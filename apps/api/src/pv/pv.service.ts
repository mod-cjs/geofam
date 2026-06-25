import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OfficialPv } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  canonicalize,
  sealContentHash,
  sealHmac,
  verifySeal,
  type SealableValue,
} from '@roadsen/shared';

import { PrismaService } from '../prisma/prisma.service';
import { requireOrgId } from '../tenant/tenant-context';

/** PV officiel + verdict de verification du sceau (recalcule a la lecture). */
export interface OfficialPvView {
  pv: OfficialPv;
  sealValid: boolean;
}

/**
 * PvService — EMISSION + LECTURE/VERIFICATION des PV officiels (#63, incr. B).
 *
 * EMISSION (emitFromCalc) — pour un calc_result du tenant courant :
 *  1. assemble le CONTENU CANONIQUE { pvNumber, sealedAt(ISO string), engineMeta,
 *     identity, input, output, scienceStatus } (sealedAt = CHAINE ISO, jamais un
 *     objet Date : canonicalize n'accepte que des valeurs JSON-plain) ;
 *  2. alloue le numero PAR ORG (allocate_pv_number) au format
 *     PV-RDS-{orgSlug}-{YYYY}-{NNNNNN} ;
 *  3. scelle : content_hash = SHA-256(canonical), hmac = HMAC-SHA256(canonical,
 *     PV_SIGNING_SECRET) ;
 *  4. insere l'official_pv IMMUABLE (copie figee + input_canonical = la chaine
 *     EXACTE scellee).
 *
 *  IDEMPOTENCE : UNIQUE(org_id, calc_result_id) en base. Si un PV existe deja
 *  pour ce calcul, on le RENVOIE tel quel SANS bruler de numero (on n'appelle
 *  meme pas allocate_pv_number). Une course (deux emissions simultanees) bute sur
 *  la contrainte unique -> on relit et renvoie l'existant.
 *
 * LECTURE (getById/list) : renvoie le PV + `sealValid`, recalcule en
 * re-canonicalisant... NON : on re-verifie le sceau STOCKE contre la chaine
 * canonique STOCKEE (input_canonical). Une alteration de input_canonical en base
 * casse le hash -> sealValid=false (detection de falsification).
 */
@Injectable()
export class PvService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Emet (ou renvoie, si deja emis) le PV officiel d'un calc_result du tenant.
   * @throws NotFoundException si le calcul n'existe pas dans le tenant courant.
   */
  async emitFromCalc(args: {
    calcResultId: string;
    projectId: string;
    userId: string;
  }): Promise<OfficialPv> {
    const orgId = requireOrgId();
    const secret = this.signingSecret();

    return this.prisma
      .withTenant(orgId, async (tx) => {
        // IDEMPOTENCE : un PV existe-t-il deja pour ce calcul ? Si oui, on le renvoie
        // tel quel (aucun numero brule, aucun nouveau scellement).
        const existing = await tx.officialPv.findUnique({
          where: {
            orgId_calcResultId: { orgId, calcResultId: args.calcResultId },
          },
        });
        if (existing) return existing;

        // Charge le calcul (RLS scope -> uniquement le tenant courant).
        const calc = await tx.calcResult.findUnique({
          where: { id: args.calcResultId },
        });
        if (!calc || calc.projectId !== args.projectId) {
          throw new NotFoundException(
            'Calcul introuvable dans ce projet/cette organisation.',
          );
        }

        // Coordonnees du tenant (slug) + libelle projet — lisibles sous RLS.
        const org = await tx.organization.findUnique({
          where: { id: orgId },
          select: { slug: true },
        });
        const project = await tx.project.findUnique({
          where: { id: args.projectId },
          select: { name: true },
        });
        if (!org || !project) {
          // Ne devrait pas arriver (FK), mais fail-closed plutot que sceller a vide.
          throw new NotFoundException('Organisation ou projet introuvable.');
        }

        // sealedAt FIGE (ISO string) : c'est l'horodatage SCELLE du PV.
        const sealedAtIso = new Date().toISOString();
        const year = Number(sealedAtIso.slice(0, 4));

        // NUMEROTATION PAR ORG (idempotente cote sequence) : allocate_pv_number
        // incremente le compteur du tenant courant. On l'appelle UNIQUEMENT ici,
        // apres avoir verifie qu'aucun PV n'existe -> pas de numero gaspille.
        // CAST ::int explicite : un parametre lie Prisma est typé bigint par
        // defaut ; la fonction attend integer, et Postgres ne resout pas
        // bigint->integer implicitement (42883). Le cast fige la signature.
        const seqRows = await tx.$queryRaw<
          Array<{ allocate_pv_number: bigint }>
        >`
        SELECT allocate_pv_number(${year}::int) AS allocate_pv_number
      `;
        const seq = Number(seqRows[0]?.allocate_pv_number ?? 0);
        const pvNumber = formatPvNumber(org.slug, year, seq);

        // CONTENU CANONIQUE : tout ce qui est scelle. sealedAt = chaine ISO.
        const content: SealableValue = {
          pvNumber,
          sealedAt: sealedAtIso,
          engineMeta: {
            engineId: calc.engineId,
            engineVersion: calc.engineVersion,
            // engineSourceHash optionnel (peut etre null en base) : on l'omet si absent.
            ...(calc.engineSourceHash
              ? { engineSourceHash: calc.engineSourceHash }
              : {}),
          },
          identity: {
            userId: args.userId,
            projectId: args.projectId,
            projectName: project.name,
          },
          input: calc.input,
          output: calc.output,
          scienceStatus: SCIENCE_STATUS,
        };

        const canonical = canonicalize(content);
        const contentHash = sealContentHash(canonical);
        const hmac = sealHmac(canonical, secret);

        // INSERT de l'official_pv (immuable). Une course sur le meme calcul bute sur
        // UNIQUE(org_id, calc_result_id) -> P2002. ATTENTION : le rattrapage NE PEUT
        // PAS se faire ICI : le P2002 a deja AVORTE cette transaction (Postgres 25P02
        // « current transaction is aborted »), tout ordre suivant DANS la tx echoue.
        // On laisse donc le P2002 REMONTER : le throw du callback termine la tx
        // ($transaction rollback), et le rattrapage se fait dans une NOUVELLE tx,
        // hors de ce withTenant (cf. catch d'emitFromCalc).
        return tx.officialPv.create({
          data: {
            orgId,
            calcResultId: args.calcResultId,
            projectId: args.projectId,
            pvNumber,
            userId: args.userId,
            projectName: project.name,
            engineId: calc.engineId,
            engineVersion: calc.engineVersion,
            engineSourceHash: calc.engineSourceHash,
            inputCanonical: canonical,
            output: calc.output as object,
            scienceStatus: SCIENCE_STATUS,
            contentHash,
            hmac,
            sealedAt: new Date(sealedAtIso),
          },
        });
      })
      .catch(async (err: unknown) => {
        // RATTRAPAGE DE COURSE — HORS de la tx avortee. Si l'INSERT a bute sur
        // UNIQUE(org_id, calc_result_id) (P2002), un PV pour ce calcul a ete cree
        // par une emission concurrente : on le relit dans une NOUVELLE transaction
        // (la 1re est terminee par le throw -> la connexion poolee est reutilisable)
        // et on le renvoie -> idempotence preservee meme sous course. Le numero
        // alloue par la transaction perdante est « brule » (gap possible) :
        // acceptable, un compteur n'est pas garanti contigu, l'unicite prime.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          const raced = await this.prisma.withTenant(orgId, (tx2) =>
            tx2.officialPv.findUnique({
              where: {
                orgId_calcResultId: { orgId, calcResultId: args.calcResultId },
              },
            }),
          );
          if (raced) return raced;
        }
        throw err;
      });
  }

  /** Lit un PV du tenant + verdict de sceau. @throws NotFound si absent/hors tenant. */
  async getViewById(args: {
    projectId: string;
    pvId: string;
  }): Promise<OfficialPvView> {
    const orgId = requireOrgId();
    const secret = this.signingSecret();
    const pv = await this.prisma.withTenant(orgId, (tx) =>
      tx.officialPv.findUnique({ where: { id: args.pvId } }),
    );
    if (!pv || pv.projectId !== args.projectId) {
      throw new NotFoundException(
        'PV introuvable dans ce projet/cette organisation.',
      );
    }
    return { pv, sealValid: this.verify(pv, secret) };
  }

  /** Liste les PV d'un projet du tenant (RLS scope), chacun avec son verdict. */
  async listForProject(projectId: string): Promise<OfficialPvView[]> {
    const orgId = requireOrgId();
    const secret = this.signingSecret();
    const rows = await this.prisma.withTenant(orgId, (tx) =>
      tx.officialPv.findMany({
        where: { projectId },
        orderBy: { sealedAt: 'desc' },
      }),
    );
    return rows.map((pv) => ({ pv, sealValid: this.verify(pv, secret) }));
  }

  /**
   * Re-verifie le sceau STOCKE contre la chaine canonique STOCKEE. Une alteration
   * de input_canonical (ou du hash/hmac) en base -> sealValid=false.
   */
  private verify(pv: OfficialPv, secret: string): boolean {
    return verifySeal(pv.inputCanonical, pv.contentHash, pv.hmac, secret);
  }

  /** Recupere le secret de scellement ; refuse de fonctionner sans (fail-closed). */
  private signingSecret(): string {
    const secret = process.env.PV_SIGNING_SECRET;
    if (!secret || secret.length === 0) {
      // Secret absent = MAUVAISE CONFIGURATION SERVEUR (pas un refus d'autorisation) :
      // on ne peut ni sceller ni verifier. 503 (temporairement indisponible),
      // message borne -> pas de 403 trompeur ni de PV non signe / verif faussee.
      throw new ServiceUnavailableException(
        'Scellement temporairement indisponible : secret de signature des PV non configure.',
      );
    }
    return secret;
  }
}

/** Statut science = metadonnee INTERNE (pas de bandeau @science-unsigned, decision titulaire). */
const SCIENCE_STATUS = 'unsigned';

/** Formate PV-RDS-{orgSlug}-{YYYY}-{NNNNNN} (sequence sur 6 chiffres, zero-padded). */
function formatPvNumber(orgSlug: string, year: number, seq: number): string {
  const nnnnnn = String(seq).padStart(6, '0');
  return `PV-RDS-${orgSlug}-${year}-${nnnnnn}`;
}
