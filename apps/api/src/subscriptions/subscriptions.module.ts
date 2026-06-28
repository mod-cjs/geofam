import { Module } from '@nestjs/common';

import { EntitlementsController } from './entitlements.controller';
import { SubscriptionsService } from './subscriptions.service';

/**
 * SubscriptionsModule — enforcement d'abonnement (ADR 0009/0011).
 *
 * Expose SubscriptionsService : injecte par le SubscriptionGuard (chaine de
 * gardes globale, AppModule) ET par les services consommants (calc/PV) pour le
 * decompte atomique reserveUnit(). PrismaService vient du PrismaModule global.
 */
@Module({
  controllers: [EntitlementsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
