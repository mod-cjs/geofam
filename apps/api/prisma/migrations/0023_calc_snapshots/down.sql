-- =====================================================================
--  ROADSEN — Rollback de la migration 0023 (snapshot du document client)
--
--  Prisma Migrate ne joue PAS les "down" : plan de rollback DOCUMENTE, a appliquer
--  manuellement (psql). Ordre INVERSE de migration.sql.
--
--  AVERTISSEMENT — DESTRUCTIF SUR LES DOCUMENTS CAPTURES.
--  Ce down DROP calc_snapshots : tout document d'affichage/impression capture est
--  PERDU. Les PV scelles restent valides (le sceau porte sha256(print_html), mais
--  le service du document /pvs/:id/document renverra 404 sans la source) : le
--  client retombe sur le PDF pdfmake. SAUVEGARDER avant en preprod/prod.
-- =====================================================================

BEGIN;

-- La policy/RLS et les index tombent avec la table.
DROP TABLE IF EXISTS "calc_snapshots";

COMMIT;
