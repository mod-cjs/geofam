-- =====================================================================
--  ROADSEN — Migration 0019 : durcissement ANTI-LOCKOUT du SUPERADMIN
--  (deux trous RBAC fermes, revue securite de 0018)
--
--  ROADSEN-MIGRATION-REVIEWED: dev-backend (build) — EN ATTENTE revue
--  ingenieur-securite (zone CRITIQUE : RBAC transverse hors tenant ; l'invariant
--  « au moins un SUPERADMIN actif » est la clef d'acces du back-office STARFIRE).
--
--  CONTEXTE — DEUX TROUS FERMES
--  ----------------------------
--  MAJEUR-1 (lockout INTER-CHEMINS via admin_set_user_active, 0015) :
--    admin_set_platform_role (0018) protege l'invariant sur le chemin « retrait de ROLE »
--    (dernier SUPERADMIN actif -> R0013). admin_set_user_active (0015) mute users.is_active
--    SANS aucune garde d'invariant : il ne portait QUE l'anti auto-desactivation (R0009).
--    Sequence de lockout : A desactive B, B desactive A -> 0 SUPERADMIN actif -> back-office
--    verrouille. CORRECTIF : admin_set_user_active refuse (R0013, 409) la desactivation d'une
--    cible SUPERADMIN s'il ne reste AUCUN AUTRE SUPERADMIN actif. MEME ORDRE DE VERROUILLAGE
--    que admin_set_platform_role (ligne cible FOR UPDATE, PUIS sous-requete count FOR UPDATE)
--    -> les deux fonctions se SERIALISENT : pas de fenetre a zero par course
--    set_platform_role <-> set_user_active.
--
--  MAJEUR-2 (SUPERADMIN desactive garde l'acces via auth_get_platform_role, 0007) :
--    auth_get_platform_role renvoyait users.platform_role SANS filtrer is_active. Un compte
--    desactive (is_active=false) conservait donc un platform_role EFFECTIF -> le RolesGuard le
--    laissait franchir les routes @Roles(SUPERADMIN) avec un token encore valide (le JWT ne
--    porte pas le role ; le guard relit la fonction a chaque requete). CORRECTIF : ne renvoyer
--    le role QUE si is_active=true (un compte desactive -> role NULL -> RolesGuard refuse).
--    Coherent avec le login/refresh qui refusent deja un compte desactive (0009).
--
--  MODELE DE SECURITE (repris EXACTEMENT de 0007/0015/0018)
--  -------------------------------------------------------
--  Fonctions SECURITY DEFINER owned roadsen_auth (NOLOGIN, NOSUPERUSER, NOBYPASSRLS),
--  appelees sous asAppRole (roadsen_app). Chaque fonction pose app.auth_bootstrap='on' et le
--  referme sur TOUT chemin de sortie (RETURN + EXCEPTION) ; search_path fige ; EXECUTE revoque
--  a PUBLIC + accorde au seul roadsen_app. L'ACTEUR (p_actor) est le sub du JWT SUPERADMIN
--  passe par le service (jamais le corps — lecon #42) ; p_actor NULL -> refus.
--
--  ADDITIVE / NON DESTRUCTIVE : CREATE OR REPLACE de DEUX fonctions PREEXISTANTES
--  (admin_set_user_active de 0015 ; auth_get_platform_role de 0007) — memes SIGNATURES,
--  memes proprietaires, memes GRANT. AUCUN nouveau privilege de table (le UPDATE ON users
--  requis existe deja depuis 0015 §0 ; auth_get_platform_role ne fait que SELECT). IDEMPOTENTE
--  (CREATE OR REPLACE). Reversible : voir down.sql (restaure les corps 0015/0007 a l'identique).
--
--  ERRCODES (inchanges) :
--    R0009 = auto-desactivation d'un SUPERADMIN (400)  [conserve]
--    R0013 = dernier SUPERADMIN actif : desactivation/retrait refuse (409)  [reutilise de 0018]
--    R0005 = cible introuvable (404)
-- =====================================================================

-- Verrou borne : ne pas rester bloque indefiniment sur une ligne users deja verrouillee
-- (CREATE OR REPLACE FUNCTION / ALTER FUNCTION prennent un verrou sur pg_proc ; les
-- fonctions elles-memes verrouillent des lignes users). Echec franc plutot que hang au deploy.
SET lock_timeout = '3s';

-- Pre-requis ALTER OWNER (executant membre de roadsen_auth + CREATE sur le schema),
-- re-affirmes ici (idempotents, self-contenu — patron 0013/0015/0018).
GRANT "roadsen_auth" TO CURRENT_USER;
GRANT USAGE, CREATE ON SCHEMA public TO "roadsen_auth";

-- ---------------------------------------------------------------------
-- 1) admin_set_user_active — DESACTIVATION / REACTIVATION GLOBALE, + garde ANTI-LOCKOUT
--
--  MEME corps que 0015 (idempotence + trace is_active avant/apres, R0009 auto-desactivation,
--  R0005 introuvable), AVEC une garde d'invariant ajoutee :
--    (R0009) AUTO-DESACTIVATION : un acteur ne se coupe pas lui-meme l'acces (p_user_id =
--            p_actor AND p_active=false) -> evaluee EN TETE (avant tout effet). Conservee.
--    (R0013) DERNIER SUPERADMIN ACTIF : desactiver (p_active=false) une cible SUPERADMIN est
--            REFUSE s'il ne reste AUCUN AUTRE SUPERADMIN actif (id<>cible, platform_role=
--            'SUPERADMIN', is_active=true). Ferme le lockout INTER-CHEMINS (l'autre chemin,
--            admin_set_platform_role, porte la meme garde depuis 0018).
--  ORDRE DE VERROUILLAGE identique a admin_set_platform_role : on verrouille d'ABORD la LIGNE
--  CIBLE (FOR UPDATE), PUIS la sous-requete count des autres SUPERADMIN actifs (FOR UPDATE).
--  Deux operations concurrentes sur des SUPERADMIN qui se recouvrent se serialisent sur ces
--  verrous de ligne (ou s'annulent par deadlock) -> jamais de fenetre a zero SUPERADMIN actif.
--  GARDES AVANT L'AUDIT (patron set_platform_role/set_member_role) -> aucune trace orpheline
--  pour une action refusee.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "admin_set_user_active"(
  p_user_id         uuid,
  p_active          boolean,
  p_actor           uuid,
  p_idempotency_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_before boolean;
  v_role   "PlatformRole";
  v_others int;
  v_audit  uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'admin_set_user_active: p_actor requis';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'admin_set_user_active: idempotency_key requis';
  END IF;
  -- ANTI AUTO-DESACTIVATION : on ne se coupe pas soi-meme l'acces (evalue AVANT tout effet).
  IF p_user_id = p_actor AND p_active = false THEN
    RAISE EXCEPTION 'admin_set_user_active: auto-desactivation interdite' USING ERRCODE = 'R0009';
  END IF;

  PERFORM set_config('app.auth_bootstrap', 'on', true);

  -- Etat avant + role plateforme (VERROU DE LIGNE sur la CIBLE : 1er verrou, comme
  -- admin_set_platform_role). Introuvable -> 404.
  SELECT u."is_active", u."platform_role" INTO v_before, v_role
  FROM "users" u
  WHERE u."id" = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_set_user_active: utilisateur introuvable' USING ERRCODE = 'R0005';
  END IF;

  -- ANTI-LOCKOUT (R0013) : desactiver une cible SUPERADMIN exige qu'un AUTRE SUPERADMIN
  -- actif subsiste. Sous-requete count FOR UPDATE (2e verrou, MEME ORDRE que set_platform_role)
  -- -> serialise set_user_active <-> set_platform_role (pas de fenetre a zero).
  IF p_active = false AND v_role = 'SUPERADMIN' THEN
    SELECT count(*) INTO v_others FROM (
      SELECT 1 FROM "users" u
      WHERE u."platform_role" = 'SUPERADMIN' AND u."is_active" = true AND u."id" <> p_user_id
      FOR UPDATE
    ) locked;
    IF v_others = 0 THEN
      RAISE EXCEPTION 'admin_set_user_active: dernier SUPERADMIN actif requis' USING ERRCODE = 'R0013';
    END IF;
  END IF;

  INSERT INTO "admin_audit_log"
    ("actor_user_id", "action", "target_user_id", "payload", "idempotency_key")
  VALUES (
    p_actor, 'USER_ACTIVE_SET', p_user_id,
    jsonb_build_object('is_active_before', v_before, 'is_active_after', p_active),
    p_idempotency_key
  )
  ON CONFLICT ("idempotency_key") DO NOTHING
  RETURNING "id" INTO v_audit;

  IF v_audit IS NULL THEN
    PERFORM set_config('app.auth_bootstrap', 'off', true);
    RETURN;
  END IF;

  UPDATE "users" SET "is_active" = p_active, "updated_at" = now()
  WHERE "id" = p_user_id;

  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 2) auth_get_platform_role — role PLATEFORME EFFECTIF (filtre is_active)
--
--  Lu par le RolesGuard a CHAQUE requete (le JWT ne porte pas le role) -> source de verite
--  live du RBAC hors tenant. AJOUT : `AND u.is_active = true`. Un compte DESACTIVE n'a plus
--  de role plateforme effectif -> NULL -> RolesGuard refuse (403). Aligne avec login/refresh
--  qui barrent deja un compte desactive (0009). STABLE/DEFINER inchanges ; ne fait que SELECT
--  (aucun privilege de table nouveau).
-- ---------------------------------------------------------------------
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
    AND u."is_active" = true
  LIMIT 1;
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RETURN v_role;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 3) Propriete (barriere B1) + EXECUTE reserve a roadsen_app
--
--  Re-affirmes a l'identique (CREATE OR REPLACE preserve owner/ACL, mais on re-pose pour
--  self-containment / idempotence). AUCUN nouveau GRANT dangereux : memes signatures, memes
--  droits qu'en 0007/0015. OWNER TO DUR (echec fort au deploy si impossible — lecon 0004->0007).
-- ---------------------------------------------------------------------
ALTER FUNCTION "admin_set_user_active"(uuid, boolean, uuid, text) OWNER TO "roadsen_auth";
ALTER FUNCTION "auth_get_platform_role"(uuid)                     OWNER TO "roadsen_auth";

REVOKE ALL ON FUNCTION "admin_set_user_active"(uuid, boolean, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "auth_get_platform_role"(uuid)                     FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "admin_set_user_active"(uuid, boolean, uuid, text) TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "auth_get_platform_role"(uuid)                     TO "roadsen_app";
