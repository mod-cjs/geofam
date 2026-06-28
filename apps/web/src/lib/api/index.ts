/**
 * Point d'entrée public de la couche API.
 * Swap backend = poser NEXT_PUBLIC_API_BASE_URL ; client.ts bascule automatiquement.
 */
export * from './client';
export * from './types';
export type { DemoScenario } from './mock-data';
// Utilitaires JWT exposés pour la résolution d'org (composants, providers)
export { decodeJwtPayload, deriveOrgId } from './http-client';
