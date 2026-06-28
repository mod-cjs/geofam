-- =====================================================================
--  ROADSEN — Rollback de la migration 0004 (helper fail-closed bruyant)
--
--  Prisma Migrate ne joue PAS les "down" : plan de rollback DOCUMENTE, a
--  appliquer manuellement (psql). Ordre inverse de migration.sql.
--
--  ATOMIQUE : enveloppe dans une transaction (BEGIN/COMMIT). En cas d'erreur
--  intermediaire, ROLLBACK manuel -> aucun etat partiel.
--
--  AVERTISSEMENT — ROLLBACK DE DEPANNAGE, PAS UNE CIBLE DE PROD.
--  Ce down restaure l'etat PRE-0004 :
--    - scoping silencieux (NULLIF(... , true)) au lieu du RAISE bruyant ;
--    - provision_org SANS restauration de contexte (la fuite tenant CRITIQUE-1
--      revient) ;
--    - proprietaire des 4 fonctions = CURRENT_USER (le role qui applique le
--      rollback = proprietaire des tables).
--  Or en PROD l'etat pre-0004 etait DEJA defaillant : sous un owner non-superuser
--  (Render), le login etait silencieusement casse (cf. en-tete de migration.sql).
--  Ne rollback 0004 qu'en environnement ou l'owner courant bypasse la RLS
--  (local/superuser), ou conjointement a un rollback du flux d'auth #41.
-- =====================================================================

BEGIN;

-- 1) Restaure les policies silencieuses (NULLIF(... , true)) -----------------
DROP POLICY IF EXISTS "tenant_isolation" ON "users";
CREATE POLICY "tenant_isolation" ON "users"
  USING (
    EXISTS (
      SELECT 1 FROM "memberships" m
      WHERE m."user_id" = "users"."id"
        AND m."org_id"  = NULLIF(current_setting('app.current_org', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "memberships" m
      WHERE m."user_id" = "users"."id"
        AND m."org_id"  = NULLIF(current_setting('app.current_org', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS "tenant_isolation" ON "organizations";
CREATE POLICY "tenant_isolation" ON "organizations"
  USING ("id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

DROP POLICY IF EXISTS "tenant_isolation" ON "projects";
CREATE POLICY "tenant_isolation" ON "projects"
  USING ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

DROP POLICY IF EXISTS "tenant_isolation" ON "memberships";
CREATE POLICY "tenant_isolation" ON "memberships"
  USING ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- 2) Restaure provision_org dans sa forme PRE-0004 (sans restauration de
--    contexte) — version 0002 a l'identique. -------------------------------
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
  v_org_id uuid := gen_random_uuid();
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
  PERFORM set_config('app.current_org', v_org_id::text, true);
  INSERT INTO "organizations" ("id", "name", "slug", "updatedAt")
  VALUES (v_org_id, p_name, p_slug, CURRENT_TIMESTAMP);
  INSERT INTO "memberships" ("org_id", "user_id", "role")
  VALUES (v_org_id, p_owner_user_id, 'OWNER');
  RETURN v_org_id;
END;
$$;

-- 3) Rend la propriete des 4 fonctions DEFINER a l'utilisateur courant
--    (owner des tables = role qui applique le rollback). En prod non-superuser
--    cela RECASSE le login (cf. avertissement en-tete) : rollback de depannage.
ALTER FUNCTION "provision_org"(text, text, uuid)            OWNER TO CURRENT_USER;
ALTER FUNCTION "auth_find_user_by_email"(text)              OWNER TO CURRENT_USER;
ALTER FUNCTION "auth_user_has_membership"(uuid, uuid)       OWNER TO CURRENT_USER;
ALTER FUNCTION "auth_get_platform_role"(uuid)               OWNER TO CURRENT_USER;

-- 4) Retire le role dedie et le helper --------------------------------------
REVOKE ALL ON "organizations", "memberships", "users" FROM "roadsen_auth";
REVOKE USAGE ON SCHEMA public FROM "roadsen_auth";
DROP ROLE IF EXISTS "roadsen_auth";

DROP FUNCTION IF EXISTS "app_current_org"();

COMMIT;
