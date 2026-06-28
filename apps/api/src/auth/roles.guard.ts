import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
// Imports VALEUR (DI NestJS).
import { Reflector } from '@nestjs/core';

import { AuthService } from './auth.service';
import type { AllowedRole } from './decorators';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';
import type { AuthedRequest } from './request-context';

const TENANT_ROLES = new Set<string>([
  'OWNER',
  'ADMIN',
  'ENGINEER',
  'TECHNICIAN',
  'VIEWER',
]);

/**
 * RolesGuard — applique @Roles(...). Deny-by-default :
 *  - Pas de @Roles sur la route -> on laisse passer (l'auth + tenant ont deja
 *    statue sur l'acces ; @Roles raffine, il n'est pas le seul rempart).
 *  - @Roles present -> acces SI le role tenant courant (req.tenant.role) OU le
 *    platformRole du user figure dans la liste autorisee. Sinon 403.
 *
 * Verification SERVEUR exclusivement : le front n'est jamais une frontiere de
 * droits. Le platformRole est lu paresseusement (DEFINER) seulement si la route
 * autorise au moins un PlatformRole -> pas de requete inutile sur les routes
 * purement tenant.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Coherence avec JwtAuthGuard/TenantGuard : une route @Public() ne passe par
    // AUCUN guard (sinon un @Public + @Roles deviendrait un 403 silencieux, et
    // RolesGuard s'executerait sans req.auth/req.tenant). Invariant : @Public
    // honore par TOUS les guards.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<AllowedRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();

    // 1) Role tenant courant (issu du membership verifie par TenantGuard).
    const tenantRole = req.tenant?.role;
    if (tenantRole && required.includes(tenantRole)) return true;

    // 2) PlatformRole — uniquement si la route en autorise un (evite la requete).
    const wantsPlatform = required.some((r) => !TENANT_ROLES.has(r));
    if (wantsPlatform && req.auth) {
      const platformRole =
        req.auth.platformRole ??
        (await this.auth.platformRole(req.auth.userId));
      req.auth.platformRole = platformRole; // memoise pour la requete
      if (platformRole && required.includes(platformRole)) return true;
    }

    throw new ForbiddenException('Droits insuffisants');
  }
}
