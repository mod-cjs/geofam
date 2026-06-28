import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

// Import VALEUR (DI NestJS).
import { ZodValidationPipe } from '../common/zod-validation.pipe';

import { AuthService } from './auth.service';
import type { TokenPair, UserProfile } from './auth.service';
import { NoTenant, Public } from './decorators';
import type { LoginDto, RefreshDto } from './dto';
import { loginSchema, refreshSchema } from './dto';
import type { AuthedRequest } from './request-context';

/**
 * AuthController — points d'entree publics (login/refresh). @Public() les
 * exempte du JwtAuthGuard global. Validation Zod a la frontiere. 200 explicite
 * (pas de 201) : on ne cree pas de ressource, on emet des tokens.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginDto,
  ): Promise<TokenPair> {
    return this.auth.login(body.email, body.password);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshDto,
  ): Promise<TokenPair> {
    return this.auth.refresh(body.refreshToken);
  }

  /**
   * GET /auth/me — profil de l'utilisateur AUTHENTIFIE + ses appartenances.
   *
   * @NoTenant : route authentifiee mais HORS contexte tenant. C'est exactement
   * "qui suis-je et a quelles orgs j'appartiens" AVANT toute selection d'org (le
   * front s'en sert pour proposer les orgs disponibles). L'identite vient du SUB
   * du JWT verifie (req.auth.userId) — JAMAIS d'une valeur cliente : un user ne
   * lit que SON propre profil, jamais celui d'un autre, ni une org dont il n'est
   * pas membre.
   *
   * Cas anormal : token verifie mais user supprime depuis -> profil introuvable
   * -> 401 (le compte n'existe plus). password_hash n'est jamais renvoye.
   */
  @NoTenant()
  @Get('me')
  async me(@Req() req: AuthedRequest): Promise<UserProfile> {
    // req.auth est garanti pose par JwtAuthGuard (route non @Public). Filet :
    const userId = req.auth?.userId;
    if (!userId) {
      throw new UnauthorizedException('Non authentifie');
    }
    const profile = await this.auth.getProfile(userId);
    if (!profile) {
      throw new UnauthorizedException('Compte introuvable');
    }
    return profile;
  }
}
