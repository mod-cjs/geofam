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
 * GET /admin/orgs?q=&limit=&offset= — liste paginee des organisations.
 * `q` : filtre optionnel (ILIKE name/slug, borne cote SQL). `limit` plafonne a
 * 100 (defaut 20), `offset` >= 0 (defaut 0). Les bornes cote SQL priment.
 */
export const listOrgsQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  // .max borne AUSSI l'offset (revue securite) : sans plafond, un offset > 2^31 passe
  // Zod puis casse en « integer out of range » cote ::int -> 500. Plafond genereux.
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});
export type ListOrgsQuery = z.infer<typeof listOrgsQuerySchema>;

/**
 * GET /admin/users?q=&limit= — recherche d'utilisateurs par email/nom.
 * `q` : filtre optionnel (ILIKE email/full_name). `limit` plafonne a 50 (defaut 20).
 */
export const searchUsersQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type SearchUsersQuery = z.infer<typeof searchUsersQuerySchema>;
