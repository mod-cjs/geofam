-- =====================================================================
--  ROADSEN — Rollback de la migration 0020 (one-org enforcement + hard remove)
--
--  ROADSEN-MIGRATION-REVIEWED: dev-backend (build) — plan de rollback.
--
--  Prisma Migrate ne joue PAS les « down » : plan DOCUMENTE, applique a la main.
--  0020 a fait CREATE OR REPLACE de TROIS fonctions PREEXISTANTES ; le rollback ne les
--  DROP donc PAS — il RESTAURE leurs corps d'origine A L'IDENTIQUE :
--    - provision_member (3-arg) -> version 0011 (SANS garde one-org ni advisory) ;
--    - provision_org    (3-arg) -> version 0007 (SANS garde one-org ni advisory) ;
--    - remove_member    (4-arg) -> version 0013 (SOFT : UPDATE is_active=false).
--  Puis REVOKE DELETE ON memberships FROM roadsen_auth (le SOFT n'en a pas besoin).
--  Memes signatures, memes proprietaires, memes GRANT EXECUTE (0014 §7 preserve).
--  ATOMIQUE (BEGIN/COMMIT). Applicable sous un user membre de roadsen_auth + CREATE sur
--  le schema, NON-superuser (aucun BYPASSRLS requis). NON DESTRUCTIF (aucune donnee touchee).
--
--  ATTENTION : revenir en arriere RE-AUTORISE le multi-org (un user dans plusieurs orgs)
--  et RE-TRANSFORME le retrait en simple suspension. A ne faire qu'en cas de regression
--  averee, en binome ingenieur-securite, de preference en re-corrigeant plutot qu'en
--  rollbackant. Les appartenances DEJA supprimees par un HARD DELETE ne reviennent PAS.
-- =====================================================================

SET lock_timeout = '3s';

BEGIN;

-- Pre-requis ALTER OWNER (self-contenu).
GRANT "roadsen_auth" TO CURRENT_USER;
GRANT USAGE, CREATE ON SCHEMA public TO "roadsen_auth";

-- 1) provision_member (3-arg) — RESTAURE le corps 0011 (SANS garde one-org).
CREATE OR REPLACE FUNCTION "provision_member"(
  p_org_id  uuid,
  p_user_id uuid,
  p_role    "Role"
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v    uuid := gen_random_uuid();
  prev text := COALESCE(current_setting('app.current_org', true), '');
BEGIN
  IF p_role = 'OWNER' THEN
    RAISE EXCEPTION 'provision_member: OWNER interdit par cette voie';
  END IF;

  PERFORM set_config('app.auth_bootstrap', 'on', true);
  PERFORM set_config('app.current_org', p_org_id::text, true);

  INSERT INTO "memberships" ("id", "org_id", "user_id", "role")
  VALUES (v, p_org_id, p_user_id, p_role);

  PERFORM set_config('app.current_org', prev, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.current_org', prev, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- 2) provision_org (3-arg) — RESTAURE le corps 0007 (SANS garde one-org).
CREATE OR REPLACE FUNCTION "provision_org"(
  p_name          text,
  p_slug          text,
  p_owner_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org_id   uuid := gen_random_uuid();
  v_prev_org text := COALESCE(current_setting('app.current_org', true), '');
BEGIN
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'provision_org: p_name requis';
  END IF;
  IF p_slug IS NULL OR length(btrim(p_slug)) = 0 THEN
    RAISE EXCEPTION 'provision_org: p_slug requis';
  END IF;
  IF p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'provision_org: p_owner_user_id requis';
  END IF;

  PERFORM set_config('app.auth_bootstrap', 'on', true);
  PERFORM set_config('app.current_org', v_org_id::text, true);

  INSERT INTO "organizations" ("id", "name", "slug", "updatedAt")
  VALUES (v_org_id, p_name, p_slug, CURRENT_TIMESTAMP);

  INSERT INTO "memberships" ("org_id", "user_id", "role")
  VALUES (v_org_id, p_owner_user_id, 'OWNER');

  PERFORM set_config('app.current_org', v_prev_org, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RETURN v_org_id;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.current_org', v_prev_org, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- 3) remove_member (4-arg) — RESTAURE le corps 0013 (SOFT : UPDATE is_active=false).
CREATE OR REPLACE FUNCTION "remove_member"(
  p_org_id          uuid,
  p_user_id         uuid,
  p_actor           uuid,
  p_idempotency_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role   "Role";
  owners   int;
  v_audit  uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'remove_member: p_actor requis';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'remove_member: idempotency_key requis';
  END IF;

  PERFORM set_config('app.auth_bootstrap', 'on', true);

  SELECT m."role" INTO v_role
  FROM "memberships" m
  WHERE m."org_id" = p_org_id AND m."user_id" = p_user_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'remove_member: membre introuvable' USING ERRCODE = 'R0005';
  END IF;

  IF v_role = 'OWNER' THEN
    SELECT count(*) INTO owners FROM (
      SELECT 1 FROM "memberships" m
      WHERE m."org_id" = p_org_id AND m."role" = 'OWNER' AND m."is_active" = true
      FOR UPDATE
    ) locked;
    IF owners <= 1 THEN
      RAISE EXCEPTION 'remove_member: dernier OWNER actif (anti-lockout)' USING ERRCODE = 'R0008';
    END IF;
  END IF;

  INSERT INTO "admin_audit_log"
    ("actor_user_id", "action", "target_org_id", "target_user_id", "payload", "idempotency_key")
  VALUES (
    p_actor, 'MEMBER_REMOVED', p_org_id, p_user_id,
    jsonb_build_object('role', v_role, 'mode', 'SOFT'),
    p_idempotency_key
  )
  ON CONFLICT ("idempotency_key") DO NOTHING
  RETURNING "id" INTO v_audit;

  IF v_audit IS NULL THEN
    PERFORM set_config('app.auth_bootstrap', 'off', true);
    RETURN;
  END IF;

  UPDATE "memberships" SET "is_active" = false
  WHERE "org_id" = p_org_id AND "user_id" = p_user_id;

  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- 4) Propriete + EXECUTE (re-affirmes, identiques) + REVOKE du DELETE ajoute en 0020.
ALTER FUNCTION "provision_member"(uuid, uuid, "Role")   OWNER TO "roadsen_auth";
ALTER FUNCTION "provision_org"(text, text, uuid)         OWNER TO "roadsen_auth";
ALTER FUNCTION "remove_member"(uuid, uuid, uuid, text)   OWNER TO "roadsen_auth";

REVOKE ALL ON FUNCTION "provision_member"(uuid, uuid, "Role")  FROM PUBLIC;
REVOKE ALL ON FUNCTION "provision_org"(text, text, uuid)       FROM PUBLIC;
REVOKE ALL ON FUNCTION "remove_member"(uuid, uuid, uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "remove_member"(uuid, uuid, uuid, text) TO "roadsen_app";

-- Le SOFT n'ecrit plus memberships que par UPDATE (deja accorde en 0011) : on retire
-- le DELETE ajoute en 0020 (defense en profondeur ; roadsen_auth n'en a plus besoin).
REVOKE DELETE ON "memberships" FROM "roadsen_auth";

COMMIT;
