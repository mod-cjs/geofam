-- =====================================================================
--  ROADSEN — Migration 0006 : COEUR D'INTEGRITE DU PV SCELLE (BUILD #63, incr. A)
--
--  Zone CRITIQUE (integrite + isolation). Cette migration pose la STRUCTURE de
--  persistance du pipeline PV, SANS le flux d'emission (= incrément B). Elle cree :
--
--    1) projects : UNIQUE(org_id, id) — support de la FK COMPOSITE (org_id, .)
--       qui empeche un enfant org-scope de pointer un parent d'un AUTRE tenant
--       (resout la NOTE §4 de 0004 : 1res tables enfant de projects).
--    2) calc_results : org-scopee, MUTABLE/jetable — un calcul (input projete,
--       output whiteliste, meta moteur). RLS ENABLE+FORCE + policy tenant.
--    3) official_pvs : org-scopee, IMMUABLE et AUTOPORTANTE — copie FIGEE de tout
--       ce qui a ete scelle (input_canonical, output, meta moteur, identite,
--       numero, sealed_at, content_hash SHA-256, hmac, science_status). RLS FORCE.
--    4) pv_counters + allocate_pv_number(...) : numerotation PAR ORG idempotente
--       (format PV-RDS-{slug}-{YYYY}-{NNNNNN}), avec UNIQUE(org_id, calc_result_id)
--       sur official_pvs pour qu'un meme calcul re-emis NE BRULE PAS un numero.
--    5) triggers d'IMMUABILITE : tout UPDATE/DELETE sur official_pvs est REFUSE.
--
--  MODELE DE SCOPING inchange : l'app pose `SET LOCAL app.current_org = '<uuid>'`
--  par transaction (cf. PrismaService.withTenant). Les policies appellent
--  app_current_org() (0004) -> fail-closed BRUYANT si le contexte n'est pas pose.
--
--  ROLES (rappel) : runtime = roadsen_app (NOBYPASSRLS) ; voie privilegiee =
--  roadsen_auth (BYPASSRLS, NOLOGIN) porteur des fonctions DEFINER d'auth/bootstrap.
--  Ici, allocate_pv_number n'est PAS DEFINER (il s'execute SOUS le tenant courant,
--  scope par RLS via pv_counters) : aucun franchissement de RLS n'est requis.
--
--  ADDITIVE : aucune table existante n'est DROP/ALTER de maniere destructive. On
--  AJOUTE un index UNIQUE sur projects (non bloquant : projects.id est deja unique
--  via la PK, donc (org_id, id) l'est trivialement). N'edite PAS 0001..0005.
--  Reversible : voir down.sql.
--  A REVOIR EN BINOME ingenieur-securite (isolation des nouvelles tables) +
--  qa-challenger (immuabilite, canonicalisation, gestion du secret HMAC cote app).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) projects : UNIQUE(org_id, id) — cible des FK COMPOSITE enfant
--
--  projects a deja PK(id) => id est unique => (org_id, id) l'est aussi. Cet index
--  UNIQUE explicite est REQUIS comme CIBLE d'une FK composite (Postgres exige que
--  la cible d'une FK soit une contrainte unique/PK portant EXACTEMENT ces colonnes).
--  Il est donc structurel, pas une nouvelle regle d'unicite metier.
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX "projects_org_id_id_key" ON "projects" ("org_id", "id");

-- ---------------------------------------------------------------------
-- 2) calc_results — calcul org-scope, MUTABLE/jetable
--
--  Stocke un recalcul serveur : input PROJETE (whiteliste, jsonb), output
--  whiteliste (jsonb), meta moteur (engine_id/version/source_hash). user_id =
--  auteur ; project_id = rattachement (FK composite incluant org_id -> un calcul
--  ne peut referencer qu'un projet de SON tenant). Pas d'immuabilite : un calcul
--  est jetable tant qu'il n'a pas ete officialise en PV.
--
--  engine_source_hash NULLABLE : la meta moteur (engine-io.ts) le rend optionnel
--  tant qu'un moteur reel n'est pas cable au registre (retro-compat).
-- ---------------------------------------------------------------------
CREATE TABLE "calc_results" (
  "id"                 UUID         NOT NULL DEFAULT gen_random_uuid(),
  "org_id"             UUID         NOT NULL,
  "project_id"         UUID         NOT NULL,
  "user_id"            UUID         NOT NULL,
  "engine_id"          TEXT         NOT NULL,
  "engine_version"     TEXT         NOT NULL,
  "engine_source_hash" TEXT,
  "input"              JSONB        NOT NULL,
  "output"             JSONB        NOT NULL,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "calc_results_pkey" PRIMARY KEY ("id"),
  -- org-coherence de l'id local (cible de FK depuis official_pvs au besoin)
  CONSTRAINT "calc_results_org_id_id_key" UNIQUE ("org_id", "id"),
  -- FK COMPOSITE : le projet pointe DOIT etre dans le MEME org (anti cross-tenant)
  CONSTRAINT "calc_results_org_project_fkey" FOREIGN KEY ("org_id", "project_id")
    REFERENCES "projects" ("org_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- l'org existe (CASCADE : suppression d'org -> purge des calculs)
  CONSTRAINT "calc_results_org_id_fkey" FOREIGN KEY ("org_id")
    REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "calc_results_org_id_idx" ON "calc_results" ("org_id");
CREATE INDEX "calc_results_org_project_idx" ON "calc_results" ("org_id", "project_id");

-- RLS FORCE + policy tenant (modele 0001/0004 : scope par app_current_org()).
ALTER TABLE "calc_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calc_results" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "calc_results"
  USING ("org_id" = "app_current_org"())
  WITH CHECK ("org_id" = "app_current_org"());

-- ---------------------------------------------------------------------
-- 3) pv_counters — compteur de numerotation PAR ORG et PAR ANNEE
--
--  Une ligne (org_id, year) detient last_seq, increment atomique a l'emission.
--  PK composite (org_id, year). RLS FORCE : un tenant ne lit/n'incremente QUE son
--  propre compteur. Pas de FK composite (pas d'enfant), juste FK org_id.
--
--  CHOIX (numerotation par org, decision titulaire) : le compteur est PORTE PAR
--  ORG, pas global. Deux bureaux peuvent avoir chacun leur PV-...-000001 la meme
--  annee — c'est voulu (numerotation lisible et privee a chaque bureau).
-- ---------------------------------------------------------------------
CREATE TABLE "pv_counters" (
  "org_id"   UUID         NOT NULL,
  "year"     INTEGER      NOT NULL,
  "last_seq" BIGINT       NOT NULL DEFAULT 0,
  CONSTRAINT "pv_counters_pkey" PRIMARY KEY ("org_id", "year"),
  CONSTRAINT "pv_counters_org_id_fkey" FOREIGN KEY ("org_id")
    REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "pv_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pv_counters" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "pv_counters"
  USING ("org_id" = "app_current_org"())
  WITH CHECK ("org_id" = "app_current_org"());

-- ---------------------------------------------------------------------
-- 4) official_pvs — PV OFFICIEL, IMMUABLE et AUTOPORTANT
--
--  AUTOPORTANT : copie FIGEE de tout ce qui a ete scelle. Aucune FK « vivante »
--  vers calc_results (un calcul jetable supprime ne doit pas effacer un PV
--  officiel) : on conserve calc_result_id en simple reference textuelle/uuid SANS
--  FK, juste pour l'IDEMPOTENCE (UNIQUE(org_id, calc_result_id)). Les FK
--  conservees sont uniquement org_id (existence du tenant) — PAS de cascade depuis
--  un projet/calcul, le PV survit a leur suppression. project_id reste stocke
--  comme donnee d'identite figee (texte d'origine), sans FK.
--
--  input_canonical : LA CHAINE CANONIQUE EXACTE qui a ete hachee/HMACee (cf.
--  packages/shared/src/seal.ts). C'est la source de verite re-verifiable :
--  sealContentHash(input_canonical) doit re-egaler content_hash.
--
--  content_hash : SHA-256 hex (64). hmac : HMAC-SHA256 hex (64, clé PV_SIGNING_SECRET,
--  detenue par l'app, JAMAIS en base). science_status : 'unsigned' | 'signed'
--  (bandeau science, gere a l'emission incr. B).
--
--  UNIQUE(org_id, pv_number) : un numero est unique dans un org. UNIQUE(org_id,
--  calc_result_id) : un meme calcul re-emis retombe sur le MEME PV (idempotence
--  d'emission, ne brule pas un nouveau numero) — applique au flux d'emission (incr. B).
-- ---------------------------------------------------------------------
CREATE TABLE "official_pvs" (
  "id"                 UUID         NOT NULL DEFAULT gen_random_uuid(),
  "org_id"             UUID         NOT NULL,
  "calc_result_id"     UUID         NOT NULL, -- reference d'idempotence (SANS FK : autoportant)
  "project_id"         UUID         NOT NULL, -- identite figee (SANS FK : autoportant)
  "pv_number"          TEXT         NOT NULL,
  "user_id"            UUID         NOT NULL, -- identite figee de l'emetteur
  "project_name"       TEXT         NOT NULL, -- libelle fige (copie au scellement)
  "engine_id"          TEXT         NOT NULL,
  "engine_version"     TEXT         NOT NULL,
  "engine_source_hash" TEXT,
  "input_canonical"    TEXT         NOT NULL, -- chaine canonique exacte scellee
  "output"             JSONB        NOT NULL,
  "science_status"     TEXT         NOT NULL,
  "content_hash"       TEXT         NOT NULL, -- SHA-256 hex (64)
  "hmac"               TEXT         NOT NULL, -- HMAC-SHA256 hex (64)
  "sealed_at"          TIMESTAMP(3) NOT NULL, -- horodatage de scellement (fige, scelle)
  CONSTRAINT "official_pvs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "official_pvs_org_pvnumber_key" UNIQUE ("org_id", "pv_number"),
  CONSTRAINT "official_pvs_org_calc_key"     UNIQUE ("org_id", "calc_result_id"),
  -- bornes d'integrite des empreintes (hex 64) + statut science ferme
  CONSTRAINT "official_pvs_content_hash_chk" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "official_pvs_hmac_chk"         CHECK ("hmac" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "official_pvs_science_chk"      CHECK ("science_status" IN ('unsigned', 'signed')),
  -- SEULE FK : l'org (CASCADE). Aucune FK vers projects/calc_results : autoportant.
  CONSTRAINT "official_pvs_org_id_fkey" FOREIGN KEY ("org_id")
    REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "official_pvs_org_id_idx" ON "official_pvs" ("org_id");

ALTER TABLE "official_pvs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "official_pvs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "official_pvs"
  USING ("org_id" = "app_current_org"())
  WITH CHECK ("org_id" = "app_current_org"());

-- ---------------------------------------------------------------------
-- 5) IMMUABILITE de official_pvs — un PV officiel ne se modifie JAMAIS (#58)
--
--  Trigger BEFORE UPDATE OR DELETE qui RAISE systematiquement. Defense en
--  profondeur : meme un bug applicatif, une migration future maladroite, ou un
--  acces direct sous roadsen_app ne peuvent ni reecrire ni effacer un PV scelle.
--  La SEULE operation permise reste l'INSERT (emission, incr. B) ; la
--  REGENERATION d'un PV (DoD §5) = re-emission d'une NOUVELLE ligne, jamais une
--  mutation de l'existante.
--
--  NB : ce trigger ne bloque PAS un TRUNCATE/DROP TABLE (DDL) ni un superuser
--  bypassant via DDL — c'est un garde-fou DML, complementaire de la RLS et des
--  privileges (roadsen_app n'a pas de droit DDL). Message d'erreur BORNE (aucun
--  intermediaire/donnee divulguee).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "official_pvs_immutable"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'official_pvs est IMMUABLE : % interdit sur un PV scelle', TG_OP
    USING ERRCODE = 'R0002';
END;
$$;

CREATE TRIGGER "official_pvs_no_update"
  BEFORE UPDATE ON "official_pvs"
  FOR EACH ROW EXECUTE FUNCTION "official_pvs_immutable"();

CREATE TRIGGER "official_pvs_no_delete"
  BEFORE DELETE ON "official_pvs"
  FOR EACH ROW EXECUTE FUNCTION "official_pvs_immutable"();

-- ---------------------------------------------------------------------
-- 6) allocate_pv_number(p_year) — numerotation PAR ORG idempotente (structure)
--
--  Alloue le PROCHAIN numero de sequence pour l'ORG COURANT (app_current_org())
--  et l'annee donnee, en incrementant atomiquement pv_counters. UPSERT atomique :
--  INSERT ... ON CONFLICT DO UPDATE last_seq = last_seq + 1, RETURNING la valeur.
--  La ligne pv_counters est verrouillee par l'UPDATE -> deux emissions concurrentes
--  serialisent (pas de numero double).
--
--  NON DEFINER : s'execute sous le tenant courant, soumise a la RLS de pv_counters
--  (un appelant ne peut incrementer QUE son propre compteur). Le slug et le
--  formatage final PV-RDS-{slug}-{YYYY}-{NNNNNN} sont assembles cote app (incr. B) :
--  cette fonction ne rend que la SEQUENCE numerique (NNNNNN), le slug vivant dans
--  organizations (lisible sous RLS). L'IDEMPOTENCE par calcul est garantie en
--  amont par UNIQUE(org_id, calc_result_id) : l'app n'appelle allocate_pv_number
--  que si aucun PV n'existe deja pour ce calcul (sinon elle reutilise l'existant).
--
--  RAISE si app.current_org non pose (via app_current_org()) -> fail-closed bruyant.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "allocate_pv_number"(p_year integer)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org uuid := "app_current_org"(); -- RAISE si contexte tenant absent
  v_seq bigint;
BEGIN
  IF p_year IS NULL OR p_year < 2000 OR p_year > 9999 THEN
    RAISE EXCEPTION 'allocate_pv_number: annee invalide (%).', p_year;
  END IF;

  INSERT INTO "pv_counters" ("org_id", "year", "last_seq")
  VALUES (v_org, p_year, 1)
  ON CONFLICT ("org_id", "year")
  DO UPDATE SET "last_seq" = "pv_counters"."last_seq" + 1
  RETURNING "last_seq" INTO v_seq;

  RETURN v_seq;
END;
$$;

-- EXECUTE : revoque a PUBLIC, accorde au seul runtime roadsen_app.
REVOKE ALL ON FUNCTION "allocate_pv_number"(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "allocate_pv_number"(integer) TO "roadsen_app";

-- ---------------------------------------------------------------------
-- 7) Droits DML du runtime sur les nouvelles tables
--
--  roadsen_app obtient le DML attendu. official_pvs : INSERT + SELECT SEULEMENT
--  (pas d'UPDATE/DELETE accorde — double verrou avec le trigger d'immuabilite :
--  meme le privilege manque). calc_results / pv_counters : DML standard.
--  (ALTER DEFAULT PRIVILEGES de 0001 a deja pu couvrir SELECT/INSERT/UPDATE/DELETE
--   pour les tables creees par le proprietaire ; on EXPLICITE ici par clarte et on
--   RETIRE UPDATE/DELETE sur official_pvs pour ne laisser que INSERT+SELECT.)
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON "calc_results" TO "roadsen_app";
GRANT SELECT, INSERT, UPDATE, DELETE ON "pv_counters"  TO "roadsen_app";
GRANT SELECT, INSERT                  ON "official_pvs" TO "roadsen_app";
REVOKE UPDATE, DELETE ON "official_pvs" FROM "roadsen_app";
