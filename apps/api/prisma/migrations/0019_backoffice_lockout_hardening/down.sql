-- =====================================================================
--  ROADSEN — Rollback de la migration 0019 (durcissement anti-lockout)
--
--  ROADSEN-MIGRATION-REVIEWED: dev-backend (build) — plan de rollback.
--
--  Prisma Migrate ne joue PAS les « down » : plan DOCUMENTE, applique a la main.
--  0019 a fait CREATE OR REPLACE de DEUX fonctions PREEXISTANTES ; le rollback ne les
--  DROP donc PAS — il RESTAURE leurs corps d'origine A L'IDENTIQUE :
--    - admin_set_user_active  -> version 0015 (SANS la garde R0013 ; R0009 seul) ;
--    - auth_get_platform_role -> version 0007 (SANS le filtre is_active).
--  Memes signatures, memes proprietaires, memes GRANT : rien a re-accorder/re-revoquer.
--  ATOMIQUE (BEGIN/COMMIT). Applicable sous un user membre de roadsen_auth + CREATE sur le
--  schema, NON-superuser (aucun BYPASSRLS requis). NON DESTRUCTIF (aucune donnee touchee).
--
--  ATTENTION SECURITE : revenir en arriere RE-OUVRE les deux trous (lockout inter-chemins +
--  SUPERADMIN desactive garde l'acces). A ne faire qu'en cas de regression averee, en binome
--  ingenieur-securite, et de preference en re-corrigeant plutot qu'en rollbackant.
-- =====================================================================

SET lock_timeout = '3s';

BEGIN;

-- Pre-requis ALTER OWNER (self-contenu).
GRANT "roadsen_auth" TO CURRENT_USER;
GRANT USAGE, CREATE ON SCHEMA public TO "roadsen_auth";

-- 1) admin_set_user_active — RESTAURE le corps 0015 (R0009 seul, PAS de R0013).
CREATE OR REPLACE FUNCTION "admin_set_user_active"(
  p_user_id         uuid,
  p_active          boolean,
  p_actor           uuid,
  p_idempotency_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_before boolean;
  v_audit  uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'admin_set_user_active: p_actor requis';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'admin_set_user_active: idempotency_key requis';
  END IF;
  IF p_user_id = p_actor AND p_active = false THEN
    RAISE EXCEPTION 'admin_set_user_active: auto-desactivation interdite' USING ERRCODE = 'R0009';
  END IF;

  PERFORM set_config('app.auth_bootstrap', 'on', true);

  SELECT u."is_active" INTO v_before
  FROM "users" u
  WHERE u."id" = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_set_user_active: utilisateur introuvable' USING ERRCODE = 'R0005';
  END IF;

  INSERT INTO "admin_audit_log"
    ("actor_user_id", "action", "target_user_id", "payload", "idempotency_key")
  VALUES (
    p_actor, 'USER_ACTIVE_SET', p_user_id,
    jsonb_build_object('is_active_before', v_before, 'is_active_after', p_active),
    p_idempotency_key
  )
  ON CONFLICT ("idempotency_key") DO NOTHING
  RETURNING "id" INTO v_audit;

  IF v_audit IS NULL THEN
    PERFORM set_config('app.auth_bootstrap', 'off', true);
    RETURN;
  END IF;

  UPDATE "users" SET "is_active" = p_active, "updated_at" = now()
  WHERE "id" = p_user_id;

  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- 2) auth_get_platform_role — RESTAURE le corps 0007 (SANS filtre is_active).
CREATE OR REPLACE FUNCTION "auth_get_platform_role"(p_user_id uuid)
RETURNS "PlatformRole"
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role "PlatformRole";
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);
  SELECT u."platform_role" INTO v_role
  FROM "users" u
  WHERE u."id" = p_user_id
  LIMIT 1;
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RETURN v_role;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- 3) Propriete + EXECUTE (re-affirmes, identiques).
ALTER FUNCTION "admin_set_user_active"(uuid, boolean, uuid, text) OWNER TO "roadsen_auth";
ALTER FUNCTION "auth_get_platform_role"(uuid)                     OWNER TO "roadsen_auth";

REVOKE ALL ON FUNCTION "admin_set_user_active"(uuid, boolean, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "auth_get_platform_role"(uuid)                     FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "admin_set_user_active"(uuid, boolean, uuid, text) TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "auth_get_platform_role"(uuid)                     TO "roadsen_app";

COMMIT;
