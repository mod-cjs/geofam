import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PieuxInputSchema,
  findEngine,
  runPieux,
  type PieuxInput,
  type PieuxOutput,
} from '@roadsen/engines';
import { toSafeEngineError, type EngineResultEnvelope } from '@roadsen/shared';

import { Public } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

/**
 * PieuxController — recalcul SERVEUR de la portance de pieu / fondations profondes
 * (NF P 94-262, EC7, #48).
 *
 * `POST /calc/pieux` : valide l'entree contre le contrat #56 (ZodValidationPipe),
 * puis recalcule cote serveur via @roadsen/engines (le calcul confidentiel ne tourne
 * JAMAIS dans le navigateur — DoD §8). Renvoie l'enveloppe { ok, meta, output } ou la
 * sortie est la WHITELIST stricte du contrat (aucun intermediaire : ni terme de
 * pointe, ni facteur de portance, ni detail de frottement par couche, ni courbe de
 * tassement).
 *
 * --- @Public (pilote #48, comme terzaghi #45 / burmister #46 / pressiometre #47) ---
 * L'endpoint est @Public pour ce PILOTE : le calcul ne lit aucune donnee tenant et
 * sert d'abord a prouver la chaine module->API. Le rattachement a un PV (persistance
 * + scellement, tenant) viendra avec le pipeline PV (dev-backend) ; a ce moment
 * l'endpoint passera sous garde tenant/RBAC. NON destine a la prod en l'etat (cf.
 * MJ-6 : pas de prod sans conformite cas-tests STARFIRE, @science-unsigned).
 *
 * --- Erreurs ---
 * Une entree hors-schema -> 400 (ZodValidationPipe). Une exception MOTEUR inattendue
 * est reduite a un SafeEngineError borne (aucun intermediaire/stack expose) et
 * renvoyee dans une enveloppe { ok:false }.
 */
@ApiTags('calc')
@Controller('calc')
export class PieuxController {
  @Public()
  @Post('pieux')
  @ApiOperation({
    summary:
      'Recalcul serveur — portance de pieu / fondations profondes (NF P 94-262, EC7). Portage @science-unsigned.',
  })
  pieux(
    @Body(new ZodValidationPipe(PieuxInputSchema))
    body: PieuxInput,
  ): EngineResultEnvelope<PieuxOutput> {
    try {
      return runPieux(body);
    } catch (err) {
      // Garde-fou : aucune exception moteur ne doit deverser d'intermediaire. On
      // reduit a un code d'erreur borne (toSafeEngineError) et on renvoie une
      // enveloppe d'echec, avec la meta de version reelle (registre) pour la
      // tracabilite — sans aucun detail/stack.
      const entry = findEngine('fondation-profonde-pieux');
      return {
        ok: false,
        meta: {
          engineId: 'fondation-profonde-pieux',
          engineVersion: entry?.version ?? '0.0.0',
          ...(entry ? { engineSourceHash: entry.sha256 } : {}),
        },
        error: toSafeEngineError(err),
      };
    }
  }
}
