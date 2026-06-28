-- =====================================================================
--  ROADSEN — Rollback de la migration 0002 (RLS users/orgs + provision_org)
--
--  Prisma Migrate ne joue PAS les "down" : plan de rollback DOCUMENTE, a
--  appliquer manuellement (psql), en binome avec ingenieur-securite (test
--  d'isolation post-rollback). Ordre inverse de migration.sql.
--
--  ATTENTION ISOLATION : ce rollback RETIRE la RLS sur organizations & users.
--  Apres application, le role roadsen_app peut de nouveau lire TOUS les
--  users (password_hash + PII) et toutes les orgs = retour du trou d'isolation
--  releve en revue. Ne l'appliquer QUE si aucun endpoint de listing users/orgs
--  n'est expose, et revenir a 0002 au plus vite. Tracer la decision.
-- =====================================================================

-- 1) Fonction de bootstrap : revoquer puis supprimer
REVOKE ALL ON FUNCTION "provision_org"(text, text, uuid) FROM "roadsen_app";
DROP FUNCTION IF EXISTS "provision_org"(text, text, uuid);

-- 2) users — policy + RLS
DROP POLICY IF EXISTS "tenant_isolation" ON "users";
ALTER TABLE IF EXISTS "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "users" DISABLE ROW LEVEL SECURITY;

-- 3) organizations — policy + RLS
DROP POLICY IF EXISTS "tenant_isolation" ON "organizations";
ALTER TABLE IF EXISTS "organizations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "organizations" DISABLE ROW LEVEL SECURITY;
