import type { CanActivate, ExecutionContext } from '@nestjs/common';
import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
// Imports VALEUR (DI NestJS).
import { Reflector } from '@nestjs/core';

import { AuthService } from './auth.service';
import { IS_PUBLIC_KEY } from './decorators';
import type { AuthedRequest } from './request-context';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * TenantGuard — resout l'org de la requete PUIS prouve l'appartenance AVANT
 * que tout contexte tenant ne soit pose. C'est la cle de la fermeture du trou
 * "en-tete" : l'org demandee (en-tete x-org-id) n'est PAS crue sur parole ; on
 * verifie que le user authentifie (req.auth.userId, issu du JWT) possede un
 * Membership dans CET org. Sans membership -> 403, AUCUN contexte pose
 * (fail-closed : RLS ne verra aucune ligne et requireOrgId() levera).
 *
 * Le check membership lit memberships HORS contexte tenant (on n'a pas encore
 * le droit de poser l'org) : il passe par AuthService.membershipRole, adosse a
 * la fonction SECURITY DEFINER auth_user_has_membership (migration 0003). C'est
 * la seule lecture "a froid" autorisee ; elle ne renvoie QUE le role du couple
 * (user, org) demande, jamais de donnees d'un autre tenant.
 *
 * Pose req.tenant = { orgId, role }. Le TenantContextInterceptor exploitera ce
 * champ pour executer le handler dans l'AsyncLocalStorage (SET LOCAL + RLS).
 *
 * S'applique a toute route non @Public(). Sur une route protegee sans org
 * exploitable, on refuse plutot que d'exposer un acces hors tenant.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.auth) {
      // JwtAuthGuard doit s'executer AVANT : absence d'auth = configuration KO.
      throw new UnauthorizedException('Non authentifie');
    }

    const orgId = orgFromRequest(req);
    if (!orgId) {
      throw new ForbiddenException('Organisation non specifiee');
    }
    if (!UUID_RE.test(orgId)) {
      throw new ForbiddenException('Organisation invalide');
    }

    const role = await this.auth.membershipRole(req.auth.userId, orgId);
    if (!role) {
      // Pas membre de l'org demandee : refus net, aucun contexte pose.
      throw new ForbiddenException('Acces refuse a cette organisation');
    }

    req.tenant = { orgId, role };
    return true;
  }
}

/** Org demandee : en-tete x-org-id (priorite) sinon param de route :orgId. */
function orgFromRequest(req: AuthedRequest): string | undefined {
  const raw = req.headers['x-org-id'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  const fromHeader = header?.trim();
  if (fromHeader) return fromHeader;
  const param = (req.params as Record<string, string> | undefined)?.orgId;
  return param?.trim() || undefined;
}
