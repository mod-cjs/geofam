import { Body, Controller, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  BURMISTER_FIXTURES,
  findEngine,
  runBurmister,
  type BurmisterOutput,
} from '@roadsen/engines';
import { toSafeEngineError, type EngineResultEnvelope } from '@roadsen/shared';

import { Public } from '../auth/decorators';

import { BurmisterInputDto } from './dto/calc.dto';

/**
 * BurmisterController — recalcul SERVEUR du dimensionnement de chaussees
 * (methode rationnelle / AGEROUTE Senegal 2015, #46).
 *
 * `POST /calc/burmister` : valide l'entree contre le contrat #56
 * (ZodValidationPipe), puis recalcule cote serveur via @roadsen/engines (le
 * calcul confidentiel ne tourne JAMAIS dans le navigateur — DoD §8). Renvoie
 * l'enveloppe { ok, meta, output } ou la sortie est la WHITELIST stricte du
 * contrat (aucun intermediaire : ni contrainte brute, ni coefficient de fatigue).
 *
 * --- @Public (pilote #46, comme terzaghi #45) ---
 * L'endpoint est @Public pour ce PILOTE : le calcul ne lit aucune donnee tenant
 * et sert d'abord a prouver la chaine module->API. Le rattachement a un PV
 * (persistance + scellement, tenant) viendra avec le pipeline PV (dev-backend) ;
 * a ce moment l'endpoint passera sous garde tenant/RBAC. NON destine a la prod en
 * l'etat (cf. MJ-6 : pas de prod sans conformite cas-tests STARFIRE,
 * @science-unsigned).
 *
 * --- Erreurs ---
 * Une entree hors-schema -> 400 (ZodValidationPipe). Une exception MOTEUR
 * inattendue est reduite a un SafeEngineError borne (aucun intermediaire/stack
 * expose) et renvoyee dans une enveloppe { ok:false }.
 */
@ApiTags('calc')
@Controller('calc')
export class BurmisterController {
  @Public()
  @Post('burmister')
  @ApiOperation({
    summary:
      'Recalcul serveur — dimensionnement de chaussees (burmister, AGEROUTE Senegal 2015). Portage @science-unsigned.',
  })
  @ApiBody({
    type: BurmisterInputDto,
    examples: { demo: { value: BURMISTER_FIXTURES[0]?.input } },
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
  burmister(
    @Body() body: BurmisterInputDto,
  ): EngineResultEnvelope<BurmisterOutput> {
    try {
      return runBurmister(body);
    } catch (err) {
      // Garde-fou : aucune exception moteur ne doit deverser d'intermediaire.
      // On reduit a un code d'erreur borne (toSafeEngineError) et on renvoie une
      // enveloppe d'echec, avec la meta de version reelle (registre) pour la
      // tracabilite — sans aucun detail/stack.
      const entry = findEngine('chaussee-burmister');
      return {
        ok: false,
        meta: {
          engineId: 'chaussee-burmister',
          engineVersion: entry?.version ?? '0.0.0',
          ...(entry ? { engineSourceHash: entry.sha256 } : {}),
        },
        error: toSafeEngineError(err),
      };
    }
  }
}
