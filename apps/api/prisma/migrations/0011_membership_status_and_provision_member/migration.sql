-- =====================================================================
--  ROADSEN — Migration 0011 : accès contrôlés multi-membres (P1, admin-géré)
--  (renumérotée 0010 -> 0011 : recette porte déjà 0010_project_domain_description ;
--   notre migration ne dépend que de <= 0009, ordre sûr après project_domain.)
--
--  ROADSEN-MIGRATION-REVIEWED: dev-backend (build) + ingenieur-securite (GO-conditionnel,
--  conditions traitées : isolation cross-tenant écriture/lecture prouvées par test,
--  anti-lockout FOR UPDATE, RBAC 403). Surface DEFINER hors-RLS + patch
--  auth_user_has_membership. Cf. docs/cadrage-acces-membres-p1.md.
--
--  CONTEXTE
--  --------
--  Aujourd'hui un membership n'est créé qu'à la création de l'org (l'OWNER, via
--  provision_org, 0007). Il n'existe AUCUNE voie pour attacher un membre à une
--  org EXISTANTE, ni pour suspendre proprement un accès. Cette migration ajoute :
--    (a) memberships.is_active (suspension sans suppression) ;
--    (b) le PATCH du filtre is_active dans auth_user_has_membership — sinon la
--        suspension serait INOPÉRANTE (le rôle continuerait d'être servi au
--        TenantGuard). PIÈGE HAUTE : (a) + (b) + le test n°1 vivent dans la
--        MÊME migration/PR (sinon fausse sécurité) ;
--    (c) provision_member — attache un membre (rôle ≠ OWNER) à une org existante,
--        org injectée SERVEUR (leçon #42), miroir de provision_org ;
--    (d) set_member_active — suspend/réactive, avec anti-lockout du dernier OWNER
--        actif ;
--    (e) list_org_members — liste des membres d'une org (identité), pour le
--        back-office SUPERADMIN.
--
--  MODÈLE DE SÉCURITÉ (repris EXACTEMENT de 0007)
--  ----------------------------------------------
--  Les tables d'identité (users, memberships, organizations) sont sous FORCE RLS ;
--  leur DML est réservé au rôle roadsen_auth (barrière B1), et le runtime
--  roadsen_app ne les touche QUE via des fonctions SECURITY DEFINER auditées, qui
--  posent le drapeau fail-closed `app.auth_bootstrap` (ouvre la branche RLS
--  d'identité) et le referment sur TOUT chemin de sortie. Les 3 nouvelles
--  fonctions suivent ce patron : owned par roadsen_auth, drapeau posé/fermé,
--  EXECUTE réservé à roadsen_app.
--
--  ÉCART ASSUMÉ vs le SQL du cadrage (documenté, revue sécurité) :
--   1. auth_user_has_membership est CONSERVÉE en plpgsql AVEC le drapeau (forme
--      0007) — le cadrage montrait une forme `LANGUAGE sql` simplifiée qui, elle,
--      RÉGRESSERAIT le drapeau et casserait le lookup « à froid » du TenantGuard.
--      On n'ajoute QUE le filtre `AND m.is_active = true`.
--   2. set_member_active pose le drapeau `app.auth_bootstrap` (le SQL du cadrage
--      l'omettait) : sans lui, ses lectures/écritures sur `memberships` (RLS, sans
--      app.current_org en contexte) ne verraient AUCUNE ligne -> « membre
--      introuvable » sur un membre valide et UPDATE à 0 ligne. Correction requise.
--   3. GRANT UPDATE ON memberships TO roadsen_auth : set_member_active fait un
--      UPDATE ; 0007 n'avait accordé à roadsen_auth que SELECT/INSERT sur
--      l'identité. Sans ce GRANT, le DEFINER (exécuté avec les droits de
--      roadsen_auth) échouerait en insufficient_privilege.
--   4. ALTER FUNCTION ... OWNER TO roadsen_auth sur les 3 nouvelles fonctions
--      (comme 0007 §4.3) : c'est ce qui rend la barrière B1 réelle (le DEFINER
--      s'exécute avec le privilège identité de roadsen_auth, pas celui de
--      l'appelant).
--
--  ADDITIVE / NON DESTRUCTIVE sur les données (ADD COLUMN, CREATE OR REPLACE).
--  IDEMPOTENTE (ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, GRANT, ALTER OWNER).
--  Reversible : voir down.sql (DROP des 3 fonctions, restauration de
--  auth_user_has_membership sans le filtre, DROP COLUMN is_active).
-- =====================================================================

-- ---------------------------------------------------------------------
-- (a) Colonne is_active (suspension sans suppression). DEFAULT true : les
--     membres existants restent actifs. NOT NULL (le filtre RLS/lookup compare
--     `= true`, jamais NULL).
-- ---------------------------------------------------------------------
ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------
-- (b) PATCH auth_user_has_membership : un membre SUSPENDU ne porte plus de rôle.
--
--  Forme 0007 CONSERVÉE (plpgsql + drapeau `app.auth_bootstrap`) : le TenantGuard
--  appelle cette fonction « à froid » (avant tout app.current_org). Le drapeau
--  ouvre la branche RLS d'identité ; sans lui, la lecture de memberships
--  renverrait 0 ligne. On AJOUTE uniquement le filtre `AND m.is_active = true`.
--  CREATE OR REPLACE préserve l'owner (roadsen_auth) et les GRANT EXECUTE.
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
    WHERE m."user_id" = p_user_id
      AND m."org_id"  = p_org_id
      AND m."is_active" = true          -- <-- AJOUT : un membre suspendu ne porte plus de rôle
    LIMIT 1;
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- (c) provision_member — attache un membre (rôle ≠ OWNER) à une org EXISTANTE.
--
--  Miroir de provision_org (0007) : DEFINER, drapeau posé/fermé, org injectée
--  SERVEUR via p_org_id (jamais une identité cliente — leçon #42 ; l'org vient du
--  path param validé côté route, le user d'un compte existant). OWNER est INTERDIT
--  par cette voie (l'unicité de l'OWNER se gère à la création d'org / transfert
--  explicite). L'@@unique(org_id,user_id) lève 23505 sur un ré-ajout -> 409 propre
--  côté service. Restaure contexte + drapeau sur tous les chemins de sortie.
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
-- (d) set_member_active — suspend/réactive un membre, ANTI-LOCKOUT du dernier
--     OWNER actif.
--
--  DEFINER + drapeau `app.auth_bootstrap` (correction vs cadrage : sans lui, les
--  accès à memberships sous RLS, hors app.current_org, ne verraient aucune ligne).
--  Le drapeau ouvre la branche identité ; le WHERE explicite (org_id, user_id)
--  garantit qu'AUCUNE ligne d'un autre tenant n'est touchée. RAISE distincts
--  (introuvable / anti-lockout) que le service mappe en 404 / 409.
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

  -- Anti-lockout : on ne suspend jamais le DERNIER OWNER actif (l'org resterait
  -- sans propriétaire capable d'agir). SÛR EN CONCURRENCE (revue sécurité) : on
  -- VERROUILLE les lignes OWNER actives (FOR UPDATE dans la sous-requête) AVANT de
  -- compter -> deux suspensions concurrentes de 2 OWNER distincts se sérialisent (pas
  -- de TOCTOU laissant l'org sans OWNER). Inatteignable en P1 (1 seul OWNER/org, aucun
  -- moyen d'en créer un 2e), mais gravé pour la Phase 2 (multi-OWNER / transfert).
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

  UPDATE "memberships" SET "is_active" = p_active
  WHERE "org_id" = p_org_id AND "user_id" = p_user_id;

  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- (e) list_org_members — liste des membres d'une org (identité) pour le
--     back-office SUPERADMIN.
--
--  DEFINER + drapeau : lit memberships JOIN users (deux tables d'identité que
--  roadsen_app ne peut PAS lire en requête ordinaire, barrière B1). Périmètre
--  STRICT : filtré sur p_org_id, colonnes minimales (identité des membres de CETTE
--  org), aucune énumération inter-tenant. Le comptage d'usage mensuel N'EST PAS ici
--  (usage_ledger = table de DONNÉES, lue par le service via withTenant sous
--  roadsen_app) : on ne mélange pas lecture d'identité et de données dans un même
--  DEFINER (séparation identité/données, cf. 0007). Renvoie AUSSI les membres
--  suspendus (is_active=false) — le back-office doit les voir pour les réactiver.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "list_org_members"(p_org_id uuid)
RETURNS TABLE (
  user_id   uuid,
  email     text,
  full_name text,
  role      "Role",
  is_active boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);
  RETURN QUERY
    SELECT m."user_id", u."email", u."full_name", m."role", m."is_active"
    FROM "memberships" m
    JOIN "users" u ON u."id" = m."user_id"
    WHERE m."org_id" = p_org_id
    ORDER BY m."created_at" ASC;
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- Privilèges. set_member_active fait un UPDATE sur memberships : roadsen_auth
-- n'avait que SELECT/INSERT (0007) -> on ajoute UPDATE (contenu : seul roadsen_auth
-- l'obtient ; roadsen_app reste sans DML direct sur l'identité). Puis on transfère
-- la propriété des 3 fonctions à roadsen_auth (barrière B1) et on réserve EXECUTE
-- à roadsen_app.
-- ---------------------------------------------------------------------
GRANT UPDATE ON "memberships" TO "roadsen_auth";

ALTER FUNCTION "provision_member"(uuid, uuid, "Role")    OWNER TO "roadsen_auth";
ALTER FUNCTION "set_member_active"(uuid, uuid, boolean)  OWNER TO "roadsen_auth";
ALTER FUNCTION "list_org_members"(uuid)                  OWNER TO "roadsen_auth";

REVOKE ALL ON FUNCTION "provision_member"(uuid, uuid, "Role")    FROM PUBLIC;
REVOKE ALL ON FUNCTION "set_member_active"(uuid, uuid, boolean)  FROM PUBLIC;
REVOKE ALL ON FUNCTION "list_org_members"(uuid)                  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "provision_member"(uuid, uuid, "Role")    TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "set_member_active"(uuid, uuid, boolean)  TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "list_org_members"(uuid)                  TO "roadsen_app";
