import { z } from 'zod';

/**
 * Schemas Zod des entrees back-office « mutations » (Lot 2, money-adjacent).
 * Validation a la FRONTIERE (controleur) via ZodValidationPipe : jamais se fier au
 * client. Les gardes METIER (quota >= consommation, anti-escalade OWNER,
 * anti-lockout) sont RE-appliquees cote base par les fonctions DEFINER : Zod ne
 * fait que borner la forme. Cf. docs/cadrage-backoffice.md §2.
 *
 * IDEMPOTENCE : la cle d'idempotence n'est PAS dans ces schemas — elle vient de
 * l'en-tete HTTP `Idempotency-Key` (ou est generee serveur), jamais du corps metier
 * (cf. admin.controller). L'ACTEUR non plus : c'est le sub du JWT (serveur), jamais
 * le corps (lecon #42).
 */

/** Params de route UUID. */
export const mutOrgIdParam = z.string().uuid();
export const mutUserIdParam = z.string().uuid();

/**
 * POST /admin/orgs/:orgId/subscription/topup — ajuste le quota de `delta`.
 * `delta` != 0 (un ajustement nul n'a pas de sens). Peut etre negatif (baisse), mais
 * la base REFUSE un quota resultant < consommation deja engagee (400). `motif`
 * OBLIGATOIRE (tracabilite : la raison est consignee dans admin_audit_log).
 */
// Borne dure de l'ajustement de quota : ±1_000_000 unites. Sans plafond, un delta
// enorme (> 2^31) deborde `int` cote base -> « integer out of range » (500). Plafond
// large mais fini = garde-fou de forme (le montant reel reste tres en-deca).
const DELTA_MAX = 1_000_000;

export const topUpSchema = z.object({
  delta: z
    .number()
    .int()
    .min(-DELTA_MAX)
    .max(DELTA_MAX)
    .refine((v) => v !== 0, { message: 'delta ne peut pas etre nul' }),
  motif: z.string().trim().min(1).max(500),
});
export type TopUpDto = z.infer<typeof topUpSchema>;

/**
 * POST /admin/orgs/:orgId/subscription/renew — renouvelle : reset consommation + nouvelle
 * fenetre. `dateDebut` <= `dateFin` (re-verifie en base). z.coerce.date accepte une
 * chaine ISO cote client.
 */
export const renewSchema = z
  .object({
    dateDebut: z.coerce.date(),
    dateFin: z.coerce.date(),
  })
  .refine((v) => v.dateDebut <= v.dateFin, {
    message: 'dateDebut doit preceder dateFin',
    path: ['dateFin'],
  });
export type RenewDto = z.infer<typeof renewSchema>;

/**
 * PATCH /admin/orgs/:orgId/subscription/entitlements — edite le pack + les modules
 * debloques. `entitlements` peut etre vide (aucun module). Ne touche ni quota ni
 * fenetre ni consommation.
 */
export const entitlementsSchema = z.object({
  pack: z.string().trim().min(1).max(100),
  entitlements: z.array(z.string().trim().min(1).max(100)).max(50),
});
export type EntitlementsDto = z.infer<typeof entitlementsSchema>;

/**
 * PATCH /admin/orgs/:orgId/members/:userId/role — change le role tenant. OWNER EXCLU
 * (l'unicite de l'OWNER se gere a la creation d'org / transfert explicite ; la base
 * refuse OWNER en defense de profondeur). Retrograder le dernier OWNER actif -> 409.
 */
export const setRoleSchema = z.object({
  role: z.enum(['ADMIN', 'ENGINEER', 'TECHNICIAN', 'VIEWER']),
});
export type SetRoleDto = z.infer<typeof setRoleSchema>;

/**
 * PATCH /admin/orgs/:orgId/status — suspension / (re)activation / archivage d'une org.
 * L'effet REEL de SUSPENDED/ARCHIVED (perte d'acces des membres) est porte par
 * auth_user_has_membership (redefinie en 0013), au prochain appel.
 */
export const setOrgStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']),
});
export type SetOrgStatusDto = z.infer<typeof setOrgStatusSchema>;

/**
 * GET /admin/orgs/:orgId/audit?limit=&offset= — journal d'audit de l'org. Borne (limit
 * plafonne a 100 cote base, defaut 50). offset >= 0.
 */
export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

/* ===================================================================
 *  VAGUE 2 — comptes GLOBAUX + rattachement d'abo + transfert d'OWNER
 * =================================================================== */

/** Param de route UUID (userId d'un compte EXISTANT, cible d'une action GLOBALE). */
export const mutUserGlobalIdParam = z.string().uuid();

/**
 * PATCH /admin/users/:userId/active — desactive (false) / reactive (true) un compte
 * GLOBALEMENT (users.is_active). L'anti auto-desactivation (un SUPERADMIN qui se coupe
 * l'acces) est porte cote base (R0009 -> 400) : l'acteur vient du sub JWT, jamais du corps.
 */
export const setUserActiveSchema = z.object({
  active: z.boolean(),
});
export type SetUserActiveDto = z.infer<typeof setUserActiveSchema>;

/**
 * POST /admin/users/:userId/reset-password — reset admin du mot de passe. `newPassword`
 * suit les MEMES regles que createUserSchema (min 12 / max 1024, borne haute = anti-DoS
 * argon2). Le hash est calcule COTE SERVICE ; ni le mdp ni le hash n'entrent dans l'audit
 * (seul `motif`, optionnel, est trace).
 */
export const resetPasswordSchema = z.object({
  newPassword: z.string().min(12).max(1024),
  motif: z.string().trim().min(1).max(500).optional(),
});
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;

/**
 * POST /admin/orgs/:orgId/subscription — rattache un abonnement a une org EXISTANTE sans
 * abo. Meme forme que subscriptionInputSchema (pack whiteliste, entitlements, fenetre, quota
 * fini). La base REFUSE si un abo ACTIF existe deja (409) ; un abo EXPIRE est remplace.
 */
export const attachSubscriptionSchema = z
  .object({
    pack: z.enum(['ROUTES', 'FONDATIONS', 'COMPLETE']),
    entitlements: z.array(z.string().trim().min(1)).min(1),
    dateDebut: z.coerce.date(),
    dateFin: z.coerce.date(),
    quota: z.number().int().min(0),
  })
  .refine((v) => v.dateDebut <= v.dateFin, {
    message: 'dateDebut doit preceder dateFin',
    path: ['dateFin'],
  });
export type AttachSubscriptionDto = z.infer<typeof attachSubscriptionSchema>;

/**
 * PATCH /admin/orgs/:orgId/owner — transfert d'OWNER. `newOwnerUserId` DOIT etre un membre
 * ACTIF de l'org (re-verifie en base : R0011 -> 400). L'ancien OWNER est retrograde ADMIN.
 */
export const transferOwnerSchema = z.object({
  newOwnerUserId: z.string().uuid(),
});
export type TransferOwnerDto = z.infer<typeof transferOwnerSchema>;
