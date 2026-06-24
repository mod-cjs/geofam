import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  RadierInputSchema,
  findEngine,
  runRadier,
  type RadierInput,
  type RadierOutput,
} from '@roadsen/engines';
import { toSafeEngineError, type EngineResultEnvelope } from '@roadsen/shared';

import { Public } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

/**
 * RadierController — recalcul SERVEUR du radier/plaque sur sol multicouche elastique
 * (elements finis, GEOPLAQUE, #54).
 *
 * `POST /calc/radier` : valide l'entree contre le contrat #56 (ZodValidationPipe), puis
 * recalcule cote serveur via @roadsen/engines (le calcul confidentiel — solveur EF
 * dense — ne tourne JAMAIS dans le navigateur, DoD §8). Renvoie l'enveloppe
 * { ok, meta, output } ou la sortie est la WHITELIST stricte du contrat : DIAGNOSTICS
 * uniquement (tassements/distorsions), AUCUN champ nodal ni topologie de maillage.
 *
 * --- @Public (pilote #54, comme #45/#46/#47/#48) ---
 * L'endpoint est @Public pour ce PILOTE : le calcul ne lit aucune donnee tenant et sert
 * d'abord a prouver la chaine module->API. Le rattachement a un PV (persistance +
 * scellement, tenant) viendra avec le pipeline PV (dev-backend) ; a ce moment l'endpoint
 * passera sous garde tenant/RBAC. NON destine a la prod en l'etat (MJ-6 : pas de prod
 * sans conformite cas-tests STARFIRE, @science-unsigned).
 *
 * --- Erreurs ---
 * Une entree hors-schema -> 400 (ZodValidationPipe). Une exception MOTEUR inattendue est
 * reduite a un SafeEngineError borne (aucun intermediaire/stack expose) et renvoyee dans
 * une enveloppe { ok:false }.
 */
@ApiTags('calc')
@Controller('calc')
export class RadierController {
  @Public()
  @Post('radier')
  @ApiOperation({
    summary:
      'Recalcul serveur — radier/plaque sur sol multicouche élastique (EF, GEOPLAQUE). Portage @science-unsigned.',
  })
  radier(
    @Body(new ZodValidationPipe(RadierInputSchema))
    body: RadierInput,
  ): EngineResultEnvelope<RadierOutput> {
    try {
      return runRadier(body);
    } catch (err) {
      // Garde-fou : aucune exception moteur ne doit deverser d'intermediaire. On reduit
      // a un code d'erreur borne (toSafeEngineError) et on renvoie une enveloppe d'echec,
      // avec la meta de version reelle (registre) pour la tracabilite — sans detail/stack.
      const entry = findEngine('radier-plaque');
      return {
        ok: false,
        meta: {
          engineId: 'radier-plaque',
          engineVersion: entry?.version ?? '0.0.0',
          ...(entry ? { engineSourceHash: entry.sha256 } : {}),
        },
        error: toSafeEngineError(err),
      };
    }
  }
}
