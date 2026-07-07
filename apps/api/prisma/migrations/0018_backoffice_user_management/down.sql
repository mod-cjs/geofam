-- Rollback 0018 — gestion utilisateurs (edition identite + role plateforme).
--  Retour etat post-0017. Ces fonctions sont NOUVELLES (aucun overload preexistant a
--  restaurer) : on les DROP simplement. Les privileges GRANT UPDATE ON users (0015 §0)
--  restent en place (partages avec admin_set_user_active / admin_reset_user_password).
DROP FUNCTION IF EXISTS "admin_update_user_identity"(uuid, text, text, uuid, text);
DROP FUNCTION IF EXISTS "admin_set_platform_role"(uuid, text, uuid, text);
