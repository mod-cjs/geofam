-- =====================================================================
--  ROADSEN — Rollback de la migration 0009 (auth_get_user_state)
--
--  Prisma Migrate ne joue PAS les "down" : plan de rollback DOCUMENTE, a
--  appliquer manuellement (psql). Ordre INVERSE de migration.sql.
--
--  NON DESTRUCTIF : retire une fonction de LECTURE additive. Aucune donnee
--  touchee. Effet : le refresh ne pourrait plus revalider l'etat du compte ->
--  retour au comportement stateless anterieur (regression de securite assumee
--  uniquement le temps d'un rollback).
--
--  NOTE DEPLOIEMENT (manage) : si l'ALTER FUNCTION ... OWNER TO roadsen_auth de la
--  migration a echoue faute de droits, jouer ce DROP en tant que role apte
--  (proprietaire de la fonction). Les GRANT/REVOKE tombent avec le DROP.
-- =====================================================================

BEGIN;

REVOKE ALL ON FUNCTION "auth_get_user_state"(uuid) FROM "roadsen_app";
DROP FUNCTION IF EXISTS "auth_get_user_state"(uuid);

COMMIT;
