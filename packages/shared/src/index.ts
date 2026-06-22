import { z } from 'zod';

// Contrats partages client <-> serveur (schemas Zod). Importable par apps/api ET apps/web.
// Ne contient AUCUNE logique de calcul (celle-ci vit dans @roadsen/engines, server-only).

/** Identifiant d'organisation (tenant). */
export const OrgIdSchema = z.string().uuid();
export type OrgId = z.infer<typeof OrgIdSchema>;

/**
 * Contrat de la sonde de sante (`GET /v1/health`). Defini cote partage pour que
 * le front et le back parlent la meme forme — la reponse serveur est validee
 * contre ce schema (pas de duplication de la forme cote API).
 */
export const HealthStatusSchema = z.object({
  status: z.literal('ok'),
});
export type HealthStatus = z.infer<typeof HealthStatusSchema>;
