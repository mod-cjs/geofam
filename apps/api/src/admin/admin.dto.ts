import { z } from 'zod';

/**
 * Schemas Zod des entrees back-office « lecture » (Lot 1, console SUPERADMIN).
 * Validation a la FRONTIERE (controleur) via ZodValidationPipe : jamais se fier
 * au client. Cf. docs/cadrage-backoffice.md §1.2.
 *
 * NB query-string : les parametres d'URL arrivent en CHAINE. On coerce limit /
 * offset en entier ; le BORNAGE dur (plafond) est RE-applique cote fonction SQL
 * (defense en profondeur : la borne ne depend jamais du seul client).
 */

/** Param de route UUID (orgId d'une org EXISTANTE). */
export const orgIdParam = z.string().uuid();

/**
 * GET /admin/orgs?q=&limit=&offset=&status=&sort= — liste paginee des organisations.
 * `q` : filtre optionnel (ILIKE name/slug, borne cote SQL). `limit` plafonne a
 * 100 (defaut 20), `offset` >= 0 (defaut 0). Les bornes cote SQL priment.
 * `status` : filtre par statut d'org (enum, borne AUSSI cote SQL). `sort` : tri
 * whiteliste { name | createdAt | quota | expiration } (RE-whiteliste cote SQL :
 * un tri hors liste retombe sur name — jamais de colonne cliente dans l'ORDER BY).
 */
export const orgSortEnum = z.enum(['name', 'createdAt', 'quota', 'expiration']);
export const listOrgsQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  // .max borne AUSSI l'offset (revue securite) : sans plafond, un offset > 2^31 passe
  // Zod puis casse en « integer out of range » cote ::int -> 500. Plafond genereux.
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']).optional(),
  sort: orgSortEnum.optional(),
});
export type ListOrgsQuery = z.infer<typeof listOrgsQuerySchema>;

/**
 * GET /admin/subscriptions?filter=&sort=&limit=&offset= — console d'abonnements
 * (vue MONEY-centree des orgs). `filter` : famille whiteliste (expired | expiring |
 * noquota | nosub | withsub). Reutilise la DEFINER admin_list_orgs enrichie (join
 * subscriptions). Filtre/tri RE-whitelistes cote SQL.
 */
export const subscriptionFilterEnum = z.enum([
  'expired',
  'expiring',
  'noquota',
  'nosub',
  'withsub',
]);
export const listSubscriptionsQuerySchema = z.object({
  filter: subscriptionFilterEnum.optional(),
  sort: orgSortEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});
export type ListSubscriptionsQuery = z.infer<
  typeof listSubscriptionsQuerySchema
>;

/**
 * GET /admin/audit?action=&actor=&from=&to=&limit=&offset= — journal d'audit GLOBAL
 * (toutes orgs). Filtres SQL bornes : `action` (marqueur exact, ex. QUOTA_TOPUP),
 * `actor` (uuid du SUPERADMIN), `from`/`to` (fenetre temporelle ISO). `limit`
 * plafonne a 100 (defaut 50) cote SQL. z.coerce.date accepte une chaine ISO.
 */
export const globalAuditQuerySchema = z.object({
  action: z.string().trim().min(1).max(100).optional(),
  actor: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});
export type GlobalAuditQuery = z.infer<typeof globalAuditQuerySchema>;

/** GET /admin/pvs?q=&limit=&offset= — supervision PV cross-tenant (recherche par n°). */
export const listPvsQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});
export type ListPvsQuery = z.infer<typeof listPvsQuerySchema>;

/**
 * GET /admin/users?q=&limit= — recherche d'utilisateurs par email/nom.
 * `q` : filtre optionnel (ILIKE email/full_name). `limit` plafonne a 50 (defaut 20).
 */
export const searchUsersQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type SearchUsersQuery = z.infer<typeof searchUsersQuerySchema>;
