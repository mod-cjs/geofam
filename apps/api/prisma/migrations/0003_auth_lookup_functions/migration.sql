-- =====================================================================
--  ROADSEN — Migration 0003 : fonctions de lookup pour l'authentification
--                             (#41 Auth + RBAC), SECURITY DEFINER, lecture seule
--
--  PROBLEME RESOLU
--  ---------------
--  Depuis 0002, "users" est sous RLS FORCE : un user n'est visible que s'il
--  PARTAGE un membership avec app.current_org. Or l'authentification a lieu
--  AVANT tout contexte tenant :
--    - login : on cherche un user PAR EMAIL, sans org connue -> RLS users le
--      masque (aucun membership sur un org non encore pose) -> lookup impossible.
--    - resolution du tenant : il faut verifier que le user (sub du JWT) possede
--      un membership dans l'org DEMANDEE *avant* de poser app.current_org. Lire
--      ce membership "a froid" sous RLS est circulaire (memberships scopee par
--      app.current_org, qu'on n'a justement pas encore le droit de poser).
--
--  Le runtime (roadsen_app, NOBYPASSRLS) ne peut donc PAS faire ces lectures
--  via des requetes ordinaires. On expose deux fonctions SECURITY DEFINER
--  STRICTEMENT EN LECTURE, au perimetre minimal, sur le modele de provision_org
--  (0002) : voie sanctionnee, auditable, sans role BYPASSRLS ad hoc ni superuser
--  au runtime.
--
--  PERIMETRE / FUITE
--  -----------------
--  Ces fonctions contournent la RLS users/memberships PAR CONCEPTION (DEFINER).
--  On limite donc ce qu'elles renvoient au strict besoin du flux d'auth :
--    - auth_find_user_by_email : 1 ligne pour 1 email exact, colonnes id /
--      password_hash / is_active uniquement. Pas de listing, pas de PII au-dela
--      du hash necessaire a la verification. L'email est deja connu de
--      l'appelant (il vient de le saisir), donc aucune enumeration nouvelle.
--    - auth_user_has_membership : booleen + role pour 1 couple (user, org). Ne
--      renvoie aucune donnee d'un autre tenant ; juste "ce user est-il membre de
--      cet org, et avec quel role".
--  Aucune des deux ne permet d'ENUMERER les users/orgs : il faut fournir l'email
--  (login) ou un couple (userId, orgId) deja en main (issu du JWT verifie).
--
--  search_path FIGE (anti-hijack DEFINER) — meme protection que provision_org.
--  EXECUTE revoque a PUBLIC, accorde a roadsen_app uniquement.
--
--  ADDITIVE : aucune table, aucune donnee tenant creee/modifiee ; uniquement
--  deux fonctions. Pas de RLS a ajouter (rien de nouveau ne porte des donnees).
--  Reversible : voir down.sql. A REVOIR EN BINOME ingenieur-securite (DEFINER +
--  contournement RLS = zone critique).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) auth_find_user_by_email — lookup d'authentification par email
--
--  Renvoie au plus une ligne (email UNIQUE). Colonnes minimales pour le login.
--  is_active permet de refuser un compte desactive SANS oracle (l'appelant
--  renvoie une erreur generique quelle que soit la cause).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "auth_find_user_by_email"(p_email text)
RETURNS TABLE (id uuid, password_hash text, is_active boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u."id", u."password_hash", u."is_active"
  FROM "users" u
  WHERE u."email" = lower(btrim(p_email))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION "auth_find_user_by_email"(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "auth_find_user_by_email"(text) TO "roadsen_app";

-- ---------------------------------------------------------------------
-- 2) auth_user_has_membership — verifie l'appartenance (user, org)
--
--  Coeur de la fermeture du trou "en-tete" : avant de poser app.current_org,
--  l'app appelle cette fonction avec le sub (JWT verifie) et l'org demandee.
--  Si aucune ligne -> 403, aucun contexte pose (fail-closed). Renvoie le role
--  tenant pour alimenter le RBAC sans seconde requete.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "auth_user_has_membership"(
  p_user_id uuid,
  p_org_id  uuid
)
RETURNS TABLE (role "Role")
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT m."role"
  FROM "memberships" m
  WHERE m."user_id" = p_user_id
    AND m."org_id"  = p_org_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION "auth_user_has_membership"(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "auth_user_has_membership"(uuid, uuid) TO "roadsen_app";

-- ---------------------------------------------------------------------
-- 3) auth_get_platform_role — role PLATEFORME (transverse) d'un user
--
--  Le platform_role (SUPERADMIN/SUPPORT, back-office STARFIRE) est porte par
--  "users" et n'est PAS lie a un tenant. Le RBAC en a besoin pour les routes
--  @Roles(SUPERADMIN/SUPPORT), or "users" est sous RLS scopee par membership :
--  illisible hors org. Cette fonction renvoie le seul platform_role pour un id
--  donne (deja issu d'un JWT verifie) — aucune autre PII, aucun listing.
--  Renvoie NULL si user inconnu OU sans role plateforme (cas nominal).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "auth_get_platform_role"(p_user_id uuid)
RETURNS "PlatformRole"
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u."platform_role"
  FROM "users" u
  WHERE u."id" = p_user_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION "auth_get_platform_role"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "auth_get_platform_role"(uuid) TO "roadsen_app";
