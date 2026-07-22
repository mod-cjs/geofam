-- =====================================================================
--  ROADSEN — Rollback de la migration 0026 (date d'archivage des projets)
--
--  Prisma Migrate ne joue PAS les « down » : plan de rollback DOCUMENTE, a
--  appliquer manuellement (psql). Ordre INVERSE de migration.sql.
--
--  PERTE DE DONNEE, BORNEE : ce down DROP `archived_at`. Les dates d'archivage
--  deja enregistrees sont PERDUES et irrecuperables (aucune autre colonne ne les
--  porte — c'est precisement pourquoi la colonne a ete ajoutee). Rien d'autre
--  n'est affecte : le statut ARCHIVED, les projets, les calculs et les PV
--  scelles restent intacts, et la vue « Archives » retombe simplement sur un
--  affichage sans date. SAUVEGARDER avant en preprod/prod.
-- =====================================================================

BEGIN;

DROP INDEX IF EXISTS "projects_org_id_archived_at_idx";

ALTER TABLE "projects" DROP COLUMN IF EXISTS "archived_at";

COMMIT;
