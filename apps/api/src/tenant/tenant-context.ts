import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexte tenant par requete, propage via AsyncLocalStorage.
 *
 * Le middleware (TenantContextMiddleware) etablit ce store au debut de chaque
 * requete HTTP a partir de l'identite resolue (JWT/membership). Les services
 * y lisent l'org courant sans avoir a le passer en parametre partout.
 *
 * NB : ce store est la SOURCE du guard applicatif. La barriere ultime reste
 * RLS cote base (cf. PrismaService.withTenant).
 */
export interface TenantContext {
  orgId: string;
  userId: string;
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

/** Renvoie le contexte tenant courant, ou undefined hors requete scopee. */
export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

/** Renvoie l'org courant ou leve si absent (appel hors contexte = bug). */
export function requireOrgId(): string {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    throw new Error(
      'Aucun contexte tenant : appel hors requete scopee (verifier le middleware).',
    );
  }
  return ctx.orgId;
}
