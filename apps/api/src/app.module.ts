import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { TenantContextInterceptor } from './auth/tenant-context.interceptor';
import { TenantGuard } from './auth/tenant.guard';
import { TraceIdMiddleware } from './common/trace';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { TenantContextMiddleware } from './tenant/tenant-context.middleware';

@Module({
  imports: [PrismaModule, AuthModule, ProjectsModule, HealthModule],
  controllers: [AppController],
  providers: [
    AppService,
    // Chaine de gardes GLOBALE, dans l'ordre d'execution :
    //  1) JwtAuthGuard  — exige un access token verifie (sauf @Public).
    //  2) TenantGuard   — prouve l'appartenance a l'org demandee, pose req.tenant.
    //  3) RolesGuard    — applique @Roles (role tenant ou platformRole).
    // Deny-by-default : toute route non @Public exige un token ET une org membre.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Execute le handler dans l'AsyncLocalStorage tenant (SET LOCAL + RLS) une
    // fois l'appartenance prouvee.
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule implements NestModule {
  // Middlewares globaux, dans l'ordre d'execution :
  //  1) TraceIdMiddleware     — pose req.traceId + en-tete x-trace-id AVANT les
  //     gardes, pour qu'un 401/403/404 emette aussi un traceId.
  //  2) TenantContextMiddleware — voie DEV par en-tetes (verrouillee :
  //     ROADSEN_DEV_HEADERS=1 && !prod). Pose le store ALS et coexiste avec la
  //     chaine de gardes : le TenantContextInterceptor ne re-enveloppe pas si le
  //     store est deja pose.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceIdMiddleware, TenantContextMiddleware).forRoutes('*');
  }
}
