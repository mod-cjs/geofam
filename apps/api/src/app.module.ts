import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module } from '@nestjs/common';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { TenantContextMiddleware } from './tenant/tenant-context.middleware';

@Module({
  imports: [PrismaModule, ProjectsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  // Le contexte tenant est etabli pour TOUTES les routes ; les routes
  // publiques (sans en-tete) passent simplement sans store (fail-closed).
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
