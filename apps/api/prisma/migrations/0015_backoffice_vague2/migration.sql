-- =====================================================================
--  ROADSEN — Migration 0015 : back-office SUPERADMIN, VAGUE 2
--  (comptes GLOBAUX + rattachement d'abonnement + transfert d'OWNER)
--
--  ROADSEN-MIGRATION-REVIEWED: dev-backend (build) — EN ATTENTE revue
--  ingenieur-securite (zone CRITIQUE : identite + money). Points a revoir en binome :
--    (1) NOUVEAU privilege `GRANT UPDATE ON users TO roadsen_auth` : jusqu'ici
--        roadsen_auth n'avait que SELECT (0004) + INSERT (0005) sur users. La Vague 2
--        MUTE users (is_active + password_hash) via DEFINER -> il faut UPDATE. Comme les
--        autres GRANT money/identite (0013 §2), il n'est atteignable QUE via les DEFINER
--        auditees (roadsen_auth reste NOLOGIN ; le runtime ne fait jamais SET ROLE roadsen_auth).
--    (2) admin_attach_subscription LIT subscriptions cross-tenant-capable : elle porte un
--        `WHERE org_id = p_org_id` explicite (invariant grave en 0014 §INVARIANT) + FOR UPDATE
--        (re-applique tenant_isolation). Aucune lecture non bornee.
--    (3) admin_transfer_ownership REECRIT des roles OWNER : anti-lockout preserve (le nouvel
--        owner DOIT etre un membre ACTIF ; on ne laisse jamais l'org sans OWNER — on PROMEUT
--        avant de RETROGRADER, et le nouvel owner reste OWNER).
--
--  CONTEXTE
--  --------
--  Vague 1 (0012/0013/0014) : lecture + mutations money-adjacent PAR ORG. La Vague 2 ajoute :
--    - la desactivation/reactivation GLOBALE d'un compte (users.is_active, deja applique au
--      login/refresh mais sans levier admin) ;
--    - le reset de mot de passe par un SUPERADMIN (hash argon2id calcule cote service, jamais
--      en clair ; le payload d'audit NE contient NI mot de passe NI hash) ;
--    - le rattachement d'un abonnement a une org EXISTANTE sans abo (une org sans abo est
--      barree 403 a vie par le SubscriptionGuard) ;
--    - le transfert d'OWNER (promotion d'un membre + retrogradation de l'ancien).
--  Chaque action est TRACEE (admin_audit_log, APPEND-ONLY) et IDEMPOTENTE sur idempotency_key.
--
--  MODELE DE SECURITE (repris EXACTEMENT de 0007/0013/0014)
--  --------------------------------------------------------
--  Toute ecriture privilegiee passe par des fonctions SECURITY DEFINER owned roadsen_auth
--  (NOLOGIN, NOSUPERUSER, NOBYPASSRLS). Chaque fonction pose app.auth_bootstrap (+ app.current_org
--  pour les ecritures sur la table de DONNEES tenant subscriptions) et le/les referme sur TOUT
--  chemin de sortie (RETURN + EXCEPTION), search_path fige, EXECUTE revoque a PUBLIC + accorde au
--  seul roadsen_app. AUCUN BYPASSRLS n'est introduit. L'ACTEUR (p_actor) est le sub du JWT
--  SUPERADMIN passe par le service (jamais le corps — lecon #42) ; p_actor NULL -> refus.
--
--  ORDRE IDEMPOTENCE-AVANT-GARDE (F1, 0013) : les fonctions qui portent une garde metier
--  (attach : abo actif deja present) tracent la cle AVANT d'evaluer la garde -> un rejeu a MEME
--  cle est un NO-OP succes, jamais un refus parasite. Un RAISE de garde (cle NEUVE) rollback
--  l'INSERT audit dans la meme tx (pas d'audit orphelin).
--
--  ADDITIVE / NON DESTRUCTIVE (CREATE OR REPLACE de fonctions NOUVELLES, un GRANT). IDEMPOTENTE
--  (CREATE OR REPLACE, GRANT). Reversible : voir down.sql.
--
--  ERRCODES applicatifs introduits (mappes en HTTP cote service) :
--    R0009 = auto-desactivation d'un SUPERADMIN (400)
--    R0010 = abonnement actif deja present au rattachement (409)
--    R0011 = nouveau proprietaire non membre actif (400)
--  (reutilises : R0005 introuvable (404), R0006 fenetre invalide (400))
-- =====================================================================

-- Pre-requis ALTER OWNER (executant membre de roadsen_auth + CREATE sur le schema),
-- re-affirmes ici (idempotents, self-contenu — patron 0013 §2).
GRANT "roadsen_auth" TO CURRENT_USER;
GRANT USAGE, CREATE ON SCHEMA public TO "roadsen_auth";

-- ---------------------------------------------------------------------
-- 0) NOUVEAU privilege : roadsen_auth doit pouvoir UPDATE users
--
--  admin_set_user_active / admin_reset_user_password (DEFINER, owned roadsen_auth) mutent
--  users.is_active / users.password_hash. 0004/0005 n'avaient donne que SELECT/INSERT. Sans
--  ce GRANT, le DEFINER (execute comme roadsen_auth) echouerait en 42501 sous NOBYPASSRLS.
--  Atteignable UNIQUEMENT via les DEFINER (roadsen_auth NOLOGIN). La policy users
--  (bootstrap OR membership, 0007) autorise deja l'UPDATE sous le drapeau d'auth.
-- ---------------------------------------------------------------------
GRANT UPDATE ON "users" TO "roadsen_auth";

-- ---------------------------------------------------------------------
-- 1) admin_set_user_active — DESACTIVATION / REACTIVATION GLOBALE d'un compte, TRACE
--
--  Mute users.is_active (global, hors tenant). L'effet est immediat au prochain login
--  (auth_find_user_by_email renvoie is_active ; login refuse si false) ET au prochain
--  refresh (auth_get_user_state, 0009). ANTI AUTO-DESACTIVATION : un acteur ne peut pas se
--  desactiver lui-meme (p_user_id = p_actor AND p_active=false) -> R0009 (400) : garde-fou
--  contre le lock-out du SUPERADMIN. users = policy `bootstrap OR membership` (0007) : le
--  drapeau suffit. Idempotent + trace (is_active avant/apres).
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

  SELECT u."is_active" INTO v_before
  FROM "users" u
  WHERE u."id" = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_set_user_active: utilisateur introuvable' USING ERRCODE = 'R0005';
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
-- 2) admin_reset_user_password — RESET du mot de passe (admin), TRACE SANS SECRET
--
--  Le hash argon2id est calcule COTE SERVICE (hashPassword) : aucun mot de passe en clair
--  n'atteint la base ni cette fonction. Le payload d'audit ne porte QUE le motif (jamais le
--  mdp ni le hash — exigence explicite). Idempotent + trace. users = policy `bootstrap OR
--  membership` (0007). NB dette : pas de revocation des refresh tokens (aucune table de jetons
--  en P1) -> un refresh emis AVANT le reset reste valide jusqu'a expiration (documente, non masque).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "admin_reset_user_password"(
  p_user_id         uuid,
  p_hash            text,
  p_actor           uuid,
  p_motif           text,
  p_idempotency_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_audit uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'admin_reset_user_password: p_actor requis';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'admin_reset_user_password: idempotency_key requis';
  END IF;
  IF p_hash IS NULL OR length(btrim(p_hash)) = 0 THEN
    RAISE EXCEPTION 'admin_reset_user_password: hash requis';
  END IF;

  PERFORM set_config('app.auth_bootstrap', 'on', true);

  -- existence (verrou de ligne). PERFORM positionne FOUND.
  PERFORM 1 FROM "users" u WHERE u."id" = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_reset_user_password: utilisateur introuvable' USING ERRCODE = 'R0005';
  END IF;

  -- Payload MINIMAL : uniquement le motif (jamais le mdp ni le hash).
  INSERT INTO "admin_audit_log"
    ("actor_user_id", "action", "target_user_id", "payload", "idempotency_key")
  VALUES (
    p_actor, 'USER_PASSWORD_RESET', p_user_id,
    jsonb_build_object('motif', p_motif),
    p_idempotency_key
  )
  ON CONFLICT ("idempotency_key") DO NOTHING
  RETURNING "id" INTO v_audit;

  IF v_audit IS NULL THEN
    PERFORM set_config('app.auth_bootstrap', 'off', true);
    RETURN;
  END IF;

  UPDATE "users" SET "password_hash" = p_hash, "updated_at" = now()
  WHERE "id" = p_user_id;

  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 3) admin_attach_subscription — RATTACHER un abo a une org EXISTANTE sans abo, TRACE
--
--  Une org sans abonnement est barree 403 (SubscriptionGuard) a vie ; cette fonction pose le
--  1er abo. GARDE (409) : si un abo ACTIF (date_fin >= now) existe DEJA, on REFUSE (R0010) —
--  le changement d'un abo actif passe par les mutations dediees (adjust_quota / renew /
--  entitlements, 0013). Un abo EXPIRE est REMPLACE (re-souscription : upsert + reset conso).
--  subscriptions = DONNEE tenant -> app.current_org = p_org_id (satisfait la policy org_scope
--  a l'INSERT/UPDATE) ET WHERE org_id explicite a la lecture (invariant 0014). FOR UPDATE
--  re-applique tenant_isolation. IDEMPOTENCE AVANT GARDE (F1) : le rejeu a meme cle = no-op.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "admin_attach_subscription"(
  p_org_id          uuid,
  p_pack            text,
  p_entitlements    text[],
  p_date_debut      timestamptz,
  p_date_fin        timestamptz,
  p_quota           int,
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
  v_org_ok   boolean;
  v_sub_id   uuid;
  v_date_fin timestamptz;
  v_active   boolean;
  v_audit    uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'admin_attach_subscription: p_actor requis';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'admin_attach_subscription: idempotency_key requis';
  END IF;
  IF p_quota IS NULL OR p_quota < 0 THEN
    RAISE EXCEPTION 'admin_attach_subscription: quota invalide (%).', p_quota;
  END IF;
  IF p_entitlements IS NULL THEN
    RAISE EXCEPTION 'admin_attach_subscription: entitlements requis (liste, eventuellement vide)';
  END IF;
  IF p_date_debut IS NULL OR p_date_fin IS NULL OR p_date_debut > p_date_fin THEN
    RAISE EXCEPTION 'admin_attach_subscription: fenetre invalide (debut > fin)' USING ERRCODE = 'R0006';
  END IF;

  PERFORM set_config('app.auth_bootstrap', 'on', true);
  PERFORM set_config('app.current_org', p_org_id::text, true);

  -- org existante ? (identite, sous le drapeau). Introuvable -> 404.
  SELECT true INTO v_org_ok FROM "organizations" o WHERE o."id" = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_attach_subscription: organisation introuvable' USING ERRCODE = 'R0005';
  END IF;

  -- Abo existant ? WHERE org_id EXPLICITE (invariant 0014) + FOR UPDATE (2e barriere tenant).
  SELECT s."id", s."date_fin" INTO v_sub_id, v_date_fin
  FROM "subscriptions" s
  WHERE s."org_id" = p_org_id
  FOR UPDATE;
  v_active := (v_sub_id IS NOT NULL AND v_date_fin >= now());

  -- IDEMPOTENCE D'ABORD (F1) : trace la cle AVANT la garde. Rejeu meme cle -> no-op succes.
  INSERT INTO "admin_audit_log"
    ("actor_user_id", "action", "target_org_id", "payload", "idempotency_key")
  VALUES (
    p_actor, 'SUBSCRIPTION_ATTACHED', p_org_id,
    jsonb_build_object(
      'pack', p_pack, 'quota', p_quota,
      'date_debut', p_date_debut, 'date_fin', p_date_fin,
      'replaced_expired', (v_sub_id IS NOT NULL)
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

  -- GARDE (cle NEUVE) : un abo ACTIF existe deja -> 409 (le RAISE rollback l'audit ci-dessus).
  IF v_active THEN
    RAISE EXCEPTION 'admin_attach_subscription: abonnement actif deja present' USING ERRCODE = 'R0010';
  END IF;

  -- Upsert (org_id UNIQUE) : cree l'abo, ou REMPLACE un abo EXPIRE (reset consommation).
  INSERT INTO "subscriptions"
    ("org_id", "pack", "entitlements", "date_debut", "date_fin", "quota", "consommation")
  VALUES
    (p_org_id, p_pack, p_entitlements, p_date_debut, p_date_fin, p_quota, 0)
  ON CONFLICT ("org_id") DO UPDATE SET
    "pack"         = EXCLUDED."pack",
    "entitlements" = EXCLUDED."entitlements",
    "date_debut"   = EXCLUDED."date_debut",
    "date_fin"     = EXCLUDED."date_fin",
    "quota"        = EXCLUDED."quota",
    "consommation" = 0,
    "updated_at"   = now();

  PERFORM set_config('app.current_org', prev_org, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.current_org', prev_org, true);
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 4) admin_transfer_ownership — TRANSFERT d'OWNER, ATOMIQUE + TRACE
--
--  Promeut p_new_owner_user_id OWNER et retrograde l'(les) ancien(s) OWNER en ADMIN. Le
--  nouvel owner DOIT etre un membre ACTIF de l'org (anti-lockout : sinon on risquerait une org
--  sans owner joignable) -> sinon R0011 (400). On PROMEUT AVANT de RETROGRADER (l'org a
--  toujours >= 1 OWNER pendant la transition). Le nouvel owner N'est JAMAIS retrograde (WHERE
--  user_id <> p_new_owner). memberships = policy `org_scope OR bootstrap` -> le drapeau suffit ;
--  WHERE (org_id,user_id) explicite = cloisonnement. Idempotent + trace (before/after).
--  Il n'y a PAS de garde OWNER (contrairement a set_member_role) : ici on CREE justement un OWNER.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "admin_transfer_ownership"(
  p_org_id             uuid,
  p_new_owner_user_id  uuid,
  p_actor              uuid,
  p_idempotency_key    text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_new_role   "Role";
  v_new_active boolean;
  v_prev       jsonb;
  v_audit      uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'admin_transfer_ownership: p_actor requis';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'admin_transfer_ownership: idempotency_key requis';
  END IF;
  IF p_new_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'admin_transfer_ownership: p_new_owner_user_id requis';
  END IF;

  PERFORM set_config('app.auth_bootstrap', 'on', true);

  -- Le nouvel owner doit etre un membre ACTIF de l'org (verrou de ligne).
  SELECT m."role", m."is_active" INTO v_new_role, v_new_active
  FROM "memberships" m
  WHERE m."org_id" = p_org_id AND m."user_id" = p_new_owner_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_new_active = false THEN
    RAISE EXCEPTION 'admin_transfer_ownership: le nouveau proprietaire doit etre un membre actif'
      USING ERRCODE = 'R0011';
  END IF;

  -- Capture des OWNER actuels (hors le nouveau) pour l'audit + verrou (serialise 2 transferts).
  SELECT COALESCE(jsonb_agg(m."user_id"), '[]'::jsonb) INTO v_prev
  FROM (
    SELECT m."user_id" FROM "memberships" m
    WHERE m."org_id" = p_org_id AND m."role" = 'OWNER' AND m."user_id" <> p_new_owner_user_id
    FOR UPDATE
  ) m;

  INSERT INTO "admin_audit_log"
    ("actor_user_id", "action", "target_org_id", "target_user_id", "payload", "idempotency_key")
  VALUES (
    p_actor, 'OWNERSHIP_TRANSFERRED', p_org_id, p_new_owner_user_id,
    jsonb_build_object(
      'new_owner_user_id', p_new_owner_user_id,
      'new_owner_role_before', v_new_role,
      'new_owner_role_after', 'OWNER',
      'previous_owner_user_ids', v_prev,
      'previous_owner_role_after', 'ADMIN'
    ),
    p_idempotency_key
  )
  ON CONFLICT ("idempotency_key") DO NOTHING
  RETURNING "id" INTO v_audit;

  IF v_audit IS NULL THEN
    PERFORM set_config('app.auth_bootstrap', 'off', true);
    RETURN;
  END IF;

  -- 1) PROMOTION du nouvel owner (avant toute retrogradation : l'org garde >= 1 OWNER).
  UPDATE "memberships" SET "role" = 'OWNER'
  WHERE "org_id" = p_org_id AND "user_id" = p_new_owner_user_id;

  -- 2) RETROGRADATION des autres OWNER en ADMIN (jamais le nouvel owner).
  UPDATE "memberships" SET "role" = 'ADMIN'
  WHERE "org_id" = p_org_id AND "role" = 'OWNER' AND "user_id" <> p_new_owner_user_id;

  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- 5) Propriete (barriere B1) + EXECUTE reserve a roadsen_app
--
--  Chaque fonction DEFINER devient owned par roadsen_auth (elle s'execute avec son privilege
--  de table, pas celui de l'appelant). EXECUTE revoque a PUBLIC, accorde au seul roadsen_app.
--  OWNER TO DUR (echec fort au deploy si impossible — lecon 0004->0007).
-- ---------------------------------------------------------------------
ALTER FUNCTION "admin_set_user_active"(uuid, boolean, uuid, text)                       OWNER TO "roadsen_auth";
ALTER FUNCTION "admin_reset_user_password"(uuid, text, uuid, text, text)                OWNER TO "roadsen_auth";
ALTER FUNCTION "admin_attach_subscription"(uuid, text, text[], timestamptz, timestamptz, int, uuid, text) OWNER TO "roadsen_auth";
ALTER FUNCTION "admin_transfer_ownership"(uuid, uuid, uuid, text)                       OWNER TO "roadsen_auth";

REVOKE ALL ON FUNCTION "admin_set_user_active"(uuid, boolean, uuid, text)                       FROM PUBLIC;
REVOKE ALL ON FUNCTION "admin_reset_user_password"(uuid, text, uuid, text, text)                FROM PUBLIC;
REVOKE ALL ON FUNCTION "admin_attach_subscription"(uuid, text, text[], timestamptz, timestamptz, int, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "admin_transfer_ownership"(uuid, uuid, uuid, text)                       FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "admin_set_user_active"(uuid, boolean, uuid, text)                       TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "admin_reset_user_password"(uuid, text, uuid, text, text)                TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "admin_attach_subscription"(uuid, text, text[], timestamptz, timestamptz, int, uuid, text) TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "admin_transfer_ownership"(uuid, uuid, uuid, text)                       TO "roadsen_app";
