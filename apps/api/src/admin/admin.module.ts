import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

import { AdminController } from './admin.controller';
import { AdminMutationsService } from './admin-mutations.service';
import { AdminOrgsService } from './admin-orgs.service';
import { AdminStatsService } from './admin-stats.service';
import { AdminUsersService } from './admin-users.service';
import { MembersService } from './members.service';

/**
 * AdminModule — back-office plateforme (onboarding + accès multi-membres +
 * console de lecture SUPERADMIN, P1/Lot 1).
 *
 * L'onboarding (users/orgs) vit dans AuthService (via AuthModule) et
 * SubscriptionsService (via SubscriptionsModule) ; la gestion des membres d'une
 * org existante vit dans MembersService (provider propre : provision_member /
 * set_member_active / list_org_members). La console de LECTURE (Lot 1) vit dans
 * AdminOrgsService (admin_list_orgs / admin_get_org + abo/usage via withTenant)
 * et AdminUsersService (admin_search_users). PrismaService vient du PrismaModule global.
 */
@Module({
  imports: [AuthModule, SubscriptionsModule],
  controllers: [AdminController],
  providers: [
    MembersService,
    AdminOrgsService,
    AdminUsersService,
    AdminMutationsService,
    AdminStatsService,
  ],
})
export class AdminModule {}
