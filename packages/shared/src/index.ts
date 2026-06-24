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
 *
 * `env` / `science` sont OPTIONNELS (compat ascendante : un consommateur qui ne
 * verifie que `status:'ok'` reste valide). Ils identifient l'environnement et
 * l'etat scientifique : en RECETTE, l'API renvoie `{ env:'recette',
 * science:'unsigned' }` — justesse non validee tant que le kit cas-tests
 * STARFIRE n'est pas signe (MJ-6 : pas de mise en production).
 */
export const DeployEnvSchema = z.enum(['recette', 'production']);
export type DeployEnv = z.infer<typeof DeployEnvSchema>;

export const ScienceStatusSchema = z.enum(['unsigned', 'signed']);
export type ScienceStatus = z.infer<typeof ScienceStatusSchema>;

export const HealthStatusSchema = z.object({
  status: z.literal('ok'),
  env: DeployEnvSchema.optional(),
  science: ScienceStatusSchema.optional(),
});
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

// Contrat d I/O des moteurs (enveloppe de resultat, whitelist de sortie,
// detail d erreur sur, bornage des entrees persistees). AUCUN symbole moteur.
export * from './engine-io.js';
// Exemple de reference du pattern (moteur fictif, sans science).
export * from './engine-io.reference.js';
