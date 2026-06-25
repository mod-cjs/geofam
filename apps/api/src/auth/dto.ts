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
});
export type CreateOrgDto = z.infer<typeof createOrgSchema>;
