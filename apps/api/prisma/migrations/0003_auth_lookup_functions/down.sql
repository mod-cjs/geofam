-- =====================================================================
--  ROADSEN — Rollback de la migration 0003 (fonctions de lookup auth)
--
--  Prisma Migrate ne joue PAS les "down" : plan de rollback DOCUMENTE, a
--  appliquer manuellement (psql). Ordre inverse de migration.sql.
--
--  Impact : retire les deux fonctions DEFINER d'auth. Apres application, le
--  flux #41 (login + check membership) ne peut plus lire users/memberships
--  hors contexte -> login et resolution tenant cessent de fonctionner. A ne
--  faire que si l'on rollback aussi le code applicatif d'auth. Aucune donnee
--  tenant n'est detruite (fonctions seulement).
-- =====================================================================

REVOKE ALL ON FUNCTION "auth_get_platform_role"(uuid) FROM "roadsen_app";
DROP FUNCTION IF EXISTS "auth_get_platform_role"(uuid);

REVOKE ALL ON FUNCTION "auth_user_has_membership"(uuid, uuid) FROM "roadsen_app";
DROP FUNCTION IF EXISTS "auth_user_has_membership"(uuid, uuid);

REVOKE ALL ON FUNCTION "auth_find_user_by_email"(text) FROM "roadsen_app";
DROP FUNCTION IF EXISTS "auth_find_user_by_email"(text);
