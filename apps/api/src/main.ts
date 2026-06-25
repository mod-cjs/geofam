import { NestFactory } from '@nestjs/core';

import {
  assertCorsOriginsInProd,
  configureApp,
  resolveCorsOrigins,
} from './app.config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Pipe Zod + filtre d'erreur standard + versionnage + OpenAPI (cf. app.config).
  // La CONFIGURATION applicative (configureApp) est identique en test e2e. NB :
  // la resolution de modules differe (tests ts-jest en CommonJS vs build prod
  // nodenext) ; ce qui releve de la resolution/ESM est couvert par le `build`,
  // pas par les e2e.
  configureApp(app);

  // CORS : permet a STARFIRE d'appeler l'API depuis un outil/navigateur d'une
  // AUTRE origine (l'UI Swagger same-origin marche sans CORS, mais pas un client
  // tiers). Origines via `ROADSEN_CORS_ORIGINS` (liste separee par des virgules) ;
  // a defaut on reflete l'origine appelante (recette : la barriere reelle reste la
  // cle X-Recette-Key, pas CORS). On autorise l'en-tete de cle cote navigateur.
  //
  // FAIL-FAST : en PRODUCTION, un defaut permissif (origin:true) est interdit ->
  // on exige une liste d'origines declaree, sinon le boot est refuse (#73).
  assertCorsOriginsInProd();
  const corsOrigins = resolveCorsOrigins();
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Recette-Key'],
    methods: ['GET', 'POST', 'OPTIONS'],
    maxAge: 86400,
  });

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
