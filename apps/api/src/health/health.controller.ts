import { Controller, Get, Version } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { HealthStatusSchema } from '@roadsen/shared';
import type { HealthStatus } from '@roadsen/shared';

import { Public } from '../auth/decorators';
import { getDeployEnv, getScienceStatus } from '../recette/recette.config';

import { HealthStatusDto } from './health.dto';

/**
 * HealthController — sonde de sante de l'API. @Public (pas de token) et NON
 * tenant. Versionnee : @Version('1') -> `GET /v1/health`.
 *
 * La reponse est CONSTRUITE puis validee contre le schema partage
 * `@roadsen/shared` : la forme est definie a un seul endroit (preuve d'usage
 * d'un schema partage dans un handler, sans duplication). On y ajoute `env` et
 * `science` (champs optionnels du contrat) pour que l'environnement et l'etat
 * scientifique soient identifiables a la sonde : en recette, `science:'unsigned'`
 * rappelle que la justesse n'est pas validee (MJ-6).
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Public()
  @Version('1')
  @Get()
  @ApiOkResponse({ type: HealthStatusDto })
  check(): HealthStatus {
    // Validation de SORTIE contre le contrat partage : si la forme derivait du
    // contrat, on echouerait ici plutot que de livrer une reponse hors-contrat.
    return HealthStatusSchema.parse({
      status: 'ok',
      env: getDeployEnv(),
      science: getScienceStatus(),
    });
  }
}
