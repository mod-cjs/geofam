import { z } from 'zod';

/**
 * Schemas Zod des entrees back-office « membres » (P1, admin-géré). Validation a
 * la FRONTIERE (controleur) via ZodValidationPipe : jamais se fier au client.
 * Cf. docs/cadrage-acces-membres-p1.md §5.
 */

/** Param de route UUID (orgId d'une org EXISTANTE, userId d'un user EXISTANT). */
export const memberOrgIdParam = z.string().uuid();
export const memberUserIdParam = z.string().uuid();

/**
 * POST /admin/orgs/:orgId/members — attache un membre a une org existante.
 * `role` EXCLUT OWNER : l'unicite de l'OWNER se gere a la creation d'org /
 * transfert explicite (provision_member refuse OWNER en defense de profondeur ;
 * ici l'enum le barre AVANT la base -> 400). `userId` = user EXISTANT (l'existence
 * est garantie par la FK memberships_user_id_fkey, traduite en 400 borne).
 */
export const addMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['ADMIN', 'ENGINEER', 'TECHNICIAN', 'VIEWER']),
});
export type AddMemberDto = z.infer<typeof addMemberSchema>;

/**
 * PATCH /admin/orgs/:orgId/members/:userId — suspend (false) / reactive (true).
 * Anti-lockout du dernier OWNER actif : porte cote base (set_member_active),
 * traduit en 409.
 */
export const setMemberActiveSchema = z.object({
  isActive: z.boolean(),
});
export type SetMemberActiveDto = z.infer<typeof setMemberActiveSchema>;
