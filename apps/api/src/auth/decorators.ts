import { SetMetadata } from '@nestjs/common';
import type { PlatformRole, Role } from '@prisma/client';

/**
 * @Public() — marque une route comme ouverte (pas de JwtAuthGuard).
 * Reserve a login / refresh. Tout le reste est protege par defaut.
 */
export const IS_PUBLIC_KEY = 'roadsen:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * @NoTenant() — route AUTHENTIFIEE mais HORS contexte tenant.
 *
 * Difference essentielle avec @Public : l'identite reste OBLIGATOIRE (JwtAuthGuard
 * exige un token verifie), seule l'appartenance a une organisation est levee.
 * Le TenantGuard, qui par defaut refuse toute route ne prouvant pas un membership
 * (x-org-id), court-circuite ici. Aucun req.tenant n'est pose -> aucune requete
 * ne s'execute dans un contexte tenant (le TenantContextInterceptor n'enveloppe
 * pas), donc ces handlers NE DOIVENT PAS toucher une table multi-tenant en
 * requete ordinaire (RLS leverait). Ils passent par les fonctions DEFINER
 * dediees (provision_user/org hors tenant, auth_get_user_profile a froid).
 *
 * Usage : onboarding SUPERADMIN (POST /admin/users, /admin/orgs — un SUPERADMIN
 * plateforme n'appartient a aucun tenant) et GET /auth/me (lister SES orgs AVANT
 * d'en selectionner une). Le RBAC reste applique : @Roles(SUPERADMIN) sur les
 * routes admin -> le RolesGuard resout le platformRole (il n'a pas besoin de
 * req.tenant). @NoTenant sans @Roles = simplement "tout user authentifie".
 */
export const NO_TENANT_KEY = 'roadsen:noTenant';
export const NoTenant = () => SetMetadata(NO_TENANT_KEY, true);

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
