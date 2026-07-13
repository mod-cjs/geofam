import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { OfficialPv } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  canonicalize,
  projectEngineOutput,
  sealContentHash,
  sealHmac,
  verifySeal,
  type SealableValue,
} from '@roadsen/shared';

import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { requireOrgId } from '../tenant/tenant-context';

import { findEngineDispatchByRegistryId } from './engine-dispatch';
import { renderPvPdf } from './pdf/pv-pdf';
import { resolveVerdict } from './verdict';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

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

        // Libelle projet — projects est une table de DONNEES (roadsen_app garde
        // le DML) -> lecture directe sous RLS, inchangee.
        const project = await tx.project.findUnique({
          where: { id: args.projectId },
          select: { name: true },
        });
        if (!project) {
          // Ne devrait pas arriver (FK), mais fail-closed plutot que sceller a vide.
          throw new NotFoundException('Projet introuvable.');
        }

        // IDENTITE A SCELLER (org + emetteur) — lecture via fonction DEFINER.
        //
        // MIGRATION 0007 : roadsen_app n'a PLUS de DML direct sur organizations /
        // users (BARRIERE 1 anti-fuite identite). On lit donc le slug + nom de
        // l'org ET le nom complet de l'emetteur en UNE fois via la fonction
        // SECURITY DEFINER pv_emitter_context(p_org_id, p_user_id), owned par
        // roadsen_auth (qui detient le privilege identite) et bornee au couple
        // passe : orgId (deja prouvee par TenantGuard) + args.userId (sub JWT
        // verifie). Le nom de l'org et le visa de l'emetteur sont des donnees
        // SCELLEES (provenance du PV), pas un simple affichage.
        //
        // NB ROLE : cet appel a lieu DANS withTenant (donc SOUS roadsen_app, cf.
        // PrismaService). pv_emitter_context etant SECURITY DEFINER, il s'execute
        // QUAND MEME avec les droits de roadsen_auth (le SET ROLE de l'appelant est
        // ignore par SECURITY DEFINER) -> il franchit la RLS d'identite. C'est une
        // lecture identite READ-ONLY, auto-contenue (drapeau on->off interne) : seule
        // exception sanctionnee a "pas de DEFINER d'identite dans withTenant", car
        // l'emission a besoin du visa scelle au moment du scellement.
        const ctxRows = await tx.$queryRaw<
          Array<{
            org_slug: string;
            org_name: string;
            emitter_full_name: string | null;
          }>
        >`
        SELECT org_slug, org_name, emitter_full_name
        FROM pv_emitter_context(${orgId}::uuid, ${args.userId}::uuid)
      `;
        const ctx = ctxRows[0];
        if (!ctx) {
          // org ou emetteur introuvable (ne devrait pas arriver : FK + membership
          // deja prouve). Fail-closed plutot que sceller a vide.
          throw new NotFoundException('Organisation ou émetteur introuvable.');
        }
        const org = { slug: ctx.org_slug, name: ctx.org_name };
        // full_name est NON-NULL au schema ; fallback defensif si vide/illisible.
        const userDisplayName =
          ctx.emitter_full_name && ctx.emitter_full_name.trim().length > 0
            ? ctx.emitter_full_name.trim()
            : '';

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

        // INTEGRITE (revue adverse) : calc_results est MUTABLE (roadsen_app a UPDATE).
        // On RE-EXECUTE le moteur sur l'input stocke et on REFUSE de sceller si la sortie
        // recomputee differe de la sortie stockee -> le PV scelle correspond TOUJOURS a ce
        // que le moteur produit REELLEMENT (pas une sortie alteree en base entre calcul et
        // emission). Fail-closed : moteur indisponible / non reproductible / divergent
        // (ex. version moteur changee depuis le calcul) -> emission REFUSEE.
        const dispatch = findEngineDispatchByRegistryId(calc.engineId);
        if (!dispatch) {
          throw new ServiceUnavailableException(
            `Moteur « ${calc.engineId} » indisponible pour re-verification a l'emission du PV.`,
          );
        }
        const recomputed = dispatch.run(calc.input);
        if (!recomputed.ok) {
          throw new ConflictException(
            'Le calcul ne peut plus etre reproduit par le moteur : emission du PV refusee (integrite).',
          );
        }
        const recomputedOutput: unknown = projectEngineOutput(
          dispatch.contract.outputSchema,
          recomputed.output,
        );
        // GARDE FAIL-CLOSED (revue adverse B1) : un output porteur d'une `erreur` (echec de
        // garde encode ok:true + zeros par radier/plane-strain/tri-raft) ne doit JAMAIS etre
        // scelle — sinon PV de zeros « faisant foi » (DoD §5). Defense en profondeur : la
        // garde de calc-results empeche deja de persister un tel calcul ; on refuse aussi ici.
        if (
          recomputedOutput != null &&
          typeof recomputedOutput === 'object' &&
          (recomputedOutput as { erreur?: unknown }).erreur != null
        ) {
          throw new ConflictException(
            'Ce calcul est en erreur : emission du PV refusee (aucun livrable scelle sur un calcul echoue).',
          );
        }
        if (
          canonicalize(recomputedOutput as SealableValue) !==
          canonicalize(calc.output)
        ) {
          // On DISTINGUE une derive de version (le moteur a ete mis a jour depuis le calcul
          // -> divergence LEGITIME) d'une ALTERATION en base. Message non alarmant dans le
          // 1er cas : l'utilisateur relance le calcul, il n'y a pas de falsification.
          const versionDrift =
            recomputed.meta.engineVersion !== calc.engineVersion ||
            (calc.engineSourceHash != null &&
              recomputed.meta.engineSourceHash != null &&
              recomputed.meta.engineSourceHash !== calc.engineSourceHash);
          if (versionDrift) {
            throw new ConflictException(
              'Ce calcul a ete produit par une version anterieure du moteur : relancez le calcul avant d emettre le PV.',
            );
          }
          throw new ConflictException(
            'La sortie stockee ne correspond pas au recalcul serveur (alteration detectee) : emission du PV refusee.',
          );
        }

        // VERDICT (ADR 0012) — resolu depuis l'engineId scelle (registryId) et la
        // sortie persistee. FAIL-CLOSED : resolveVerdict LEVE si un moteur a
        // verdict booleen attendu (burmister/pieux) ne porte pas son drapeau ->
        // pas de PV (on refuse de sceller un verdict indetermine). Le verdict
        // entre dans le CONTENU CANONIQUE (champ de 1er niveau, scelle par le HMAC).
        const verdict = resolveVerdict(calc.engineId, calc.output);

        // CONTENU CANONIQUE : tout ce qui est scelle. sealedAt = chaine ISO.
        const content: SealableValue = {
          pvNumber,
          verdict,
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
            // Nom de l'emetteur + organisation : SCELLES (visa du PV = provenance).
            // Le PV est le livrable du bureau d'etudes -> l'organisation fait partie
            // de la provenance scellee, comme l'auteur. userDisplayName vide est
            // scelle tel quel ('') -> rendu « (identité non renseignée) ».
            userDisplayName,
            orgDisplayName: org.name,
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

        // DECOMPTE ATOMIQUE (ADR 0011 §3, TM-8) — UNIQUEMENT sur l'EMISSION REELLE.
        // On est ici APRES le check d'idempotence (existing renvoye plus haut) :
        // une re-emission idempotente N'ATTEINT JAMAIS ce point -> AUCUN 2e quota
        // brule (anti double-comptage). Le decompte est dans la MEME tx que
        // l'INSERT : quota epuise/expire -> 402 -> ROLLBACK -> pas de PV, pas de
        // conso. Une course (P2002) plus bas rollback AUSSI cette reservation.
        await this.subscriptions.reserveUnit(tx, {
          orgId,
          kind: 'PV',
          refId: args.calcResultId,
          userId: args.userId,
        });

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
            // Copie denormalisee de la valeur SCELLEE (verite = input_canonical).
            verdict,
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

  /**
   * Rend le PDF d'un PV du tenant. Passe par getViewById -> MEME isolation/RLS
   * et MEME 404 cross-org/hors-projet. Le PDF est régénérable (rendu depuis les
   * seules données scellées de l'official_pv).
   */
  async pdfForView(args: {
    projectId: string;
    pvId: string;
  }): Promise<{ pv: OfficialPv; pdf: Buffer }> {
    // getViewById -> signingSecret() : secret ABSENT = mauvaise config serveur
    // -> 503 (ServiceUnavailable), déjà géré en amont. Distinct du 409 ci-dessous.
    const { pv, sealValid } = await this.getViewById(args);
    // FAIL-CLOSED — REFUS DUR (CRIT-1, décision titulaire) : un PV « officiel » au
    // sceau cassé NE DOIT PAS exister en PDF (pas de tampon « invalide »). sealValid
    // est faux si verifySeal échoue (donnée altérée) OU si input_canonical est
    // illisible (le hash d'une canonique corrompue ne correspond plus) -> les deux
    // cas = anomalie d'intégrité = 409 Conflict. renderPvPdf re-vérifie en défense
    // en profondeur (il lèverait aussi). AUCUN rendu dégradé depuis la ligne.
    if (!sealValid) {
      throw new ConflictException(
        "Intégrité du PV non vérifiée — anomalie d'intégrité, contactez le support.",
      );
    }
    // Défense en profondeur : renderPvPdf re-vérifie le sceau ET re-parse la
    // canonique (fail-closed). Toute erreur d'intégrité résiduelle (ex. canonique
    // illisible dont le hash coïnciderait malgré tout) est mappée en 409, jamais
    // un 500 brut — cohérent avec le refus dur ci-dessus.
    try {
      const pdf = await renderPvPdf(pv);
      return { pv, pdf };
    } catch {
      throw new ConflictException(
        "Intégrité du PV non vérifiée — anomalie d'intégrité, contactez le support.",
      );
    }
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
