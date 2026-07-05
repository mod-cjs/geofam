-- =====================================================================
--  ROADSEN — Migration 0014 : back-office SUPERADMIN, TABLEAU DE BORD + vues GLOBALES
--
--  ROADSEN-MIGRATION-REVIEWED: dev-backend (build) — EN ATTENTE revue
--  ingenieur-securite (zone CRITIQUE). Points a revoir en binome (cf. §0 ci-dessous) :
--    (1) NOUVELLE branche de lecture BOOTSTRAP sur DEUX tables de DONNEES tenant
--        (subscriptions, official_pvs) : elargit ce que le drapeau app.auth_bootstrap
--        expose. AVANT 0014, poser ce drapeau ne donnait acces qu'a l'IDENTITE
--        (emails, noms d'org). APRES 0014, il donne AUSSI la lecture cross-tenant de
--        TOUS les abonnements (montants de quota/consommation, fenetres) et des
--        META-donnees de TOUS les PV. Le modele de confidentialite money/PV repose
--        donc desormais sur le MEME invariant que l'identite depuis 0007 : « le runtime
--        roadsen_app ne pose JAMAIS app.auth_bootstrap » (aucun code applicatif ne le
--        fait ; seules les fonctions SECURITY DEFINER le posent/referment). C'est
--        COHERENT avec 0007 mais AUGMENTE la valeur de cet invariant -> a valider.
--    (2) admin_platform_stats / admin_list_orgs enrichi lisent subscriptions+official_pvs
--        cross-tenant. MITIGATION CDP : stats = AGREGATS SCALAIRES seulement (aucune
--        ligne tenant brute) ; la liste d'orgs ne renvoie que le RESUME d'abo deja
--        montre au SUPERADMIN dans le detail d'org (rien de nouveau cote fuite).
--    (3) BACKPORT d'audit : provision_user/org/member + set_member_active (Lot 1, non
--        traces jusqu'ici) recoivent un p_actor_user_id et TRACENT dans admin_audit_log,
--        ATOMIQUEMENT (meme tx que la mutation). L'acteur est le sub JWT SUPERADMIN
--        (jamais le corps, lecon #42). Implementes en WRAPPERS des fonctions existantes
--        (corps eprouves INCHANGES) -> risque minimal, rollback trivial.
--
--  CONTEXTE
--  --------
--  Vague 1 du back-office : un TABLEAU DE BORD plateforme (agregats cross-tenant) + des
--  vues GLOBALES (journal d'audit toutes-orgs, liste d'orgs filtrable/triable en SQL,
--  console d'abonnements). Jusqu'ici la liste d'orgs (0012) ne portait que l'IDENTITE et
--  enrichissait l'abo PAR ORG (N+1) cote service -> le tri/filtre par montant d'abo etait
--  fait CLIENT-SIDE sur une seule page (pagination faussee). On corrige a la SOURCE : la
--  DEFINER de liste JOINT subscriptions et trie/filtre/pagine en SQL, en UNE passe.
--
--  MODELE DE SECURITE (repris EXACTEMENT de 0007/0012/0013)
--  --------------------------------------------------------
--  Toute lecture/ecriture privilegiee passe par des fonctions SECURITY DEFINER owned par
--  roadsen_auth (NOLOGIN, NOSUPERUSER, NOBYPASSRLS). Chaque fonction pose le drapeau
--  app.auth_bootstrap et le referme sur TOUT chemin de sortie (RETURN + EXCEPTION),
--  search_path fige, EXECUTE revoque a PUBLIC + accorde au seul roadsen_app. AUCUN
--  BYPASSRLS n'est introduit : la visibilite cross-tenant vient de la RLS (branche
--  bootstrap), pas d'un contournement de la RLS.
--
--  ADDITIVE / NON DESTRUCTIVE sur les donnees (CREATE POLICY nouvelles, CREATE OR REPLACE
--  / DROP+CREATE de fonctions, GRANT). IDEMPOTENTE (IF EXISTS / OR REPLACE / DROP POLICY IF
--  EXISTS). Reversible : voir down.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Branche de LECTURE bootstrap sur subscriptions + official_pvs
--
--  subscriptions/official_pvs ont une policy tenant_isolation FOR ALL avec le helper
--  RAISANT app_current_org() (fail-closed dur hors contexte). Pour permettre a une
--  DEFINER d'AGREGER cross-tenant SANS BYPASSRLS, on AJOUTE une policy PERMISSIVE
--  **FOR SELECT UNIQUEMENT**, gatee sur le RÔLE (current_user = 'roadsen_auth') :
--    - roadsen_app n'est PAS membre de roadsen_auth (seul le superuser l'est) -> cette
--      policy est toujours FALSE pour lui, meme s'il pose app.auth_bootstrap -> son
--      comportement de lecture est INCHANGE (org-scope ; RAISE hors contexte preserve,
--      car la policy FOR ALL raisante s'evalue toujours pour lui) ;
--    - une DEFINER (owner roadsen_auth) qui pose un app.current_org FACTICE (pour que le
--      app_current_org() de la policy FOR ALL ne RAISE pas) voit toutes les lignes via
--      le OR de cette policy SELECT (current_user y vaut 'roadsen_auth').
--  Les ECRITURES restent 100% inchangees (aucune branche bootstrap en WITH CHECK / FOR
--  INSERT/UPDATE/DELETE) : l'isolation d'ecriture money/PV n'est PAS touchee.
--
--  Design (b) retenu apres REVUE SECURITE ADVERSE : le gate par-role n'est PAS un
--  set_config falsifiable par injection -> il exige d'ETRE roadsen_auth (ce que seules
--  les DEFINER sont). Restaure une 2e barriere par-role pour money/PV (analogue de B1
--  pour l'identite). Condition permanente : le runtime se connecte en roadsen_app/
--  render_app (non-membre de roadsen_auth), jamais en role proprietaire.
-- ---------------------------------------------------------------------

-- Pre-requis ALTER OWNER (executant membre de roadsen_auth + CREATE sur le schema),
-- re-affirmes ici (idempotents, self-contenu — patron 0013 §2).
GRANT "roadsen_auth" TO CURRENT_USER;
GRANT USAGE, CREATE ON SCHEMA public TO "roadsen_auth";

-- roadsen_auth doit pouvoir LIRE official_pvs (il a deja SELECT sur subscriptions via
-- 0013). Sans ce GRANT de TABLE, la DEFINER (executee comme roadsen_auth) echouerait en
-- 42501 malgre la policy (la RLS filtre les LIGNES, le GRANT autorise la COMMANDE).
GRANT SELECT ON "official_pvs" TO "roadsen_auth";

-- GATE PAR RÔLE (revue securite adverse, design (b)) : la lecture cross-tenant est
-- reservee au CORPS des DEFINER, qui s'executent comme leur owner roadsen_auth
-- (current_user = 'roadsen_auth'). roadsen_app NE PEUT PAS devenir roadsen_auth
-- (non membre ; seul le superuser l'est) -> meme en posant app.auth_bootstrap, il voit
-- 0 ligne. Barriere NON falsifiable par set_config (contrairement au drapeau) : elle
-- restaure une 2e barriere par-role pour money/PV, l'analogue de B1 pour l'identite.
DROP POLICY IF EXISTS "stats_bootstrap_read" ON "subscriptions";
CREATE POLICY "stats_bootstrap_read" ON "subscriptions"
  FOR SELECT
  USING (current_user = 'roadsen_auth');

DROP POLICY IF EXISTS "stats_bootstrap_read" ON "official_pvs";
CREATE POLICY "stats_bootstrap_read" ON "official_pvs"
  FOR SELECT
  USING (current_user = 'roadsen_auth');

-- ---------------------------------------------------------------------
-- 2) admin_platform_stats — AGREGATS cross-tenant (tableau de bord)
--
--  Renvoie UNE LIGNE de SCALAIRES (minimisation CDP : aucune ligne tenant brute). Pose
--  le drapeau + un app.current_org FACTICE (gen_random_uuid) : le factice ne matche
--  aucune org (le OR bootstrap fait la visibilite) mais EMPECHE le RAISE de la policy
--  FOR ALL raisante de subscriptions/official_pvs. Les deux GUC sont restaures sur tous
--  les chemins de sortie.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "admin_platform_stats"()
RETURNS TABLE (
  orgs_active           bigint,
  orgs_suspended        bigint,
  orgs_archived         bigint,
  users_total           bigint,
  memberships_active    bigint,
  pv_total              bigint,
  quota_alloue_total    bigint,
  quota_consomme_total  bigint,
  abos_expirant_30j     bigint,
  abos_expires          bigint,
  orgs_sans_abo         bigint,
  orgs_quota_90pct      bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  prev_org text := COALESCE(current_setting('app.current_org', true), '');
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);
  -- Contexte FACTICE : neutralise le RAISE de la policy FOR ALL de subscriptions/
  -- official_pvs (app_current_org() ne RAISE plus, retourne ce factice qui ne matche
  -- aucune ligne ; la visibilite vient du OR bootstrap de stats_bootstrap_read).
  PERFORM set_config('app.current_org', gen_random_uuid()::text, true);

  RETURN QUERY
    SELECT
      (SELECT count(*) FROM "organizations" WHERE "status" = 'ACTIVE')            AS orgs_active,
      (SELECT count(*) FROM "organizations" WHERE "status" = 'SUSPENDED')         AS orgs_suspended,
      (SELECT count(*) FROM "organizations" WHERE "status" = 'ARCHIVED')          AS orgs_archived,
      (SELECT count(*) FROM "users")                                              AS users_total,
      (SELECT count(*) FROM "memberships" WHERE "is_active" = true)               AS memberships_active,
      (SELECT count(*) FROM "official_pvs")                                       AS pv_total,
      (SELECT COALESCE(sum("quota"), 0) FROM "subscriptions")::bigint             AS quota_alloue_total,
      (SELECT COALESCE(sum("consommation"), 0) FROM "subscriptions")::bigint      AS quota_consomme_total,
      (SELECT count(*) FROM "subscriptions"
         WHERE "date_fin" >= now() AND "date_fin" < now() + interval '30 days')   AS abos_expirant_30j,
      (SELECT count(*) FROM "subscriptions" WHERE "date_fin" < now())             AS abos_expires,
      (SELECT count(*) FROM "organizations" o
         WHERE NOT EXISTS (SELECT 1 FROM "subscriptions" s WHERE s."org_id" = o."id")) AS orgs_sans_abo,
      (SELECT count(*) FROM "subscriptions"
         WHERE "quota" > 0 AND "consommation"::numeric >= 0.9 * "quota"::numeric) AS orgs_quota_90pct;

  PERFORM set_config('app.current_org', prev_org, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.current_org', prev_org, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 3) admin_list_orgs (ENRICHI) — identite + nb membres + RESUME D'ABO en UNE passe
--
--  REDEFINITION (DROP de la signature 0012 (int,int,text) + CREATE d'une signature
--  enrichie). Ajouts vs 0012 :
--    - p_status  : filtre par statut d'org (NULL = tous) ;
--    - p_sort    : tri whiteliste { name | createdAt | quota | expiration } (defaut name) ;
--    - p_sub_filter : filtre money whiteliste (NULL = aucun) :
--        expired  = date_fin < now ; expiring = date_fin dans [now, now+30j] ;
--        noquota  = quota epuise (consommation >= quota) ; nosub = SANS abonnement ;
--        withsub  = AVEC abonnement.
--  JOINT subscriptions (LEFT) -> tri/filtre/pagination MONEY en SQL (fin du client-side).
--  Le tri est whiteliste PAR CONSTRUCTION (CASE sur v_sort) : aucune injection possible
--  (jamais de SQL dynamique concatene). Drapeau + app.current_org factice (idem §2 :
--  subscriptions est joint et sa policy FOR ALL raisante s'evalue).
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS "admin_list_orgs"(int, int, text);

CREATE OR REPLACE FUNCTION "admin_list_orgs"(
  p_limit      int         DEFAULT 20,
  p_offset     int         DEFAULT 0,
  p_q          text        DEFAULT NULL,
  p_status     "OrgStatus" DEFAULT NULL,
  p_sort       text        DEFAULT NULL,
  p_sub_filter text        DEFAULT NULL
)
RETURNS TABLE (
  id            uuid,
  name          text,
  slug          text,
  status        "OrgStatus",
  created_at    timestamp,   -- SANS fuseau : correspond a organizations.createdAt (cf. 0012)
  nb_membres    bigint,
  has_sub       boolean,
  pack          text,
  quota         int,
  consommation  int,
  date_fin      timestamptz,
  expired       boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit  int  := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_offset int  := GREATEST(COALESCE(p_offset, 0), 0);
  v_pat    text := CASE
                     WHEN p_q IS NULL OR length(btrim(p_q)) = 0 THEN NULL
                     ELSE '%' || replace(replace(replace(btrim(p_q),
                            '\', '\\'), '%', '\%'), '_', '\_') || '%'
                   END;
  -- tri whiteliste : toute valeur hors liste retombe sur le defaut 'name'.
  v_sort   text := CASE
                     WHEN p_sort IN ('name', 'createdAt', 'quota', 'expiration') THEN p_sort
                     ELSE 'name'
                   END;
  -- filtre money whiteliste : toute valeur hors liste = pas de filtre.
  v_filter text := CASE
                     WHEN p_sub_filter IN ('expired', 'expiring', 'noquota', 'nosub', 'withsub')
                       THEN p_sub_filter
                     ELSE NULL
                   END;
  prev_org text := COALESCE(current_setting('app.current_org', true), '');
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);
  PERFORM set_config('app.current_org', gen_random_uuid()::text, true);

  RETURN QUERY
    SELECT
      o."id",
      o."name",
      o."slug",
      o."status",
      o."createdAt" AS created_at,
      (SELECT count(*) FROM "memberships" m WHERE m."org_id" = o."id") AS nb_membres,
      (s."id" IS NOT NULL) AS has_sub,
      s."pack",
      s."quota",
      s."consommation",
      s."date_fin",
      (s."date_fin" IS NOT NULL AND now() > s."date_fin") AS expired
    FROM "organizations" o
    LEFT JOIN "subscriptions" s ON s."org_id" = o."id"
    WHERE (p_status IS NULL OR o."status" = p_status)
      AND (v_pat IS NULL OR o."name" ILIKE v_pat OR o."slug" ILIKE v_pat)
      AND (
        v_filter IS NULL
        OR (v_filter = 'expired'  AND s."id" IS NOT NULL AND s."date_fin" < now())
        OR (v_filter = 'expiring' AND s."id" IS NOT NULL
              AND s."date_fin" >= now() AND s."date_fin" < now() + interval '30 days')
        OR (v_filter = 'noquota'  AND s."id" IS NOT NULL AND s."consommation" >= s."quota")
        OR (v_filter = 'nosub'    AND s."id" IS NULL)
        OR (v_filter = 'withsub'  AND s."id" IS NOT NULL)
      )
    ORDER BY
      (CASE WHEN v_sort = 'quota'      THEN s."quota" END)                       DESC NULLS LAST,
      (CASE WHEN v_sort = 'expiration' THEN extract(epoch FROM s."date_fin") END) ASC  NULLS LAST,
      (CASE WHEN v_sort = 'createdAt'  THEN o."createdAt" END)                    DESC NULLS LAST,
      o."name" ASC, o."id" ASC
    LIMIT v_limit OFFSET v_offset;

  PERFORM set_config('app.current_org', prev_org, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.current_org', prev_org, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 4) admin_list_audit (ENRICHI) — journal GLOBAL filtrable (action/acteur/periode)
--
--  0013 supporte deja p_org_id NULL (mode GLOBAL). On AJOUTE des filtres SQL bornes :
--  p_action (texte exact), p_actor (uuid), p_from / p_to (fenetre temporelle). REDEFINITION
--  (DROP (uuid,int,int) + CREATE signature enrichie). Colonnes minimales, tri recent
--  d'abord, borne (limit <= 100).
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS "admin_list_audit"(uuid, int, int);

CREATE OR REPLACE FUNCTION "admin_list_audit"(
  p_org_id uuid        DEFAULT NULL,
  p_limit  int         DEFAULT 50,
  p_offset int         DEFAULT 0,
  p_action text        DEFAULT NULL,
  p_actor  uuid        DEFAULT NULL,
  p_from   timestamptz DEFAULT NULL,
  p_to     timestamptz DEFAULT NULL
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
  v_limit  int  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset int  := GREATEST(COALESCE(p_offset, 0), 0);
  v_action text := CASE
                     WHEN p_action IS NULL OR length(btrim(p_action)) = 0 THEN NULL
                     ELSE btrim(p_action)
                   END;
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);
  RETURN QUERY
    SELECT a."id", a."actor_user_id", a."action", a."target_org_id",
           a."target_user_id", a."payload", a."created_at"
    FROM "admin_audit_log" a
    WHERE (p_org_id IS NULL OR a."target_org_id" = p_org_id)
      AND (v_action IS NULL OR a."action" = v_action)
      AND (p_actor  IS NULL OR a."actor_user_id" = p_actor)
      AND (p_from   IS NULL OR a."created_at" >= p_from)
      AND (p_to     IS NULL OR a."created_at" <= p_to)
    ORDER BY a."created_at" DESC, a."id" DESC
    LIMIT v_limit OFFSET v_offset;
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 5) BACKPORT d'audit sur les mutations Lot 1 (provision_user/org/member + set_member_active)
--
--  Ces actions d'onboarding n'etaient PAS tracees. On ajoute des SURCHARGES (nouvelle
--  arite avec p_actor_user_id) qui :
--    (a) DELEGUENT au corps EPROUVE existant (arite d'origine) -> logique metier
--        INCHANGEE (unicite/FK/anti-lockout/contexte tenant preserves) ;
--    (b) TRACENT dans admin_audit_log APRES succes, dans la MEME transaction (atomicite :
--        un echec de trace ROLLBACK la mutation ; un echec de mutation => pas de trace).
--  L'idempotency_key est GENEREE (gen_random_uuid) : l'onboarding n'est pas rejouable a
--  cle stable (createUser/createOrg sont deja tranches par UNIQUE email/slug) ; chaque
--  action reussie laisse UNE ligne d'audit. L'acteur = sub JWT SUPERADMIN (le service le
--  passe ; jamais le corps — lecon #42). p_actor_user_id NULL -> refus (defense).
--
--  Owned roadsen_auth (INSERT sur admin_audit_log via le GRANT 0013). Les surcharges
--  n'ecrasent PAS les fonctions d'origine (arite differente) -> rollback = simple DROP.
-- ---------------------------------------------------------------------

-- (a) provision_user + audit
CREATE OR REPLACE FUNCTION "provision_user"(
  p_email         text,
  p_password_hash text,
  p_full_name     text,
  p_actor_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user uuid;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'provision_user: p_actor_user_id requis';
  END IF;
  -- delegue au corps d'origine (arite 3) : unicite email tranchee par la base (23505).
  v_user := "provision_user"(p_email, p_password_hash, p_full_name);

  PERFORM set_config('app.auth_bootstrap', 'on', true);
  INSERT INTO "admin_audit_log"
    ("actor_user_id", "action", "target_user_id", "payload", "idempotency_key")
  VALUES (p_actor_user_id, 'USER_PROVISIONED', v_user, '{}'::jsonb, gen_random_uuid()::text);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RETURN v_user;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- (b) provision_org + audit
CREATE OR REPLACE FUNCTION "provision_org"(
  p_name          text,
  p_slug          text,
  p_owner_user_id uuid,
  p_actor_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org uuid;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'provision_org: p_actor_user_id requis';
  END IF;
  -- delegue au corps d'origine (arite 3) : unicite slug (23505) / FK owner (23503).
  v_org := "provision_org"(p_name, p_slug, p_owner_user_id);

  PERFORM set_config('app.auth_bootstrap', 'on', true);
  INSERT INTO "admin_audit_log"
    ("actor_user_id", "action", "target_org_id", "payload", "idempotency_key")
  VALUES (
    p_actor_user_id, 'ORG_PROVISIONED', v_org,
    jsonb_build_object('slug', p_slug, 'owner_user_id', p_owner_user_id),
    gen_random_uuid()::text
  );
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RETURN v_org;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- (c) provision_member + audit
CREATE OR REPLACE FUNCTION "provision_member"(
  p_org_id        uuid,
  p_user_id       uuid,
  p_role          "Role",
  p_actor_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_membership uuid;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'provision_member: p_actor_user_id requis';
  END IF;
  -- delegue au corps d'origine (arite 3) : OWNER interdit / unicite / FK preserves.
  v_membership := "provision_member"(p_org_id, p_user_id, p_role);

  PERFORM set_config('app.auth_bootstrap', 'on', true);
  INSERT INTO "admin_audit_log"
    ("actor_user_id", "action", "target_org_id", "target_user_id", "payload", "idempotency_key")
  VALUES (
    p_actor_user_id, 'MEMBER_ADDED', p_org_id, p_user_id,
    jsonb_build_object('role', p_role),
    gen_random_uuid()::text
  );
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RETURN v_membership;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- (d) set_member_active + audit (RETURNS void)
CREATE OR REPLACE FUNCTION "set_member_active"(
  p_org_id        uuid,
  p_user_id       uuid,
  p_active        boolean,
  p_actor_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'set_member_active: p_actor_user_id requis';
  END IF;
  -- delegue au corps d'origine (arite 3) : introuvable / anti-lockout preserves.
  PERFORM "set_member_active"(p_org_id, p_user_id, p_active);

  PERFORM set_config('app.auth_bootstrap', 'on', true);
  INSERT INTO "admin_audit_log"
    ("actor_user_id", "action", "target_org_id", "target_user_id", "payload", "idempotency_key")
  VALUES (
    p_actor_user_id, 'MEMBER_ACTIVE_SET', p_org_id, p_user_id,
    jsonb_build_object('is_active', p_active),
    gen_random_uuid()::text
  );
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 6) Propriete (barriere B1) + EXECUTE reserve a roadsen_app
--
--  Chaque fonction DEFINER devient owned par roadsen_auth (elle s'execute avec son
--  privilege de table, pas celui de l'appelant). EXECUTE revoque a PUBLIC, accorde au
--  seul roadsen_app. OWNER TO DUR (echec fort au deploy si impossible — lecon 0004->0007).
-- ---------------------------------------------------------------------
ALTER FUNCTION "admin_platform_stats"()                                          OWNER TO "roadsen_auth";
ALTER FUNCTION "admin_list_orgs"(int, int, text, "OrgStatus", text, text)        OWNER TO "roadsen_auth";
ALTER FUNCTION "admin_list_audit"(uuid, int, int, text, uuid, timestamptz, timestamptz) OWNER TO "roadsen_auth";
ALTER FUNCTION "provision_user"(text, text, text, uuid)                          OWNER TO "roadsen_auth";
ALTER FUNCTION "provision_org"(text, text, uuid, uuid)                           OWNER TO "roadsen_auth";
ALTER FUNCTION "provision_member"(uuid, uuid, "Role", uuid)                      OWNER TO "roadsen_auth";
ALTER FUNCTION "set_member_active"(uuid, uuid, boolean, uuid)                    OWNER TO "roadsen_auth";

REVOKE ALL ON FUNCTION "admin_platform_stats"()                                          FROM PUBLIC;
REVOKE ALL ON FUNCTION "admin_list_orgs"(int, int, text, "OrgStatus", text, text)        FROM PUBLIC;
REVOKE ALL ON FUNCTION "admin_list_audit"(uuid, int, int, text, uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION "provision_user"(text, text, text, uuid)                          FROM PUBLIC;
REVOKE ALL ON FUNCTION "provision_org"(text, text, uuid, uuid)                           FROM PUBLIC;
REVOKE ALL ON FUNCTION "provision_member"(uuid, uuid, "Role", uuid)                      FROM PUBLIC;
REVOKE ALL ON FUNCTION "set_member_active"(uuid, uuid, boolean, uuid)                    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "admin_platform_stats"()                                          TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "admin_list_orgs"(int, int, text, "OrgStatus", text, text)        TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "admin_list_audit"(uuid, int, int, text, uuid, timestamptz, timestamptz) TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "provision_user"(text, text, text, uuid)                          TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "provision_org"(text, text, uuid, uuid)                           TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "provision_member"(uuid, uuid, "Role", uuid)                      TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "set_member_active"(uuid, uuid, boolean, uuid)                    TO "roadsen_app";
