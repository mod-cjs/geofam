import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
// Imports VALEUR (DI NestJS).
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from './decorators';
import type { AuthedRequest } from './request-context';
import { TokenService } from './token.service';

/**
 * JwtAuthGuard — exige un access token VALIDE (signature + expiration + type
 * 'access') sur toute route NON marquee @Public(). C'est ici que l'on cesse de
 * faire confiance au client : l'identite (userId) provient EXCLUSIVEMENT du
 * `sub` d'un JWT verifie, jamais d'un en-tete brut.
 *
 * Pose req.auth = { userId } pour les guards/handlers en aval. Ne lit pas la
 * base (le platform_role est resolu paresseusement par le RolesGuard).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = bearer(req.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Token absent');
    }

    const userId = await this.tokens.verify(token, 'access');
    if (!userId) {
      throw new UnauthorizedException('Token invalide');
    }

    req.auth = { userId };
    return true;
  }
}

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim() || null;
}
