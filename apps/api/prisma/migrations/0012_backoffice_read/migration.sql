-- =====================================================================
--  ROADSEN — Migration 0012 : back-office SUPERADMIN, console de LECTURE (Lot 1)
--
--  ROADSEN-MIGRATION-REVIEWED: dev-backend (build) — EN ATTENTE revue
--  ingenieur-securite (3 DEFINER de lecture cross-tenant sur l'IDENTITE).
--  Cf. docs/cadrage-backoffice.md §1.1.
--
--  CONTEXTE
--  --------
--  Le back-office STARFIRE (SUPERADMIN) doit LIRE, cross-tenant, l'inventaire des
--  organisations et des utilisateurs de la plateforme (console d'ops read-first,
--  Lot 1). Or users/organizations/memberships sont sous FORCE RLS et leur SELECT
--  est reserve a roadsen_auth (barriere B1, 0007) : le runtime roadsen_app
--  (NOBYPASSRLS) ne les lit QUE via des fonctions SECURITY DEFINER auditees. On
--  ajoute donc 3 fonctions de LECTURE PURE, sur le patron EXACT de list_org_members
--  (0011) : owned roadsen_auth, drapeau `app.auth_bootstrap` pose/ferme sur tous
--  les chemins de sortie, search_path fige, REVOKE PUBLIC + GRANT EXECUTE
--  roadsen_app, colonnes minimales, PAGINEES / BORNEES (minimisation CDP).
--    (a) admin_list_orgs   — inventaire des orgs (identite + nb de membres) ;
--    (b) admin_get_org     — identite d'une org ;
--    (c) admin_search_users — recherche d'utilisateurs (identite + nb d'orgs).
--
--  SEPARATION IDENTITE / DONNEES (invariant 0007 — NON negocie ici)
--  ----------------------------------------------------------------
--  Le drapeau `app.auth_bootstrap` n'ouvre QUE la branche RLS des tables
--  d'IDENTITE (users, memberships, organizations). Il n'a AUCUN effet sur les
--  tables de DONNEES tenant (subscriptions, usage_ledger, projects, ...), dont la
--  policy reste `org_id = app_current_org()` SANS branche bootstrap, et dont le
--  SELECT n'est PAS accorde a roadsen_auth. En consequence :
--
--    Ces 3 fonctions ne lisent QUE de l'identite. Le RESUME D'ABONNEMENT et
--    l'USAGE d'une org (subscriptions / usage_ledger) NE SONT PAS joints ici :
--    ils restent des DONNEES tenant, lues par le service via withTenant(orgId)
--    (roadsen_app a deja le GRANT SELECT, RLS scope a l'org). C'est un ECART
--    ASSUME vs le cadrage §1.1 (« jointure organizations + subscriptions en une
--    passe ») : cette jointure violerait la separation identite/donnees de 0007
--    (subscriptions n'a ni branche bootstrap ni GRANT roadsen_auth ; sa policy
--    RAISE hors contexte tenant). Le cadrage lui-meme classe subscriptions en
--    « donnees tenant → withTenant » (§ principe directeur) : on suit l'invariant
--    fige, pas la phrase optimiste. Le service compose identite (DEFINER) + abo
--    (withTenant) — cf. admin-orgs.service.ts. A confirmer par ingenieur-securite.
--
--  ADDITIVE / NON DESTRUCTIVE : aucune table, aucune colonne, aucune donnee
--  creee/modifiee ; uniquement 3 fonctions (CREATE OR REPLACE) + leurs droits.
--  AUCUN GRANT DML nouveau (lecture pure ; roadsen_auth a deja SELECT sur les 3
--  tables d'identite depuis 0007). IDEMPOTENTE. Reversible : voir down.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- (a) admin_list_orgs — inventaire des organisations (IDENTITE seule).
--
--  Renvoie l'identite de chaque org + son NOMBRE DE MEMBRES (COUNT sur
--  memberships, table d'identite lisible sous le drapeau). Le resume d'abonnement
--  (pack/quota/consommation/date_fin) est AJOUTE par le service via withTenant
--  (donnee tenant, cf. en-tete) : il n'apparait PAS ici.
--
--  BORNAGE (minimisation + anti-abus) : p_limit est plafonne a 100 cote fonction
--  (une valeur cliente plus haute est ramenee a 100) et defaut 20 ; p_offset >= 0.
--  Filtre optionnel p_q : ILIKE sur name OU slug (NULL/vide => pas de filtre).
--  Tri stable (name, id) pour une pagination offset deterministe.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "admin_list_orgs"(
  p_limit  int  DEFAULT 20,
  p_offset int  DEFAULT 0,
  p_q      text DEFAULT NULL
)
RETURNS TABLE (
  id          uuid,
  name        text,
  slug        text,
  status      "OrgStatus",
  -- organizations.createdAt = timestamp(3) SANS fuseau (defaut Prisma DateTime, pas
  -- de @db.Timestamptz) : le type de retour DOIT correspondre (sinon « structure of
  -- query does not match function result type »). On expose donc `timestamp`, pas
  -- `timestamptz` ; le service serialise en ISO.
  created_at  timestamp,
  nb_membres  bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- plafond dur du nombre de lignes (bornage CDP) : une valeur cliente absente,
  -- <= 0 ou > 100 est ramenee dans [1, 100]. p_offset negatif => 0.
  v_limit  int := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  -- motif ILIKE : NULL/vide => pas de filtre. On echappe les jokers LIKE (%_\)
  -- d'une saisie utilisateur pour qu'ils soient traites comme des litteraux.
  v_pat    text := CASE
                     WHEN p_q IS NULL OR length(btrim(p_q)) = 0 THEN NULL
                     ELSE '%' || replace(replace(replace(btrim(p_q),
                            '\', '\\'), '%', '\%'), '_', '\_') || '%'
                   END;
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);
  RETURN QUERY
    SELECT
      o."id",
      o."name",
      o."slug",
      o."status",
      o."createdAt" AS created_at,
      count(m."id") AS nb_membres
    FROM "organizations" o
    LEFT JOIN "memberships" m ON m."org_id" = o."id"
    WHERE v_pat IS NULL
       OR o."name" ILIKE v_pat
       OR o."slug" ILIKE v_pat
    GROUP BY o."id", o."name", o."slug", o."status", o."createdAt"
    ORDER BY o."name" ASC, o."id" ASC
    LIMIT v_limit OFFSET v_offset;
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- (b) admin_get_org — identite d'UNE organisation (pour le detail composite).
--
--  Perimetre STRICT : filtre sur p_org_id, colonnes d'identite minimales. Le
--  detail complet (membres + abonnement + usage) est COMPOSE par le service :
--  cette fonction + list_org_members (0011) + withTenant (abo/usage).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "admin_get_org"(p_org_id uuid)
RETURNS TABLE (
  id          uuid,
  name        text,
  slug        text,
  status      "OrgStatus",
  created_at  timestamp  -- SANS fuseau : correspond a organizations.createdAt (cf. admin_list_orgs)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);
  RETURN QUERY
    SELECT o."id", o."name", o."slug", o."status", o."createdAt"
    FROM "organizations" o
    WHERE o."id" = p_org_id
    LIMIT 1;
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- (c) admin_search_users — recherche d'utilisateurs (IDENTITE seule).
--
--  SUPERADMIN only (route @Roles(SUPERADMIN)). Sans filtre, renvoie les premiers
--  utilisateurs (borne dure) ; avec p_q, ILIKE sur email OU full_name. Colonnes
--  minimales : id, email, full_name, platform_role, is_active + nb d'orgs
--  (COUNT sur memberships, identite lisible sous le drapeau). Aucun password_hash.
--  BORNE : p_limit plafonne a 50 (defaut 20). Tri stable (email, id).
--
--  NB oracle d'enumeration : c'est le prix d'un back-office. Le bornage + la
--  reserve @Roles(SUPERADMIN) + (Lot 2) la journalisation limitent l'abus.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "admin_search_users"(
  p_q     text DEFAULT NULL,
  p_limit int  DEFAULT 20
)
RETURNS TABLE (
  id            uuid,
  email         text,
  full_name     text,
  platform_role "PlatformRole",
  is_active     boolean,
  nb_orgs       bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit int  := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_pat   text := CASE
                    WHEN p_q IS NULL OR length(btrim(p_q)) = 0 THEN NULL
                    ELSE '%' || replace(replace(replace(btrim(p_q),
                           '\', '\\'), '%', '\%'), '_', '\_') || '%'
                  END;
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);
  RETURN QUERY
    SELECT
      u."id",
      u."email",
      u."full_name",
      u."platform_role",
      u."is_active",
      count(m."id") AS nb_orgs
    FROM "users" u
    LEFT JOIN "memberships" m ON m."user_id" = u."id"
    WHERE v_pat IS NULL
       OR u."email" ILIKE v_pat
       OR u."full_name" ILIKE v_pat
    GROUP BY u."id", u."email", u."full_name", u."platform_role", u."is_active"
    ORDER BY u."email" ASC, u."id" ASC
    LIMIT v_limit;
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- ---------------------------------------------------------------------
-- Privileges. LECTURE PURE : aucun GRANT DML nouveau. roadsen_auth detient deja
-- SELECT sur organizations/memberships/users (0007) -> les 3 DEFINER lisent sous
-- son privilege. On transfere la propriete a roadsen_auth (barriere B1 : le
-- DEFINER s'execute avec le privilege identite de roadsen_auth, pas de l'appelant)
-- et on reserve EXECUTE a roadsen_app (PUBLIC revoque).
-- ---------------------------------------------------------------------
ALTER FUNCTION "admin_list_orgs"(int, int, text)  OWNER TO "roadsen_auth";
ALTER FUNCTION "admin_get_org"(uuid)              OWNER TO "roadsen_auth";
ALTER FUNCTION "admin_search_users"(text, int)    OWNER TO "roadsen_auth";

REVOKE ALL ON FUNCTION "admin_list_orgs"(int, int, text)  FROM PUBLIC;
REVOKE ALL ON FUNCTION "admin_get_org"(uuid)              FROM PUBLIC;
REVOKE ALL ON FUNCTION "admin_search_users"(text, int)    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "admin_list_orgs"(int, int, text)  TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "admin_get_org"(uuid)              TO "roadsen_app";
GRANT EXECUTE ON FUNCTION "admin_search_users"(text, int)    TO "roadsen_app";
