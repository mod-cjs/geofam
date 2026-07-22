-- =====================================================================
--  ROADSEN — Rollback de la migration 0025 (description de projet + index P0-6)
--
--  Prisma Migrate ne joue PAS les « down » : plan de rollback DOCUMENTE, a
--  appliquer manuellement (psql). Ordre INVERSE de migration.sql.
--
--  AVERTISSEMENT — DESTRUCTIF SUR LES DESCRIPTIONS DE PROJET.
--  Ce down DROP `projects.description` : tout texte saisi par les utilisateurs
--  dans ce champ est PERDU (aucune autre colonne ne le porte). SAUVEGARDER avant
--  en preprod/prod :
--     \copy (SELECT id, org_id, description FROM projects WHERE description IS NOT NULL)
--       TO 'projects_description_backup.csv' CSV HEADER
--
--  Les deux DROP INDEX, eux, sont sans perte : ils ne font que retirer les index
--  de couverture ajoutes en 0025. Consequence attendue = les agregats « nombre
--  de PV / dernier scellement » et « dernier calcul » d'un projet repassent en
--  parcours de tout l'org (lenteur, pas d'erreur).
-- =====================================================================

BEGIN;

-- Index d'abord (inverse de l'ordre de creation), puis la colonne.
DROP INDEX IF EXISTS "calc_results_org_project_created_idx";
DROP INDEX IF EXISTS "official_pvs_org_project_sealed_idx";

ALTER TABLE "projects" DROP COLUMN IF EXISTS "description";

COMMIT;
