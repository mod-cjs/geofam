-- =====================================================================
--  ROADSEN — Migration 0021 : DURCISSEMENT DES COURSES d'appartenance
--  (verrous de lecture manquants + garde one-org sur la reactivation)
--
--  ROADSEN-MIGRATION-REVIEWED: dev-backend (build) — EN ATTENTE revue
--  ingenieur-securite (zone CRITIQUE : identite + isolation + invariant OWNER).
--  Cette migration ferme DEUX defauts de concurrence MAJEURS et un mineur trouves
--  par la revue securite de 0020. Points a revoir en binome :
--    (M1) COURSE remove_member x admin_transfer_ownership -> ORG SANS OWNER.
--         remove_member (0020) lit le role cible SANS FOR UPDATE : entre sa lecture
--         (« ce membre n'est pas OWNER, pas d'anti-lockout ») et son DELETE, un
--         admin_transfer_ownership concurrent peut PROMOUVOIR ce membre OWNER (et
--         retrograder l'ancien). Le DELETE efface alors le SEUL OWNER -> org sans
--         proprietaire. CORRECTIF : la lecture de role dans remove_member ET dans
--         set_member_role passe en FOR UPDATE. La course se serialise sur la ligne
--         cible : soit le retrait verrouille en 1er (le transfert echoue R0011,
--         le membre n'existant plus / etant verrouille), soit le transfert en 1er
--         (le retrait RE-LIT v_role = OWNER SOUS VERROU -> anti-lockout R0008).
--    (M2) INVARIANT « un user = une org » CONTOURNE par la reactivation.
--         set_member_active (0011) n'a PAS la garde one-org : suspendre A / ajouter B
--         / REACTIVER A rendait le user actif dans A ET B. CORRECTIF : sur le SEUL
--         chemin p_active=true, set_member_active applique la MEME garde one-org que
--         provision_member (advisory xact lock keye user + EXISTS actif dans une AUTRE
--         org -> R0015). La SUSPENSION (p_active=false) n'est JAMAIS bloquee, et
--         l'anti-lockout existant est conserve.
--    (m1) lock_timeout : 0020 (up) avait OUBLIE `SET lock_timeout`. On le pose ici
--         en tete (borne l'attente sur un verrou pendant le deploiement). 0020 n'est
--         PAS re-touchee (migration deja jouee ; on ne reecrit pas l'historique).
--
--  MODELE DE SECURITE (repris EXACTEMENT de 0007/0011/0013/0014/0020) — INCHANGE
--  ---------------------------------------------------------------------------
--  Toutes les fonctions restent SECURITY DEFINER owned par roadsen_auth (NOLOGIN,
--  NOSUPERUSER, NOBYPASSRLS). Chaque fonction pose le drapeau app.auth_bootstrap et
--  le referme sur TOUT chemin de sortie (RETURN + EXCEPTION), search_path fige,
--  EXECUTE reserve a roadsen_app (pour les aretes exposees au runtime). AUCUN
--  BYPASSRLS n'est introduit ; aucun nouveau privilege de table (le DELETE ON
--  memberships accorde en 0020 suffit — on le re-affirme, idempotent).
--
--  ADDITIVE / NON DESTRUCTIVE sur le SCHEMA (CREATE OR REPLACE de fonctions
--  PREEXISTANTES uniquement). IDEMPOTENTE (CREATE OR REPLACE, GRANT). Reversible :
--  voir down.sql (restaure les corps 0011/0013/0020 A L'IDENTIQUE, sans les verrous
--  ni la garde). Les verrous ajoutes ne changent PAS la semantique fonctionnelle
--  (memes resultats hors course) : la non-regression members/mutations/one-org tient.
-- =====================================================================

-- (m1) Borne l'attente sur un verrou pendant l'application (0020 l'avait oublie).
SET lock_timeout = '3s';

-- ---------------------------------------------------------------------
-- 0) Pre-requis ALTER OWNER (executant membre de roadsen_auth + CREATE sur le
--    schema) + le GRANT DELETE ON memberships de 0020, re-affirmes (idempotents,
--    self-contenu — patron 0013/0014/0020 §0). remove_member fait un DELETE.
-- ---------------------------------------------------------------------
GRANT "roadsen_auth" TO CURRENT_USER;
GRANT USAGE, CREATE ON SCHEMA public TO "roadsen_auth";
GRANT DELETE ON "memberships" TO "roadsen_auth";

-- ---------------------------------------------------------------------
-- 1) remove_member (4-arg) — M1 : VERROU DE LECTURE DU ROLE (FOR UPDATE)
--
--  CREATE OR REPLACE du corps 0020 (HARD DELETE). SEUL changement : la lecture du
--  role cible passe en FOR UPDATE. Effet : un admin_transfer_ownership concurrent qui
--  voudrait promouvoir ce membre OWNER se SERIALISE sur la ligne (il FOR UPDATE la
--  meme ligne cible en 0015). Deux issues, toutes deux SURES :
--    - remove_member verrouille EN PREMIER : le transfert attend, puis echoue R0011
--      (la cible n'est plus un membre actif apres le DELETE) ;
--    - le transfert verrouille EN PREMIER : remove_member attend le COMMIT du
--      transfert, RE-LIT v_role = OWNER SOUS VERROU, et l'anti-lockout (dernier OWNER
--      actif) refuse le retrait (R0008). L'org conserve TOUJOURS >= 1 OWNER.
--  Le reste (anti-lockout FOR UPDATE, audit AVANT DELETE, idempotence, DELETE borne
--  au couple org/user) est INCHANGE vs 0020.
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

  -- M1 : FOR UPDATE sur la ligne cible. Verrouille le role AU MOMENT de sa lecture
  -- -> serialise contre admin_transfer_ownership / set_member_role concurrents (qui
  -- verrouillent la meme ligne). Empeche la fenetre TOCTOU « lu non-OWNER, promu
  -- OWNER entre-temps, supprime => zero OWNER ».
  SELECT m."role" INTO v_role
  FROM "memberships" m
  WHERE m."org_id" = p_org_id AND m."user_id" = p_user_id
  FOR UPDATE;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'remove_member: membre introuvable' USING ERRCODE = 'R0005';
  END IF;

  -- Anti-lockout : retirer le dernier OWNER actif laisserait l'org sans proprietaire.
  -- On verrouille les OWNER actifs (FOR UPDATE) AVANT de compter — patron 0011/0013.
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

  -- Trace AVANT le DELETE (pas de trace orpheline).
  INSERT INTO "admin_audit_log"
    ("actor_user_id", "action", "target_org_id", "target_user_id", "payload", "idempotency_key")
  VALUES (
    p_actor, 'MEMBER_REMOVED', p_org_id, p_user_id,
    jsonb_build_object('role', v_role, 'mode', 'HARD'),
    p_idempotency_key
  )
  ON CONFLICT ("idempotency_key") DO NOTHING
  RETURNING "id" INTO v_audit;

  IF v_audit IS NULL THEN
    -- Cle deja appliquee : NO-OP idempotent (aucun re-DELETE).
    PERFORM set_config('app.auth_bootstrap', 'off', true);
    RETURN;
  END IF;

  -- VRAI RETRAIT : suppression de l'appartenance (bornee au couple org/user).
  DELETE FROM "memberships"
  WHERE "org_id" = p_org_id AND "user_id" = p_user_id;

  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 2) set_member_role (5-arg) — M1 (backport) : VERROU DE LECTURE DU ROLE
--
--  CREATE OR REPLACE du corps 0013. MEME defaut que remove_member : la lecture du
--  role courant se faisait SANS FOR UPDATE -> meme course possible (retrograder un
--  membre promu OWNER entre-temps). SEUL changement : la lecture passe en FOR UPDATE.
--  Le reste (anti-escalade OWNER, anti-lockout FOR UPDATE, audit, UPDATE borne) est
--  INCHANGE. Ainsi set_member_role se serialise avec admin_transfer_ownership.
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

  -- M1 (backport) : FOR UPDATE sur la ligne cible (meme raison que remove_member).
  SELECT m."role" INTO v_current
  FROM "memberships" m
  WHERE m."org_id" = p_org_id AND m."user_id" = p_user_id
  FOR UPDATE;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'set_member_role: membre introuvable' USING ERRCODE = 'R0005';
  END IF;

  -- Anti-lockout : retrograder le DERNIER OWNER actif laisserait l'org sans owner.
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
-- 3) set_member_active (3-arg CORE) — M2 : GARDE one-org SUR LA REACTIVATION
--
--  CREATE OR REPLACE du corps 0011. La reactivation (p_active=true) applique
--  DESORMAIS la MEME garde « un user = une org » que provision_member (0020) :
--    (a) pg_advisory_xact_lock keye sur le user (MEME cle que provision_member /
--        provision_org) -> serialise reactivation et rattachement concurrents du
--        MEME user ;
--    (b) EXISTS : le user ne doit PAS deja appartenir (actif) a une AUTRE org, sinon
--        R0015 (409). Lecture cross-org rendue possible par le drapeau (branche
--        bootstrap), BORNEE au user cible.
--  La SUSPENSION (p_active=false) n'est JAMAIS touchee (ni advisory, ni garde). L'anti
--  -lockout du dernier OWNER actif (p_active=false, FOR UPDATE) est CONSERVE a
--  l'identique. La 4-arg (0014, tracee) DELEGUE a ce corps -> la garde s'applique au
--  runtime sans re-declaration.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "set_member_active"(
  p_org_id  uuid,
  p_user_id uuid,
  p_active  boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  tgt_role "Role";
  owners   int;
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);

  SELECT m."role" INTO tgt_role
  FROM "memberships" m
  WHERE m."org_id" = p_org_id AND m."user_id" = p_user_id;

  IF tgt_role IS NULL THEN
    RAISE EXCEPTION 'set_member_active: membre introuvable';
  END IF;

  -- Anti-lockout : on ne suspend jamais le DERNIER OWNER actif (INCHANGE vs 0011).
  IF tgt_role = 'OWNER' AND p_active = false THEN
    SELECT count(*) INTO owners FROM (
      SELECT 1
      FROM "memberships" m
      WHERE m."org_id" = p_org_id AND m."role" = 'OWNER' AND m."is_active" = true
      FOR UPDATE
    ) locked;
    IF owners <= 1 THEN
      RAISE EXCEPTION 'set_member_active: dernier OWNER actif (anti-lockout)';
    END IF;
  END IF;

  -- M2 : GARDE one-org SUR LA SEULE REACTIVATION (p_active=true). Reactiver un membre
  -- suspendu ne doit pas contourner « un user = une org » (suspendre A / ajouter B /
  -- reactiver A). MEME patron que provision_member (0020) : verrou de course + EXISTS.
  IF p_active = true THEN
    -- (a) verrou de course : MEME cle d'advisory que provision_member/provision_org.
    PERFORM pg_advisory_xact_lock(hashtextextended('roadsen:one_org:' || p_user_id::text, 0));
    -- (b) le user ne doit PAS deja appartenir (actif) a une AUTRE org.
    IF EXISTS (
      SELECT 1 FROM "memberships" m
      WHERE m."user_id" = p_user_id
        AND m."org_id" <> p_org_id
        AND m."is_active" = true
    ) THEN
      RAISE EXCEPTION 'set_member_active: l''utilisateur appartient deja a une autre organisation'
        USING ERRCODE = 'R0015';
    END IF;
  END IF;

  UPDATE "memberships" SET "is_active" = p_active
  WHERE "org_id" = p_org_id AND "user_id" = p_user_id;

  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 4) Propriete (barriere B1) + EXECUTE — re-affirmes (idempotents, DUR au deploy).
--
--  Aretes exposees au runtime : remove_member (4-arg) et set_member_role (5-arg)
--  conservent EXECUTE roadsen_app. Le CORE set_member_active (3-arg) reste NON
--  joignable par roadsen_app (0014 §7 : seule la 4-arg tracee est exposee) ; on
--  n'y RE-GRANTe donc PAS EXECUTE — la 4-arg (owned roadsen_auth) l'appelle en tant
--  que roadsen_auth. CREATE OR REPLACE preserve l'owner ; on le re-affirme.
-- ---------------------------------------------------------------------
ALTER FUNCTION "remove_member"(uuid, uuid, uuid, text)            OWNER TO "roadsen_auth";
ALTER FUNCTION "set_member_role"(uuid, uuid, "Role", uuid, text)  OWNER TO "roadsen_auth";
ALTER FUNCTION "set_member_active"(uuid, uuid, boolean)           OWNER TO "roadsen_auth";

REVOKE ALL ON FUNCTION "remove_member"(uuid, uuid, uuid, text)            FROM PUBLIC;
REVOKE ALL ON FUNCTION "set_member_role"(uuid, uuid, "Role", uuid, text)  FROM PUBLIC;
REVOKE ALL ON FUNCTION "set_member_active"(uuid, uuid, boolean)           FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "remove_member"(uuid, uuid, uuid, text)           TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "set_member_role"(uuid, uuid, "Role", uuid, text) TO "roadsen_app";
-- set_member_active(3-arg) : PAS de GRANT EXECUTE a roadsen_app (0014 §7 le ferme).
