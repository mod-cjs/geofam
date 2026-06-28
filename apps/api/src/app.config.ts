import { VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { ZodValidationPipe, cleanupOpenApiDoc } from 'nestjs-zod';

import { AllExceptionsFilter } from './common/http-exception.filter';
import { getDeployEnv, getScienceStatus } from './recette/recette.config';

/** Nom du schema de securite apiKey (cle d'acces recette) dans le document OpenAPI. */
export const RECETTE_SECURITY_SCHEME = 'recette-key';
/** En-tete HTTP porteur de la cle d'acces recette, expose dans Swagger « Authorize ». */
export const RECETTE_SECURITY_HEADER = 'X-Recette-Key';

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
  // En PRODUCTION, on n'expose PAS /docs + /docs-json par defaut : c'est une
  // surface d'API anonyme (fuite d'information). Activable explicitement via
  // ROADSEN_EXPOSE_DOCS=1. Hors prod (dev/test), toujours expose.
  //
  // PERF : la GENERATION du document (createDocument + cleanupOpenApiDoc sur les
  // DTO Zod volumineux des 6 moteurs) est CPU-lourde (~plusieurs dizaines de s).
  // C'est cette generation qui faisait TIMEOUT (beforeAll 30 s) les e2e qui ne
  // touchent pas /docs. On l'EVITE explicitement via ROADSEN_SKIP_DOCS=1 (opt-out
  // reserve a ces suites e2e) : aucun effet en prod (qui ne pose pas ce flag) ni
  // sur openapi-doc.e2e (qui teste /docs et NE pose PAS ce flag).
  // cleanupOpenApiDoc (nestjs-zod v5) injecte les schemas createZodDto.
  const exposeDocs =
    process.env.NODE_ENV !== 'production' ||
    process.env.ROADSEN_EXPOSE_DOCS === '1';
  if (exposeDocs && process.env.ROADSEN_SKIP_DOCS !== '1') {
    const document = cleanupOpenApiDoc(
      SwaggerModule.createDocument(app, buildOpenApiDocument()),
    );
    SwaggerModule.setup('docs', app, document);
  }
}

/**
 * Construit la configuration de base du document OpenAPI (DocumentBuilder).
 * Exporte pour que le runtime ET les tests bootstrappent le MEME document.
 *
 * Securite : on declare DEUX schemas — la cle d'acces RECETTE (apiKey en-tete
 * `X-Recette-Key`, exigee GLOBALEMENT via addSecurityRequirements -> bouton
 * « Authorize » dans /docs, en-tete envoye sur chaque essai) et le bearer JWT
 * (conserve pour les futurs endpoints tenant). La cle recette est le verrou de
 * perimetre actuel (cf. RecetteAccessGuard) : sans elle, tout essai fait 401.
 */
export function buildOpenApiDocument(): Omit<OpenAPIObject, 'paths'> {
  return (
    new DocumentBuilder()
      .setTitle('ROADSEN API')
      .setDescription(buildApiDescription())
      .setVersion('1.0')
      // Cle d'acces recette (apiKey) : reference l'en-tete reel du guard.
      .addApiKey(
        { type: 'apiKey', name: RECETTE_SECURITY_HEADER, in: 'header' },
        RECETTE_SECURITY_SCHEME,
      )
      // Exigee globalement -> Swagger « Authorize » + en-tete sur chaque essai.
      .addSecurityRequirements(RECETTE_SECURITY_SCHEME)
      .addBearerAuth()
      .build()
  );
}

/**
 * Construit la description OpenAPI. En RECETTE (science non signee), on prefixe
 * une BANNIERE d'avertissement bien visible : justesse non validee (kit cas-tests
 * STARFIRE en attente), interdit en production (MJ-6). En production avec science
 * signee, on s'en tient a la description neutre.
 */
export function buildApiDescription(): string {
  const base =
    'Plateforme de calcul geotechnique & routier (multi-tenant).\n\n' +
    'Acces RECETTE par cle : cliquer « Authorize » et renseigner X-Recette-Key ' +
    'avant tout essai (sinon 401). Les recalculs sont a la RACINE (`/calc/*`, ' +
    'non versionnes) ; la sonde de sante est versionnee (`/v1/health`, exemptee de cle).';
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

/** Indique si l'environnement courant est une PRODUCTION (NODE_ENV ou ROADSEN_ENV). */
function isProductionEnv(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.ROADSEN_ENV === 'production'
  );
}

/**
 * Resout la liste des origines CORS autorisees depuis `ROADSEN_CORS_ORIGINS`
 * (CSV). Exporte/testable : `main.ts` s'en sert pour configurer enableCors.
 */
export function resolveCorsOrigins(): string[] {
  return (process.env.ROADSEN_CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * FAIL-FAST SECURITE (#73, MINEUR-2) : en PRODUCTION, refuse le boot si aucune
 * origine CORS n'est declaree. Sans liste, enableCors retomberait sur
 * `origin:true` (reflet de TOUTE origine appelante) — trop permissif en prod, ou
 * la cle X-Recette-Key n'est plus la barriere (les endpoints passeront sous auth
 * tenant). En RECETTE, on tolere le defaut permissif (la cle reste la barriere) :
 * cette assertion ne se declenche donc QU'en production. Exporte pour etre
 * testable unitairement et appelee au boot par main.ts.
 */
export function assertCorsOriginsInProd(): void {
  if (isProductionEnv() && resolveCorsOrigins().length === 0) {
    throw new Error(
      'Configuration interdite : aucune origine CORS declaree en production. ' +
        'Renseignez ROADSEN_CORS_ORIGINS (liste CSV des origines autorisees) — ' +
        'le defaut permissif (reflet de toute origine) est interdit en prod. Demarrage refuse.',
    );
  }
}
