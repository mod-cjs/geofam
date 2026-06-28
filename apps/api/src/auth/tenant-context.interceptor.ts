import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Observable } from 'rxjs';

import { tenantStorage } from '../tenant/tenant-context';

import type { AuthedRequest } from './request-context';

/**
 * TenantContextInterceptor — pont entre les guards d'auth et l'AsyncLocalStorage
 * que lisent les services (requireOrgId()).
 *
 * Quand TenantGuard a valide l'appartenance et pose req.tenant, cet intercepteur
 * execute le handler DANS tenantStorage.run({ orgId, userId }). Les services
 * appellent alors PrismaService.withTenant(requireOrgId(), ...) -> SET LOCAL +
 * RLS, exactement comme dans la voie DEV par middleware. Difference essentielle :
 * ici l'org a ete PROUVEE (membership verifie sur identite JWT), pas crue sur un
 * en-tete.
 *
 * Si req.tenant est absent (route @Public, ou voie DEV middleware qui a deja
 * pose le store), on n'enveloppe pas : on laisse le flux tel quel. On evite
 * ainsi un double-run et on reste compatible avec le middleware DEV existant.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const tenant = req.tenant;
    const userId = req.auth?.userId;

    if (!tenant || !userId) {
      return next.handle();
    }

    // tenantStorage.run rend le contexte disponible pour TOUTE la suite
    // synchrone+asynchrone du handler (ALS propage a travers les await).
    return tenantStorage.run({ orgId: tenant.orgId, userId }, () =>
      next.handle(),
    );
  }
}
