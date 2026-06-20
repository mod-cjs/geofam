import { z } from 'zod';

// Contrats partages client <-> serveur (schemas Zod). Importable par apps/api ET apps/web.
// Ne contient AUCUNE logique de calcul (celle-ci vit dans @roadsen/engines, server-only).

/** Identifiant d'organisation (tenant). */
export const OrgIdSchema = z.string().uuid();
export type OrgId = z.infer<typeof OrgIdSchema>;
