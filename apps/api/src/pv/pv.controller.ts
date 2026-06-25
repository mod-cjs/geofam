import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { OfficialPv } from '@prisma/client';
import { z } from 'zod';

import { Roles } from '../auth/decorators';
import type { AuthedRequest } from '../auth/request-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

import type { PersistedCalcResult } from './calc-results.service';
import { CalcResultsService } from './calc-results.service';
import type { OfficialPvView } from './pv.service';
import { PvService } from './pv.service';

// UUID des parametres de chemin (defense en profondeur : un id malforme -> 400,
// jamais une requete base avec une valeur non-uuid).
const uuidParam = z.string().uuid();

/**
 * PvController — surface TENANT du pipeline PV (#63, incr. B).
 *
 * TOUTES les routes sont authentifiees + tenant (chaine de gardes globale :
 * JwtAuthGuard -> TenantGuard -> RolesGuard, cf. AppModule). AUCUN @Public ni
 * @NoTenant : un token verifie ET une appartenance a l'org (x-org-id) sont
 * exiges. La surface RECETTE (`/calc/*`, @Public derriere X-Recette-Key) reste
 * INCHANGEE et distincte (decision titulaire : deux surfaces separees).
 *
 * RBAC :
 *  - calcul persistant : OWNER/ADMIN/ENGINEER/TECHNICIAN (un technicien-sondeur
 *    saisit/lance des calculs) ;
 *  - emission de PV     : OWNER/ADMIN/ENGINEER (acte d'ingenierie ; un TECHNICIAN
 *    ne scelle pas un PV officiel) ;
 *  - lecture            : tous les roles tenant (consultation).
 */
@ApiTags('pv')
@Controller('projects/:projectId')
export class PvController {
  constructor(
    private readonly calcResults: CalcResultsService,
    private readonly pv: PvService,
  ) {}

  /**
   * POST /projects/:projectId/calc/:engine — recalcul SERVEUR persistant.
   * Valide le corps contre le contrat du moteur (meme run<Engine> que la recette),
   * persiste un calc_result org-scope, renvoie l'enveloppe + calcResultId.
   */
  @Post('calc/:engine')
  @Roles('OWNER', 'ADMIN', 'ENGINEER', 'TECHNICIAN', 'SUPERADMIN')
  @ApiOperation({
    summary:
      'Recalcul serveur PERSISTANT (surface tenant) : execute le moteur et stocke un calc_result org-scope.',
  })
  runCalc(
    @Param('projectId', new ZodValidationPipe(uuidParam)) projectId: string,
    @Param('engine') engine: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<PersistedCalcResult> {
    return this.calcResults.runAndPersist({
      engineSlug: engine,
      projectId,
      userId: req.auth!.userId, // identite JWT verifiee (jamais une valeur cliente)
      body,
    });
  }

  /**
   * POST /projects/:projectId/calc-results/:id/pv — emission du PV officiel.
   * Idempotent : re-emettre le meme calcul renvoie le PV existant (pas de
   * nouveau numero).
   */
  @Post('calc-results/:id/pv')
  @Roles('OWNER', 'ADMIN', 'ENGINEER', 'SUPERADMIN')
  @ApiOperation({
    summary:
      'Emet (ou renvoie si deja emis) le PV officiel scelle d un calc_result. Idempotent.',
  })
  emitPv(
    @Param('projectId', new ZodValidationPipe(uuidParam)) projectId: string,
    @Param('id', new ZodValidationPipe(uuidParam)) calcResultId: string,
    @Req() req: AuthedRequest,
  ): Promise<OfficialPv> {
    return this.pv.emitFromCalc({
      calcResultId,
      projectId,
      userId: req.auth!.userId,
    });
  }

  /**
   * GET /projects/:projectId/pvs/:pvId — lit un PV + verdict de sceau (sealValid),
   * recalcule en re-verifiant le sceau stocke contre input_canonical.
   */
  @Get('pvs/:pvId')
  @Roles('OWNER', 'ADMIN', 'ENGINEER', 'TECHNICIAN', 'VIEWER', 'SUPERADMIN')
  @ApiOperation({
    summary: 'Lit un PV officiel et son verdict d integrite (sealValid).',
  })
  getPv(
    @Param('projectId', new ZodValidationPipe(uuidParam)) projectId: string,
    @Param('pvId', new ZodValidationPipe(uuidParam)) pvId: string,
  ): Promise<OfficialPvView> {
    return this.pv.getViewById({ projectId, pvId });
  }

  /** GET /projects/:projectId/pvs — liste les PV du projet (chacun avec sealValid). */
  @Get('pvs')
  @Roles('OWNER', 'ADMIN', 'ENGINEER', 'TECHNICIAN', 'VIEWER', 'SUPERADMIN')
  @ApiOperation({ summary: 'Liste les PV officiels d un projet.' })
  listPvs(
    @Param('projectId', new ZodValidationPipe(uuidParam)) projectId: string,
  ): Promise<OfficialPvView[]> {
    return this.pv.listForProject(projectId);
  }
}
