-- =====================================================================
--  ROADSEN — Rollback de la migration 0027 (etiquette `name` calc + PV)
--
--  Prisma Migrate ne joue PAS les « down » : plan de rollback DOCUMENTE, a
--  appliquer manuellement (psql). Ordre INVERSE de migration.sql.
--
--  PERTE DE DONNEE, BORNEE : ce down DROP les deux colonnes `name`. Les libelles
--  d'affichage saisis (calculs ET PV) sont PERDUS (aucune autre colonne ne les
--  porte). Aucune autre donnee affectee : le contenu scelle des PV, les calculs,
--  l'isolation et l'immuabilite restent intacts. SAUVEGARDER avant en preprod/prod :
--     \copy (SELECT id, org_id, name FROM official_pvs WHERE name IS NOT NULL)
--       TO 'official_pvs_name_backup.csv' CSV HEADER
--     \copy (SELECT id, org_id, name FROM calc_results WHERE name IS NOT NULL)
--       TO 'calc_results_name_backup.csv' CSV HEADER
--
--  On RETABLIT l'immuabilite d'ORIGINE de official_pvs : le trigger d'UPDATE
--  repointe sur official_pvs_immutable() (qui RAISE sur TOUT UPDATE), on revoque
--  le privilege UPDATE(name), et on supprime la fonction devenue inutile.
-- =====================================================================

BEGIN;

-- 1) Retablir le trigger d'UPDATE d'origine (RAISE sur tout UPDATE), puis retirer
--    la fonction de la breche `name`.
DROP TRIGGER IF EXISTS "official_pvs_no_update" ON "official_pvs";
CREATE TRIGGER "official_pvs_no_update"
  BEFORE UPDATE ON "official_pvs"
  FOR EACH ROW EXECUTE FUNCTION "official_pvs_immutable"();
DROP FUNCTION IF EXISTS "official_pvs_seal_immutable_update"();

-- 2) Revoquer le privilege UPDATE au niveau colonne.
REVOKE UPDATE ("name") ON "official_pvs" FROM "roadsen_app";

-- 3) Retirer les colonnes (ordre indifferent — deux tables distinctes).
ALTER TABLE "official_pvs" DROP COLUMN IF EXISTS "name";
ALTER TABLE "calc_results" DROP COLUMN IF EXISTS "name";

COMMIT;
