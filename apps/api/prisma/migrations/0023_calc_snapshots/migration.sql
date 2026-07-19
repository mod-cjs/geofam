-- =====================================================================
--  ROADSEN — Migration 0023 : SNAPSHOT DU DOCUMENT CLIENT (scellement option-3)
--
--  Zone CRITIQUE (integrite + isolation). Le PV « option-3 » EST le document que
--  l'outil client produit A L'IMPRESSION (HTML/SVG auto-contenu, deterministe,
--  zero canvas), scelle puis re-affiche/imprime a l'identique — PAS une
--  reconstruction pdfmake. Cette migration pose la PERSISTANCE de ce document :
--
--    calc_snapshots : capture org-scopee, en RELATION 1-1 avec calc_results.
--      display_html = document d'AFFICHAGE ; print_html = document d'IMPRESSION.
--      Un meme calcul est IMMUABLE -> sa capture est deterministe -> re-capturer
--      ECRASE (UPSERT par calc_result_id, cote app). C'est une table de DONNEES du
--      tenant (pas un livrable scelle) : mutable, roadsen_app garde le DML complet.
--
--  L'INTEGRITE du document n'est PAS portee ici mais par le SCEAU du PV : a
--  l'emission, sha256(print_html) entre dans le contenu canonique HMACe
--  (official_pvs.input_canonical, champ `document.sha256`). Le service du document
--  re-verifie sha256(print_html) == document.sha256 scelle -> alteration = 409.
--  Cette table stocke donc la SOURCE re-verifiable, le sceau du PV en est la preuve.
--
--  MODELE DE SCOPING inchange (0004/0006) : l'app pose SET LOCAL app.current_org
--  par transaction (PrismaService.withTenant) ; la policy appelle app_current_org()
--  -> fail-closed BRUYANT si le contexte n'est pas pose.
--
--  ADDITIVE : aucune table existante DROP/ALTER. Reversible : voir down.sql.
--  A REVOIR EN BINOME ingenieur-securite (isolation de la nouvelle table + test
--  d'isolation post-migration) + qa-challenger.
-- =====================================================================

-- ---------------------------------------------------------------------
--  calc_snapshots — capture du document client, org-scope, 1-1 avec calc_results
--
--  FK COMPOSITE (org_id, calc_result_id) -> calc_results(org_id, id) : une capture
--  ne peut referencer qu'un calcul de SON tenant (anti cross-tenant, meme patron
--  que calc_results -> projects en 0006). ON DELETE CASCADE : supprimer le calcul
--  (jetable) purge sa capture. UNIQUE(calc_result_id) : relation 1-1 stricte (une
--  seule capture par calcul ; l'UPSERT applicatif ecrase la ligne existante).
-- ---------------------------------------------------------------------
CREATE TABLE "calc_snapshots" (
  "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
  "org_id"         UUID        NOT NULL,
  "calc_result_id" UUID        NOT NULL,
  "display_html"   TEXT        NOT NULL,
  "print_html"     TEXT        NOT NULL,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "calc_snapshots_pkey" PRIMARY KEY ("id"),
  -- Relation 1-1 : au plus une capture par calcul.
  CONSTRAINT "calc_snapshots_calc_result_id_key" UNIQUE ("calc_result_id"),
  -- Unicite COMPOSITE (org_id, calc_result_id) : cote definissant du 1-1 Prisma sur
  -- la FK composite (implique par l'unicite de calc_result_id, explicitee pour sync).
  CONSTRAINT "calc_snapshots_org_id_calc_result_id_key" UNIQUE ("org_id", "calc_result_id"),
  -- FK COMPOSITE : le calcul pointe DOIT etre dans le MEME org (anti cross-tenant).
  CONSTRAINT "calc_snapshots_org_calc_fkey" FOREIGN KEY ("org_id", "calc_result_id")
    REFERENCES "calc_results" ("org_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- l'org existe (CASCADE : suppression d'org -> purge des captures).
  CONSTRAINT "calc_snapshots_org_id_fkey" FOREIGN KEY ("org_id")
    REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "calc_snapshots_org_id_idx" ON "calc_snapshots" ("org_id");

-- RLS FORCE + policy tenant (modele 0006 : scope par app_current_org()).
ALTER TABLE "calc_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calc_snapshots" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "calc_snapshots"
  USING ("org_id" = "app_current_org"())
  WITH CHECK ("org_id" = "app_current_org"());

-- DML du runtime : table de DONNEES mutable (UPSERT = INSERT + UPDATE).
GRANT SELECT, INSERT, UPDATE, DELETE ON "calc_snapshots" TO "roadsen_app";
