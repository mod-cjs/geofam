-- =====================================================================
--  ROADSEN — Rollback de la migration 0013 (back-office mutations Lot 2)
--
--  ROADSEN-MIGRATION-REVIEWED: dev-backend (build) — plan de rollback.
--
--  Prisma Migrate ne joue PAS les « down » : plan DOCUMENTE, applique a la main.
--  Ordre INVERSE de migration.sql. ATOMIQUE (BEGIN/COMMIT). Applicable sous un user
--  CREATEROLE non-superuser (aucun BYPASSRLS requis).
--
--  CIBLE = etat POST-0012 : auth_user_has_membership SANS le filtre status (mais AVEC
--  is_active, forme 0011) ; roadsen_app avec GRANT UPDATE PLEIN sur subscriptions ;
--  aucune fonction de mutation ; pas de table admin_audit_log.
-- =====================================================================

BEGIN;

-- 0) provision_subscription : le forward-fix (contexte tenant, §3bis de 0013) est
--    VOLONTAIREMENT CONSERVE — comme le GRANT INSERT (§4). Restaurer la forme 0008 (sans
--    app.current_org) re-casserait le wizard onboarding (R0001 -> 500). On ne la reverte pas.

-- 1) Supprime les fonctions de mutation + lecture d'audit introduites par 0013.
DROP FUNCTION IF EXISTS "admin_list_audit"(uuid, int, int);
DROP FUNCTION IF EXISTS "set_org_status"(uuid, "OrgStatus", uuid, text);
DROP FUNCTION IF EXISTS "remove_member"(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS "set_member_role"(uuid, uuid, "Role", uuid, text);
DROP FUNCTION IF EXISTS "set_subscription_entitlements"(uuid, text, text[], uuid, text);
DROP FUNCTION IF EXISTS "renew_subscription"(uuid, timestamptz, timestamptz, uuid, text);
DROP FUNCTION IF EXISTS "adjust_quota"(uuid, int, text, uuid, text);

-- 2) Restaure auth_user_has_membership dans sa forme 0011 (is_active, SANS le filtre
--    status). plpgsql + drapeau. CREATE OR REPLACE preserve owner (roadsen_auth) + GRANTs.
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
      AND m."is_active" = true
    LIMIT 1;
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- 3) Re-scope INVERSE du GRANT UPDATE sur subscriptions : retour au GRANT PLEIN de 0008
--    (toutes colonnes) pour roadsen_app. On retire d'abord le GRANT colonne-scope.
REVOKE UPDATE ("consommation", "updated_at") ON "subscriptions" FROM "roadsen_app";
GRANT  UPDATE ON "subscriptions" TO "roadsen_app";

-- 4) Retire les GRANT de table ajoutes pour roadsen_auth par 0013 — SAUF INSERT sur
--    subscriptions.
--    ⚠️ ON GARDE `GRANT INSERT ON subscriptions TO roadsen_auth` au rollback : ce n'est PAS
--    une nouveaute de 0013, c'est un FORWARD-FIX d'un bug latent de 0008 (provision_subscription,
--    owned roadsen_auth, INSERT sans privilege -> 42501/500 sur le wizard onboarding en prod).
--    Le revoquer re-casserait `POST /admin/orgs` AVEC body.subscription (deja deploye). On ne
--    retire donc que SELECT+UPDATE (specifiques a 0013) et on LAISSE INSERT en place.
REVOKE UPDATE ON "organizations"              FROM "roadsen_auth";
REVOKE SELECT, UPDATE ON "subscriptions"      FROM "roadsen_auth";
-- (INSERT sur subscriptions VOLONTAIREMENT conserve : forward-fix bug 0008 — cf. ci-dessus.)

-- 5) Table d'audit EN DERNIER (plus aucune fonction ne la reference) : triggers,
--    fonction d'immuabilite, puis la table (DESTRUCTIF sur le journal d'audit).
DROP TRIGGER IF EXISTS "admin_audit_log_no_delete" ON "admin_audit_log";
DROP TRIGGER IF EXISTS "admin_audit_log_no_update" ON "admin_audit_log";
DROP FUNCTION IF EXISTS "admin_audit_log_immutable"();
DROP TABLE IF EXISTS "admin_audit_log";

COMMIT;
