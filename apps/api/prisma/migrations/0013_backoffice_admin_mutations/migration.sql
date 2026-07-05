-- =====================================================================
--  ROADSEN — Migration 0013 : back-office SUPERADMIN, MUTATIONS money-adjacent (Lot 2)
--
--  ROADSEN-MIGRATION-REVIEWED: dev-backend (build) — EN ATTENTE revue
--  ingenieur-securite (zone CRITIQUE : argent + ecritures privilegiees). Deux
--  changements les PLUS dangereux, a revoir en binome :
--    (1) RE-SCOPE du GRANT UPDATE ON subscriptions (fermeture du top-up non trace) ;
--    (2) REDEFINITION de auth_user_has_membership (coeur de l'isolation, appelee a
--        CHAQUE requete par le TenantGuard).
--  Cf. docs/cadrage-backoffice.md §2 (LOT 2).
--
--  CONTEXTE
--  --------
--  Le back-office (Lot 1, 0012) LIT l'inventaire cross-tenant. Le Lot 2 ajoute les
--  MUTATIONS money-adjacent : top-up de quota, renouvellement d'abonnement, edition
--  des entitlements, gestion de role/retrait de membre, suspension d'organisation.
--  Chaque mutation est TRACEE dans un journal admin APPEND-ONLY (admin_audit_log) et
--  IDEMPOTENTE (anti double-credit). Le quota etant *money-adjacent*, on FERME
--  d'abord le chemin non trace : roadsen_app a aujourd'hui `GRANT UPDATE ON
--  subscriptions` (tout, colonnes comprises) -> un top-up direct passerait SANS
--  trace. On re-scope ce GRANT AUX SEULES colonnes que reserveUnit ecrit
--  (consommation, updated_at) ; le `quota` ne bouge plus QUE par adjust_quota (DEFINER,
--  trace). Cf. §3 ci-dessous.
--
--  MODELE DE SECURITE (repris EXACTEMENT de 0007/0008/0011)
--  --------------------------------------------------------
--  Toutes les ecritures privilegiees passent par des fonctions SECURITY DEFINER
--  owned par roadsen_auth (NOLOGIN, NOSUPERUSER, NOBYPASSRLS). Chaque fonction :
--    - pose `app.auth_bootstrap='on'` (ouvre la branche RLS d'identite + la policy
--      d'admin_audit_log) et le referme sur TOUT chemin de sortie (RETURN + EXCEPTION) ;
--    - pour les ecritures sur subscriptions (table de DONNEES tenant, policy
--      `org_id = app_current_org()` SANS branche bootstrap), pose AUSSI
--      `app.current_org = p_org_id` et le RESTAURE (patron provision_org 0004) ;
--    - search_path fige (anti-hijack DEFINER) ;
--    - EXECUTE revoque a PUBLIC, accorde au seul roadsen_app.
--
--  ECARTS DE PRIVILEGE ASSUMES (revue securite) :
--   1. GRANT SELECT, INSERT, UPDATE ON subscriptions TO roadsen_auth : adjust_quota /
--      renew_subscription / set_subscription_entitlements (owned roadsen_auth) ecrivent
--      subscriptions, ET provision_subscription (0008, owned roadsen_auth) fait un INSERT
--      qui manquait de privilege (forward-fix, cf. §2). 0008 n'avait accorde ces DML qu'a
--      roadsen_app. Sans ce GRANT, le DEFINER (execute avec le privilege de roadsen_auth)
--      echouerait en 42501 (insufficient_privilege) sous un runtime NOBYPASSRLS. roadsen_auth
--      restant NOLOGIN, ce privilege n'est atteignable QUE via les DEFINER auditees.
--   2. GRANT UPDATE ON organizations TO roadsen_auth : set_org_status ecrit
--      organizations.status. 0004/0007 n'avaient donne a roadsen_auth que SELECT/INSERT
--      sur organizations. On ajoute UPDATE (idem : atteignable seulement via DEFINER).
--   3. admin_audit_log : GRANT INSERT/SELECT a roadsen_auth UNIQUEMENT (aucun a
--      roadsen_app). RLS FORCE + policy gatee sur app_auth_bootstrap() -> meme un GRANT
--      accidentel a roadsen_app ne fuiterait rien (roadsen_app ne pose jamais le
--      drapeau). Immuabilite via triggers (clone usage_ledger 0008).
--
--  EROSION DU PERIMETRE roadsen_auth (note de revue securite) : roadsen_auth porte
--  desormais l'identite (users/orgs/memberships) + subscriptions.quota + organizations.status.
--  Cette concentration de privilege money+identite sur UN role est ACCEPTABLE en P1 UNIQUEMENT
--  parce que le runtime ne fait JAMAIS `SET ROLE roadsen_auth` : tout chemin applicatif passe
--  par `asAppRole`/`withTenant` -> `SET LOCAL ROLE roadsen_app`, et roadsen_auth (NOLOGIN)
--  n'est atteint QUE via les fonctions SECURITY DEFINER auditees. La garantie tient TANT QUE
--  cet invariant tient (aucun `SET ROLE roadsen_auth` runtime). SEPARATION d'un role « money »
--  dedie (ex. roadsen_billing) = piste Phase 2 si le perimetre s'elargit.
--
--  LIMITE D'IMMUABILITE (threat model) : les triggers FOR EACH ROW bloquent UPDATE/DELETE de
--  LIGNES mais PAS `TRUNCATE` ni `ALTER TABLE ... DISABLE TRIGGER` (operations DDL). Un porteur
--  du credential DB ADMIN (proprietaire des tables) peut donc effacer/rembobiner le journal
--  money. C'est BORNE a l'admin DB (roadsen_app a `REVOKE ALL` sur admin_audit_log ; le runtime
--  ne peut ni tronquer ni desactiver un trigger) et A NOTER dans le threat model — l'integrite
--  forte du journal (au-dela de l'admin DB) releverait d'une chaine externalisee (Phase 2).
--
--  ADDITIVE / NON DESTRUCTIVE sur les donnees existantes (CREATE TABLE nouveau,
--  CREATE OR REPLACE des fonctions, re-scope de GRANT). IDEMPOTENTE autant que
--  possible (IF NOT EXISTS, CREATE OR REPLACE, GRANT). Reversible : voir down.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) admin_audit_log — journal APPEND-ONLY des actions admin (HORS-tenant)
--
--  Cross-tenant PAR NATURE (un SUPERADMIN agit sur n'importe quelle org) : PAS de
--  policy tenant `org_id = app_current_org()` (elle n'aurait aucun sens ; target_org_id
--  est nullable et l'audit couvre toutes les orgs). A la place, RLS FORCE + une policy
--  gatee sur app_auth_bootstrap() : seuls les chemins DEFINER qui posent le drapeau
--  (les fonctions ci-dessous + le DEFINER de lecture) lisent/ecrivent ; roadsen_app,
--  qui ne pose JAMAIS ce drapeau, est fail-closed meme si un GRANT lui etait accorde
--  par erreur (defense en profondeur).
--
--  idempotency_key UNIQUE : cle d'idempotence GLOBALE (anti double-credit). Une
--  seconde mutation portant la meme cle -> ON CONFLICT DO NOTHING cote fonction ->
--  le delta n'est PAS re-applique (cf. adjust_quota). AUCUNE FK (target_org_id /
--  target_user_id) : l'audit est AUTONOME et SURVIT a la suppression d'une org/user
--  (permanence du journal, comme official_pvs 0006).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "admin_audit_log" (
  "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
  "actor_user_id"   UUID         NOT NULL,       -- sub du JWT SUPERADMIN (serveur, jamais le body — lecon #42)
  "action"          TEXT         NOT NULL,       -- ex. QUOTA_TOPUP / SUB_RENEW / ORG_STATUS_SET ...
  "target_org_id"   UUID,                        -- org visee (NULL pour une action non org-scopee)
  "target_user_id"  UUID,                        -- user vise (NULL hors action membre)
  "payload"         JSONB        NOT NULL DEFAULT '{}'::jsonb, -- avant/apres, motif, delta...
  "idempotency_key" TEXT         NOT NULL,        -- cle d'idempotence globale (anti double-credit)
  "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_audit_log_idem_key" UNIQUE ("idempotency_key"),
  CONSTRAINT "admin_audit_log_action_nonempty" CHECK (length(btrim("action")) > 0)
);

-- Index de consultation : par org visee, plus recent d'abord (liste back-office).
CREATE INDEX IF NOT EXISTS "admin_audit_log_target_org_idx"
  ON "admin_audit_log" ("target_org_id", "created_at" DESC);

-- RLS FORCE + policy gatee sur le drapeau d'auth (aucune branche tenant : hors-tenant).
ALTER TABLE "admin_audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_audit_log" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_audit_bootstrap_only" ON "admin_audit_log";
CREATE POLICY "admin_audit_bootstrap_only" ON "admin_audit_log"
  USING ("app_auth_bootstrap"())
  WITH CHECK ("app_auth_bootstrap"());

-- IMMUABILITE (clone usage_ledger 0008) : UPDATE/DELETE REFUSES -> l'audit ne peut
-- etre falsifie ni efface. Message borne, ERRCODE applicatif dedie.
CREATE OR REPLACE FUNCTION "admin_audit_log_immutable"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log est APPEND-ONLY : % interdit', TG_OP
    USING ERRCODE = 'R0004';
END;
$$;

DROP TRIGGER IF EXISTS "admin_audit_log_no_update" ON "admin_audit_log";
CREATE TRIGGER "admin_audit_log_no_update"
  BEFORE UPDATE ON "admin_audit_log"
  FOR EACH ROW EXECUTE FUNCTION "admin_audit_log_immutable"();

DROP TRIGGER IF EXISTS "admin_audit_log_no_delete" ON "admin_audit_log";
CREATE TRIGGER "admin_audit_log_no_delete"
  BEFORE DELETE ON "admin_audit_log"
  FOR EACH ROW EXECUTE FUNCTION "admin_audit_log_immutable"();

-- ---------------------------------------------------------------------
-- 2) Privileges TABLE pour les DEFINER (owned roadsen_auth)
--
--  Poses AVANT les fonctions (elles s'appuient dessus a l'execution, pas a la
--  compilation ; l'ordre n'est pas strict mais on groupe pour la lisibilite). Les
--  pre-requis de l'ALTER OWNER (executant membre de roadsen_auth + CREATE sur le
--  schema) sont poses en 0004 et re-affirmes ici (idempotents, self-contenu).
-- ---------------------------------------------------------------------
GRANT "roadsen_auth" TO CURRENT_USER;
GRANT USAGE, CREATE ON SCHEMA public TO "roadsen_auth";

-- subscriptions : adjust_quota / renew / set_entitlements (DEFINER) lisent+ecrivent.
--  INSERT inclus = FORWARD-FIX d'un bug latent de 0008 : provision_subscription (owned
--  roadsen_auth) fait un INSERT sur subscriptions, mais 0008 n'avait donne ce DML qu'a
--  roadsen_app. Sous le runtime NOBYPASSRLS (SET ROLE roadsen_app -> DEFINER execute
--  comme roadsen_auth), l'INSERT echouait 42501 -> `POST /admin/orgs` AVEC body.subscription
--  (wizard onboarding Lot 1, deja deploye) cassait en 500 en prod (masque en local car
--  connexion superuser). On accorde donc SELECT, INSERT, UPDATE a roadsen_auth.
GRANT SELECT, INSERT, UPDATE ON "subscriptions"  TO "roadsen_auth";
-- organizations : set_org_status ecrit status (roadsen_auth avait SELECT/INSERT en 0004/0007).
GRANT UPDATE ON "organizations"          TO "roadsen_auth";
-- admin_audit_log : ecriture (mutations) + lecture (DEFINER de consultation). RIEN a roadsen_app.
--  DEFENSE EN PROFONDEUR : `ALTER DEFAULT PRIVILEGES ... TO roadsen_app` (0001) accorde
--  AUTOMATIQUEMENT a/r/w/d a roadsen_app sur toute table nouvelle -> admin_audit_log en
--  a herite. La RLS (policy bootstrap-only) le neutralise deja au niveau LIGNE (roadsen_app
--  ne pose jamais le drapeau -> INSERT refuse, SELECT = 0 ligne), MAIS on REVOQUE aussi le
--  privilege de TABLE (on ne s'appuie pas sur la seule RLS ; patron 0006 official_pvs).
REVOKE ALL ON "admin_audit_log" FROM "roadsen_app";
GRANT INSERT, SELECT ON "admin_audit_log" TO "roadsen_auth";

-- ---------------------------------------------------------------------
-- 3) RE-SCOPE du GRANT UPDATE ON subscriptions (fermeture du top-up non trace)
--
--  INSPECTION reserveUnit (subscriptions.service.ts) : l'UNIQUE UPDATE que le runtime
--  fait sur subscriptions est le decompte atomique
--      SET consommation = consommation + 1, updated_at = now()
--  Il n'ecrit QUE (consommation, updated_at). On re-scope donc le GRANT UPDATE de
--  roadsen_app a CES DEUX COLONNES : roadsen_app peut toujours decompter la
--  consommation, mais NE PEUT PLUS toucher `quota` (ni date_debut/date_fin/pack/
--  entitlements). Le quota ne bouge desormais QUE via adjust_quota (DEFINER, trace) ;
--  la fenetre/les entitlements que via renew_subscription / set_subscription_entitlements.
--  SELECT et INSERT de roadsen_app sont conserves (provision + lecture d'etat).
-- ---------------------------------------------------------------------
REVOKE UPDATE ON "subscriptions" FROM "roadsen_app";
GRANT  UPDATE ("consommation", "updated_at") ON "subscriptions" TO "roadsen_app";

-- ---------------------------------------------------------------------
-- 3bis) provision_subscription — FORWARD-FIX (2e volet : CONTEXTE TENANT manquant)
--
--  Le GRANT INSERT (§2) etait NECESSAIRE mais PAS SUFFISANT. provision_subscription
--  (0008, owned roadsen_auth) fait `INSERT INTO subscriptions` SANS poser app.current_org.
--  Or la policy de subscriptions (0008) est `org_id = app_current_org()` — org-scope PUR,
--  SANS branche bootstrap — et app_current_org() (0004) RAISE (R0001) si le GUC n'est pas
--  pose. Appelee via `asAppRole` (aucun contexte tenant), la fonction echoue donc le
--  WITH CHECK -> R0001 -> `POST /admin/orgs` AVEC body.subscription = 500. (Masque en local
--  car la connexion superuser BYPASSRLS ; prouve en prod-like sous roadsen_app.)
--
--  CORRECTIF : on REDEFINIT provision_subscription pour qu'elle POSE app.current_org =
--  p_org_id (portee transaction) avant l'INSERT et le RESTAURE avant tout RETURN (patron
--  EXACT de provision_org, 0004 §3bis). Le WITH CHECK `org_id = app_current_org()` est alors
--  satisfait, sans BYPASSRLS. Logique metier INCHANGEE (gardes quota/fenetre, ON CONFLICT
--  (org_id) DO NOTHING idempotent, re-lecture de l'id existant). CREATE OR REPLACE preserve
--  l'owner (roadsen_auth) ; on le re-affirme + EXECUTE roadsen_app par prudence.
--
--  NB rollback : ce forward-fix est CONSERVE au down.sql (comme le GRANT INSERT) — restaurer
--  la forme 0008 (sans contexte) re-casserait le wizard. Cf. down.sql §4.
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
  -- contexte tenant prealable (a restaurer avant tout RETURN, comme provision_org).
  prev text := COALESCE(current_setting('app.current_org', true), '');
BEGIN
  IF p_quota IS NULL OR p_quota < 0 THEN
    RAISE EXCEPTION 'provision_subscription: quota invalide (%).', p_quota;
  END IF;
  IF p_date_debut > p_date_fin THEN
    RAISE EXCEPTION 'provision_subscription: fenetre invalide (debut > fin).';
  END IF;

  -- Pose le tenant courant sur l'org cible -> satisfait `org_id = app_current_org()`
  -- (WITH CHECK a l'INSERT, USING a la re-lecture). Portee transaction (SET LOCAL).
  PERFORM set_config('app.current_org', p_org_id::text, true);

  INSERT INTO "subscriptions"
    ("org_id", "pack", "entitlements", "date_debut", "date_fin", "quota")
  VALUES
    (p_org_id, p_pack, p_entitlements, p_date_debut, p_date_fin, p_quota)
  ON CONFLICT ("org_id") DO NOTHING
  RETURNING "id" INTO v_id;

  -- ON CONFLICT DO NOTHING -> v_id NULL si l'org a deja un abonnement : on relit
  -- l'existant (sous le meme contexte tenant) pour rester idempotent.
  IF v_id IS NULL THEN
    SELECT "id" INTO v_id FROM "subscriptions" WHERE "org_id" = p_org_id;
  END IF;

  -- Restaure le contexte prealable AVANT de rendre la main (aucune fuite de contexte).
  PERFORM set_config('app.current_org', prev, true);
  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.current_org', prev, true);
  RAISE;
END;
$$;

-- CREATE OR REPLACE preserve l'owner ; on re-affirme (barriere B1) + EXECUTE roadsen_app.
ALTER FUNCTION "provision_subscription"(uuid, text, text[], timestamptz, timestamptz, integer)
  OWNER TO "roadsen_auth";
REVOKE ALL ON FUNCTION
  "provision_subscription"(uuid, text, text[], timestamptz, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  "provision_subscription"(uuid, text, text[], timestamptz, timestamptz, integer) TO "roadsen_app";

-- ---------------------------------------------------------------------
-- 4) adjust_quota — TOP-UP de quota, ATOMIQUE + IDEMPOTENT + TRACE
--
--  Dans UNE transaction (le corps plpgsql s'execute dans la tx de l'appelant). ORDRE
--  CRITIQUE (F1, revue qa-challenger) : l'IDEMPOTENCE PASSE AVANT LA GARDE. Sinon, sur
--  un REJEU a meme cle d'un delta NEGATIF, la garde recalcule `v_new` contre le quota
--  DEJA MUTE -> RAISE 400 sur une operation pourtant REUSSIE -> l'operateur croit a un
--  echec et rejoue via une NOUVELLE cle -> DOUBLE-DECOMPTE reel. On sort donc en succes
--  idempotent AVANT de (re)calculer la garde. Ordre :
--    (a) verrouille la ligne d'abonnement (FOR UPDATE) et lit quota/consommation ;
--    (b) IDEMPOTENCE D'ABORD : INSERT admin_audit_log ON CONFLICT (idempotency_key) DO
--        NOTHING RETURNING id -> si RIEN (cle deja vue) -> RETURN NO-OP IMMEDIAT (succes
--        idempotent ; la garde n'est JAMAIS recalculee -> aucun 400 parasite au rejeu) ;
--    (c) UNIQUEMENT pour une cle NEUVE : GARDE quota resultant (quota + p_delta) >=
--        consommation ET >= 0, sinon RAISE 400 (le RAISE rollback l'INSERT audit qu'on
--        vient de faire — tout est dans la meme tx : pas d'audit orphelin) ;
--    (d) UPDATE subscriptions SET quota = v_new, updated_at = now().
--  JAMAIS `consommation` (elle se reconcilie avec le COUNT du ledger). Tout est
--  tout-ou-rien : un RAISE (garde ou abonnement introuvable) ROLLBACK aussi l'audit.
--
--  subscriptions = DONNEE tenant (policy org_scope sans bootstrap) -> on pose
--  app.current_org = p_org_id (satisfait la policy) ET on garde le WHERE org_id
--  explicite (double cloisonnement). admin_audit_log = policy bootstrap -> drapeau.
--  Les deux GUC sont restaures sur tous les chemins de sortie.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "adjust_quota"(
  p_org_id          uuid,
  p_delta           int,
  p_motif           text,
  p_actor           uuid,
  p_idempotency_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  prev_org   text := COALESCE(current_setting('app.current_org', true), '');
  v_quota    int;
  v_conso    int;
  v_new      int;
  v_audit    uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'adjust_quota: p_actor requis';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'adjust_quota: idempotency_key requis';
  END IF;

  PERFORM set_config('app.auth_bootstrap', 'on', true);
  PERFORM set_config('app.current_org', p_org_id::text, true);

  -- (a) verrou de la ligne + lecture. RLS (org_scope) restreint deja a p_org_id ;
  --     le WHERE explicite est la 2e barriere.
  SELECT "quota", "consommation" INTO v_quota, v_conso
  FROM "subscriptions"
  WHERE "org_id" = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'adjust_quota: abonnement introuvable' USING ERRCODE = 'R0005';
  END IF;

  v_new := v_quota + p_delta;

  -- (b) IDEMPOTENCE D'ABORD (F1) : trace la cle AVANT toute garde. Une cle deja vue ->
  --     NO-OP idempotent immediat, SANS recalculer la garde (sinon un rejeu de delta
  --     negatif RAISErait un 400 parasite contre le quota deja mute -> double-decompte).
  INSERT INTO "admin_audit_log"
    ("actor_user_id", "action", "target_org_id", "payload", "idempotency_key")
  VALUES (
    p_actor, 'QUOTA_TOPUP', p_org_id,
    jsonb_build_object(
      'delta', p_delta, 'motif', p_motif,
      'quota_before', v_quota, 'quota_after', v_new, 'consommation', v_conso
    ),
    p_idempotency_key
  )
  ON CONFLICT ("idempotency_key") DO NOTHING
  RETURNING "id" INTO v_audit;

  IF v_audit IS NULL THEN
    -- Cle deja appliquee : NO-OP idempotent (succes, le delta n'est PAS re-applique).
    PERFORM set_config('app.current_org', prev_org, true);
    PERFORM set_config('app.auth_bootstrap', 'off', true);
    RETURN;
  END IF;

  -- (c) GARDE (cle NEUVE uniquement) : le quota ne peut passer sous la consommation deja
  --     engagee, ni < 0. Le RAISE rollback l'INSERT audit ci-dessus (meme tx) -> pas
  --     d'audit orphelin pour une operation refusee.
  IF v_new < v_conso OR v_new < 0 THEN
    RAISE EXCEPTION 'adjust_quota: quota resultant (%) < consommation (%)', v_new, v_conso
      USING ERRCODE = 'R0006';
  END IF;

  -- (d) application du delta (jamais consommation).
  UPDATE "subscriptions"
  SET "quota" = v_new, "updated_at" = now()
  WHERE "org_id" = p_org_id;

  PERFORM set_config('app.current_org', prev_org, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.current_org', prev_org, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 5) renew_subscription — RENOUVELLEMENT : reset consommation + nouvelle fenetre
--
--  Decision actee (cadrage §2.1) : renouveler = remettre consommation a 0 ET poser
--  une nouvelle fenetre (date_debut/date_fin). Le quota n'est PAS touche (un
--  changement de quota passe par adjust_quota). Idempotent + trace (etat avant/apres).
--  Garde : date_debut <= date_fin.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "renew_subscription"(
  p_org_id          uuid,
  p_date_debut      timestamptz,
  p_date_fin        timestamptz,
  p_actor           uuid,
  p_idempotency_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  prev_org        text := COALESCE(current_setting('app.current_org', true), '');
  v_conso_before  int;
  v_debut_before  timestamptz;
  v_fin_before    timestamptz;
  v_audit         uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'renew_subscription: p_actor requis';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'renew_subscription: idempotency_key requis';
  END IF;
  IF p_date_debut IS NULL OR p_date_fin IS NULL OR p_date_debut > p_date_fin THEN
    RAISE EXCEPTION 'renew_subscription: fenetre invalide (debut > fin)' USING ERRCODE = 'R0006';
  END IF;

  PERFORM set_config('app.auth_bootstrap', 'on', true);
  PERFORM set_config('app.current_org', p_org_id::text, true);

  SELECT "consommation", "date_debut", "date_fin"
    INTO v_conso_before, v_debut_before, v_fin_before
  FROM "subscriptions"
  WHERE "org_id" = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'renew_subscription: abonnement introuvable' USING ERRCODE = 'R0005';
  END IF;

  INSERT INTO "admin_audit_log"
    ("actor_user_id", "action", "target_org_id", "payload", "idempotency_key")
  VALUES (
    p_actor, 'SUB_RENEW', p_org_id,
    jsonb_build_object(
      'consommation_before', v_conso_before,
      'date_debut_before', v_debut_before, 'date_fin_before', v_fin_before,
      'date_debut_after', p_date_debut, 'date_fin_after', p_date_fin
    ),
    p_idempotency_key
  )
  ON CONFLICT ("idempotency_key") DO NOTHING
  RETURNING "id" INTO v_audit;

  IF v_audit IS NULL THEN
    PERFORM set_config('app.current_org', prev_org, true);
    PERFORM set_config('app.auth_bootstrap', 'off', true);
    RETURN;
  END IF;

  UPDATE "subscriptions"
  SET "consommation" = 0,
      "date_debut"   = p_date_debut,
      "date_fin"     = p_date_fin,
      "updated_at"   = now()
  WHERE "org_id" = p_org_id;

  PERFORM set_config('app.current_org', prev_org, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.current_org', prev_org, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 6) set_subscription_entitlements — edition du pack + entitlements, TRACE
--
--  Modifie le pack et la liste d'entitlements (modules debloques). Ni quota ni
--  fenetre ni consommation. Idempotent + trace (avant/apres). Garde : entitlements
--  non-NULL (peut etre vide = aucun module).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "set_subscription_entitlements"(
  p_org_id          uuid,
  p_pack            text,
  p_entitlements    text[],
  p_actor           uuid,
  p_idempotency_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  prev_org       text := COALESCE(current_setting('app.current_org', true), '');
  v_pack_before  text;
  v_ent_before   text[];
  v_audit        uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'set_subscription_entitlements: p_actor requis';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'set_subscription_entitlements: idempotency_key requis';
  END IF;
  IF p_pack IS NULL OR length(btrim(p_pack)) = 0 THEN
    RAISE EXCEPTION 'set_subscription_entitlements: pack requis';
  END IF;
  IF p_entitlements IS NULL THEN
    RAISE EXCEPTION 'set_subscription_entitlements: entitlements requis (liste, eventuellement vide)';
  END IF;

  PERFORM set_config('app.auth_bootstrap', 'on', true);
  PERFORM set_config('app.current_org', p_org_id::text, true);

  SELECT "pack", "entitlements" INTO v_pack_before, v_ent_before
  FROM "subscriptions"
  WHERE "org_id" = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_subscription_entitlements: abonnement introuvable' USING ERRCODE = 'R0005';
  END IF;

  INSERT INTO "admin_audit_log"
    ("actor_user_id", "action", "target_org_id", "payload", "idempotency_key")
  VALUES (
    p_actor, 'ENTITLEMENTS_SET', p_org_id,
    jsonb_build_object(
      'pack_before', v_pack_before, 'pack_after', p_pack,
      'entitlements_before', to_jsonb(v_ent_before),
      'entitlements_after', to_jsonb(p_entitlements)
    ),
    p_idempotency_key
  )
  ON CONFLICT ("idempotency_key") DO NOTHING
  RETURNING "id" INTO v_audit;

  IF v_audit IS NULL THEN
    PERFORM set_config('app.current_org', prev_org, true);
    PERFORM set_config('app.auth_bootstrap', 'off', true);
    RETURN;
  END IF;

  UPDATE "subscriptions"
  SET "pack" = p_pack, "entitlements" = p_entitlements, "updated_at" = now()
  WHERE "org_id" = p_org_id;

  PERFORM set_config('app.current_org', prev_org, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.current_org', prev_org, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 7) set_member_role — change le role tenant d'un membre, TRACE
--
--  Anti-escalade : p_role = 'OWNER' INTERDIT par cette voie (comme provision_member :
--  l'OWNER se gere a la creation d'org / transfert explicite). Anti-lockout : on ne
--  RETROGRADE jamais le DERNIER OWNER actif (l'org resterait sans proprietaire) —
--  VERROU FOR UPDATE sur les OWNER actifs avant le comptage (patron 0011). memberships
--  = policy `org_scope OR bootstrap` -> le drapeau suffit (pas besoin d'app.current_org).
--  Le WHERE (org_id, user_id) explicite est l'UNIQUE cloisonnement sous le drapeau.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "set_member_role"(
  p_org_id          uuid,
  p_user_id         uuid,
  p_role            "Role",
  p_actor           uuid,
  p_idempotency_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_current "Role";
  owners    int;
  v_audit   uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'set_member_role: p_actor requis';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'set_member_role: idempotency_key requis';
  END IF;
  IF p_role = 'OWNER' THEN
    RAISE EXCEPTION 'set_member_role: OWNER interdit par cette voie' USING ERRCODE = 'R0007';
  END IF;

  PERFORM set_config('app.auth_bootstrap', 'on', true);

  SELECT m."role" INTO v_current
  FROM "memberships" m
  WHERE m."org_id" = p_org_id AND m."user_id" = p_user_id;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'set_member_role: membre introuvable' USING ERRCODE = 'R0005';
  END IF;

  -- Anti-lockout : retrograder le DERNIER OWNER actif laisserait l'org sans owner.
  -- On verrouille les OWNER actifs (FOR UPDATE) AVANT de compter (serialise deux
  -- retrogradations concurrentes) — patron set_member_active (0011).
  IF v_current = 'OWNER' AND p_role <> 'OWNER' THEN
    SELECT count(*) INTO owners FROM (
      SELECT 1 FROM "memberships" m
      WHERE m."org_id" = p_org_id AND m."role" = 'OWNER' AND m."is_active" = true
      FOR UPDATE
    ) locked;
    IF owners <= 1 THEN
      RAISE EXCEPTION 'set_member_role: dernier OWNER actif (anti-lockout)' USING ERRCODE = 'R0008';
    END IF;
  END IF;

  INSERT INTO "admin_audit_log"
    ("actor_user_id", "action", "target_org_id", "target_user_id", "payload", "idempotency_key")
  VALUES (
    p_actor, 'MEMBER_ROLE_SET', p_org_id, p_user_id,
    jsonb_build_object('role_before', v_current, 'role_after', p_role),
    p_idempotency_key
  )
  ON CONFLICT ("idempotency_key") DO NOTHING
  RETURNING "id" INTO v_audit;

  IF v_audit IS NULL THEN
    PERFORM set_config('app.auth_bootstrap', 'off', true);
    RETURN;
  END IF;

  UPDATE "memberships" SET "role" = p_role
  WHERE "org_id" = p_org_id AND "user_id" = p_user_id;

  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 8) remove_member — retrait SOFT (is_active=false) d'un membre, TRACE
--
--  SOFT par defaut (decision cadrage §2.2) : on suspend sans supprimer (le back-office
--  peut reactiver via set_member_active). Anti-lockout : jamais le dernier OWNER actif
--  (FOR UPDATE, patron 0011). Idempotence : une cle deja vue -> no-op. Si le membre est
--  DEJA inactif, l'UPDATE est neutre mais la 1re trace reste posee (le back-office voit
--  l'action). memberships = policy `org_scope OR bootstrap` -> drapeau suffit.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "remove_member"(
  p_org_id          uuid,
  p_user_id         uuid,
  p_actor           uuid,
  p_idempotency_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role   "Role";
  owners   int;
  v_audit  uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'remove_member: p_actor requis';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'remove_member: idempotency_key requis';
  END IF;

  PERFORM set_config('app.auth_bootstrap', 'on', true);

  SELECT m."role" INTO v_role
  FROM "memberships" m
  WHERE m."org_id" = p_org_id AND m."user_id" = p_user_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'remove_member: membre introuvable' USING ERRCODE = 'R0005';
  END IF;

  IF v_role = 'OWNER' THEN
    SELECT count(*) INTO owners FROM (
      SELECT 1 FROM "memberships" m
      WHERE m."org_id" = p_org_id AND m."role" = 'OWNER' AND m."is_active" = true
      FOR UPDATE
    ) locked;
    IF owners <= 1 THEN
      RAISE EXCEPTION 'remove_member: dernier OWNER actif (anti-lockout)' USING ERRCODE = 'R0008';
    END IF;
  END IF;

  INSERT INTO "admin_audit_log"
    ("actor_user_id", "action", "target_org_id", "target_user_id", "payload", "idempotency_key")
  VALUES (
    p_actor, 'MEMBER_REMOVED', p_org_id, p_user_id,
    jsonb_build_object('role', v_role, 'mode', 'SOFT'),
    p_idempotency_key
  )
  ON CONFLICT ("idempotency_key") DO NOTHING
  RETURNING "id" INTO v_audit;

  IF v_audit IS NULL THEN
    PERFORM set_config('app.auth_bootstrap', 'off', true);
    RETURN;
  END IF;

  UPDATE "memberships" SET "is_active" = false
  WHERE "org_id" = p_org_id AND "user_id" = p_user_id;

  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 9) set_org_status — SUSPENSION / (RE)ACTIVATION / ARCHIVAGE d'une org, TRACE
--
--  Ecrit organizations.status. organizations = table d'IDENTITE (policy
--  `id = app_current_org_or_null() OR app_auth_bootstrap()`) : le drapeau suffit
--  (pas besoin d'app.current_org). L'EFFET REEL de la suspension est porte par la
--  REDEFINITION de auth_user_has_membership (§10) : une org SUSPENDED -> ses membres
--  perdent l'acces au prochain appel. Idempotent + trace (status avant/apres).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "set_org_status"(
  p_org_id          uuid,
  p_status          "OrgStatus",
  p_actor           uuid,
  p_idempotency_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_before "OrgStatus";
  v_audit  uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'set_org_status: p_actor requis';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'set_org_status: idempotency_key requis';
  END IF;

  PERFORM set_config('app.auth_bootstrap', 'on', true);

  SELECT o."status" INTO v_before
  FROM "organizations" o
  WHERE o."id" = p_org_id
  FOR UPDATE;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'set_org_status: organisation introuvable' USING ERRCODE = 'R0005';
  END IF;

  INSERT INTO "admin_audit_log"
    ("actor_user_id", "action", "target_org_id", "payload", "idempotency_key")
  VALUES (
    p_actor, 'ORG_STATUS_SET', p_org_id,
    jsonb_build_object('status_before', v_before, 'status_after', p_status),
    p_idempotency_key
  )
  ON CONFLICT ("idempotency_key") DO NOTHING
  RETURNING "id" INTO v_audit;

  IF v_audit IS NULL THEN
    PERFORM set_config('app.auth_bootstrap', 'off', true);
    RETURN;
  END IF;

  UPDATE "organizations" SET "status" = p_status, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "id" = p_org_id;

  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 10) REDEFINITION de auth_user_has_membership — SUSPENSION D'ORG PROPRE (RLS)
--
--  ⚠️ COEUR DE L'ISOLATION : appelee a CHAQUE requete par le TenantGuard (via
--  AuthService.membershipRole). On AJOUTE la jointure `organizations o WHERE
--  o.status = 'ACTIVE'` (en plus du filtre is_active deja pose en 0011). Effet : un
--  membre d'une org SUSPENDED/ARCHIVED ne porte plus de role -> 403 au prochain appel.
--  Un membre LEGITIME (org ACTIVE + is_active=true) garde l'acces (non-regression
--  OBLIGATOIRE). Forme 0011 CONSERVEE (plpgsql + drapeau app.auth_bootstrap, sans
--  lequel la lecture de memberships/organizations « a froid » renverrait 0 ligne).
--  CREATE OR REPLACE preserve owner (roadsen_auth) + GRANT EXECUTE.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "auth_user_has_membership"(
  p_user_id uuid,
  p_org_id  uuid
)
RETURNS TABLE (role "Role")
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);
  RETURN QUERY
    SELECT m."role"
    FROM "memberships" m
    JOIN "organizations" o ON o."id" = m."org_id"    -- <-- AJOUT : l'org doit exister ET
    WHERE m."user_id" = p_user_id
      AND m."org_id"  = p_org_id
      AND m."is_active" = true                       --     le membre etre actif (0011) ET
      AND o."status"  = 'ACTIVE'                      -- <-- l'org etre ACTIVE (suspension propre)
    LIMIT 1;
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 11) admin_list_audit — LECTURE du journal d'audit (back-office SUPERADMIN)
--
--  DEFINER (drapeau bootstrap -> franchit la policy d'admin_audit_log). Filtre
--  optionnel sur target_org_id, BORNE (limit plafonne a 100), tri recent d'abord.
--  Un journal non lisible serait inutile ; cette voie reste SUPERADMIN-only (route).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "admin_list_audit"(
  p_org_id uuid DEFAULT NULL,
  p_limit  int  DEFAULT 50,
  p_offset int  DEFAULT 0
)
RETURNS TABLE (
  id              uuid,
  actor_user_id   uuid,
  action          text,
  target_org_id   uuid,
  target_user_id  uuid,
  payload         jsonb,
  created_at      timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit  int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);
  RETURN QUERY
    SELECT a."id", a."actor_user_id", a."action", a."target_org_id",
           a."target_user_id", a."payload", a."created_at"
    FROM "admin_audit_log" a
    WHERE p_org_id IS NULL OR a."target_org_id" = p_org_id
    ORDER BY a."created_at" DESC, a."id" DESC
    LIMIT v_limit OFFSET v_offset;
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 12) Propriete (barriere B1) + EXECUTE reserve a roadsen_app
--
--  Chaque fonction DEFINER devient owned par roadsen_auth (elle s'execute alors avec
--  le privilege de table de roadsen_auth, pas de l'appelant). EXECUTE revoque a PUBLIC,
--  accorde au seul roadsen_app. OWNER TO DUR (echec fort au deploy si impossible —
--  lecon 0004->0007 : une fonction restee owned par le user de migration « marche » en
--  local superuser mais casse en prod NOBYPASSRLS).
-- ---------------------------------------------------------------------
ALTER FUNCTION "adjust_quota"(uuid, int, text, uuid, text)                        OWNER TO "roadsen_auth";
ALTER FUNCTION "renew_subscription"(uuid, timestamptz, timestamptz, uuid, text)   OWNER TO "roadsen_auth";
ALTER FUNCTION "set_subscription_entitlements"(uuid, text, text[], uuid, text)    OWNER TO "roadsen_auth";
ALTER FUNCTION "set_member_role"(uuid, uuid, "Role", uuid, text)                  OWNER TO "roadsen_auth";
ALTER FUNCTION "remove_member"(uuid, uuid, uuid, text)                            OWNER TO "roadsen_auth";
ALTER FUNCTION "set_org_status"(uuid, "OrgStatus", uuid, text)                    OWNER TO "roadsen_auth";
ALTER FUNCTION "admin_list_audit"(uuid, int, int)                                 OWNER TO "roadsen_auth";
-- auth_user_has_membership : deja owned roadsen_auth (0004/0011) ; CREATE OR REPLACE
-- l'a preserve, on re-affirme par prudence (idempotent).
ALTER FUNCTION "auth_user_has_membership"(uuid, uuid)                             OWNER TO "roadsen_auth";

REVOKE ALL ON FUNCTION "adjust_quota"(uuid, int, text, uuid, text)                        FROM PUBLIC;
REVOKE ALL ON FUNCTION "renew_subscription"(uuid, timestamptz, timestamptz, uuid, text)   FROM PUBLIC;
REVOKE ALL ON FUNCTION "set_subscription_entitlements"(uuid, text, text[], uuid, text)    FROM PUBLIC;
REVOKE ALL ON FUNCTION "set_member_role"(uuid, uuid, "Role", uuid, text)                  FROM PUBLIC;
REVOKE ALL ON FUNCTION "remove_member"(uuid, uuid, uuid, text)                            FROM PUBLIC;
REVOKE ALL ON FUNCTION "set_org_status"(uuid, "OrgStatus", uuid, text)                    FROM PUBLIC;
REVOKE ALL ON FUNCTION "admin_list_audit"(uuid, int, int)                                 FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "adjust_quota"(uuid, int, text, uuid, text)                        TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "renew_subscription"(uuid, timestamptz, timestamptz, uuid, text)   TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "set_subscription_entitlements"(uuid, text, text[], uuid, text)    TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "set_member_role"(uuid, uuid, "Role", uuid, text)                  TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "remove_member"(uuid, uuid, uuid, text)                            TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "set_org_status"(uuid, "OrgStatus", uuid, text)                    TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "admin_list_audit"(uuid, int, int)                                 TO "roadsen_app";
