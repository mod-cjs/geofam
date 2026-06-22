import { Controller, Get, Version } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { HealthStatusSchema } from '@roadsen/shared';
import type { HealthStatus } from '@roadsen/shared';

import { Public } from '../auth/decorators';

import { HealthStatusDto } from './health.dto';

/**
 * HealthController — sonde de sante de l'API. @Public (pas de token) et NON
 * tenant. Versionnee : @Version('1') -> `GET /v1/health`.
 *
 * La reponse est CONSTRUITE puis validee contre le schema partage
 * `@roadsen/shared` : la forme `{status:'ok'}` n'est definie qu'a un seul
 * endroit (preuve d'usage d'un schema partage dans un handler, sans duplication).
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
    return HealthStatusSchema.parse({ status: 'ok' });
  }
}
