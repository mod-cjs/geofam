import { NestFactory } from '@nestjs/core';

import { configureApp } from './app.config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Pipe Zod + filtre d'erreur standard + versionnage + OpenAPI (cf. app.config).
  // La CONFIGURATION applicative (configureApp) est identique en test e2e. NB :
  // la resolution de modules differe (tests ts-jest en CommonJS vs build prod
  // nodenext) ; ce qui releve de la resolution/ESM est couvert par le `build`,
  // pas par les e2e.
  configureApp(app);

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
