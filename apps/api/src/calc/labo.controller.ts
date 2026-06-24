import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  LaboInputSchema,
  findEngine,
  runLabo,
  type LaboInput,
  type LaboOutput,
} from '@roadsen/engines';
import { toSafeEngineError, type EngineResultEnvelope } from '@roadsen/shared';

import { Public } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

/**
 * LaboController — recalcul SERVEUR des essais de laboratoire & classification GTR
 * (FASTLAB, NF P 11-300, #49-53).
 *
 * `POST /calc/labo` : valide l'entree contre le contrat #56 (ZodValidationPipe), puis
 * recalcule cote serveur via @roadsen/engines. Renvoie l'enveloppe { ok, meta, output }
 * ou la sortie est l'ensemble des resultats d'essais + la classe GTR (tout client-safe :
 * resultat de labo = livrable). La whitelist `.strict()` borne la forme (fail-closed sur
 * cle inconnue), DoD §8.
 *
 * --- @Public (pilote #49-53, comme #45/#46/#47/#48/#54) ---
 * Endpoint @Public pour ce PILOTE : aucune donnee tenant lue. Le rattachement a un PV
 * (persistance + scellement, tenant) viendra avec le pipeline PV ; l'endpoint passera
 * alors sous garde tenant/RBAC. NON destine a la prod en l'etat (MJ-6 : pas de prod sans
 * conformite cas-tests STARFIRE, @science-unsigned).
 *
 * --- Erreurs ---
 * Entree hors-schema -> 400 (ZodValidationPipe). Exception MOTEUR inattendue -> reduite
 * a un SafeEngineError borne (sans intermediaire/stack), enveloppe { ok:false }.
 */
@ApiTags('calc')
@Controller('calc')
export class LaboController {
  @Public()
  @Post('labo')
  @ApiOperation({
    summary:
      'Recalcul serveur — essais de labo & classification GTR (FASTLAB, NF P 11-300). Portage @science-unsigned.',
  })
  labo(
    @Body(new ZodValidationPipe(LaboInputSchema))
    body: LaboInput,
  ): EngineResultEnvelope<LaboOutput> {
    try {
      return runLabo(body);
    } catch (err) {
      const entry = findEngine('labo-classification-gtr');
      return {
        ok: false,
        meta: {
          engineId: 'labo-classification-gtr',
          engineVersion: entry?.version ?? '0.0.0',
          ...(entry ? { engineSourceHash: entry.sha256 } : {}),
        },
        error: toSafeEngineError(err),
      };
    }
  }
}
