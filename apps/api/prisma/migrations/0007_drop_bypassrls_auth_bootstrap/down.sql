-- =====================================================================
--  ROADSEN — Rollback de la migration 0007 (suppression BYPASSRLS auth)
--
--  Prisma Migrate ne joue PAS les "down" : plan DOCUMENTE, applique a la main.
--  Ordre inverse de migration.sql. ATOMIQUE (BEGIN/COMMIT).
--
--  CIBLE DU ROLLBACK = etat POST-0004(revisee)/0005 : roadsen_auth NOBYPASSRLS,
--  owner des fonctions DEFINER (forme SANS drapeau), roadsen_app avec DML identite.
--  AVERTISSEMENT : dans cet etat (sans le drapeau de 0007), le login/provisioning
--  A FROID sont INOPERANTS (fonctions DEFINER soumises a la RLS). Ce down ne sert
--  donc qu'a revenir transitoirement a l'etat pre-0007 pour re-corriger/rejouer ;
--  il ne retablit PAS un systeme d'auth fonctionnel a lui seul. Applicable sous un
--  user CREATEROLE non-superuser (aucun BYPASSRLS requis ni recree).
-- =====================================================================

BEGIN;

-- 1) roadsen_auth en NOBYPASSRLS (etat post-0004 revisee ; pas de BYPASSRLS). -----
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roadsen_auth') THEN
    CREATE ROLE "roadsen_auth" NOLOGIN NOSUPERUSER NOBYPASSRLS;
  ELSE
    ALTER ROLE "roadsen_auth" NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO "roadsen_auth";
GRANT SELECT, INSERT ON "organizations", "memberships" TO "roadsen_auth";
GRANT SELECT, INSERT ON "users" TO "roadsen_auth";

-- 2) Restaure les fonctions DEFINER dans leur forme 0004/0005 (sans drapeau),
--    owned par roadsen_auth. (Formes resumees : voir 0003/0004/0005 pour le detail.)
CREATE OR REPLACE FUNCTION "auth_find_user_by_email"(p_email text)
RETURNS TABLE (id uuid, password_hash text, is_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT u."id", u."password_hash", u."is_active" FROM "users" u
      WHERE u."email" = lower(btrim(p_email)) LIMIT 1; $$;

CREATE OR REPLACE FUNCTION "auth_user_has_membership"(p_user_id uuid, p_org_id uuid)
RETURNS TABLE (role "Role")
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT m."role" FROM "memberships" m
      WHERE m."user_id" = p_user_id AND m."org_id" = p_org_id LIMIT 1; $$;

CREATE OR REPLACE FUNCTION "auth_get_platform_role"(p_user_id uuid)
RETURNS "PlatformRole"
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT u."platform_role" FROM "users" u WHERE u."id" = p_user_id LIMIT 1; $$;

CREATE OR REPLACE FUNCTION "provision_user"(p_email text, p_password_hash text, p_full_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE v_user_id uuid := gen_random_uuid(); v_email text := lower(btrim(p_email));
BEGIN
  INSERT INTO "users" ("id","email","password_hash","full_name","updated_at")
  VALUES (v_user_id, v_email, p_password_hash, btrim(p_full_name), CURRENT_TIMESTAMP);
  RETURN v_user_id;
END; $$;

CREATE OR REPLACE FUNCTION "auth_get_user_profile"(p_user_id uuid)
RETURNS TABLE (user_id uuid, email text, full_name text, platform_role "PlatformRole",
  org_id uuid, org_name text, org_slug text, membership_role "Role")
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT u."id", u."email", u."full_name", u."platform_role", o."id", o."name", o."slug", m."role"
      FROM "users" u LEFT JOIN "memberships" m ON m."user_id" = u."id"
      LEFT JOIN "organizations" o ON o."id" = m."org_id" WHERE u."id" = p_user_id; $$;

CREATE OR REPLACE FUNCTION "provision_org"(p_name text, p_slug text, p_owner_user_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE v_org_id uuid := gen_random_uuid();
        v_prev_org text := COALESCE(current_setting('app.current_org', true), '');
BEGIN
  PERFORM set_config('app.current_org', v_org_id::text, true);
  INSERT INTO "organizations" ("id","name","slug","updatedAt")
  VALUES (v_org_id, p_name, p_slug, CURRENT_TIMESTAMP);
  INSERT INTO "memberships" ("org_id","user_id","role") VALUES (v_org_id, p_owner_user_id, 'OWNER');
  PERFORM set_config('app.current_org', v_prev_org, true);
  RETURN v_org_id;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.current_org', v_prev_org, true); RAISE;
END; $$;

ALTER FUNCTION "provision_org"(text, text, uuid)            OWNER TO "roadsen_auth";
ALTER FUNCTION "provision_user"(text, text, text)           OWNER TO "roadsen_auth";
ALTER FUNCTION "auth_find_user_by_email"(text)              OWNER TO "roadsen_auth";
ALTER FUNCTION "auth_user_has_membership"(uuid, uuid)       OWNER TO "roadsen_auth";
ALTER FUNCTION "auth_get_platform_role"(uuid)               OWNER TO "roadsen_auth";
ALTER FUNCTION "auth_get_user_profile"(uuid)                OWNER TO "roadsen_auth";

-- 3) Restaure les policies d'identite SANS la branche app_auth_bootstrap()
--    (forme 0004 : app_current_org() bruyant).
DROP POLICY IF EXISTS "tenant_isolation" ON "organizations";
CREATE POLICY "tenant_isolation" ON "organizations"
  USING ("id" = "app_current_org"()) WITH CHECK ("id" = "app_current_org"());

DROP POLICY IF EXISTS "tenant_isolation" ON "memberships";
CREATE POLICY "tenant_isolation" ON "memberships"
  USING ("org_id" = "app_current_org"()) WITH CHECK ("org_id" = "app_current_org"());

DROP POLICY IF EXISTS "tenant_isolation" ON "users";
CREATE POLICY "tenant_isolation" ON "users"
  USING (EXISTS (SELECT 1 FROM "memberships" m WHERE m."user_id" = "users"."id"
                 AND m."org_id" = "app_current_org"()))
  WITH CHECK (EXISTS (SELECT 1 FROM "memberships" m WHERE m."user_id" = "users"."id"
                 AND m."org_id" = "app_current_org"()));

-- 3bis) RESTAURE le DML direct de roadsen_app sur l'IDENTITE (que 0007 §4.4 avait
--       revoque). Etat pre-0007 : roadsen_app avait SELECT/INSERT/UPDATE/DELETE sur
--       les 4 tables, et l'isolation tenait par BYPASSRLS de roadsen_auth + FORCE.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "organizations", "memberships", "users"
  TO "roadsen_app";

-- 4) Retire les objets introduits par 0007.
--    pv_emitter_context est NOUVELLE en 0007 : on la supprime (l'emission PV
--    pre-0007 lisait l'identite en direct sous roadsen_app, re-grant ci-dessus).
REVOKE ALL ON FUNCTION "pv_emitter_context"(uuid, uuid) FROM "roadsen_app";
DROP FUNCTION IF EXISTS "pv_emitter_context"(uuid, uuid);
DROP FUNCTION IF EXISTS "app_current_org_or_null"();
DROP FUNCTION IF EXISTS "app_auth_bootstrap"();

COMMIT;
