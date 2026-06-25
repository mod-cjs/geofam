-- =====================================================================
--  ROADSEN — Rollback de la migration 0006 (coeur d'integrite du PV scelle)
--
--  Prisma Migrate ne joue PAS les "down" : plan de rollback DOCUMENTE, a
--  appliquer manuellement (psql). Ordre INVERSE de migration.sql.
--
--  ATOMIQUE : enveloppe dans une transaction (BEGIN/COMMIT). Une erreur
--  intermediaire -> ROLLBACK manuel, aucun etat partiel.
--
--  AVERTISSEMENT — DESTRUCTIF SUR DONNEES PV.
--  Ce down DROP calc_results, official_pvs et pv_counters : tout PV scelle et
--  tout calcul persiste sont PERDUS. En preprod/prod, SAUVEGARDER d'abord
--  (les PV officiels sont des livrables). A ne jouer qu'en environnement de
--  recette ou apres export des PV.
-- =====================================================================

BEGIN;

-- 1) Fonction de numerotation (revoke + drop) -------------------------------
REVOKE ALL ON FUNCTION "allocate_pv_number"(integer) FROM "roadsen_app";
DROP FUNCTION IF EXISTS "allocate_pv_number"(integer);

-- 2) Triggers + fonction d'immuabilite --------------------------------------
DROP TRIGGER IF EXISTS "official_pvs_no_update" ON "official_pvs";
DROP TRIGGER IF EXISTS "official_pvs_no_delete" ON "official_pvs";
DROP FUNCTION IF EXISTS "official_pvs_immutable"();

-- 3) Tables (les policies/RLS tombent avec la table). Ordre indifferent : pas de
--    FK entre ces 3 tables (official_pvs est autoportant). ---------------------
DROP TABLE IF EXISTS "official_pvs";
DROP TABLE IF EXISTS "pv_counters";
DROP TABLE IF EXISTS "calc_results";

-- 4) Index UNIQUE support de FK composite sur projects ----------------------
--    (sans danger : projects.id reste unique via sa PK.)
DROP INDEX IF EXISTS "projects_org_id_id_key";

COMMIT;
