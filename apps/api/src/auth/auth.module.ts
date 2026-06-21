import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

/**
 * AuthModule — login/refresh + briques d'identite. JwtModule est enregistre
 * sans secret global : TokenService passe secret/expiresIn explicitement a
 * chaque sign/verify (lu depuis l'env), ce qui evite tout secret fige au boot
 * du module et garde la config centralisee dans TokenService.
 *
 * AuthService est exporte : les guards (TenantGuard, RolesGuard) l'injectent
 * pour les checks membership/platformRole.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, TokenService],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
