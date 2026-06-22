import { NestFactory } from '@nestjs/core';

import { configureApp } from './app.config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Pipe Zod + filtre d'erreur standard + versionnage + OpenAPI (cf. app.config).
  // Memes reglages qu'en test e2e : zero derive entre runtime et tests.
  configureApp(app);

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
