import { Body, Controller, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  TERZAGHI_FIXTURES,
  findEngine,
  runTerzaghi,
  type TerzaghiOutput,
} from '@roadsen/engines';
import { toSafeEngineError, type EngineResultEnvelope } from '@roadsen/shared';

import { Public } from '../auth/decorators';

import { TerzaghiInputDto } from './dto/calc.dto';

/**
 * TerzaghiController — recalcul SERVEUR de la fondation superficielle (NF P 94-261).
 *
 * `POST /calc/terzaghi` : valide l'entree contre le contrat #56 (ZodValidationPipe),
 * puis recalcule cote serveur via @roadsen/engines (le calcul confidentiel ne
 * tourne JAMAIS dans le navigateur — DoD §8). Renvoie l'enveloppe { ok, meta,
 * output } ou la sortie est la WHITELIST stricte du contrat (aucun intermediaire).
 *
 * --- @Public (pilote #45) ---
 * L'endpoint est @Public pour ce PILOTE : le calcul ne lit aucune donnee tenant
 * et sert d'abord a prouver la chaine module->API. Le rattachement a un PV
 * (persistance + scellement, tenant) viendra avec le pipeline PV (dev-backend) ;
 * a ce moment l'endpoint passera sous garde tenant/RBAC. NON destine a la prod en
 * l'etat (cf. MJ-6 : pas de prod sans conformite cas-tests STARFIRE).
 *
 * --- Erreurs ---
 * Une entree hors-schema -> 400 (ZodValidationPipe). Une exception MOTEUR
 * inattendue est reduite a un SafeEngineError borne (aucun intermediaire/stack
 * expose) et renvoyee dans une enveloppe { ok:false }.
 */
@ApiTags('calc')
@Controller('calc')
export class TerzaghiController {
  @Public()
  @Post('terzaghi')
  @ApiOperation({
    summary:
      'Recalcul serveur — fondation superficielle (terzaghi, NF P 94-261). Portage @science-unsigned.',
  })
  @ApiBody({
    type: TerzaghiInputDto,
    // Exemple « Try it out » pre-rempli, SOURCE de la fixture de portage (#45)
    // TERZAGHI_FIXTURES[0].input : ENTREES uniquement (client-safe, DoD §8) — on
    // ne reference jamais .output. Nomme clairement pour la recette STARFIRE.
    examples: {
      'fondation-superficielle-cas-de-reference': {
        summary: 'Fondation superficielle — cas de référence (NF P 94-261)',
        value: TERZAGHI_FIXTURES[0]?.input,
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Enveloppe { ok, meta, output } (recalcul serveur).',
  })
  @ApiResponse({
    status: 400,
    description: 'Entree hors-contrat (validation Zod).',
  })
  @ApiResponse({
    status: 401,
    description: 'Cle d acces recette absente/invalide.',
  })
  terzaghi(
    @Body() body: TerzaghiInputDto,
  ): EngineResultEnvelope<TerzaghiOutput> {
    try {
      return runTerzaghi(body);
    } catch (err) {
      // Garde-fou : aucune exception moteur ne doit deverser d'intermediaire.
      // On reduit a un code d'erreur borne (toSafeEngineError) et on renvoie une
      // enveloppe d'echec, avec la meta de version reelle (registre) pour la
      // tracabilite — sans aucun detail/stack.
      const entry = findEngine('fondation-superficielle');
      return {
        ok: false,
        meta: {
          engineId: 'fondation-superficielle',
          engineVersion: entry?.version ?? '0.0.0',
          ...(entry ? { engineSourceHash: entry.sha256 } : {}),
        },
        error: toSafeEngineError(err),
      };
    }
  }
}
