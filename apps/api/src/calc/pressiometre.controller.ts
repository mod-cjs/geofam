import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PressiometreInputSchema,
  findEngine,
  runPressiometre,
  type PressiometreInput,
  type PressiometreOutput,
} from '@roadsen/engines';
import { toSafeEngineError, type EngineResultEnvelope } from '@roadsen/shared';

import { Public } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

/**
 * PressiometreController — recalcul SERVEUR du depouillement pressiometrique
 * Menard (NF EN ISO 22476-4, #47).
 *
 * `POST /calc/pressiometre` : valide l'entree contre le contrat #56
 * (ZodValidationPipe), puis recalcule cote serveur via @roadsen/engines (le calcul
 * confidentiel ne tourne JAMAIS dans le navigateur — DoD §8). Renvoie l'enveloppe
 * { ok, meta, output } ou la sortie est la WHITELIST stricte du contrat (aucun
 * intermediaire : ni courbe corrigee, ni decomposition de contrainte, ni coefficient
 * de regression).
 *
 * --- @Public (pilote #47, comme terzaghi #45 / burmister #46) ---
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
export class PressiometreController {
  @Public()
  @Post('pressiometre')
  @ApiOperation({
    summary:
      'Recalcul serveur — depouillement pressiometrique Menard (NF EN ISO 22476-4). Portage @science-unsigned.',
  })
  pressiometre(
    @Body(new ZodValidationPipe(PressiometreInputSchema))
    body: PressiometreInput,
  ): EngineResultEnvelope<PressiometreOutput> {
    try {
      return runPressiometre(body);
    } catch (err) {
      // Garde-fou : aucune exception moteur ne doit deverser d'intermediaire. On
      // reduit a un code d'erreur borne (toSafeEngineError) et on renvoie une
      // enveloppe d'echec, avec la meta de version reelle (registre) pour la
      // tracabilite — sans aucun detail/stack.
      const entry = findEngine('pressiometre-menard');
      return {
        ok: false,
        meta: {
          engineId: 'pressiometre-menard',
          engineVersion: entry?.version ?? '0.0.0',
          ...(entry ? { engineSourceHash: entry.sha256 } : {}),
        },
        error: toSafeEngineError(err),
      };
    }
  }
}
