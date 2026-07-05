-- =====================================================================
--  ROADSEN — Rollback de la migration 0014 (tableau de bord + vues globales)
--
--  ROADSEN-MIGRATION-REVIEWED: dev-backend (build) — plan de rollback.
--
--  Prisma Migrate ne joue PAS les « down » : plan DOCUMENTE, applique a la main.
--  Ordre INVERSE de migration.sql. ATOMIQUE (BEGIN/COMMIT). Aucun BYPASSRLS requis.
--
--  CIBLE = etat POST-0013 : admin_list_orgs(int,int,text) et admin_list_audit(uuid,int,int)
--  dans leur forme 0012/0013 ; PAS de surcharges d'onboarding a 4 args ; PAS de policy
--  stats_bootstrap_read ; PAS de admin_platform_stats. Les corps d'origine (arite 3) de
--  provision_user/org/member + set_member_active ne sont PAS touches par 0014 -> rien a
--  restaurer sur eux.
-- =====================================================================

BEGIN;

-- 1) Surcharges d'onboarding a 4 args (backport audit) : simple DROP (les corps arite-3
--    d'origine restent intacts).
DROP FUNCTION IF EXISTS "set_member_active"(uuid, uuid, boolean, uuid);
DROP FUNCTION IF EXISTS "provision_member"(uuid, uuid, "Role", uuid);
DROP FUNCTION IF EXISTS "provision_org"(text, text, uuid, uuid);
DROP FUNCTION IF EXISTS "provision_user"(text, text, text, uuid);

-- 2) admin_platform_stats : DROP.
DROP FUNCTION IF EXISTS "admin_platform_stats"();

-- 3) admin_list_audit : DROP de la signature enrichie + RESTAURE la forme 0013 (uuid,int,int).
DROP FUNCTION IF EXISTS "admin_list_audit"(uuid, int, int, text, uuid, timestamptz, timestamptz);
CREATE OR REPLACE FUNCTION "admin_list_audit"(
  p_org_id uuid DEFAULT NULL,
  p_limit  int  DEFAULT 50,
  p_offset int  DEFAULT 0
)
RETURNS TABLE (
  id              uuid,
  actor_user_id   uuid,
  action          text,
  target_org_id   uuid,
  target_user_id  uuid,
  payload         jsonb,
  created_at      timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit  int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);
  RETURN QUERY
    SELECT a."id", a."actor_user_id", a."action", a."target_org_id",
           a."target_user_id", a."payload", a."created_at"
    FROM "admin_audit_log" a
    WHERE p_org_id IS NULL OR a."target_org_id" = p_org_id
    ORDER BY a."created_at" DESC, a."id" DESC
    LIMIT v_limit OFFSET v_offset;
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;
ALTER FUNCTION "admin_list_audit"(uuid, int, int)  OWNER TO "roadsen_auth";
REVOKE ALL ON FUNCTION "admin_list_audit"(uuid, int, int)  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "admin_list_audit"(uuid, int, int)  TO "roadsen_app";

-- 4) admin_list_orgs : DROP de la signature enrichie + RESTAURE la forme 0012 (int,int,text).
DROP FUNCTION IF EXISTS "admin_list_orgs"(int, int, text, "OrgStatus", text, text);
CREATE OR REPLACE FUNCTION "admin_list_orgs"(
  p_limit  int  DEFAULT 20,
  p_offset int  DEFAULT 0,
  p_q      text DEFAULT NULL
)
RETURNS TABLE (
  id          uuid,
  name        text,
  slug        text,
  status      "OrgStatus",
  created_at  timestamp,
  nb_membres  bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit  int := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_pat    text := CASE
                     WHEN p_q IS NULL OR length(btrim(p_q)) = 0 THEN NULL
                     ELSE '%' || replace(replace(replace(btrim(p_q),
                            '\', '\\'), '%', '\%'), '_', '\_') || '%'
                   END;
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);
  RETURN QUERY
    SELECT o."id", o."name", o."slug", o."status", o."createdAt" AS created_at,
           count(m."id") AS nb_membres
    FROM "organizations" o
    LEFT JOIN "memberships" m ON m."org_id" = o."id"
    WHERE v_pat IS NULL OR o."name" ILIKE v_pat OR o."slug" ILIKE v_pat
    GROUP BY o."id", o."name", o."slug", o."status", o."createdAt"
    ORDER BY o."name" ASC, o."id" ASC
    LIMIT v_limit OFFSET v_offset;
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;
ALTER FUNCTION "admin_list_orgs"(int, int, text)  OWNER TO "roadsen_auth";
REVOKE ALL ON FUNCTION "admin_list_orgs"(int, int, text)  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "admin_list_orgs"(int, int, text)  TO "roadsen_app";

-- 5) Policies de lecture bootstrap sur les tables de donnees + GRANT official_pvs.
DROP POLICY IF EXISTS "stats_bootstrap_read" ON "official_pvs";
DROP POLICY IF EXISTS "stats_bootstrap_read" ON "subscriptions";
REVOKE SELECT ON "official_pvs" FROM "roadsen_auth";

COMMIT;
