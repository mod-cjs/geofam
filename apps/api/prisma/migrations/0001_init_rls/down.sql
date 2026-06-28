-- =====================================================================
--  ROADSEN — Rollback de la migration 0001 (init + RLS FORCE)
--
--  Prisma Migrate ne joue PAS automatiquement les "down" : ce fichier est
--  le plan de rollback DOCUMENTE, a appliquer manuellement (psql) en cas de
--  besoin AVANT toute mise en prod. Ordre inverse de migration.sql.
--
--  ATTENTION : DROP TABLE detruit les donnees. A n'utiliser qu'en dev/preprod
--  ou apres sauvegarde verifiee. Sur une base partagee multi-tenant, tout
--  rollback se fait en binome avec ingenieur-securite (test d'isolation
--  post-rollback) — cf. CLAUDE.md.
-- =====================================================================

-- 1) Policies + RLS (l'ordre n'a pas d'importance, mais on detache d'abord)
DROP POLICY IF EXISTS "tenant_isolation" ON "projects";
DROP POLICY IF EXISTS "tenant_isolation" ON "memberships";
ALTER TABLE IF EXISTS "projects"    NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "projects"    DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "memberships" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "memberships" DISABLE ROW LEVEL SECURITY;

-- 2) Droits & role applicatif
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM "roadsen_app";
-- (on ne DROP pas le role par defaut : il peut etre partage / detenir des
--  objets. Le decommissionnement du role est une operation a part.)

-- 3) Tables (ordre inverse des FK)
DROP TABLE IF EXISTS "projects";
DROP TABLE IF EXISTS "memberships";
DROP TABLE IF EXISTS "users";
DROP TABLE IF EXISTS "organizations";

-- 4) Types
DROP TYPE IF EXISTS "ProjectStatus";
DROP TYPE IF EXISTS "PlatformRole";
DROP TYPE IF EXISTS "Role";
DROP TYPE IF EXISTS "OrgStatus";
