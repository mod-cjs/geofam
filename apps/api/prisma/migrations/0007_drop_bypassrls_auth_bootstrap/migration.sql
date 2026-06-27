-- =====================================================================
--  ROADSEN — Migration 0007 : SUPPRESSION de la dependance BYPASSRLS pour
--                             l'auth / le provisioning (compat Postgres MANAGE)
--
--  CONTEXTE / BLOCAGE PROD
--  -----------------------
--  Sur Render, l'utilisateur applicatif (proprietaire des tables, qui joue les
--  migrations) a CREATEROLE mais N'A PAS BYPASSRLS ni superuser. La migration
--  0004 (version d'origine) faisait `CREATE ROLE roadsen_auth ... BYPASSRLS`, ce
--  qui ECHOUAIT : « Only roles with the BYPASSRLS attribute may create roles with
--  the BYPASSRLS attribute » (SQLSTATE 42501) -> 0001-0003 appliquees, 0004 en
--  echec, suite bloquee. (#42)
--
--  NB CHAINE (revision conjointe) : 0004 a ete REVISEE pour creer roadsen_auth en
--  NOBYPASSRLS (creable en managed) tout en conservant app_current_org() fail-closed.
--  La chaine 0004(revisee)->0005->0006->0007 se deploie donc desormais sous un user
--  CREATEROLE non-superuser. 0007 reste indispensable et CONVERGE l'etat final :
--  il introduit le drapeau fail-closed (qui retablit le login a froid SANS
--  BYPASSRLS), la branche OR des policies d'identite, pv_emitter_context, et le
--  RETRAIT du DML identite de roadsen_app (barriere 1). 0007 est IDEMPOTENT
--  (ALTER ROLE NOBYPASSRLS, CREATE OR REPLACE, DROP POLICY IF EXISTS) : rejouable
--  sans danger meme si 0004 revisee a deja pose roadsen_auth NOBYPASSRLS.
--
--  POURQUOI roadsen_auth/BYPASSRLS existait
--  ----------------------------------------
--  Les fonctions SECURITY DEFINER d'auth/bootstrap (provision_org, provision_user,
--  auth_find_user_by_email, auth_user_has_membership, auth_get_platform_role,
--  auth_get_user_profile) doivent lire/ecrire users/memberships/organizations
--  AVANT tout contexte tenant (login a froid, onboarding). Or 0004 a mis ces
--  tables sous FORCE ROW LEVEL SECURITY : FORCE applique la RLS MEME au
--  proprietaire des tables. Une fonction DEFINER (qui s'execute avec les droits
--  du proprietaire) reste donc soumise a la RLS -> sans BYPASSRLS, app_current_org()
--  RAISE (pas de contexte) et le login casse. 0004 a "resolu" cela en donnant
--  BYPASSRLS a un role dedie roadsen_auth, proprietaire des fonctions. C'est ce
--  BYPASSRLS qui n'est pas creable en managed.
--
--  MODELE RETENU (sans BYPASSRLS, sans toucher a l'isolation)
--  ---------------------------------------------------------
--  On REMPLACE le contournement par BYPASSRLS par un CONTEXTE DE CONFIANCE
--  FAIL-CLOSED, pose UNIQUEMENT par les fonctions DEFINER d'auth/bootstrap :
--
--    GUC `app.auth_bootstrap` (booleen, defaut absent = FALSE).
--    Helper app_auth_bootstrap() RETURNS boolean : TRUE ssi le GUC vaut 'on'.
--    Chaque fonction DEFINER pose `set_config('app.auth_bootstrap','on',true)`
--    en debut de corps (portee TRANSACTION) et le REMET a 'off' avant tout
--    RETURN / sur erreur (jamais de fuite du drapeau hors de la fonction).
--
--    Les policies des 4 tables d'IDENTITE (users, memberships, organizations)
--    et leurs lectures d'auth deviennent :
--        org_scope_normal  OR  app_auth_bootstrap()
--    de sorte que :
--      - en chemin NORMAL (drapeau absent/off) : le scoping par org_id est le
--        SEUL critere -> isolation tenant STRICTE, inchangee.
--      - en chemin AUTH (drapeau on, pose par une fonction DEFINER auditee) :
--        la ligne est visible/inscriptible pour le bootstrap a froid.
--
--  DEUX BARRIERES INDEPENDANTES (correctif revue adverse B1)
--  ---------------------------------------------------------
--  ATTENTION — le drapeau SEUL ne suffit PAS. set_config('app.auth_bootstrap',..)
--  est posable par N'IMPORTE QUEL role, runtime roadsen_app inclus. Si le drapeau
--  etait l'UNIQUE garde, roadsen_app pourrait le poser puis `SELECT * FROM users`
--  et lire emails + password_hash + memberships de TOUS les tenants. Ce serait un
--  AFFAIBLISSEMENT (on aurait troque une barriere par-role contre une discipline
--  applicative). On combine donc DEUX conditions, toutes deux requises :
--
--    BARRIERE 1 — PRIVILEGE DE TABLE (par-role, NON contournable par GUC) :
--      Le `GRANT SELECT/INSERT` sur les 3 tables d'IDENTITE (users, memberships,
--      organizations) est RETIRE a roadsen_app et donne au SEUL role roadsen_auth
--      (NOLOGIN, NOSUPERUSER, NON-BYPASSRLS). roadsen_app n'a donc AUCUN droit de
--      lire/ecrire l'identite en requete ordinaire : poser le drapeau ne lui sert
--      a RIEN (la RLS n'est meme pas atteinte, le privilege manque en amont).
--    BARRIERE 2 — DRAPEAU FAIL-CLOSED (dans la RLS) :
--      Les fonctions SECURITY DEFINER s'executent avec les droits de leur owner
--      roadsen_auth (qui DETIENT le privilege de table) ET posent le drapeau, qui
--      ouvre la branche RLS d'identite. C'est l'unique voie qui reunit les DEUX
--      conditions -> seules ces 6 fonctions auditees franchissent la RLS d'identite.
--
--  roadsen_auth EST CREABLE EN MANAGED : c'etait l'attribut BYPASSRLS (et lui seul)
--  que Render refusait. NOLOGIN NOSUPERUSER NON-BYPASSRLS se cree avec CREATEROLE.
--  Le franchissement de RLS ne vient PLUS de BYPASSRLS mais du drapeau + du fait
--  que l'owner DEFINER detient le privilege de table. C'est le RESSERREMENT promis,
--  cette fois reellement par-role.
--
--  POURQUOI C'EST SUR (pas un trou global)
--  ---------------------------------------
--    1) Le drapeau est FAIL-CLOSED : absent => app_auth_bootstrap() = FALSE =>
--       comportement org-scope strict. Aucun acces elargi par defaut.
--    2) DEUX barrieres (privilege de table + drapeau) : roadsen_app peut poser le
--       drapeau mais N'A PAS le privilege table sur l'identite -> 0 ligne / refus.
--       (cf. test negatif B2 : drapeau on sous roadsen_app -> aucun hash d'autrui.)
--    3) Le drapeau n'a AUCUN effet sur les tables de DONNEES tenant (projects,
--       calc_results, official_pvs, pv_counters) : leur policy n'inclut PAS
--       app_auth_bootstrap(). Une fuite metier inter-bureaux par cette voie est
--       structurellement impossible.
--    4) Defense en profondeur : FORCE ROW LEVEL SECURITY reste actif partout ;
--       guards applicatifs (TenantGuard, withTenant) inchanges.
--
--  SEPARATION IDENTITE / DONNEES (exigence de la mission)
--  ------------------------------------------------------
--    - Tables d'IDENTITE  : users, memberships, organizations
--        policy = org_scope OR app_auth_bootstrap() ; DML reserve a roadsen_auth.
--    - Tables de DONNEES  : projects, calc_results, pv_counters, official_pvs
--        policy = org_scope SEUL ; DML accorde a roadsen_app (chemin tenant normal).
--
--  CE QUE FAIT CETTE MIGRATION
--  ---------------------------
--    1) cree app_auth_bootstrap() + app_current_org_or_null() (helpers) ;
--    2) reecrit les policies users/memberships/organizations (branche OR drapeau) ;
--    3) redefinit les 6 fonctions DEFINER d'auth (drapeau pose/ferme ; PLUS de
--       BYPASSRLS) + cree pv_emitter_context (identite a sceller dans un PV, lue
--       par pv.service apres le retrait du DML identite de roadsen_app) ;
--    4) RECREE/garantit roadsen_auth en NON-BYPASSRLS, lui transfere la PROPRIETE
--       des 7 fonctions, lui donne le GRANT SELECT/INSERT sur l'IDENTITE, et RETIRE
--       ce GRANT a roadsen_app (barriere 1) ;
--    5) re-affirme les GRANT EXECUTE a roadsen_app (idempotent).
--
--  IMPORTANT — provision_org / app.current_org
--  -------------------------------------------
--  provision_org pose temporairement app.current_org sur la NOUVELLE org pour
--  satisfaire les WITH CHECK. Avec le drapeau, ce n'est meme plus strictement
--  necessaire (la branche bootstrap suffit), mais on le CONSERVE (defense en
--  profondeur + restauration du contexte prealable, fix anti-fuite de 0004).
--
--  ADDITIVE / NON DESTRUCTIVE sur les donnees. Reecrit policies + fonctions,
--  cree 1 helper, supprime 1 role. N'edite PAS 0001..0006 (forward-fix).
--  IDEMPOTENTE (DROP POLICY IF EXISTS, CREATE OR REPLACE, DROP ROLE IF EXISTS).
--  Reversible : voir down.sql.
--  A REVOIR EN BINOME dev-backend + qa-challenger (zone CRITIQUE : isolation).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) app_auth_bootstrap() — drapeau de confiance FAIL-CLOSED
--
--  Renvoie TRUE uniquement si le GUC app.auth_bootstrap vaut exactement 'on'.
--  Absent / vide / toute autre valeur => FALSE (fail-closed). SECURITY INVOKER
--  (defaut) : ce helper sert A la RLS, il ne doit jamais la contourner.
--  STABLE + PARALLEL SAFE (lecture pure du GUC). search_path fige (pg_catalog).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "app_auth_bootstrap"()
RETURNS boolean
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
DECLARE
  v_raw text := current_setting('app.auth_bootstrap', true);
BEGIN
  RETURN v_raw IS NOT NULL AND v_raw = 'on';
END;
$$;

REVOKE ALL ON FUNCTION "app_auth_bootstrap"() FROM PUBLIC;
-- Evalue par le moteur de policy pour tout role : EXECUTE a PUBLIC (ne divulgue
-- rien, lit seulement le GUC de la session courante).
GRANT EXECUTE ON FUNCTION "app_auth_bootstrap"() TO PUBLIC;

-- ---------------------------------------------------------------------
-- 1bis) app_current_org_or_null() — variante NON bruyante pour l'identite
--
--  DOIT etre cree AVANT les policies de la section 2 (Postgres exige que la
--  fonction reference par une policy existe a sa creation).
--
--  PROBLEME : la policy des tables d'identite combine deux branches par OR :
--      org_scope  OR  app_auth_bootstrap()
--  Si la branche org_scope appelait app_current_org() (qui RAISE quand le GUC est
--  absent), alors le chemin d'AUTH (drapeau on, app.current_org volontairement
--  ABSENT) ferait RAISE a l'evaluation de la 1re branche AVANT meme d'atteindre
--  app_auth_bootstrap() -> login casse. On ne peut pas compter sur le court-circuit
--  du OR cote planificateur.
--
--  On introduit donc app_current_org_or_null() : variante SILENCIEUSE (renvoie
--  NULL si le GUC est absent) reservee aux SEULES tables d'identite. Le fail-closed
--  BRUYANT (#42) reste assure PAR AILLEURS :
--    - sur les tables de DONNEES tenant (projects/calc_results/...), les policies
--      continuent d'appeler app_current_org() (BRUYANT) -> un SET LOCAL oublie sur
--      une requete metier RAISE toujours fort. C'est la ou le bruit compte.
--    - sur les tables d'identite, une requete ORDINAIRE du runtime sans contexte
--      (drapeau off, GUC absent) renvoie 0 ligne (org_id = NULL => UNKNOWN) :
--      fail-closed, et de toute facon le runtime ne lit l'identite QUE via les
--      fonctions DEFINER (jamais en requete ordinaire). Le silence ici n'ouvre
--      aucune fuite ni ne masque un bug de scoping metier.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "app_current_org_or_null"()
RETURNS uuid
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
DECLARE
  v_raw text := current_setting('app.current_org', true);
BEGIN
  IF v_raw IS NULL OR length(btrim(v_raw)) = 0 THEN
    RETURN NULL; -- silencieux : fail-closed (0 ligne), pas de RAISE
  END IF;
  RETURN v_raw::uuid;
END;
$$;
REVOKE ALL ON FUNCTION "app_current_org_or_null"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "app_current_org_or_null"() TO PUBLIC;

-- ---------------------------------------------------------------------
-- 2) Reecriture des policies des 3 tables d'IDENTITE :
--      org_scope  OR  app_auth_bootstrap()
--
--  Les tables de DONNEES (projects, calc_results, pv_counters, official_pvs) ne
--  sont PAS touchees : leur policy reste org_scope SEUL (cf. 0004/0006). Le
--  drapeau d'auth n'a aucun effet sur elles.
-- ---------------------------------------------------------------------

-- organizations (scope par id = org courant)
DROP POLICY IF EXISTS "tenant_isolation" ON "organizations";
CREATE POLICY "tenant_isolation" ON "organizations"
  USING ("id" = "app_current_org_or_null"() OR "app_auth_bootstrap"())
  WITH CHECK ("id" = "app_current_org_or_null"() OR "app_auth_bootstrap"());

-- memberships (scope par org_id)
DROP POLICY IF EXISTS "tenant_isolation" ON "memberships";
CREATE POLICY "tenant_isolation" ON "memberships"
  USING ("org_id" = "app_current_org_or_null"() OR "app_auth_bootstrap"())
  WITH CHECK ("org_id" = "app_current_org_or_null"() OR "app_auth_bootstrap"());

-- users (scope par membership partage avec l'org courante, OU bootstrap d'auth)
DROP POLICY IF EXISTS "tenant_isolation" ON "users";
CREATE POLICY "tenant_isolation" ON "users"
  USING (
    "app_auth_bootstrap"()
    OR EXISTS (
      SELECT 1 FROM "memberships" m
      WHERE m."user_id" = "users"."id"
        AND m."org_id"  = "app_current_org_or_null"()
    )
  )
  WITH CHECK (
    "app_auth_bootstrap"()
    OR EXISTS (
      SELECT 1 FROM "memberships" m
      WHERE m."user_id" = "users"."id"
        AND m."org_id"  = "app_current_org_or_null"()
    )
  );

-- ---------------------------------------------------------------------
-- 3) Redefinition des 6 fonctions DEFINER : drapeau d'auth au lieu de BYPASSRLS
--
--  Chaque fonction :
--    - pose set_config('app.auth_bootstrap','on',true) a l'entree ;
--    - fait son travail (lecture/ecriture identite) ;
--    - REMET le drapeau a 'off' avant RETURN, et sur erreur (EXCEPTION) ;
--  search_path fige inchange. SECURITY DEFINER conserve : la fonction s'execute
--  avec les droits du PROPRIETAIRE (qui aura les GRANT requis) ; le drapeau, lui,
--  ouvre la branche RLS d'identite. Combinaison : la fonction lit/ecrit l'identite
--  a froid SANS BYPASSRLS.
--
--  NB sur les fonctions en LANGUAGE sql : on ne peut pas y poser/retirer un GUC
--  proprement (pas de bloc procedural). On les passe en plpgsql pour encadrer le
--  drapeau. Signatures et types de retour INCHANGES (compat appelant).
-- ---------------------------------------------------------------------

-- 3.1) auth_find_user_by_email --------------------------------------------------
CREATE OR REPLACE FUNCTION "auth_find_user_by_email"(p_email text)
RETURNS TABLE (id uuid, password_hash text, is_active boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);
  RETURN QUERY
    SELECT u."id", u."password_hash", u."is_active"
    FROM "users" u
    WHERE u."email" = lower(btrim(p_email))
    LIMIT 1;
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- 3.2) auth_user_has_membership -------------------------------------------------
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
    WHERE m."user_id" = p_user_id
      AND m."org_id"  = p_org_id
    LIMIT 1;
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- 3.3) auth_get_platform_role ---------------------------------------------------
CREATE OR REPLACE FUNCTION "auth_get_platform_role"(p_user_id uuid)
RETURNS "PlatformRole"
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role "PlatformRole";
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);
  SELECT u."platform_role" INTO v_role
  FROM "users" u
  WHERE u."id" = p_user_id
  LIMIT 1;
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RETURN v_role;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- 3.4) provision_user -----------------------------------------------------------
CREATE OR REPLACE FUNCTION "provision_user"(
  p_email         text,
  p_password_hash text,
  p_full_name     text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_email   text := lower(btrim(p_email));
BEGIN
  IF v_email IS NULL OR length(v_email) = 0 THEN
    RAISE EXCEPTION 'provision_user: p_email requis';
  END IF;
  IF p_password_hash IS NULL OR length(btrim(p_password_hash)) = 0 THEN
    RAISE EXCEPTION 'provision_user: p_password_hash requis';
  END IF;
  IF p_full_name IS NULL OR length(btrim(p_full_name)) = 0 THEN
    RAISE EXCEPTION 'provision_user: p_full_name requis';
  END IF;

  PERFORM set_config('app.auth_bootstrap', 'on', true);
  INSERT INTO "users" ("id", "email", "password_hash", "full_name", "updated_at")
  VALUES (v_user_id, v_email, p_password_hash, btrim(p_full_name), CURRENT_TIMESTAMP);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RETURN v_user_id;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- 3.5) auth_get_user_profile ----------------------------------------------------
CREATE OR REPLACE FUNCTION "auth_get_user_profile"(p_user_id uuid)
RETURNS TABLE (
  user_id         uuid,
  email           text,
  full_name       text,
  platform_role   "PlatformRole",
  org_id          uuid,
  org_name        text,
  org_slug        text,
  membership_role "Role"
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);
  RETURN QUERY
    SELECT
      u."id", u."email", u."full_name", u."platform_role",
      o."id", o."name", o."slug", m."role"
    FROM "users" u
    LEFT JOIN "memberships"   m ON m."user_id" = u."id"
    LEFT JOIN "organizations" o ON o."id" = m."org_id"
    WHERE u."id" = p_user_id;
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- 3.6) provision_org ------------------------------------------------------------
--  Conserve : restauration du contexte tenant prealable (fix anti-fuite 0004) +
--  pose app.current_org sur la nouvelle org (defense en profondeur). Ajoute le
--  drapeau d'auth (qui suffirait seul). Restaure CONTEXTE + DRAPEAU sur tous les
--  chemins de sortie.
CREATE OR REPLACE FUNCTION "provision_org"(
  p_name          text,
  p_slug          text,
  p_owner_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org_id   uuid := gen_random_uuid();
  v_prev_org text := COALESCE(current_setting('app.current_org', true), '');
BEGIN
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'provision_org: p_name requis';
  END IF;
  IF p_slug IS NULL OR length(btrim(p_slug)) = 0 THEN
    RAISE EXCEPTION 'provision_org: p_slug requis';
  END IF;
  IF p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'provision_org: p_owner_user_id requis';
  END IF;

  PERFORM set_config('app.auth_bootstrap', 'on', true);
  PERFORM set_config('app.current_org', v_org_id::text, true);

  INSERT INTO "organizations" ("id", "name", "slug", "updatedAt")
  VALUES (v_org_id, p_name, p_slug, CURRENT_TIMESTAMP);

  INSERT INTO "memberships" ("org_id", "user_id", "role")
  VALUES (v_org_id, p_owner_user_id, 'OWNER');

  -- restaure le contexte prealable ET ferme le drapeau avant de rendre la main.
  PERFORM set_config('app.current_org', v_prev_org, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RETURN v_org_id;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.current_org', v_prev_org, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- 3.7) pv_emitter_context — IDENTITE A SCELLER DANS UN PV (DEFINER, lecture) -----
--
--  CORRECTIF REVUE ADVERSE (CRITIQUE emission PV) : depuis §4.4, roadsen_app n'a
--  plus AUCUN privilege DML sur organizations/users. Or l'emission d'un PV
--  (pv.service.ts) lisait DIRECTEMENT organizations(slug,name) et users(full_name)
--  sous roadsen_app dans withTenant pour SCELLER le nom de l'org + le visa de
--  l'emetteur -> apres 0007, 42501 (permission denied) -> emission cassee.
--
--  On expose donc une fonction SECURITY DEFINER DEDIEE, au perimetre MINIMAL :
--  pour le couple (org courante, emetteur authentifie) deja en main, elle renvoie
--  EXACTEMENT les 3 champs scelles (slug + nom d'org + nom complet emetteur). Elle
--  pose/ferme le drapeau d'auth comme les autres, owned par roadsen_auth (qui DETIENT
--  le privilege identite). AUCUN listing, AUCUNE enumeration : filtre strict sur
--  p_org_id / p_user_id. L'appelant (pv.service) DOIT passer l'org courante (deja
--  prouvee par TenantGuard) et args.userId = sub JWT verifie -> pas de fuite.
--
--  NB perimetre vs auth_get_user_profile : ici on veut le full_name de l'emetteur
--  POUR UNE ORG donnee, en une seule lecture jointe ; on garde une fonction dediee
--  (sceau PV) plutot que de surcharger le profil /auth/me.
CREATE OR REPLACE FUNCTION "pv_emitter_context"(
  p_org_id  uuid,
  p_user_id uuid
)
RETURNS TABLE (
  org_slug          text,
  org_name          text,
  emitter_full_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);
  RETURN QUERY
    SELECT o."slug", o."name", u."full_name"
    FROM "organizations" o
    CROSS JOIN "users" u
    WHERE o."id" = p_org_id
      AND u."id" = p_user_id
    LIMIT 1;
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 4) roadsen_auth NON-BYPASSRLS = owner des 7 DEFINER + SEUL detenteur du DML
--    sur l'IDENTITE. roadsen_app PERD le DML direct sur l'identite (BARRIERE 1).
--
--  CORRECTIF REVUE ADVERSE B1 : le drapeau seul ne protege pas (posable par
--  roadsen_app). On retablit une barriere PAR-ROLE sans BYPASSRLS :
--    - roadsen_auth : NOLOGIN NOSUPERUSER NON-BYPASSRLS (CREABLE en managed
--      Render — c'etait BYPASSRLS, et lui seul, qui echouait). Owner des 7
--      fonctions DEFINER (6 auth/bootstrap + pv_emitter_context). SEUL role a
--      recevoir SELECT/INSERT sur users/memberships/organizations.
--    - roadsen_app : on RETIRE son SELECT/INSERT/UPDATE/DELETE sur ces 3 tables
--      d'identite. Il ne peut donc plus les lire/ecrire en requete ordinaire,
--      meme en posant le drapeau (le privilege manque AVANT la RLS). Il conserve
--      ses GRANT sur les tables de DONNEES (projects/calc_results/...).
--
--  Le franchissement de RLS d'identite ne vient PAS de BYPASSRLS : il vient de la
--  conjonction (a) owner=roadsen_auth qui DETIENT le privilege de table + (b) le
--  drapeau pose par la fonction qui ouvre la branche RLS. Les deux sont requis.
-- ---------------------------------------------------------------------

-- 4.1) garantit roadsen_auth en NON-BYPASSRLS (idempotent ; preexiste peut-etre
--      en BYPASSRLS depuis une 0004 partielle -> on FORCE NOBYPASSRLS).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roadsen_auth') THEN
    CREATE ROLE "roadsen_auth" NOLOGIN NOSUPERUSER NOBYPASSRLS;
  ELSE
    ALTER ROLE "roadsen_auth" NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

-- 4.2) roadsen_auth : acces schema + DML d'identite (ce que les DEFINER touchent).
GRANT USAGE ON SCHEMA public TO "roadsen_auth";
GRANT SELECT, INSERT ON "organizations", "memberships", "users" TO "roadsen_auth";

-- 4.3) PROPRIETE des 6 fonctions a roadsen_auth (le DEFINER s'execute alors avec
--      SON privilege de table). Le role de migration est membre de roadsen_auth
--      (il l'a cree / le possede) -> ALTER OWNER autorise sans superuser.
ALTER FUNCTION "provision_org"(text, text, uuid)            OWNER TO "roadsen_auth";
ALTER FUNCTION "provision_user"(text, text, text)           OWNER TO "roadsen_auth";
ALTER FUNCTION "auth_find_user_by_email"(text)              OWNER TO "roadsen_auth";
ALTER FUNCTION "auth_user_has_membership"(uuid, uuid)       OWNER TO "roadsen_auth";
ALTER FUNCTION "auth_get_platform_role"(uuid)               OWNER TO "roadsen_auth";
ALTER FUNCTION "auth_get_user_profile"(uuid)                OWNER TO "roadsen_auth";
ALTER FUNCTION "pv_emitter_context"(uuid, uuid)             OWNER TO "roadsen_auth";

-- 4.4) BARRIERE 1 — RETRAIT du DML direct de roadsen_app sur l'IDENTITE.
--      Apres ce REVOKE, roadsen_app ne lit/ecrit l'identite QUE via les DEFINER.
--      (Les tables de DONNEES ne sont PAS touchees : roadsen_app garde leur DML.)
REVOKE SELECT, INSERT, UPDATE, DELETE
  ON "organizations", "memberships", "users"
  FROM "roadsen_app";

-- ---------------------------------------------------------------------
-- 5) GRANT EXECUTE re-affirmes a roadsen_app (idempotent).
--    CREATE OR REPLACE ne touche pas les droits, mais on les re-affirme apres
--    les ALTER OWNER par prudence. PUBLIC reste revoque.
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION "provision_org"(text, text, uuid)         FROM PUBLIC;
REVOKE ALL ON FUNCTION "provision_user"(text, text, text)        FROM PUBLIC;
REVOKE ALL ON FUNCTION "auth_find_user_by_email"(text)           FROM PUBLIC;
REVOKE ALL ON FUNCTION "auth_user_has_membership"(uuid, uuid)    FROM PUBLIC;
REVOKE ALL ON FUNCTION "auth_get_platform_role"(uuid)            FROM PUBLIC;
REVOKE ALL ON FUNCTION "auth_get_user_profile"(uuid)             FROM PUBLIC;
REVOKE ALL ON FUNCTION "pv_emitter_context"(uuid, uuid)          FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "provision_org"(text, text, uuid)      TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "provision_user"(text, text, text)     TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "auth_find_user_by_email"(text)        TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "auth_user_has_membership"(uuid, uuid) TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "auth_get_platform_role"(uuid)         TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "auth_get_user_profile"(uuid)          TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "pv_emitter_context"(uuid, uuid)       TO "roadsen_app";
