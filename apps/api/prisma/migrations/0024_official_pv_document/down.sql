-- =====================================================================
--  ROADSEN — Rollback de la migration 0024 (document autoportant dans official_pvs)
--
--  Prisma Migrate ne joue PAS les "down" : plan de rollback DOCUMENTE, a appliquer
--  manuellement (psql). Ordre INVERSE de migration.sql.
--
--  AVERTISSEMENT — DESTRUCTIF SUR LES DOCUMENTS SCELLES.
--  Ce down DROP document_html/document_format : la copie AUTOPORTANTE du document
--  scelle est PERDUE (le sceau reste valide, mais GET /pvs/:id/document retombe sur
--  le PDF pdfmake faute de source immuable, sauf si calc_snapshots existe encore).
--  SAUVEGARDER avant en preprod/prod.
-- =====================================================================

BEGIN;

ALTER TABLE "official_pvs"
  DROP COLUMN IF EXISTS "document_format",
  DROP COLUMN IF EXISTS "document_html";

COMMIT;
