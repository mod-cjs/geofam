-- 0025 — P0-5 (description persistee) + P0-6 (index manquants)
--
-- P0-5 — LA DESCRIPTION ETAIT AVALEE
-- La modale « Nouveau projet » proposait un champ description depuis toujours.
-- Il n'existait AUCUNE colonne, et le schema de validation ne l'acceptait pas :
-- zod la retirait silencieusement. L'utilisateur saisissait un texte qui
-- disparaissait sans un mot — meme famille de defaut que le tri qui mentait.
-- NULLABLE : les projets existants n'en ont pas, et une chaine vide imposee
-- serait une donnee inventee.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "description" TEXT;

-- P0-6 — INDEX MANQUANTS
-- official_pvs n'avait qu'un index (org_id). Or les agregats de P0-1/P0-3
-- (compte des PV, date du dernier scellement) filtrent et regroupent par
-- project_id : sans index, c'est un parcours de tout l'org a chaque liste.
-- Le tri par sealed_at DESC est inclus pour que « dernier PV » soit index-only.
CREATE INDEX IF NOT EXISTS "official_pvs_org_project_sealed_idx"
  ON "official_pvs" ("org_id", "project_id", "sealed_at" DESC);

-- calc_results avait deja (org_id, project_id) mais sans created_at : le
-- « dernier calcul » de P0-3 devait donc trier apres coup. Index couvrant.
CREATE INDEX IF NOT EXISTS "calc_results_org_project_created_idx"
  ON "calc_results" ("org_id", "project_id", "created_at" DESC);
