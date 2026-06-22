import { HealthStatusSchema } from '@roadsen/shared';
import { createZodDto } from 'nestjs-zod';

/**
 * DTO de reponse de la sonde de sante, derive DIRECTEMENT du schema partage
 * `@roadsen/shared` (aucune duplication de la forme). `createZodDto` permet en
 * plus a `@nestjs/swagger` d'exposer ce schema dans le document OpenAPI une fois
 * `cleanupOpenApiDoc()` applique au document (cf. app.config.ts, nestjs-zod v5).
 */
export class HealthStatusDto extends createZodDto(HealthStatusSchema) {}
