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
