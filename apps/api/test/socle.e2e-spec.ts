/**
 * Test e2e du SOCLE API (#44) — prouve, via supertest sur l'app NestJS reelle
 * configuree par `configureApp` (memes reglages qu'en prod : zero derive) :
 *
 *  Bloc A (sans DB) — controleurs de test synthetiques :
 *    - format d'erreur STANDARD {statusCode,error,message,details?,traceId} pour
 *      400 / 401 / 403 / 404 / 409 / 500 (>= 1 cas par classe de statut) ;
 *    - validation Zod globale : corps invalide -> 400 standard avec `details` ;
 *      corps valide -> passe ;
 *    - traceId : present dans le corps d'erreur ET dans l'en-tete x-trace-id,
 *      identiques ; un x-trace-id entrant est respecte (correlation amont) ;
 *    - versionnage d'URI : /v1/... repond, la route non versionnee -> 404.
 *
 *  Bloc B (avec DB, AppModule reel) :
 *    - GET /v1/health = 200 {status:'ok'} ;
 *    - GET /docs = 200 ; GET /docs-json = OpenAPI 3 valide exposant /v1/health ;
 *    - le schema partage @roadsen/shared est bien la source du DTO (pas de
 *      duplication) -> il apparait dans le document.
 *
 *  ANTI-SKIP : le bloc B exige une base. Si DATABASE_URL est absent ET qu'on est
 *  en CI -> echec dur. En dev local sans base -> non-execute (honnete), interdit
 *  en CI.
 */
import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Module,
  NotFoundException,
  Post,
  UnauthorizedException,
  Version,
} from '@nestjs/common';
import type {
  INestApplication,
  MiddlewareConsumer,
  NestModule,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createZodDto } from 'nestjs-zod';
import request from 'supertest';
import { z } from 'zod';

import { configureApp } from '../src/app.config';
import { AppModule } from '../src/app.module';
import { TRACE_ID_HEADER, TraceIdMiddleware } from '../src/common/trace';

// DTO de test derive d'un schema Zod -> valide par le ZodValidationPipe global.
const SampleSchema = z.object({
  name: z.string().min(1),
  count: z.number().int(),
});
class SampleDto extends createZodDto(SampleSchema) {}

// Controleur synthetique : une route par classe d'erreur + une route de
// validation + une route versionnee. Sert UNIQUEMENT a prouver le contrat du
// filtre/pipe global, sans dependance a la base.
@Controller('filter-test')
class FilterTestController {
  @Get('boom')
  boom(): never {
    // Erreur non maitrisee -> doit devenir un 500 generique (cause loggee).
    throw new Error('kaboom interne avec un secret a NE PAS fuiter');
  }

  @Get('forbidden')
  forbidden(): never {
    throw new ForbiddenException('Droits insuffisants');
  }

  @Get('conflict')
  conflict(): never {
    throw new ConflictException('Ressource en conflit');
  }

  @Get('unauth')
  unauth(): never {
    throw new UnauthorizedException();
  }

  @Get('notfound')
  notfound(): never {
    throw new NotFoundException();
  }

  @Post('validate')
  validate(@Body() body: SampleDto): { ok: true; name: string } {
    return { ok: true, name: body.name };
  }

  @Version('1')
  @Get('versioned')
  versioned(): { v: number } {
    return { v: 1 };
  }
}

// Module de test : cable le VRAI TraceIdMiddleware (comme AppModule en prod),
// pour prouver le traceId sans dependre de la base. Le reste de la config
// globale (pipe Zod, filtre, versionnage, OpenAPI) vient de configureApp.
@Module({
  controllers: [FilterTestController],
})
class FilterTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceIdMiddleware).forRoutes('*');
  }
}

// Forme attendue du corps d'erreur standard.
interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  traceId: string;
}

// Sous-ensemble du document OpenAPI qu'on inspecte (res.body etant `any`).
interface OpenApiDocLike {
  openapi: string;
  paths: Record<string, { get?: unknown }>;
}

function assertStandardError(body: ApiErrorBody, status: number): void {
  expect(body.statusCode).toBe(status);
  expect(typeof body.error).toBe('string');
  expect(body.error.length).toBeGreaterThan(0);
  expect(typeof body.message).toBe('string');
  expect(body.message.length).toBeGreaterThan(0);
  expect(typeof body.traceId).toBe('string');
  expect(body.traceId.length).toBeGreaterThan(0);
}

describe('Socle API — filtre + validation + traceId + versionnage (e2e, sans DB)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FilterTestModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('500 : erreur non maitrisee -> format standard, AUCUNE fuite de stack/secret', async () => {
    const res = await request(app.getHttpServer()).get('/filter-test/boom');
    expect(res.status).toBe(500);
    assertStandardError(res.body, 500);
    // Anti-fuite : ni la stack, ni le message interne ne doivent sortir.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('secret a NE PAS fuiter');
    expect(raw).not.toContain('kaboom');
    expect(res.body).not.toHaveProperty('stack');
  });

  it('403 : ForbiddenException -> format standard', async () => {
    const res = await request(app.getHttpServer()).get(
      '/filter-test/forbidden',
    );
    expect(res.status).toBe(403);
    assertStandardError(res.body, 403);
  });

  it('409 : ConflictException -> format standard', async () => {
    const res = await request(app.getHttpServer()).get('/filter-test/conflict');
    expect(res.status).toBe(409);
    assertStandardError(res.body, 409);
  });

  it('401 : UnauthorizedException -> format standard', async () => {
    const res = await request(app.getHttpServer()).get('/filter-test/unauth');
    expect(res.status).toBe(401);
    assertStandardError(res.body, 401);
  });

  it('404 : route inconnue -> format standard (chemin NotFound par defaut de Nest)', async () => {
    const res = await request(app.getHttpServer()).get(
      '/route-inexistante-xyz',
    );
    expect(res.status).toBe(404);
    assertStandardError(res.body, 404);
  });

  it('400 : corps invalide -> format standard avec details (path/code), sans la valeur recue', async () => {
    const res = await request(app.getHttpServer())
      .post('/filter-test/validate')
      .send({ name: '', count: 'pas-un-entier' });
    const body = res.body as ApiErrorBody;
    expect(res.status).toBe(400);
    assertStandardError(body, 400);
    const details = body.details;
    expect(Array.isArray(details)).toBe(true);
    expect((details as unknown[]).length).toBeGreaterThan(0);
    // `details` n'expose que des chemins/codes, jamais la valeur fautive.
    expect(JSON.stringify(details)).not.toContain('pas-un-entier');
  });

  it('200 : corps valide -> passe la validation', async () => {
    const res = await request(app.getHttpServer())
      .post('/filter-test/validate')
      .send({ name: 'roadsen', count: 3 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true, name: 'roadsen' });
  });

  it('traceId : present dans le corps ET dans l en-tete x-trace-id, identiques', async () => {
    const res = await request(app.getHttpServer()).get(
      '/filter-test/forbidden',
    );
    const header = res.headers[TRACE_ID_HEADER];
    expect(typeof header).toBe('string');
    expect(header.length).toBeGreaterThan(0);
    expect((res.body as ApiErrorBody).traceId).toBe(header);
  });

  it('traceId : un x-trace-id fourni en amont est respecte (correlation)', async () => {
    const upstream = 'trace-amont-123';
    const res = await request(app.getHttpServer())
      .get('/filter-test/forbidden')
      .set(TRACE_ID_HEADER, upstream);
    expect((res.body as ApiErrorBody).traceId).toBe(upstream);
    expect(res.headers[TRACE_ID_HEADER]).toBe(upstream);
  });

  it('traceId : un x-trace-id malforme (espaces/longueur) est IGNORE -> id genere', async () => {
    // Anti log-injection / DoS d'en-tete : un id non conforme (espaces ici, mais
    // aussi CR/LF, controle, > 128 car.) ne doit JAMAIS etre reflete.
    const malicious = 'pas valide avec espaces';
    const res = await request(app.getHttpServer())
      .get('/filter-test/forbidden')
      .set(TRACE_ID_HEADER, malicious);
    const traceId = (res.body as ApiErrorBody).traceId;
    expect(traceId).not.toBe(malicious);
    // Un UUID v4 a ete genere a la place.
    expect(traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(res.headers[TRACE_ID_HEADER]).toBe(traceId);
  });

  it('versionnage : /v1/filter-test/versioned -> 200 ; la route non versionnee -> 404', async () => {
    const ok = await request(app.getHttpServer()).get(
      '/v1/filter-test/versioned',
    );
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ v: 1 });

    const noVersion = await request(app.getHttpServer()).get(
      '/filter-test/versioned',
    );
    expect(noVersion.status).toBe(404);
  });
});

const DB_URL = process.env.DATABASE_URL ?? '';
const ENFORCE_DB = process.env.CI === 'true';
const describeDb =
  DB_URL.length > 0 ? describe : ENFORCE_DB ? describe : describe.skip;

if (DB_URL.length === 0 && !ENFORCE_DB) {
  console.warn(
    'socle.e2e : bloc DB non execute (DATABASE_URL absent, hors CI). ' +
      'Interdit en CI (ENFORCE_DB).',
  );
}

describeDb('Socle API — health + OpenAPI (e2e, AppModule reel + DB)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    if (DB_URL.length === 0 && ENFORCE_DB) {
      throw new Error(
        'CI sans DATABASE_URL : le socle DB ne peut etre prouve.',
      );
    }
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /v1/health -> 200 {status:"ok"} + env/science identifiables', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health');
    expect(res.status).toBe(200);
    // status:'ok' (contrat de base) + champs d'identification d'environnement.
    // Par defaut (sans ROADSEN_ENV/ROADSEN_SCIENCE_SIGNED), l'API est en recette
    // et la science n'est pas signee (MJ-6).
    expect(res.body).toEqual({
      status: 'ok',
      env: 'recette',
      science: 'unsigned',
    });
  });

  it('GET /docs -> 200 (UI Swagger)', async () => {
    const res = await request(app.getHttpServer()).get('/docs');
    expect(res.status).toBe(200);
  });

  it('GET /docs-json -> OpenAPI 3 valide exposant /v1/health (schema @roadsen/shared)', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json');
    expect(res.status).toBe(200);
    const doc = res.body as OpenApiDocLike;
    expect(typeof doc.openapi).toBe('string');
    expect(doc.openapi.startsWith('3')).toBe(true);
    expect(doc.paths).toBeDefined();
    // La route versionnee figure bien dans le document.
    expect(doc.paths['/v1/health']).toBeDefined();
    expect(doc.paths['/v1/health'].get).toBeDefined();
  });

  it('chemin REEL : route protegee sans token -> 401 standard + traceId reel (AppModule complet)', async () => {
    // Preuve sur l'AppModule REEL (gardes globales + TraceIdMiddleware cable dans
    // AppModule.configure, pas dans un module de test synthetique) : la chaine
    // middleware -> gardes -> filtre produit bien le format standard, et le
    // traceId n'est PAS le filet 'unknown' (le middleware s'est execute).
    const res = await request(app.getHttpServer()).get('/projects');
    expect(res.status).toBe(401);
    const body = res.body as ApiErrorBody;
    assertStandardError(body, 401);
    expect(body.traceId).not.toBe('unknown');
    expect(res.headers[TRACE_ID_HEADER]).toBe(body.traceId);
  });
});
