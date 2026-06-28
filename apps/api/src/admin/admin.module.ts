import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

import { AdminController } from './admin.controller';

/**
 * AdminModule — back-office plateforme (onboarding SUPERADMIN). N'expose qu'un
 * controleur ; la logique d'ecriture vit dans AuthService (provision_user /
 * provision_org, via AuthModule) et SubscriptionsService (provision d'abonnement
 * a la creation d'org, via SubscriptionsModule). Aucun provider propre : pas
 * d'abstraction prematuree.
 */
@Module({
  imports: [AuthModule, SubscriptionsModule],
  controllers: [AdminController],
})
export class AdminModule {}
