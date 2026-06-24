import { VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ZodValidationPipe, cleanupOpenApiDoc } from 'nestjs-zod';

import { AllExceptionsFilter } from './common/http-exception.filter';
import { getDeployEnv, getScienceStatus } from './recette/recette.config';

/**
 * Configuration GLOBALE de l'API, en UN seul endroit. `main.ts` (runtime) ET
 * les tests e2e l'appellent -> l'app testee est bootstrapee EXACTEMENT comme la
 * prod (pas de derive test<->runtime : pipe, filtre, versionnage, OpenAPI).
 *
 * On NE fait PAS `app.listen` ici : l'ecoute reseau reste au seul `main.ts`.
 */
export function configureApp(app: INestApplication): void {
  // FAIL-FAST SECURITE : la voie en-tetes de DEV (x-org-id / x-user-id) court-
  // circuite le TenantGuard (cf. tenant-context.middleware). Le middleware
  // l'ignore deja si NODE_ENV === 'production', MAIS une telle config (var
  // ROADSEN_DEV_HEADERS=1 fuitee en prod) est une erreur de deploiement grave
  // qui ne doit PAS demarrer silencieusement. On REFUSE le boot : defense en
  // profondeur (le runtime-guard du middleware reste, ceci en est la 2e barriere).
  assertNoDevHeadersInProd();

  // Validation Zod GLOBALE (nestjs-zod) : valide les DTO createZodDto a la
  // frontiere. Les controleurs existants gardent leur pipe explicite par route
  // (meme philosophie Zod) ; les deux coexistent sans double validation.
  app.useGlobalPipes(new ZodValidationPipe());

  // Format d'erreur STANDARD pour toute l'API (cf. AllExceptionsFilter).
  app.useGlobalFilters(new AllExceptionsFilter());

  // Versionnage d'URI : seules les routes @Version('n') sont prefixees (/v1/...).
  // Les routes non versionnees (/, /auth, /projects, /docs) restent inchangees.
  app.enableVersioning({ type: VersioningType.URI });

  // OpenAPI / Swagger : UI sur /docs, document JSON sur /docs-json.
  const config = new DocumentBuilder()
    .setTitle('ROADSEN API')
    .setDescription(buildApiDescription())
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  // cleanupOpenApiDoc (nestjs-zod v5) post-traite le document pour y injecter
  // les schemas derives des createZodDto (remplace l'ancien patchNestJsSwagger).
  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
  // En PRODUCTION, on n'expose PAS /docs + /docs-json par defaut : c'est une
  // surface d'API anonyme (fuite d'information). Activable explicitement via
  // ROADSEN_EXPOSE_DOCS=1. Hors prod (dev/test), toujours expose.
  if (
    process.env.NODE_ENV !== 'production' ||
    process.env.ROADSEN_EXPOSE_DOCS === '1'
  ) {
    SwaggerModule.setup('docs', app, document);
  }
}

/**
 * Construit la description OpenAPI. En RECETTE (science non signee), on prefixe
 * une BANNIERE d'avertissement bien visible : justesse non validee (kit cas-tests
 * STARFIRE en attente), interdit en production (MJ-6). En production avec science
 * signee, on s'en tient a la description neutre.
 */
export function buildApiDescription(): string {
  const base = 'Plateforme de calcul geotechnique & routier (multi-tenant).';
  if (getDeployEnv() === 'recette' || getScienceStatus() === 'unsigned') {
    return (
      '[RECETTE — @science-unsigned] Justesse NON validee ' +
      '(kit cas-tests STARFIRE en attente). NE PAS UTILISER EN PRODUCTION (MJ-6).\n\n' +
      base
    );
  }
  return base;
}

/**
 * Refuse le demarrage si la voie en-tetes de DEV est activee EN PRODUCTION.
 * Une var d'environnement de dev qui fuit en prod = contournement total du
 * cloisonnement multi-tenant : on echoue FORT au boot plutot que de tourner
 * avec une porte ouverte. Exporte pour etre testable unitairement.
 */
export function assertNoDevHeadersInProd(): void {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.ROADSEN_DEV_HEADERS === '1'
  ) {
    throw new Error(
      'Configuration interdite : ROADSEN_DEV_HEADERS=1 avec NODE_ENV=production. ' +
        "La voie en-tetes de developpement contourne l'isolation multi-tenant et " +
        'ne doit JAMAIS etre active en production. Demarrage refuse.',
    );
  }
}
