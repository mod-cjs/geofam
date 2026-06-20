/**
 * Workspace Vitest (confort local).
 *
 * Permet, depuis la racine : `pnpm exec vitest` ou `pnpm exec vitest run`
 * pour lancer d un coup les suites de tous les packages testables, avec un
 * rapport agrege.
 *
 * En CI, c est plutot `pnpm test` (= `turbo run test`) qui pilote, lancant le
 * script `test` de CHAQUE package (cache, parallelisme turbo). Les deux chemins
 * partagent la meme base (`vitest.shared.ts`) et restent donc coherents.
 *
 * apps/api utilise Jest (NestJS) et le job CI `integration` : il n est
 * VOLONTAIREMENT pas dans ce workspace Vitest.
 */
export default ['packages/shared', 'packages/engines'];
