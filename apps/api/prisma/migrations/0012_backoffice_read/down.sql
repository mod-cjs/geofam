-- =====================================================================
--  ROADSEN — Rollback de la migration 0012 (back-office SUPERADMIN, lecture)
--
--  ROADSEN-MIGRATION-REVIEWED: dev-backend (build) — plan de rollback.
--
--  Prisma Migrate ne joue PAS les « down » : plan DOCUMENTE, applique a la main.
--  Ordre INVERSE de migration.sql. ATOMIQUE (BEGIN/COMMIT). Applicable sous un
--  user CREATEROLE non-superuser (aucun BYPASSRLS requis).
--
--  0012 est PUREMENT ADDITIVE (3 fonctions de lecture, aucune donnee, aucun GRANT
--  DML) : le rollback se limite a DROP les 3 fonctions. Rien d'autre a restaurer.
-- =====================================================================

BEGIN;

DROP FUNCTION IF EXISTS "admin_search_users"(text, int);
DROP FUNCTION IF EXISTS "admin_get_org"(uuid);
DROP FUNCTION IF EXISTS "admin_list_orgs"(int, int, text);

COMMIT;
