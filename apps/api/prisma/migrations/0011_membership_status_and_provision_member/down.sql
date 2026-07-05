-- =====================================================================
--  ROADSEN — Rollback de la migration 0010 (accès contrôlés multi-membres)
--
--  ROADSEN-MIGRATION-REVIEWED: dev-backend (build) — plan de rollback.
--
--  Prisma Migrate ne joue PAS les « down » : plan DOCUMENTÉ, appliqué à la main.
--  Ordre INVERSE de migration.sql. ATOMIQUE (BEGIN/COMMIT). Applicable sous un
--  user CREATEROLE non-superuser (aucun BYPASSRLS requis).
--
--  CIBLE = état POST-0007 : auth_user_has_membership SANS le filtre is_active,
--  memberships SANS la colonne is_active, roadsen_auth SANS UPDATE sur memberships.
-- =====================================================================

BEGIN;

-- 1) Supprime les 3 fonctions introduites par 0010 (elles référencent is_active).
DROP FUNCTION IF EXISTS "list_org_members"(uuid);
DROP FUNCTION IF EXISTS "set_member_active"(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS "provision_member"(uuid, uuid, "Role");

-- 2) Retire le GRANT UPDATE sur memberships ajouté pour set_member_active.
REVOKE UPDATE ON "memberships" FROM "roadsen_auth";

-- 3) Restaure auth_user_has_membership dans sa forme 0007 (SANS le filtre
--    is_active), plpgsql + drapeau. CREATE OR REPLACE préserve owner + GRANTs.
CREATE OR REPLACE FUNCTION "auth_user_has_membership"(
  p_user_id uuid,
  p_org_id  uuid
)
RETURNS TABLE (role "Role")
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);
  RETURN QUERY
    SELECT m."role"
    FROM "memberships" m
    WHERE m."user_id" = p_user_id
      AND m."org_id"  = p_org_id
    LIMIT 1;
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- 4) Supprime la colonne EN DERNIER (plus aucune fonction ne la référence).
ALTER TABLE "memberships" DROP COLUMN IF EXISTS "is_active";

COMMIT;
