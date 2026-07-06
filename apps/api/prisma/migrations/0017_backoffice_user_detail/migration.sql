-- =====================================================================
--  ROADSEN — Migration 0017 : back-office SUPERADMIN, FICHE UTILISATEUR
--  ROADSEN-MIGRATION-REVIEWED: dev (build direct, partie SURE — lecture identite).
--
--  admin_get_user(p_user_id) : identite d'un user + la liste de ses appartenances
--  (org + role + statut). Patron IDENTITE de 0012 (admin_search_users) : SECURITY
--  DEFINER owned roadsen_auth, drapeau app.auth_bootstrap pose/referme sur tout chemin,
--  search_path fige, REVOKE PUBLIC + GRANT roadsen_app. LECTURE d'identite uniquement
--  (aucune donnee money/PV -> pas besoin du role-gate 0014). Idempotente. down.sql.
-- =====================================================================

GRANT "roadsen_auth" TO CURRENT_USER;
GRANT USAGE, CREATE ON SCHEMA public TO "roadsen_auth";

DROP FUNCTION IF EXISTS "admin_get_user"(uuid);
CREATE FUNCTION "admin_get_user"(p_user_id uuid)
RETURNS TABLE (
  user_id           uuid,
  email             text,
  full_name         text,
  platform_role     text,
  is_active         boolean,
  org_id            uuid,
  org_name          text,
  org_slug          text,
  org_status        text,
  membership_role   text,
  membership_active boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);

  RETURN QUERY
    SELECT
      u."id", u."email", u."full_name", u."platform_role"::text, u."is_active",
      o."id", o."name", o."slug", o."status"::text,
      m."role"::text, m."is_active"
    FROM "users" u
    LEFT JOIN "memberships" m ON m."user_id" = u."id"
    LEFT JOIN "organizations" o ON o."id" = m."org_id"
    WHERE u."id" = p_user_id
    ORDER BY o."name" NULLS LAST;

  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

ALTER FUNCTION "admin_get_user"(uuid) OWNER TO "roadsen_auth";
REVOKE ALL ON FUNCTION "admin_get_user"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "admin_get_user"(uuid) TO "roadsen_app";
