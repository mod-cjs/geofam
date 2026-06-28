/**
 * Setup GLOBAL des e2e (charge avant chaque suite via jest-e2e.json > setupFiles).
 *
 * Par DEFAUT, on N'EXPOSE PAS la doc OpenAPI dans les e2e (ROADSEN_SKIP_DOCS=1).
 * Raison : la GENERATION du document Swagger sur les DTO Zod volumineux des 6
 * moteurs est CPU-lourde (~dizaines de s sur certaines machines) et faisait
 * TIMEOUT les beforeAll (30 s) des suites qui ne testent meme pas /docs (calc-*,
 * recette-access...). Seule la suite openapi-doc.e2e a besoin du document : elle
 * RETIRE explicitement ce flag (et pose ROADSEN_EXPOSE_DOCS=1) dans son beforeAll.
 *
 * Effet nul hors e2e : ce flag n'est lu que par configureApp() et n'existe pas en
 * prod (qui ne charge pas ce setup).
 */
process.env.ROADSEN_SKIP_DOCS ??= '1';
