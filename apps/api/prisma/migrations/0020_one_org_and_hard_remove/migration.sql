-- =====================================================================
--  ROADSEN — Migration 0020 : UN USER = UNE ORG (enforcement) + RETRAIT = HARD-DELETE
--
--  ROADSEN-MIGRATION-REVIEWED: dev-backend (build) — EN ATTENTE revue
--  ingenieur-securite (zone CRITIQUE : identite + isolation multi-tenant). Points a
--  revoir en binome :
--    (1) ONE-ORG GUARD dans provision_member (3-arg) ET provision_org (3-arg) : lit
--        memberships CROSS-ORG sous le drapeau app.auth_bootstrap. C'est deliberement
--        cross-tenant (verifier qu'un user n'est PAS ailleurs), borne au SEUL user cible.
--    (2) VERROU DE COURSE (pg_advisory_xact_lock keyed sur user_id) : serialise deux
--        rattachements concurrents du MEME user vers deux orgs -> impossible de creer
--        2 appartenances simultanees qui contourneraient la garde (TOCTOU).
--    (3) remove_member passe de SOFT (is_active=false) a HARD DELETE : requiert un
--        nouveau GRANT DELETE ON memberships TO roadsen_auth (le DEFINER s'execute
--        comme roadsen_auth ; sans ce privilege -> 42501). roadsen_app reste sans DML
--        direct sur l'identite (barriere B1 intacte).
--
--  DECISION TITULAIRE (2026-07-07, REVERSIBLE) :
--    (A) UN USER = UNE ORG. Interdit d'appartenir a >1 org ACTIVE. Applique aux DEUX
--        voies de rattachement : provision_member (org existante) ET provision_org
--        (creation d'org avec un OWNER designe existant). Ré-attacher dans LA MEME org
--        (ex. apres un retrait) reste permis. Un OWNER cree inline = nouveau user,
--        sans appartenance -> OK.
--    (B) « Retirer un membre » = VRAI RETRAIT (hard-delete de l'appartenance, tracé),
--        DISTINCT de « Suspendre » (set_member_active, is_active=false, INCHANGE).
--
--  MODELE DE SECURITE (repris EXACTEMENT de 0007/0011/0013/0014)
--  ------------------------------------------------------------
--  Toutes les fonctions restent SECURITY DEFINER owned par roadsen_auth (NOLOGIN,
--  NOSUPERUSER, NOBYPASSRLS). Chaque fonction pose le drapeau app.auth_bootstrap
--  (ouvre la branche RLS d'identite) et le referme sur TOUT chemin de sortie
--  (RETURN + EXCEPTION), search_path fige, EXECUTE reserve a roadsen_app. AUCUN
--  BYPASSRLS n'est introduit. La visibilite cross-org des lectures de garde vient
--  de la branche bootstrap de la policy d'identite (0007), pas d'un contournement.
--
--  INVARIANT DE CLOISONNEMENT (grave) : sous le drapeau, la RLS de memberships est
--  neutralisee -> le WHERE explicite (org_id, user_id) est l'UNIQUE barriere des
--  ecritures. La garde one-org lit DELIBEREMENT cross-org (c'est son role) mais
--  BORNEE au SEUL user cible (WHERE user_id = <param>). Le HARD DELETE reste borne
--  a (org_id, user_id) : aucune ligne d'un autre couple n'est touchee.
--
--  ADDITIVE / NON DESTRUCTIVE sur le SCHEMA (CREATE OR REPLACE, GRANT). IDEMPOTENTE
--  (CREATE OR REPLACE, GRANT). Reversible : voir down.sql (restaure les corps 0011/0013).
--
--  ⚠️ DONNEES EXISTANTES : deux users multi-org preexistent (avant enforcement). Cette
--  migration NE les regularise PAS (elle ne fait qu'empecher les NOUVEAUX cas). La
--  regularisation est un SCRIPT SEPARE (regularize-multi-org.mjs) applique a la main
--  APRES decision humaine (ne pas casser un owner unique). L'enforcement one-org
--  n'echoue PAS sur les doublons existants : la garde ne mord qu'au PROCHAIN
--  rattachement.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Pre-requis ALTER OWNER (executant membre de roadsen_auth + CREATE sur le
--    schema), re-affirmes ici (idempotents, self-contenu — patron 0013/0014 §2).
--    + GRANT DELETE ON memberships : remove_member fait desormais un DELETE.
--      roadsen_auth n'avait que SELECT/INSERT (0007) + UPDATE (0011). Sans ce GRANT,
--      le DEFINER (execute comme roadsen_auth) echouerait en 42501 sous un runtime
--      NOBYPASSRLS. roadsen_app reste SANS aucun DML direct sur l'identite (B1).
-- ---------------------------------------------------------------------
GRANT "roadsen_auth" TO CURRENT_USER;
GRANT USAGE, CREATE ON SCHEMA public TO "roadsen_auth";
GRANT DELETE ON "memberships" TO "roadsen_auth";

-- ---------------------------------------------------------------------
-- 1) provision_member (3-arg) — ONE-ORG GUARD + VERROU DE COURSE
--
--  CREATE OR REPLACE du corps EPROUVE (0011). Ajouts UNIQUEMENT :
--    (a) pg_advisory_xact_lock keyed sur le user cible : serialise deux
--        rattachements concurrents du MEME user (portee transaction, libere au
--        COMMIT). Empeche le TOCTOU ou deux INSERT simultanes passeraient chacun
--        la garde (chacun ne voyant pas l'autre) et creeraient 2 appartenances.
--    (b) GARDE one-org : REFUSE (R0015 -> 409) si le user a DEJA une appartenance
--        ACTIVE dans une AUTRE org. `org_id <> p_org_id` : ré-attacher dans LA MEME
--        org (apres un retrait) reste permis. Lecture cross-org rendue possible par
--        le drapeau (branche bootstrap de la policy memberships), BORNEE au user cible.
--  Le reste (OWNER interdit, INSERT, restauration contexte/drapeau) est INCHANGE.
--  L'@@unique(org_id,user_id) tranche toujours un ré-ajout dans la meme org (23505 -> 409).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "provision_member"(
  p_org_id  uuid,
  p_user_id uuid,
  p_role    "Role"
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v    uuid := gen_random_uuid();
  prev text := COALESCE(current_setting('app.current_org', true), '');
BEGIN
  IF p_role = 'OWNER' THEN
    RAISE EXCEPTION 'provision_member: OWNER interdit par cette voie';
  END IF;

  PERFORM set_config('app.auth_bootstrap', 'on', true);
  PERFORM set_config('app.current_org', p_org_id::text, true);

  -- (a) VERROU DE COURSE : cle d'advisory transactionnelle derivee du user cible.
  --     Deux provision_member/provision_org concurrents pour le MEME user (meme cle)
  --     se serialisent -> pas de fenetre TOCTOU laissant 2 appartenances actives.
  PERFORM pg_advisory_xact_lock(hashtextextended('roadsen:one_org:' || p_user_id::text, 0));

  -- (b) GARDE one-org : le user ne doit PAS deja appartenir (actif) a une AUTRE org.
  IF EXISTS (
    SELECT 1 FROM "memberships" m
    WHERE m."user_id" = p_user_id
      AND m."org_id" <> p_org_id
      AND m."is_active" = true
  ) THEN
    RAISE EXCEPTION 'provision_member: l''utilisateur appartient deja a une organisation'
      USING ERRCODE = 'R0015';
  END IF;

  INSERT INTO "memberships" ("id", "org_id", "user_id", "role")
  VALUES (v, p_org_id, p_user_id, p_role);

  PERFORM set_config('app.current_org', prev, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.current_org', prev, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 2) provision_org (3-arg) — ONE-ORG GUARD sur l'OWNER designe + VERROU DE COURSE
--
--  CREATE OR REPLACE du corps EPROUVE (0007). L'OWNER d'une org NOUVELLE ne doit pas
--  deja appartenir (actif) a une autre org. Un OWNER designe EXISTANT deja engage
--  ailleurs -> R0015 (409). Un OWNER cree INLINE (nouveau user, sans appartenance)
--  passe la garde. La verification a lieu APRES avoir pose le drapeau (branche
--  bootstrap -> lecture memberships cross-org) et AVANT l'INSERT du membership OWNER.
--  Même cle d'advisory que provision_member -> les deux voies se serialisent pour un
--  meme user. v_org_id est neuf : `org_id <> v_org_id` = « toute appartenance ailleurs ».
-- ---------------------------------------------------------------------
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

  -- VERROU DE COURSE + GARDE one-org sur l'OWNER designe (patron provision_member).
  PERFORM pg_advisory_xact_lock(hashtextextended('roadsen:one_org:' || p_owner_user_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM "memberships" m
    WHERE m."user_id" = p_owner_user_id
      AND m."org_id" <> v_org_id
      AND m."is_active" = true
  ) THEN
    RAISE EXCEPTION 'provision_org: l''utilisateur appartient deja a une organisation'
      USING ERRCODE = 'R0015';
  END IF;

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

-- ---------------------------------------------------------------------
-- 3) remove_member (4-arg) — RETRAIT = HARD DELETE (vrai retrait, tracé)
--
--  CREATE OR REPLACE du corps 0013 (qui faisait un UPDATE is_active=false, SOFT). On
--  passe a un VRAI DELETE de l'appartenance. INVARIANTS CONSERVES :
--    - ANTI-LOCKOUT : on ne retire JAMAIS le dernier OWNER actif (FOR UPDATE sur les
--      OWNER actifs avant comptage, patron 0011/0013) -> R0008 (409) ;
--    - AUDIT MEMBER_REMOVED (p_actor, target_org/user) INSERE AVANT le DELETE -> pas
--      de trace orpheline ; payload.mode passe de 'SOFT' a 'HARD' (marqueur explicite) ;
--    - IDEMPOTENCE : une cle deja vue -> NO-OP (aucun re-DELETE). Le DELETE est de
--      toute facon idempotent (0 ligne si deja retire) ;
--    - membre introuvable -> R0005 (404).
--  memberships = policy `org_scope OR bootstrap` -> le drapeau suffit ; le WHERE
--  (org_id, user_id) explicite est l'UNIQUE cloisonnement du DELETE. « Suspendre »
--  (set_member_active) reste INCHANGE (is_active=false, reversible).
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

  -- Anti-lockout : retirer le dernier OWNER actif laisserait l'org sans proprietaire.
  -- On verrouille les OWNER actifs (FOR UPDATE) AVANT de compter (serialise deux
  -- retraits concurrents) — patron 0011/0013.
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

  -- Trace AVANT le DELETE (pas de trace orpheline ; l'audit n'a aucune FK vers
  -- memberships -> il survit au retrait, comme les autres actions admin).
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
-- 4) Propriete (barriere B1) + EXECUTE reserve a roadsen_app
--
--  CREATE OR REPLACE preserve owner + GRANT, mais on les re-affirme (idempotent,
--  DUR au deploy — lecon 0004->0007). Les surcharges 4-args (0014, wrappers d'audit)
--  DELEGUENT a ces corps 3-args : leur signature est INCHANGEE, rien a re-declarer.
-- ---------------------------------------------------------------------
ALTER FUNCTION "provision_member"(uuid, uuid, "Role")   OWNER TO "roadsen_auth";
ALTER FUNCTION "provision_org"(text, text, uuid)         OWNER TO "roadsen_auth";
ALTER FUNCTION "remove_member"(uuid, uuid, uuid, text)   OWNER TO "roadsen_auth";

REVOKE ALL ON FUNCTION "provision_member"(uuid, uuid, "Role")  FROM PUBLIC;
REVOKE ALL ON FUNCTION "provision_org"(text, text, uuid)       FROM PUBLIC;
REVOKE ALL ON FUNCTION "remove_member"(uuid, uuid, uuid, text) FROM PUBLIC;

-- provision_org (3-arg) reste NON joignable directement par roadsen_app depuis 0014
-- (§7 : seul le wrapper 4-arg tracé est expose au runtime). On ne re-GRANT donc PAS
-- EXECUTE a roadsen_app sur les 3-args de provision_org/provision_member : le runtime
-- passe TOUJOURS par les surcharges 4-args auditees. remove_member reste 4-arg (une
-- seule arite) -> EXECUTE a roadsen_app re-affirme.
GRANT EXECUTE ON FUNCTION "remove_member"(uuid, uuid, uuid, text) TO "roadsen_app";
