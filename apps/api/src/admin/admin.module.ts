import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

import { AdminController } from './admin.controller';
import { MembersService } from './members.service';

/**
 * AdminModule — back-office plateforme (onboarding + accès multi-membres, P1).
 * L'onboarding (users/orgs) vit dans AuthService (via AuthModule) et
 * SubscriptionsService (via SubscriptionsModule) ; la gestion des membres d'une
 * org existante vit dans MembersService (provider propre : provision_member /
 * set_member_active / list_org_members). PrismaService vient du PrismaModule global.
 */
@Module({
  imports: [AuthModule, SubscriptionsModule],
  controllers: [AdminController],
  providers: [MembersService],
})
export class AdminModule {}
