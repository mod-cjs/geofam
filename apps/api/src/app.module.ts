import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, seconds } from '@nestjs/throttler';

import { AdminModule } from './admin/admin.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { TenantContextInterceptor } from './auth/tenant-context.interceptor';
import { TenantGuard } from './auth/tenant.guard';
import { CalcModule } from './calc/calc.module';
import { TraceIdMiddleware } from './common/trace';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { PvModule } from './pv/pv.module';
import { RecetteAccessGuard } from './recette/recette-access.guard';
import { SubscriptionGuard } from './subscriptions/subscription.guard';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { TenantContextMiddleware } from './tenant/tenant-context.middleware';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AdminModule,
    ProjectsModule,
    HealthModule,
    CalcModule,
    PvModule,
    SubscriptionsModule,
    // Rate limiting GLOBAL (anti-abus). Seuil LARGE (60 req / 60 s par IP) :
    // raisonnable pour des endpoints de calcul, et assez haut pour ne pas
    // perturber les suites e2e (qui enchainent quelques requetes par cas).
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: seconds(60), limit: 60 }],
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Chaine de gardes GLOBALE, dans l'ordre d'execution :
    //  0) RecetteAccessGuard — PERIMETRE recette par cle d'API (X-Recette-Key).
    //     INERTE si RECETTE_API_KEY non posee (les e2e restent verts). S'applique
    //     a TOUTES les routes, @Public comprises : c'est une porte EXTERNE,
    //     independante de l'auth JWT.
    //  0bis) ThrottlerGuard — rate limiting (cf. ThrottlerModule ci-dessus).
    //  1) JwtAuthGuard      — exige un access token verifie (sauf @Public).
    //  2) TenantGuard       — prouve l'appartenance a l'org demandee, pose req.tenant.
    //  3) SubscriptionGuard — enforce l'abonnement (ADR 0011) : 403 module hors
    //     pack / 402 expire|quota, UNIQUEMENT sur les routes @RequiresEntitlement
    //     /@Consumes. Place APRES TenantGuard (org resolue) et AVANT RolesGuard.
    //  4) RolesGuard        — applique @Roles (role tenant ou platformRole).
    // Deny-by-default : toute route non @Public exige un token ET une org membre.
    // NB ORDRE : les APP_GUARD s'executent dans l'ordre de declaration ci-dessous.
    { provide: APP_GUARD, useClass: RecetteAccessGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: SubscriptionGuard },
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
