import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { AdminController } from './admin.controller';

/**
 * AdminModule — back-office plateforme (onboarding SUPERADMIN). N'expose qu'un
 * controleur ; toute la logique d'ecriture vit dans AuthService (provision_user
 * / provision_org), importe via AuthModule (qui l'exporte deja). Aucun provider
 * propre : pas d'abstraction prematuree.
 */
@Module({
  imports: [AuthModule],
  controllers: [AdminController],
})
export class AdminModule {}
