import type { PlatformRole, Role } from '@prisma/client';
import type { Request } from 'express';

/**
 * Identite + contexte attaches a la requete par les guards d'auth.
 *  - `auth`   : pose par JwtAuthGuard apres verification du token (userId fiable).
 *  - `tenant` : pose par TenantGuard apres check d'appartenance (org + role tenant).
 * Le RolesGuard et le TenantContextInterceptor lisent ces champs.
 */
export interface AuthState {
  userId: string;
  platformRole?: PlatformRole | null;
}

export interface TenantState {
  orgId: string;
  role: Role;
}

export interface AuthedRequest extends Request {
  auth?: AuthState;
  tenant?: TenantState;
}
