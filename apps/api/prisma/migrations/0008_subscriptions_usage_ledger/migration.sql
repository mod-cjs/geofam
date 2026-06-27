-- =====================================================================
--  ROADSEN — Migration 0008 : ABONNEMENTS + LEDGER D'USAGE (ADR 0009/0011)
--
--  Zone CRITIQUE (isolation + monetisation). Concretise l'enforcement
--  d'abonnement : chaque organisation porte UN abonnement (pack, entitlements,
--  fenetre de validite, quota, consommation) et un LEDGER d'usage append-only
--  (verite auditable de la consommation). L'acces calcul/PV se ferme au PREMIER
--  atteint entre `now() > date_fin` et `consommation >= quota`.
--
--  Cette migration cree :
--    1) subscriptions : 1 ligne/org (org_id UNIQUE), org-scopee, RLS FORCE.
--       quota NOT NULL fini (le WHERE consommation < quota du decompte atomique
--       casserait sur un quota NULL -> tout barre ; garde-fou schema explicite).
--    2) usage_ledger : journal append-only org-scope (RLS FORCE), FK COMPOSITE
--       (org_id, subscription_id) -> subscriptions(org_id, id) — un ledger ne
--       peut pointer l'abonnement d'un AUTRE tenant (patron NOTE §4 de 0004/0006).
--    3) triggers d'IMMUABILITE sur usage_ledger : UPDATE/DELETE REFUSES (patron
--       official_pvs de 0006) -> on ne peut pas « rendre » du quota en effacant
--       une conso. La consommation se reconcilie par COUNT(*) du ledger.
--    4) provision_subscription(...) : fonction SECURITY DEFINER (owned roadsen_auth)
--       pour creer l'abonnement A LA CREATION D'ORG (hors contexte tenant, comme
--       provision_org). Seule voie d'INSERT « a froid » sous le runtime NOBYPASSRLS.
--    5) GRANTs runtime MINIMAUX : subscriptions = SELECT + UPDATE (le decompte
--       atomique est un UPDATE conditionnel) + INSERT (provisionnement direct sous
--       tenant si besoin) ; usage_ledger = SELECT + INSERT SEULEMENT (pas
--       d'UPDATE/DELETE : double verrou avec le trigger d'immuabilite).
--
--  CONTRAINTES POSTGRES MANAGE (lecons 0004/0007) — RESPECTEES :
--    - AUCUN CREATE/ALTER ROLE ... BYPASSRLS ni NOSUPERUSER/NOBYPASSRLS.
--    - provision_subscription est REASSIGNEE a roadsen_auth par un `ALTER FUNCTION
--      ... OWNER TO roadsen_auth` DUR (pas de bloc DO/EXCEPTION tolerant). LECON
--      0004->0007 : un OWNER TO qui « echoue en silence » laisse la fonction owned
--      par le user de migration ; en LOCAL ce user est superuser (BYPASSRLS
--      implicite) donc le DEFINER « marche » et masque le defaut ; en PROD (Render,
--      user NOBYPASSRLS) le DEFINER reste alors soumis a la RLS et l'INSERT « a
--      froid » est REFUSE -> provisionnement d'abonnement casse alors que les tests
--      locaux passaient au vert. On veut donc l'ECHEC FORT au deploy, pas le faux
--      vert local : si l'OWNER TO ne peut aboutir, la migration DOIT casser.
--    - Les PRE-REQUIS de cet OWNER TO (executant MEMBRE de roadsen_auth + CREATE
--      sur le schema pour roadsen_auth) sont poses en 0004 ; on les RE-AFFIRME ici
--      defensivement (idempotents) pour que 0008 reste self-contenu (§3bis).
--    - roadsen_app et roadsen_auth EXISTENT deja (migrations 0001/0004/0007) : on
--      ne les recree pas, on ne change pas leurs attributs.
--
--  MODELE DE SCOPING inchange : l'app pose `SET LOCAL app.current_org` par
--  transaction (PrismaService.withTenant). Les policies appellent app_current_org()
--  (0004) -> fail-closed BRUYANT si le contexte n'est pas pose.
--
--  ADDITIVE : aucune table/migration existante n'est DROP/ALTER. N'edite PAS
--  0001..0007. Reversible : voir down.sql (DESTRUCTIF sur abonnements/ledger).
--  A REVOIR EN BINOME ingenieur-securite (isolation des 2 tables, FK composite,
--  DEFINER) + qa-challenger (atomicite du decompte, immuabilite du ledger).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) subscriptions — 1 abonnement actif par org (cardinalite 1:1 en P1)
--
--  org_id UNIQUE : un seul abonnement par org. UNIQUE(org_id, id) en plus : cible
--  de la FK COMPOSITE du ledger (Postgres exige une contrainte unique portant
--  EXACTEMENT (org_id, id)). pack/entitlements stockes EXPLICITEMENT (un pack peut
--  etre amende sans toucher le code). quota NOT NULL fini ; consommation >= 0.
-- ---------------------------------------------------------------------
CREATE TABLE "subscriptions" (
  "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
  "org_id"        UUID         NOT NULL,
  "pack"          TEXT         NOT NULL,
  "entitlements"  TEXT[]       NOT NULL,
  "date_debut"    TIMESTAMPTZ  NOT NULL,
  "date_fin"      TIMESTAMPTZ  NOT NULL,
  "quota"         INTEGER      NOT NULL,
  "consommation"  INTEGER      NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscriptions_org_id_key" UNIQUE ("org_id"),
  CONSTRAINT "subscriptions_org_id_id_key" UNIQUE ("org_id", "id"),
  CONSTRAINT "subscriptions_org_id_fkey" FOREIGN KEY ("org_id")
    REFERENCES "organizations" ("id") ON DELETE CASCADE,
  -- Garde-fous d'integrite : quota fini >= 0, consommation jamais negative, et
  -- fenetre de validite coherente (debut <= fin).
  CONSTRAINT "subscriptions_quota_nonneg" CHECK ("quota" >= 0),
  CONSTRAINT "subscriptions_consommation_nonneg" CHECK ("consommation" >= 0),
  CONSTRAINT "subscriptions_window" CHECK ("date_debut" <= "date_fin")
);

-- RLS FORCE + policy tenant (modele 0001/0004 : scope par app_current_org()).
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "subscriptions"
  USING ("org_id" = "app_current_org"())
  WITH CHECK ("org_id" = "app_current_org"());

-- ---------------------------------------------------------------------
-- 2) usage_ledger — journal d'usage APPEND-ONLY (la verite de la consommation)
--
--  kind = unite consommee (CALC / PV). ref_id = id du resultat (calc_result_id /
--  official_pv_id) pour la tracabilite. created_at = horodatage SERVEUR (now()).
--  FK COMPOSITE (org_id, subscription_id) -> subscriptions(org_id, id) : un ledger
--  ne rattache QUE l'abonnement de SON tenant. FK composite (org_id) -> orgs.
-- ---------------------------------------------------------------------
CREATE TABLE "usage_ledger" (
  "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
  "org_id"           UUID         NOT NULL,
  "subscription_id"  UUID         NOT NULL,
  "kind"             TEXT         NOT NULL,
  "ref_id"           UUID,
  "user_id"          UUID         NOT NULL,
  "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "usage_ledger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "usage_ledger_kind_chk" CHECK ("kind" IN ('CALC', 'PV')),
  CONSTRAINT "usage_ledger_org_sub_fkey"
    FOREIGN KEY ("org_id", "subscription_id")
    REFERENCES "subscriptions" ("org_id", "id") ON DELETE CASCADE,
  CONSTRAINT "usage_ledger_org_id_fkey" FOREIGN KEY ("org_id")
    REFERENCES "organizations" ("id") ON DELETE CASCADE
);

CREATE INDEX "usage_ledger_org_id_idx" ON "usage_ledger" ("org_id");
CREATE INDEX "usage_ledger_org_sub_idx"
  ON "usage_ledger" ("org_id", "subscription_id");

-- RLS FORCE + policy tenant.
ALTER TABLE "usage_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_ledger" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "usage_ledger"
  USING ("org_id" = "app_current_org"())
  WITH CHECK ("org_id" = "app_current_org"());

-- ---------------------------------------------------------------------
-- 3) IMMUABILITE du ledger : UPDATE/DELETE REFUSES (patron official_pvs / 0006)
--
--  Le ledger est append-only : seule l'INSERTION est legitime. Toute tentative
--  d'UPDATE/DELETE (meme via DDL bypassant les GRANTs) est rejetee par un trigger
--  -> on ne peut pas falsifier la consommation (TM-6 du threat model ADR 0011).
--  Message d'erreur BORNE (aucune donnee divulguee), ERRCODE applicatif dedie.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "usage_ledger_immutable"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'usage_ledger est APPEND-ONLY : % interdit', TG_OP
    USING ERRCODE = 'R0003';
END;
$$;

CREATE TRIGGER "usage_ledger_no_update"
  BEFORE UPDATE ON "usage_ledger"
  FOR EACH ROW EXECUTE FUNCTION "usage_ledger_immutable"();

CREATE TRIGGER "usage_ledger_no_delete"
  BEFORE DELETE ON "usage_ledger"
  FOR EACH ROW EXECUTE FUNCTION "usage_ledger_immutable"();

-- ---------------------------------------------------------------------
-- 4) provision_subscription(...) — creation d'abonnement A LA CREATION D'ORG
--
--  Comme provision_org (0002/0004), l'abonnement est cree HORS contexte tenant
--  (au moment ou le SUPERADMIN cree l'org : pas encore d'app.current_org pose).
--  SECURITY DEFINER (owned roadsen_auth, porteur du privilege d'ecriture « a
--  froid » sous le modele 0007) : l'INSERT franchit la RLS de subscriptions sans
--  BYPASSRLS cote runtime. Idempotence : ON CONFLICT (org_id) DO NOTHING ->
--  re-provisionner la meme org ne cree pas de doublon (la 1re ligne reste).
--
--  NB MANAGE : la fonction est creee par le proprietaire de la connexion de
--  migration, puis REASSIGNEE a roadsen_auth par un OWNER TO DUR (cf. §3bis). Ce
--  transfert N'EST PAS optionnel : il conditionne le franchissement de la RLS « a
--  froid » (modele 0007 : owner roadsen_auth qui DETIENT le privilege identite +
--  drapeau pose par la fonction). S'il echouait silencieusement, la fonction
--  resterait owned par le user de migration : OK en local (superuser/BYPASSRLS),
--  mais en prod NOBYPASSRLS l'INSERT serait refuse par la RLS -> provisionnement
--  casse. On veut donc que la migration ECHOUE FORT plutot que de laisser passer
--  un faux vert (lecon 0004->0007). Les pre-requis du OWNER TO sont re-affirmes
--  en §3bis (GRANT roadsen_auth TO CURRENT_USER + CREATE sur le schema).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "provision_subscription"(
  p_org_id        uuid,
  p_pack          text,
  p_entitlements  text[],
  p_date_debut    timestamptz,
  p_date_fin      timestamptz,
  p_quota         integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_quota IS NULL OR p_quota < 0 THEN
    RAISE EXCEPTION 'provision_subscription: quota invalide (%).', p_quota;
  END IF;
  IF p_date_debut > p_date_fin THEN
    RAISE EXCEPTION 'provision_subscription: fenetre invalide (debut > fin).';
  END IF;

  INSERT INTO "subscriptions"
    ("org_id", "pack", "entitlements", "date_debut", "date_fin", "quota")
  VALUES
    (p_org_id, p_pack, p_entitlements, p_date_debut, p_date_fin, p_quota)
  ON CONFLICT ("org_id") DO NOTHING
  RETURNING "id" INTO v_id;

  -- ON CONFLICT DO NOTHING -> v_id NULL si l'org a deja un abonnement : on relit
  -- l'existant pour rester idempotent (renvoie l'id deja en place).
  IF v_id IS NULL THEN
    SELECT "id" INTO v_id FROM "subscriptions" WHERE "org_id" = p_org_id;
  END IF;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------
-- 3bis) PRE-REQUIS du OWNER TO ci-dessous (defensifs, idempotents — patron 0004)
--
--  L'ALTER FUNCTION ... OWNER TO roadsen_auth exige (PG, executant non-superuser) :
--    (a) que l'executant (CURRENT_USER = user de migration) soit MEMBRE de
--        roadsen_auth (« must be able to SET ROLE roadsen_auth ») ;
--    (b) que roadsen_auth ait CREATE sur le schema contenant l'objet.
--  Les deux sont poses en 0004 et toujours en place a 0008 ; on les RE-AFFIRME ici
--  (idempotents) pour que 0008 soit self-contenu et que l'OWNER TO ne puisse pas
--  echouer pour un pre-requis manquant si 0008 est rejoue isolement. C'est le
--  filet qui rend l'echec « fort » legitime : l'OWNER TO ne casse que si le
--  transfert est reellement impossible, pas pour un GRANT oublie.
-- ---------------------------------------------------------------------
GRANT "roadsen_auth" TO CURRENT_USER;
GRANT USAGE, CREATE ON SCHEMA public TO "roadsen_auth";

-- La fonction DEFINER DOIT etre detenue par roadsen_auth pour franchir la RLS
-- « a froid » (modele 0007). OWNER TO **DUR** : aucun DO/EXCEPTION tolerant. Un
-- echec ICI doit CASSER la migration au deploy (cf. lecon 0004->0007 en en-tete) :
-- une fonction restee owned par le user de migration « marche » en local superuser
-- mais, en prod NOBYPASSRLS, ne franchit plus la RLS -> provisionnement casse en
-- prod tout en passant au vert en local. Echec FORT > faux vert silencieux.
ALTER FUNCTION "provision_subscription"(uuid, text, text[], timestamptz, timestamptz, integer)
  OWNER TO "roadsen_auth";

REVOKE ALL ON FUNCTION
  "provision_subscription"(uuid, text, text[], timestamptz, timestamptz, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  "provision_subscription"(uuid, text, text[], timestamptz, timestamptz, integer)
  TO "roadsen_app";

-- ---------------------------------------------------------------------
-- 5) Droits DML du runtime sur les nouvelles tables
--
--  subscriptions : SELECT (check guard) + UPDATE (decompte atomique conditionnel)
--    + INSERT (provisionnement direct si jamais fait sous tenant). PAS de DELETE.
--  usage_ledger  : SELECT + INSERT SEULEMENT (append-only). UPDATE/DELETE retires
--    -> double verrou avec le trigger d'immuabilite (meme le privilege manque).
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON "subscriptions" TO "roadsen_app";
REVOKE DELETE ON "subscriptions" FROM "roadsen_app";
GRANT SELECT, INSERT ON "usage_ledger" TO "roadsen_app";
REVOKE UPDATE, DELETE ON "usage_ledger" FROM "roadsen_app";

-- ---------------------------------------------------------------------
-- 6) official_pvs.verdict — VERDICT scelle (ADR 0012)
--
--  Le verdict (CONFORME / NON_CONFORME / NON_APPLICABLE) est un CHAMP DE PREMIER
--  NIVEAU du PV, DANS le perimetre du sceau HMAC (il entre dans la serialisation
--  canonique -> on ne peut alterer le statut sans casser le sceau). Cette colonne
--  est une COPIE denormalisee de la valeur scellee (comme pv_number/engine_id le
--  sont deja : a la fois scelles dans input_canonical ET stockes en colonne), pour
--  lister/filtrer et rendre le marquage NON CONFORME au PDF sans re-parser la
--  canonique. La VERITE reste la valeur scellee ; la colonne la reflete.
--
--  AJOUT ADDITIF sur official_pvs (DDL : autorise meme avec les triggers
--  d'immuabilite, qui ne bloquent que le DML UPDATE/DELETE de LIGNES). NOT NULL
--  avec DEFAULT 'NON_APPLICABLE' : sans danger sur d'eventuelles lignes
--  existantes (recette), et fail-safe — une future ligne sans verdict explicite
--  prendrait ce defaut neutre plutot que NULL. En pratique l'app fournit
--  TOUJOURS le verdict resolu a l'INSERT (fail-closed cote applicatif).
--  CHECK : enum ferme (pas de valeur libre).
-- ---------------------------------------------------------------------
ALTER TABLE "official_pvs"
  ADD COLUMN "verdict" TEXT NOT NULL DEFAULT 'NON_APPLICABLE';
ALTER TABLE "official_pvs"
  ADD CONSTRAINT "official_pvs_verdict_chk"
  CHECK ("verdict" IN ('CONFORME', 'NON_CONFORME', 'NON_APPLICABLE'));
