-- =====================================================================
--  ROADSEN — Migration 0018 : back-office SUPERADMIN, GESTION UTILISATEURS
--  (edition d'identite + role plateforme)
--
--  ROADSEN-MIGRATION-REVIEWED: dev-backend (build) — EN ATTENTE revue
--  ingenieur-securite (zone CRITIQUE : le ROLE PLATEFORME decide QUI accede au
--  back-office ; c'est du RBAC transverse hors tenant). Points a revoir en binome :
--    (1) admin_set_platform_role MUTE users.platform_role -> qui devient/cesse d'etre
--        SUPERADMIN/SUPPORT. Une erreur ici = escalade ou lock-out de l'admin. Les
--        INVARIANTS ANTI-LOCKOUT (dernier SUPERADMIN actif preserve ; auto-retrogradation
--        refusee) sont graves cote base, ré-appliques a chaque appel (verrou FOR UPDATE).
--    (2) admin_update_user_identity MUTE users.email : l'unicite est TRANCHEE par la
--        contrainte UNIQUE(email) (source de verite, patron provision_user 0005) ; on
--        RE-RAISE un ERRCODE dedie (R0012) pour un 409 borne.
--
--  CONTEXTE
--  --------
--  0015 (Vague 2) a ajoute la desactivation/reset-mdp GLOBALE d'un compte. Il manquait
--  l'edition de la FICHE utilisateur cote donnees identitaires :
--    - corriger l'email + le nom (admin_update_user_identity) ;
--    - attribuer / retirer un role PLATEFORME (admin_set_platform_role) : SUPERADMIN,
--      SUPPORT ou NULL (revocation). C'est le levier RBAC du back-office STARFIRE.
--  Chaque action est TRACEE (admin_audit_log, APPEND-ONLY) et IDEMPOTENTE sur idempotency_key.
--  Le payload d'audit ne porte QUE des valeurs NON secretes (email/nom/role avant/apres —
--  jamais de hash ni de mot de passe).
--
--  MODELE DE SECURITE (repris EXACTEMENT de 0013/0015)
--  ---------------------------------------------------
--  Fonctions SECURITY DEFINER owned roadsen_auth (NOLOGIN, NOSUPERUSER, NOBYPASSRLS),
--  appelees sous asAppRole (roadsen_app). Chaque fonction pose app.auth_bootstrap='on'
--  (ouvre la branche RLS d'identite users + la policy d'admin_audit_log) et le referme
--  sur TOUT chemin de sortie (RETURN + EXCEPTION) ; search_path fige ; EXECUTE revoque a
--  PUBLIC + accorde au seul roadsen_app. L'ACTEUR (p_actor) est le sub du JWT SUPERADMIN
--  passe par le service (jamais le corps — lecon #42) ; p_actor NULL -> refus.
--
--  IDENTITE (isolation) : ces deux DEFINER lisent/ecrivent users « a froid » (hors tenant),
--  exactement comme admin_set_user_active (0015). Aucune donnee tenant n'est touchee : pas
--  besoin d'app.current_org. users = policy `bootstrap OR membership` (0007) -> le drapeau
--  d'auth suffit. Le privilege UPDATE ON users est deja porte par roadsen_auth (0015 §0) :
--  AUCUN nouveau GRANT de table n'est introduit ici (platform_role est une colonne de users).
--
--  ORDRE DES GARDES (patron set_member_role 0013) : les gardes ANTI-LOCKOUT sont evaluees
--  AVANT l'INSERT d'audit -> une action refusee ne laisse PAS de trace orpheline. (Distinct
--  du patron money idempotence-avant-garde : ici aucune garde ne depend de l'idempotence.)
--
--  ADDITIVE / NON DESTRUCTIVE (CREATE OR REPLACE de fonctions NOUVELLES). IDEMPOTENTE
--  (CREATE OR REPLACE, GRANT). Reversible : voir down.sql.
--
--  ERRCODES applicatifs introduits (mappes en HTTP cote service) :
--    R0012 = email deja utilise par un AUTRE compte (409)
--    R0013 = dernier SUPERADMIN actif : retrait/retrogradation refuse (409)
--    R0014 = auto-retrogradation du role plateforme refusee (400)
--  (reutilises : R0005 introuvable (404))
-- =====================================================================

-- Pre-requis ALTER OWNER (executant membre de roadsen_auth + CREATE sur le schema),
-- re-affirmes ici (idempotents, self-contenu — patron 0013/0015).
GRANT "roadsen_auth" TO CURRENT_USER;
GRANT USAGE, CREATE ON SCHEMA public TO "roadsen_auth";

-- ---------------------------------------------------------------------
-- 1) admin_update_user_identity — EDITION email + nom, TRACE (SANS secret)
--
--  Normalise l'email (lower(btrim(...)) — MEME normalisation que provision_user 0005 /
--  auth_find_user_by_email 0003, pour que login et fiche s'accordent). UNICITE : la
--  contrainte UNIQUE(email) du schema TRANCHE (pas d'oracle d'enumeration a froid) ; on
--  fait toutefois un pre-check `email deja pris par un AUTRE user` sous le drapeau pour un
--  message clair (route SUPERADMIN-only), ET on RE-RAISE toute violation 23505 concurrente
--  en R0012 (backstop de course). Audit USER_IDENTITY_UPDATED : email/nom AVANT/APRES —
--  aucune valeur secrete. Idempotent (idempotency_key). users introuvable -> R0005 (404).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "admin_update_user_identity"(
  p_user_id         uuid,
  p_email           text,
  p_full_name       text,
  p_actor           uuid,
  p_idempotency_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_email       text := lower(btrim(p_email));
  v_name        text := btrim(p_full_name);
  v_email_before text;
  v_name_before  text;
  v_dup          boolean;
  v_audit        uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'admin_update_user_identity: p_actor requis';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'admin_update_user_identity: idempotency_key requis';
  END IF;
  IF v_email IS NULL OR length(v_email) = 0 THEN
    RAISE EXCEPTION 'admin_update_user_identity: email requis';
  END IF;
  IF v_name IS NULL OR length(v_name) = 0 THEN
    RAISE EXCEPTION 'admin_update_user_identity: nom requis';
  END IF;

  PERFORM set_config('app.auth_bootstrap', 'on', true);

  -- Etat avant (verrou de ligne). Introuvable -> 404.
  SELECT u."email", u."full_name" INTO v_email_before, v_name_before
  FROM "users" u
  WHERE u."id" = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_update_user_identity: utilisateur introuvable' USING ERRCODE = 'R0005';
  END IF;

  -- Unicite : l'email ne doit pas etre porte par un AUTRE compte (exclusion de soi ->
  -- re-poser son propre email est autorise, edition idempotente du nom).
  SELECT true INTO v_dup
  FROM "users" u
  WHERE u."email" = v_email AND u."id" <> p_user_id
  LIMIT 1;
  IF v_dup THEN
    RAISE EXCEPTION 'admin_update_user_identity: email deja utilise' USING ERRCODE = 'R0012';
  END IF;

  -- Trace AVANT l'ecriture (une cle deja vue -> no-op idempotent). Payload NON secret.
  INSERT INTO "admin_audit_log"
    ("actor_user_id", "action", "target_user_id", "payload", "idempotency_key")
  VALUES (
    p_actor, 'USER_IDENTITY_UPDATED', p_user_id,
    jsonb_build_object(
      'email_before', v_email_before, 'email_after', v_email,
      'full_name_before', v_name_before, 'full_name_after', v_name
    ),
    p_idempotency_key
  )
  ON CONFLICT ("idempotency_key") DO NOTHING
  RETURNING "id" INTO v_audit;

  IF v_audit IS NULL THEN
    PERFORM set_config('app.auth_bootstrap', 'off', true);
    RETURN;
  END IF;

  UPDATE "users" SET "email" = v_email, "full_name" = v_name, "updated_at" = now()
  WHERE "id" = p_user_id;

  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION
  WHEN unique_violation THEN
    -- Course concurrente sur UNIQUE(email) : la sous-transaction a rollback (audit inclus).
    -- On borne en R0012 (meme 409 que le pre-check). Le drapeau est deja restaure par le
    -- rollback de la sous-tx ; on le reaffirme par prudence.
    PERFORM set_config('app.auth_bootstrap', 'off', true);
    RAISE EXCEPTION 'admin_update_user_identity: email deja utilise' USING ERRCODE = 'R0012';
  WHEN OTHERS THEN
    PERFORM set_config('app.auth_bootstrap', 'off', true);
    RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 2) admin_set_platform_role — ATTRIBUE / RETIRE le role PLATEFORME, TRACE
--
--  Ecrit users.platform_role ∈ {SUPERADMIN, SUPPORT, NULL(=revocation)}. C'est le levier
--  RBAC du back-office : le RolesGuard relit auth_get_platform_role (DEFINER, base LIVE) a
--  CHAQUE requete -> l'effet est immediat au prochain appel (aucune re-emission de token).
--
--  INVARIANTS ANTI-LOCKOUT (ordre voulu) :
--    (a) DERNIER SUPERADMIN ACTIF : retirer/retrograder le SEUL SUPERADMIN actif restant est
--        REFUSE (R0013, 409). On compte les AUTRES SUPERADMIN actifs (id <> cible) sous
--        FOR UPDATE (serialise deux retrogradations concurrentes) : s'il n'en reste AUCUN,
--        on refuse. Cette garde couvre le cas ou l'acteur se retrograde lui-meme en etant
--        le dernier (elle passe AVANT l'auto-retrogradation pour donner le 409 le plus fort).
--    (b) AUTO-RETROGRADATION : un acteur ne retire pas son PROPRE acces (p_actor = p_user_id
--        ET nouveau role != SUPERADMIN) -> R0014 (400). Evaluee APRES (a) : si d'autres
--        SUPERADMIN existent, se retrograder soi-meme reste refuse (400).
--    Ces gardes sont evaluees AVANT l'INSERT d'audit (patron set_member_role) -> aucune
--    trace orpheline pour une action refusee.
--
--  Validation de forme : p_role ∈ {SUPERADMIN, SUPPORT} OU NULL, sinon refus (Zod barre
--  deja cote route ; defense en profondeur ici). Audit PLATFORM_ROLE_CHANGED (before/after).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "admin_set_platform_role"(
  p_user_id         uuid,
  p_role            text,
  p_actor           uuid,
  p_idempotency_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_before   "PlatformRole";
  v_new      "PlatformRole";
  v_downgrade boolean;
  v_others   int;
  v_audit    uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'admin_set_platform_role: p_actor requis';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'admin_set_platform_role: idempotency_key requis';
  END IF;
  -- Forme : NULL (revocation) ou une valeur d'enum connue ; toute autre chaine -> refus.
  IF p_role IS NOT NULL AND p_role NOT IN ('SUPERADMIN', 'SUPPORT') THEN
    RAISE EXCEPTION 'admin_set_platform_role: role plateforme invalide (%)', p_role;
  END IF;
  v_new := p_role::"PlatformRole"; -- p_role deja valide (ou NULL) : pas de 22P02.

  PERFORM set_config('app.auth_bootstrap', 'on', true);

  -- Etat avant (verrou de ligne). Introuvable -> 404.
  SELECT u."platform_role" INTO v_before
  FROM "users" u
  WHERE u."id" = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_set_platform_role: utilisateur introuvable' USING ERRCODE = 'R0005';
  END IF;

  -- Retrait/retrogradation d'un SUPERADMIN = passer d'un role SUPERADMIN a autre chose.
  v_downgrade := (v_before = 'SUPERADMIN' AND v_new IS DISTINCT FROM 'SUPERADMIN'::"PlatformRole");

  IF v_downgrade THEN
    -- (a) DERNIER SUPERADMIN ACTIF : compte les AUTRES SUPERADMIN actifs (verrou).
    SELECT count(*) INTO v_others FROM (
      SELECT 1 FROM "users" u
      WHERE u."platform_role" = 'SUPERADMIN' AND u."is_active" = true AND u."id" <> p_user_id
      FOR UPDATE
    ) locked;
    IF v_others = 0 THEN
      RAISE EXCEPTION 'admin_set_platform_role: dernier SUPERADMIN actif requis' USING ERRCODE = 'R0013';
    END IF;

    -- (b) AUTO-RETROGRADATION : on ne retire pas son propre acces (autres SUPERADMIN presents).
    IF p_actor = p_user_id THEN
      RAISE EXCEPTION 'admin_set_platform_role: auto-retrogradation interdite' USING ERRCODE = 'R0014';
    END IF;
  END IF;

  INSERT INTO "admin_audit_log"
    ("actor_user_id", "action", "target_user_id", "payload", "idempotency_key")
  VALUES (
    p_actor, 'PLATFORM_ROLE_CHANGED', p_user_id,
    jsonb_build_object('role_before', v_before, 'role_after', v_new),
    p_idempotency_key
  )
  ON CONFLICT ("idempotency_key") DO NOTHING
  RETURNING "id" INTO v_audit;

  IF v_audit IS NULL THEN
    PERFORM set_config('app.auth_bootstrap', 'off', true);
    RETURN;
  END IF;

  UPDATE "users" SET "platform_role" = v_new, "updated_at" = now()
  WHERE "id" = p_user_id;

  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 3) Propriete (barriere B1) + EXECUTE reserve a roadsen_app
--
--  OWNER TO roadsen_auth (execute avec son privilege de table, pas celui de l'appelant).
--  EXECUTE revoque a PUBLIC, accorde au seul roadsen_app. OWNER TO DUR (echec fort au
--  deploy si impossible — lecon 0004->0007).
-- ---------------------------------------------------------------------
ALTER FUNCTION "admin_update_user_identity"(uuid, text, text, uuid, text) OWNER TO "roadsen_auth";
ALTER FUNCTION "admin_set_platform_role"(uuid, text, uuid, text)          OWNER TO "roadsen_auth";

REVOKE ALL ON FUNCTION "admin_update_user_identity"(uuid, text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "admin_set_platform_role"(uuid, text, uuid, text)          FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "admin_update_user_identity"(uuid, text, text, uuid, text) TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "admin_set_platform_role"(uuid, text, uuid, text)          TO "roadsen_app";
