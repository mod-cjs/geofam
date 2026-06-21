import { SetMetadata } from '@nestjs/common';
import type { PlatformRole, Role } from '@prisma/client';

/**
 * @Public() — marque une route comme ouverte (pas de JwtAuthGuard).
 * Reserve a login / refresh. Tout le reste est protege par defaut.
 */
export const IS_PUBLIC_KEY = 'roadsen:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * @Roles(...) — exige l'un des roles donnes. Deux familles acceptees :
 *  - Role tenant     (OWNER/ADMIN/ENGINEER/TECHNICIAN/VIEWER) porte par Membership.
 *  - PlatformRole    (SUPERADMIN/SUPPORT) porte par users.platform_role.
 * Le RolesGuard accorde l'acces si le role tenant courant OU le platformRole du
 * user figure dans la liste. Deny-by-default : une route @Roles() sans match -> 403.
 */
export const ROLES_KEY = 'roadsen:roles';
export type AllowedRole = Role | PlatformRole;
export const Roles = (...roles: AllowedRole[]) => SetMetadata(ROLES_KEY, roles);
