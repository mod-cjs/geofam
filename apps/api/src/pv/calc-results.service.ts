import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CalcResult } from '@prisma/client';
import { findEngine } from '@roadsen/engines';
import {
  projectEngineInput,
  projectEngineOutput,
  type EngineResultMeta,
} from '@roadsen/shared';

import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { requireOrgId } from '../tenant/tenant-context';

import { findEngineDispatch, SUPPORTED_ENGINE_SLUGS } from './engine-dispatch';
import { assertProjetEcrivable } from './project-write-guard';

/** Resultat d'un calcul tenant persiste : enveloppe + id de la ligne stockee. */
export interface PersistedCalcResult {
  calcResultId: string;
  ok: boolean;
  meta: EngineResultMeta;
  output: unknown;
}

/**
 * CalcResultsService — CALCUL TENANT persistant (#63, incr. B).
 *
 * Pour un projet du tenant courant : valide l'entree contre le contrat Zod du
 * moteur (le MEME que la surface recette), execute le MEME `run<Engine>`
 * (equivalence preservee), puis persiste un `calc_result` ORG-SCOPE via withTenant
 * (RLS + WITH CHECK garantissent que la ligne appartient bien au tenant courant).
 *
 * Ce qui est PERSISTE est PROJETE (whitelist @roadsen/shared) :
 *  - `input`  = projectEngineInput(contract.inputSchema, body) -> seules les cles
 *    declarees du contrat survivent (aucun champ parasite du client) ;
 *  - `output` = projectEngineOutput(contract.outputSchema, enveloppe.output) ->
 *    whitelist stricte (aucun intermediaire de calcul ne fuit en base, DoD §8).
 *
 * En cas d'echec moteur (enveloppe { ok:false }), on NE persiste PAS de calcul
 * (rien a sceller plus tard) : on renvoie l'erreur bornee a l'appelant.
 */
@Injectable()
export class CalcResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * Execute le moteur `engineSlug` sur `body` pour `projectId` et persiste le
   * resultat (si succes). `userId` vient de l'identite JWT verifiee (jamais du client).
   *
   * @throws BadRequestException si le slug moteur est inconnu, ou si l'entree ne
   *   satisfait pas le contrat (projection -> ZodError -> 400).
   * @throws NotFoundException si le projet n'existe pas dans le tenant courant.
   */
  async runAndPersist(args: {
    engineSlug: string;
    projectId: string;
    userId: string;
    body: unknown;
  }): Promise<PersistedCalcResult> {
    const orgId = requireOrgId();
    const dispatch = findEngineDispatch(args.engineSlug);
    if (!dispatch) {
      throw new BadRequestException(
        `Moteur inconnu : « ${args.engineSlug} ». Moteurs supportes : ${SUPPORTED_ENGINE_SLUGS.join(', ')}.`,
      );
    }

    // PROJECTION D'ENTREE (whitelist) : ne persiste que les cles du contrat. Une
    // entree hors-contrat leve une ZodError -> 400 (BadRequest) via le pipe global.
    let projectedInput: unknown;
    try {
      projectedInput = projectEngineInput(
        dispatch.contract.inputSchema,
        args.body,
      );
    } catch (err) {
      throw toBadRequest(err);
    }

    // RECALCUL SERVEUR : meme run<Engine> que la recette (equivalence). On lui
    // passe l'entree PROJETEE (ce qui sera scelle plus tard = ce qui a calcule).
    const envelope = dispatch.run(projectedInput);

    if (!envelope.ok) {
      // Echec moteur borne : rien a persister. On renvoie l'enveloppe d'echec
      // (l'appelant la retransmet ; aucun intermediaire ne fuit, cf. run<Engine>).
      return {
        calcResultId: '',
        ok: false,
        meta: envelope.meta,
        output: undefined,
      };
    }

    // PROJECTION DE SORTIE (whitelist stricte) avant persistance. Le contrat
    // generique rend `any` (z.ZodTypeAny) ; on confine en `unknown` (la forme
    // exacte n'importe pas ici : on persiste/scelle la projection telle quelle).
    const projectedOutput: unknown = projectEngineOutput(
      dispatch.contract.outputSchema,
      envelope.output,
    );

    // GARDE FAIL-CLOSED (revue adverse B1) : certains moteurs (radier, plane-strain,
    // tri-raft) encodent un ECHEC de garde dans `output.erreur` avec ok:true + diagnostics
    // a ZERO (contrairement a axi qui renvoie ok:false). Persister/sceller cela produirait
    // un PV de zeros (DoD §5) et bruleraut du quota (DoD §9). Un output porteur d'une erreur
    // = calcul ECHOUE : rien n'est persiste (meme traitement que !envelope.ok ; aucun
    // intermediaire ni message brut ne fuit, cf. §8).
    if (
      projectedOutput != null &&
      typeof projectedOutput === 'object' &&
      (projectedOutput as { erreur?: unknown }).erreur != null
    ) {
      return {
        calcResultId: '',
        ok: false,
        meta: envelope.meta,
        output: undefined,
      };
    }

    // Meta de tracabilite : la version/sha256 du REGISTRE est la source de verite
    // (les sorties moteur la portent deja via meta ; elles concordent par
    // construction). On la fige dans `meta` ET dans la ligne persistee pour qu'un
    // PV ulterieur scelle EXACTEMENT la version qui a calcule.
    const registry = findEngine(dispatch.registryId);
    const meta: EngineResultMeta = {
      engineId: envelope.meta.engineId,
      engineVersion: registry?.version ?? envelope.meta.engineVersion,
      ...(registry?.sha256
        ? { engineSourceHash: registry.sha256 }
        : envelope.meta.engineSourceHash
          ? { engineSourceHash: envelope.meta.engineSourceHash }
          : {}),
    };

    const created = await this.prisma.withTenant(orgId, async (tx) => {
      // Le projet doit exister DANS le tenant (RLS scope deja la lecture) ET ne pas
      // etre ARCHIVE. Sans le filtre de statut, on BRULAIT DU QUOTA (reserveUnit +
      // ledger APPEND-ONLY, donc irreversible) sur un projet que l'utilisateur croit
      // supprime — et invisible dans toutes les listes. 404 tenant-safe et uniforme
      // (cf. assertProjetEcrivable).
      await assertProjetEcrivable(tx, args.projectId);

      // INSERT du calcul d'abord (on a son id pour tracer le ledger), puis
      // DECOMPTE ATOMIQUE (ADR 0011 §3) — TOUT dans CETTE transaction tenant :
      //  - le calcul a REUSSI (on n'arrive ici que sur envelope.ok) ;
      //  - reserveUnit incremente conditionnellement le quota (WHERE consommation
      //    < quota AND now() <= date_fin) et insere la ligne de ledger ;
      //  - 0 ligne reservee -> 402 (QUOTA/EXPIRED) -> la tx ROLLBACK -> le calcul
      //    n'est PAS persiste et RIEN n'est consomme (anti depassement + TM-5).
      // L'ordre INSERT-puis-reserve est sans incidence sur l'atomicite (meme tx) ;
      // il donne juste refId = id du calcul pour la tracabilite du ledger.
      const row = await tx.calcResult.create({
        data: {
          orgId,
          projectId: args.projectId,
          userId: args.userId,
          engineId: meta.engineId,
          engineVersion: meta.engineVersion,
          engineSourceHash: meta.engineSourceHash ?? null,
          input: projectedInput as object,
          output: projectedOutput as object,
        },
        select: { id: true },
      });

      await this.subscriptions.reserveUnit(tx, {
        orgId,
        kind: 'CALC',
        refId: row.id,
        userId: args.userId,
      });

      return row;
    });

    return {
      calcResultId: created.id,
      ok: true,
      meta,
      output: projectedOutput,
    };
  }

  /** Lit un calc_result du tenant courant (RLS scope). Null si absent/hors tenant. */
  getById(calcResultId: string): Promise<CalcResult | null> {
    const orgId = requireOrgId();
    return this.prisma.withTenant(orgId, (tx) =>
      tx.calcResult.findUnique({ where: { id: calcResultId } }),
    );
  }

  /**
   * Liste les calc_results d'un projet du tenant courant (RLS scope, plus recent
   * d'abord). Un projet d'un AUTRE org est invisible -> liste vide (jamais une
   * fuite cross-tenant) : aucune distinction entre « projet vide » et « projet
   * d'un autre org » (tenant-safe). La preuve d'isolation reelle est aux e2e.
   */
  listForProject(
    projectId: string,
  ): Promise<Array<CalcResult & { pvId: string | null }>> {
    const orgId = requireOrgId();
    return this.prisma.withTenant(orgId, async (tx) => {
      const calcs = await tx.calcResult.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      });
      if (calcs.length === 0) return [];
      // pvId par calcul — indispensable au front pour distinguer l'etat SCELLE
      // (bouton « Voir le PV »/« Imprimer ») de l'etat NON scelle (« Sceller »).
      // 2e requete (pas de relation Prisma OfficialPv->CalcResult : le PV garde
      // calcResultId en colonne simple pour survivre a la suppression du calcul).
      // RLS-scopee (withTenant) + bornee aux ids du tenant courant : aucune fuite.
      // On ne selectionne QUE id + calcResultId (jamais document_html : bande
      // passante, cf. B1-bis).
      const pvs = await tx.officialPv.findMany({
        where: { calcResultId: { in: calcs.map((c) => c.id) } },
        select: { id: true, calcResultId: true },
      });
      const pvByCalc = new Map(pvs.map((p) => [p.calcResultId, p.id]));
      return calcs.map((c) => ({ ...c, pvId: pvByCalc.get(c.id) ?? null }));
    });
  }

  /**
   * Lit UN calc_result d'un projet du tenant courant (master-detail).
   * @throws NotFoundException si le calcul n'existe pas dans le tenant courant
   *   OU n'appartient pas a `projectId` : meme 404 « introuvable » pour les deux
   *   cas (tenant-safe, anti-enumeration ; calque sur PvService.getViewById).
   *   La RLS rend deja invisible un calcul d'un autre org (findUnique -> null) ;
   *   le check projectId barre un calcul d'un AUTRE projet du MEME org.
   */
  async getForProject(args: {
    projectId: string;
    calcResultId: string;
  }): Promise<CalcResult> {
    const orgId = requireOrgId();
    const calc = await this.prisma.withTenant(orgId, (tx) =>
      tx.calcResult.findUnique({ where: { id: args.calcResultId } }),
    );
    if (!calc || calc.projectId !== args.projectId) {
      throw new NotFoundException(
        'Calcul introuvable dans ce projet/cette organisation.',
      );
    }
    return calc;
  }

  /**
   * Renomme l'ETIQUETTE d'affichage d'un calcul du tenant courant (PATCH
   * calc-results/:id). `name` = libelle MUTABLE ; `null` revient au mnemonique
   * calcule cote front. Le calcul reste par ailleurs immuable dans son CONTENU
   * (input/output/meta) : on ne touche QUE `name`.
   *
   * updateMany (et non update) : sur une ligne ABSENTE, HORS-TENANT (RLS
   * invisible) ou d'un AUTRE projet du meme org, il renvoie count=0 SANS lever
   * (update leverait P2025) -> `null`, traduit en 404 tenant-safe par le
   * controleur (anti-enumeration : « n'existe pas » et « pas chez vous »
   * indistinguables). Le predicat `projectId` barre un calcul d'un autre projet
   * du meme org ; la RLS (withTenant) barre le cross-org. WITH CHECK cote base
   * interdit tout deplacement d'org. Renvoie le calcul a jour (re-lu sous RLS).
   */
  async rename(args: {
    projectId: string;
    calcResultId: string;
    name: string | null;
  }): Promise<CalcResult | null> {
    // PROJET ARCHIVE — DECISION EXPLICITE (revue ingenieur-securite, E1) : le
    // renommage reste AUTORISE. Contrairement a la suppression (destructive) et
    // a l'emission de PV (qui brule un numero et du quota), renommer ne modifie
    // qu'une ETIQUETTE d'affichage : rien n'est detruit, aucun livrable ne bouge,
    // et un projet archive est RESTAURABLE — pouvoir ranger ses libelles avant
    // de restaurer est legitime. On n'appelle donc pas assertProjetEcrivable ici,
    // et c'est voulu, pas un oubli.
    const orgId = requireOrgId();
    return this.prisma.withTenant(orgId, async (tx) => {
      const res = await tx.calcResult.updateMany({
        where: { id: args.calcResultId, projectId: args.projectId },
        data: { name: args.name },
      });
      if (res.count === 0) return null;
      return tx.calcResult.findUnique({ where: { id: args.calcResultId } });
    });
  }

  /**
   * Supprime un calcul NON scelle du tenant courant (DELETE calc-results/:id).
   *
   * REFUS 409 SI UN PV SCELLE EXISTE pour ce calcul : official_pvs est
   * AUTOPORTANT (aucune FK vivante vers calc_results) donc rien ne casserait
   * techniquement — mais la source d'un livrable scelle ne se detruit pas (on
   * garde la tracabilite du calcul qui a produit le PV). L'utilisateur voit un
   * message exploitable. 404 tenant-safe sinon (absent / hors tenant / autre
   * projet, indistinguables).
   *
   * VERROU projet FOR UPDATE en TOUT PREMIER (meme raison que
   * ProjectsService.deletePermanently) : il est INCOMPATIBLE avec le FOR SHARE
   * que l'emission de PV pose sur le projet (assertProjetEcrivable). Une emission
   * en vol sur ce projet fait donc ATTENDRE cette suppression, qui voit ensuite
   * le PV -> 409 ; et si la suppression passe la premiere, l'emission reprend,
   * relit un calcul disparu -> 404. Sans ce verrou, on pouvait compter 0 PV,
   * supprimer le calcul, commiter, et laisser une emission concurrente inserer un
   * PV scelle dont le calcul source n'existe plus. ORDRE DES VERROUS : projet
   * d'abord, enfants (calc_snapshots -> calc_results) ensuite — memes regle
   * anti-interblocage que deletePermanently.
   *
   * LEDGER DE FACTURATION : on n'y touche PAS. Les lignes usage_ledger et la
   * `consommation` de l'abonnement restent telles quelles — le quota deja
   * consomme reste consomme (registre append-only, jamais reecrit
   * retroactivement, meme quand l'objet calcule disparait).
   *
   * @returns le calcul tel qu'il etait avant destruction, ou `null` (404).
   * @throws ConflictException si un PV scelle existe pour ce calcul.
   */
  async deleteUnsealed(args: {
    projectId: string;
    calcResultId: string;
  }): Promise<CalcResult | null> {
    const orgId = requireOrgId();
    return this.prisma.withTenant(orgId, async (tx) => {
      // VERROU projet FOR UPDATE — PREMIER ordre de la transaction. RLS-scope : un
      // projet d'un AUTRE org est INVISIBLE -> 0 ligne -> 404. $queryRaw car on a
      // besoin de la PRESENCE de la ligne (pas d'un compte d'affectations).
      //
      // `status <> 'ARCHIVED'` (revue ingenieur-securite, E1) : supprimer est une
      // ECRITURE, et un projet archive est « supprime » cote metier — invisible
      // dans toutes les listes. Sans ce predicat, on detruisait des calculs dans
      // un projet que l'interface presente comme supprime : exactement le defaut
      // ferme en PR #120/#121, que ce nouveau point d'ecriture reintroduisait.
      // Meme regle que project-write-guard ; ici en SQL brut car Prisma n'expose
      // pas FOR UPDATE, mais le predicat de statut doit rester identique.
      const verrou = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM projects
         WHERE id = ${args.projectId}::uuid
           AND status <> 'ARCHIVED'
         FOR UPDATE
      `;
      if (verrou.length === 0) return null;

      // Le calcul doit exister DANS ce projet/ce tenant (RLS scope la lecture).
      const calc = await tx.calcResult.findUnique({
        where: { id: args.calcResultId },
      });
      if (!calc || calc.projectId !== args.projectId) return null;

      // REFUS DUR : un seul PV scelle interdit la destruction. Le comptage est
      // SOUS le verrou projet -> aucune emission ne peut inserer un PV en vol
      // sans avoir d'abord attendu (FOR SHARE incompatible).
      const pvs = await tx.officialPv.count({
        where: { calcResultId: args.calcResultId },
      });
      if (pvs > 0) {
        throw new ConflictException(
          'Ce calcul a été scellé en PV officiel : sa suppression est refusée ' +
            "(on ne détruit pas la source d'un livrable scellé). Le calcul reste " +
            'conservé tant que son PV existe.',
        );
      }

      // Enfants d'abord (la capture liee), puis le calcul — chaque DELETE sous RLS.
      // deleteMany (et non delete) : sur une ligne devenue invisible entre-temps,
      // il renvoie count=0 SANS lever (delete leverait P2025) -> null -> 404.
      await tx.calcSnapshot.deleteMany({
        where: { calcResultId: args.calcResultId },
      });
      const res = await tx.calcResult.deleteMany({
        where: { id: args.calcResultId, projectId: args.projectId },
      });
      if (res.count === 0) return null;
      return calc;
    });
  }
}

/** Convertit une ZodError (ou autre) en 400 borne, sans divulguer la valeur recue. */
function toBadRequest(err: unknown): BadRequestException {
  const zerr = err as {
    issues?: Array<{ path: (string | number)[]; code: string }>;
  };
  if (Array.isArray(zerr.issues)) {
    // On ne renvoie que des chemins/codes (jamais la valeur fautive) — meme
    // discipline que le ZodValidationPipe global.
    const details = zerr.issues.map((i) => ({ path: i.path, code: i.code }));
    return new BadRequestException({
      message: 'Entree hors-contrat moteur.',
      details,
    });
  }
  return new BadRequestException('Entree hors-contrat moteur.');
}
