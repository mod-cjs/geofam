-- =====================================================================
--  ROADSEN — Rollback de la migration 0021 (durcissement des courses)
--
--  ROADSEN-MIGRATION-REVIEWED: dev-backend (build) — plan de rollback.
--
--  Prisma Migrate ne joue PAS les « down » : plan DOCUMENTE, applique a la main.
--  0021 a fait CREATE OR REPLACE de TROIS fonctions PREEXISTANTES ; le rollback ne les
--  DROP donc PAS — il RESTAURE leurs corps d'avant-0021 A L'IDENTIQUE :
--    - remove_member    (4-arg) -> corps 0020 (HARD DELETE, SANS le FOR UPDATE) ;
--    - set_member_role  (5-arg) -> corps 0013 (SANS le FOR UPDATE) ;
--    - set_member_active(3-arg) -> corps 0011 (SANS la garde one-org de reactivation).
--  Memes signatures, memes proprietaires, memes GRANT EXECUTE. ATOMIQUE (BEGIN/COMMIT).
--  Applicable sous un user membre de roadsen_auth + CREATE sur le schema, NON-superuser.
--  NON DESTRUCTIF (aucune donnee touchee ; on ne re-touche PAS le GRANT DELETE de 0020,
--  toujours requis par le HARD DELETE restaure).
--
--  ATTENTION : revenir en arriere RE-OUVRE les courses fermees par 0021 (org sans OWNER
--  via retrait/transfert concurrents ; multi-org via reactivation). A ne faire qu'en cas
--  de regression AVEREE, en binome ingenieur-securite, de preference en re-corrigeant.
-- =====================================================================

SET lock_timeout = '3s';

BEGIN;

-- Pre-requis ALTER OWNER (self-contenu).
GRANT "roadsen_auth" TO CURRENT_USER;
GRANT USAGE, CREATE ON SCHEMA public TO "roadsen_auth";

-- 1) remove_member (4-arg) — RESTAURE le corps 0020 (HARD DELETE, SANS FOR UPDATE).
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
    jsonb_build_object('role', v_role, 'mode', 'HARD'),
    p_idempotency_key
  )
  ON CONFLICT ("idempotency_key") DO NOTHING
  RETURNING "id" INTO v_audit;

  IF v_audit IS NULL THEN
    PERFORM set_config('app.auth_bootstrap', 'off', true);
    RETURN;
  END IF;

  DELETE FROM "memberships"
  WHERE "org_id" = p_org_id AND "user_id" = p_user_id;

  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- 2) set_member_role (5-arg) — RESTAURE le corps 0013 (SANS FOR UPDATE).
CREATE OR REPLACE FUNCTION "set_member_role"(
  p_org_id          uuid,
  p_user_id         uuid,
  p_role            "Role",
  p_actor           uuid,
  p_idempotency_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_current "Role";
  owners    int;
  v_audit   uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'set_member_role: p_actor requis';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'set_member_role: idempotency_key requis';
  END IF;
  IF p_role = 'OWNER' THEN
    RAISE EXCEPTION 'set_member_role: OWNER interdit par cette voie' USING ERRCODE = 'R0007';
  END IF;

  PERFORM set_config('app.auth_bootstrap', 'on', true);

  SELECT m."role" INTO v_current
  FROM "memberships" m
  WHERE m."org_id" = p_org_id AND m."user_id" = p_user_id;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'set_member_role: membre introuvable' USING ERRCODE = 'R0005';
  END IF;

  IF v_current = 'OWNER' AND p_role <> 'OWNER' THEN
    SELECT count(*) INTO owners FROM (
      SELECT 1 FROM "memberships" m
      WHERE m."org_id" = p_org_id AND m."role" = 'OWNER' AND m."is_active" = true
      FOR UPDATE
    ) locked;
    IF owners <= 1 THEN
      RAISE EXCEPTION 'set_member_role: dernier OWNER actif (anti-lockout)' USING ERRCODE = 'R0008';
    END IF;
  END IF;

  INSERT INTO "admin_audit_log"
    ("actor_user_id", "action", "target_org_id", "target_user_id", "payload", "idempotency_key")
  VALUES (
    p_actor, 'MEMBER_ROLE_SET', p_org_id, p_user_id,
    jsonb_build_object('role_before', v_current, 'role_after', p_role),
    p_idempotency_key
  )
  ON CONFLICT ("idempotency_key") DO NOTHING
  RETURNING "id" INTO v_audit;

  IF v_audit IS NULL THEN
    PERFORM set_config('app.auth_bootstrap', 'off', true);
    RETURN;
  END IF;

  UPDATE "memberships" SET "role" = p_role
  WHERE "org_id" = p_org_id AND "user_id" = p_user_id;

  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- 3) set_member_active (3-arg) — RESTAURE le corps 0011 (SANS garde one-org).
CREATE OR REPLACE FUNCTION "set_member_active"(
  p_org_id  uuid,
  p_user_id uuid,
  p_active  boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  tgt_role "Role";
  owners   int;
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);

  SELECT m."role" INTO tgt_role
  FROM "memberships" m
  WHERE m."org_id" = p_org_id AND m."user_id" = p_user_id;

  IF tgt_role IS NULL THEN
    RAISE EXCEPTION 'set_member_active: membre introuvable';
  END IF;

  IF tgt_role = 'OWNER' AND p_active = false THEN
    SELECT count(*) INTO owners FROM (
      SELECT 1
      FROM "memberships" m
      WHERE m."org_id" = p_org_id AND m."role" = 'OWNER' AND m."is_active" = true
      FOR UPDATE
    ) locked;
    IF owners <= 1 THEN
      RAISE EXCEPTION 'set_member_active: dernier OWNER actif (anti-lockout)';
    END IF;
  END IF;

  UPDATE "memberships" SET "is_active" = p_active
  WHERE "org_id" = p_org_id AND "user_id" = p_user_id;

  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- 4) Propriete + EXECUTE (re-affirmes, identiques a l'etat pre-0021).
ALTER FUNCTION "remove_member"(uuid, uuid, uuid, text)            OWNER TO "roadsen_auth";
ALTER FUNCTION "set_member_role"(uuid, uuid, "Role", uuid, text)  OWNER TO "roadsen_auth";
ALTER FUNCTION "set_member_active"(uuid, uuid, boolean)           OWNER TO "roadsen_auth";

REVOKE ALL ON FUNCTION "remove_member"(uuid, uuid, uuid, text)            FROM PUBLIC;
REVOKE ALL ON FUNCTION "set_member_role"(uuid, uuid, "Role", uuid, text)  FROM PUBLIC;
REVOKE ALL ON FUNCTION "set_member_active"(uuid, uuid, boolean)           FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "remove_member"(uuid, uuid, uuid, text)           TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "set_member_role"(uuid, uuid, "Role", uuid, text) TO "roadsen_app";
-- set_member_active(3-arg) : reste ferme a roadsen_app (0014 §7).

COMMIT;
