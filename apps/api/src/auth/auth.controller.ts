import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

// Import VALEUR (DI NestJS).
import { ZodValidationPipe } from '../common/zod-validation.pipe';

import { AuthService } from './auth.service';
import type { TokenPair } from './auth.service';
import { Public } from './decorators';
import type { LoginDto, RefreshDto } from './dto';
import { loginSchema, refreshSchema } from './dto';

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
}
