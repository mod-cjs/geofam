import {
  BadRequestException,
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
import { requireOrgId } from '../tenant/tenant-context';

import { findEngineDispatch, SUPPORTED_ENGINE_SLUGS } from './engine-dispatch';

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
  constructor(private readonly prisma: PrismaService) {}

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
      // Verifie l'existence du projet DANS le tenant (RLS scope deja la lecture).
      const project = await tx.project.findUnique({
        where: { id: args.projectId },
        select: { id: true },
      });
      if (!project) {
        throw new NotFoundException(
          'Projet introuvable dans cette organisation.',
        );
      }
      return tx.calcResult.create({
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
