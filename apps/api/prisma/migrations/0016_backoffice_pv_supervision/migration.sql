-- =====================================================================
--  ROADSEN — Migration 0016 : back-office SUPERADMIN, SUPERVISION PV cross-tenant
--
--  ROADSEN-MIGRATION-REVIEWED: dev (build direct, mode rapide titulaire).
--
--  But (Vague 3) : permettre au SUPERADMIN de LISTER les procès-verbaux émis TOUS
--  tenants (support / litige), rechercher par numéro, et récupérer un PV pour
--  VÉRIFIER son sceau (la vérification HMAC se fait dans l'API — le secret n'est pas
--  en base ; ces DEFINER n'exposent que ce qu'il faut au service serveur).
--
--  SÉCURITÉ (repris EXACTEMENT de 0014) :
--    - lecture cross-tenant de official_pvs via SECURITY DEFINER owned roadsen_auth ;
--      la policy stats_bootstrap_read (0014, FOR SELECT, gatée sur current_user =
--      'roadsen_auth') autorise la lecture cross-tenant DANS le corps de la DEFINER
--      uniquement ; roadsen_app (non membre) ne peut pas la déclencher.
--    - INVARIANT 0014 respecté : admin_get_pv (lecture d'UN PV per-tenant) porte un
--      WHERE id = p_pv_id explicite (borne). admin_list_pvs est une lecture cross-tenant
--      DÉLIBÉRÉE de MÉTADONNÉES (pas de output/input_canonical/hmac dans la liste).
--    - drapeau app.auth_bootstrap + app.current_org FACTICE posés/refermés sur TOUT
--      chemin (RETURN + EXCEPTION), search_path figé, REVOKE PUBLIC + GRANT roadsen_app.
--  Idempotente (CREATE OR REPLACE). Reversible : voir down.sql.
-- =====================================================================

-- Pré-requis ALTER OWNER (idempotents, patron 0013/0014).
GRANT "roadsen_auth" TO CURRENT_USER;
GRANT USAGE, CREATE ON SCHEMA public TO "roadsen_auth";

-- ---------------------------------------------------------------------
-- 1) admin_list_pvs — liste cross-tenant des PV (MÉTADONNÉES seulement)
--    Minimisation CDP : ni output, ni input_canonical, ni content_hash/hmac.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS "admin_list_pvs"(int, int, text);
CREATE FUNCTION "admin_list_pvs"(
  p_limit  int,
  p_offset int,
  p_q      text
)
RETURNS TABLE (
  pv_id          uuid,
  pv_number      text,
  org_id         uuid,
  org_name       text,
  org_slug       text,
  project_name   text,
  engine_id      text,
  engine_version text,
  science_status text,
  verdict        text,
  sealed_at      timestamp(3)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  prev_org text := COALESCE(current_setting('app.current_org', true), '');
  v_limit  int  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset int  := GREATEST(COALESCE(p_offset, 0), 0);
  v_q      text := NULLIF(btrim(COALESCE(p_q, '')), '');
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);
  PERFORM set_config('app.current_org', gen_random_uuid()::text, true);

  RETURN QUERY
    SELECT
      p."id", p."pv_number", p."org_id", o."name", o."slug",
      p."project_name", p."engine_id", p."engine_version",
      p."science_status", p."verdict", p."sealed_at"
    FROM "official_pvs" p
    JOIN "organizations" o ON o."id" = p."org_id"
    WHERE v_q IS NULL
       OR p."pv_number" ILIKE '%' || replace(replace(v_q, '\', '\\'), '%', '\%') || '%'
    ORDER BY p."sealed_at" DESC
    LIMIT v_limit OFFSET v_offset;

  PERFORM set_config('app.current_org', prev_org, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.current_org', prev_org, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

ALTER FUNCTION "admin_list_pvs"(int, int, text) OWNER TO "roadsen_auth";
REVOKE ALL ON FUNCTION "admin_list_pvs"(int, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "admin_list_pvs"(int, int, text) TO "roadsen_app";

-- ---------------------------------------------------------------------
-- 2) admin_get_pv — récupère UN PV (per-tenant, WHERE id borné) pour la
--    vérification de sceau côté API. Renvoie les champs nécessaires au
--    verifySeal (input_canonical, content_hash, hmac) — jamais transmis
--    tel quel au navigateur ; l'API renvoie sealValid + métadonnées.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS "admin_get_pv"(uuid);
CREATE FUNCTION "admin_get_pv"(p_pv_id uuid)
RETURNS TABLE (
  pv_id           uuid,
  pv_number       text,
  org_id          uuid,
  org_name        text,
  project_name    text,
  engine_id       text,
  engine_version  text,
  science_status  text,
  verdict         text,
  sealed_at       timestamp(3),
  input_canonical text,
  content_hash    text,
  hmac            text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  prev_org text := COALESCE(current_setting('app.current_org', true), '');
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);
  PERFORM set_config('app.current_org', gen_random_uuid()::text, true);

  RETURN QUERY
    SELECT
      p."id", p."pv_number", p."org_id", o."name",
      p."project_name", p."engine_id", p."engine_version",
      p."science_status", p."verdict", p."sealed_at",
      p."input_canonical", p."content_hash", p."hmac"
    FROM "official_pvs" p
    JOIN "organizations" o ON o."id" = p."org_id"
    WHERE p."id" = p_pv_id;

  PERFORM set_config('app.current_org', prev_org, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.current_org', prev_org, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

ALTER FUNCTION "admin_get_pv"(uuid) OWNER TO "roadsen_auth";
REVOKE ALL ON FUNCTION "admin_get_pv"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "admin_get_pv"(uuid) TO "roadsen_app";
