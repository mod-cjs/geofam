import { z } from 'zod';

/**
 * Schemas Zod des entrees auth. La validation se fait a la FRONTIERE (controleur)
 * via ZodValidationPipe : jamais se fier au client. Tout corps malforme -> 400
 * AVANT d'atteindre la logique metier ou la base.
 */

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(1024), // borne haute = anti-DoS argon2
});
export type LoginDto = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(4096),
});
export type RefreshDto = z.infer<typeof refreshSchema>;

/**
 * Onboarding SUPERADMIN — creation d'un utilisateur (POST /admin/users).
 * Le mot de passe INITIAL est borne (min 12 / max 1024) : exigence de longueur
 * raisonnable a la creation par un SUPERADMIN, borne haute = anti-DoS argon2.
 * fullName non vide et borne. email normalise (trim+lower) comme au login.
 */
export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(12).max(1024),
  fullName: z.string().trim().min(1).max(200),
});
export type CreateUserDto = z.infer<typeof createUserSchema>;

/**
 * Onboarding SUPERADMIN — creation d'une organisation (POST /admin/orgs).
 * ownerUserId DOIT etre un user EXISTANT (le 1er OWNER du bureau) : c'est un
 * UUID, valide par provision_org (FK) + verifie cote service (erreur bornee si
 * absent). slug borne au format kebab (lettres/chiffres/tirets) pour rester une
 * cle d'URL propre et eviter les surprises d'unicite.
 */
/**
 * Bloc abonnement OPTIONNEL a la creation d'org (ADR 0009/0011, provisionnement
 * manuel SUPERADMIN en P1). Si fourni, l'abonnement est cree avec l'org (pack +
 * modules debloques + fenetre de validite + quota fini). Dates en ISO 8601
 * (coerce -> Date). quota entier >= 0 (NON-NULL : le decompte atomique WHERE
 * consommation < quota casserait sur NULL). entitlements = liste des SLUGS de
 * moteurs debloques (cle des `modules` de /me/entitlements et du selecteur C-01).
 */
export const subscriptionInputSchema = z.object({
  pack: z.enum(['ROUTES', 'FONDATIONS', 'COMPLETE']),
  entitlements: z.array(z.string().trim().min(1)).min(1),
  dateDebut: z.coerce.date(),
  dateFin: z.coerce.date(),
  quota: z.number().int().min(0),
});
export type SubscriptionInputDto = z.infer<typeof subscriptionInputSchema>;

export const createOrgSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
      message: 'slug invalide (kebab-case attendu : a-z, 0-9, tirets)',
    }),
  ownerUserId: z.string().uuid(),
  // Optionnel : si absent, l'org est creee SANS abonnement (le SubscriptionGuard
  // barrera alors tout calcul/PV en 403 NoSubscription tant qu'un abonnement
  // n'est pas provisionne — fail-closed cote acces, coherent avec ADR 0011 §2.1).
  subscription: subscriptionInputSchema.optional(),
});
export type CreateOrgDto = z.infer<typeof createOrgSchema>;
