-- =====================================================================
--  ROADSEN — Rollback de la migration 0005 (provision_user + profil /auth/me)
--
--  Prisma Migrate ne joue PAS les "down" : plan de rollback DOCUMENTE, a
--  appliquer manuellement (psql). Ordre inverse de migration.sql.
--
--  Impact : retire les deux fonctions DEFINER de provisioning/profil. Apres
--  application, l'onboarding SUPERADMIN (POST /admin/users) et GET /auth/me ne
--  peuvent plus operer. Aucune donnee tenant n'est detruite (fonctions + 1 GRANT
--  seulement). On RETIRE aussi l'INSERT accorde a roadsen_auth sur "users".
-- =====================================================================

REVOKE ALL ON FUNCTION "auth_get_user_profile"(uuid) FROM "roadsen_app";
DROP FUNCTION IF EXISTS "auth_get_user_profile"(uuid);

REVOKE ALL ON FUNCTION "provision_user"(text, text, text) FROM "roadsen_app";
DROP FUNCTION IF EXISTS "provision_user"(text, text, text);

-- Retire le privilege d'ecriture ajoute par 0005 (les fonctions restantes de
-- 0002/0003/0004 ne necessitent que SELECT/INSERT deja accordes en 0004).
REVOKE INSERT ON "users" FROM "roadsen_auth";
