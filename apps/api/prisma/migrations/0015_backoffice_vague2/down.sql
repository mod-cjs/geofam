-- =====================================================================
--  ROADSEN — Rollback de la migration 0015 (back-office Vague 2)
--
--  ROADSEN-MIGRATION-REVIEWED: dev-backend (build) — plan de rollback.
--
--  Prisma Migrate ne joue PAS les « down » : plan DOCUMENTE, applique a la main.
--  Ordre INVERSE de migration.sql. ATOMIQUE (BEGIN/COMMIT). Applicable sous un user
--  CREATEROLE non-superuser (aucun BYPASSRLS requis).
--
--  CIBLE = etat POST-0014 : aucune des 4 fonctions de la Vague 2 ; roadsen_auth SANS
--  UPDATE sur users (retour a SELECT+INSERT). NON DESTRUCTIF sur les donnees (aucune table
--  supprimee ; les lignes admin_audit_log tracees par la Vague 2 SURVIVENT — journal
--  APPEND-ONLY). Les mutations deja appliquees (is_active/password_hash/abos/roles) ne sont
--  PAS annulees : un rollback ne « defait » pas les effets metier, il retire seulement les voies.
-- =====================================================================

BEGIN;

-- 1) Supprime les 4 fonctions DEFINER introduites par 0015.
DROP FUNCTION IF EXISTS "admin_transfer_ownership"(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS "admin_attach_subscription"(uuid, text, text[], timestamptz, timestamptz, int, uuid, text);
DROP FUNCTION IF EXISTS "admin_reset_user_password"(uuid, text, uuid, text, text);
DROP FUNCTION IF EXISTS "admin_set_user_active"(uuid, boolean, uuid, text);

-- 2) Retire le GRANT UPDATE ON users pour roadsen_auth (retour a SELECT+INSERT, 0004/0005).
--    Plus aucune fonction ne mute users hors identite d'origine -> privilege inutile.
REVOKE UPDATE ON "users" FROM "roadsen_auth";

COMMIT;
