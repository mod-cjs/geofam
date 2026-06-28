-- =============================================================================
-- ROADSEN — infra/recette/init-roles.sql
-- Script FALLBACK idempotent : initialisation des rôles PostgreSQL
-- =============================================================================
--
-- QUAND UTILISER CE SCRIPT
-- ------------------------
-- Les migrations 0001 et 0004 créent les rôles PostgreSQL requis (roadsen_app,
-- roadsen_auth) via des blocs DO idempotents. Si l'utilisateur managé Render
-- n'a PAS le droit CREATEROLE, `prisma migrate deploy` échoue avec :
--   « ERROR: permission denied to create role »
--
-- Dans ce cas, exécuter CE SCRIPT EN PREMIER (avant ou après avoir relancé
-- le déploiement) dans la console SQL Render :
--   Dashboard → roadsen-db-recette → Shell → coller ce fichier.
-- Puis relancer le déploiement (Manual Deploy dans Render).
--
-- POINT CRITIQUE : roadsen_app EST NOLOGIN PAR CONCEPTION
-- --------------------------------------------------------
-- La migration 0001 crée roadsen_app avec NOLOGIN. C'est intentionnel :
-- roadsen_app est un rôle de permission SQL (GRANT DML), PAS un rôle de
-- connexion. En production managée Render, la connexion Prisma se fait via
-- l'utilisateur managé `roadsen` (le propriétaire des tables, fourni par
-- Render dans DATABASE_URL). roadsen_app n'apparaît PAS dans DATABASE_URL.
--
-- roadsen_auth est aussi NOLOGIN : c'est le propriétaire des fonctions
-- SECURITY DEFINER d'auth/bootstrap (provision_org, auth_find_user_by_email,
-- auth_user_has_membership, auth_get_platform_role). Il ne se connecte jamais
-- directement ; il porte uniquement le BYPASSRLS nécessaire aux fonctions DEFINER.
--
-- IDEMPOTENCE
-- -----------
-- Chaque bloc DO vérifie l'existence du rôle avant de le créer ou modifier.
-- Ce script peut être rejoué sans risque.
--
-- Ce script reproduit EXACTEMENT ce que font les migrations 0001 et 0004.
-- En cas de divergence avec les migrations, les migrations font autorité.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) roadsen_app — rôle applicatif runtime (migration 0001)
--    NOLOGIN : pas de surface de connexion directe.
--    NOBYPASSRLS : soumis à toutes les policies RLS (isolation garantie).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roadsen_app') THEN
    CREATE ROLE roadsen_app NOLOGIN NOBYPASSRLS;
  ELSE
    -- Garantit l'absence de BYPASSRLS même si le rôle préexistait.
    ALTER ROLE roadsen_app NOBYPASSRLS;
  END IF;
END
$$;

-- Accès au schéma TO roadsen_app. DML SUR LES TABLES DE DONNÉES SEULEMENT.
-- BARRIÈRE 1 (modèle 0007) : roadsen_app N'A PLUS de DML direct sur l'IDENTITÉ
-- (users/memberships/organizations) — il ne les touche que via les DEFINER. Il
-- garde le DML sur les tables de données (projects + calc_results/pv_counters/
-- official_pvs côté 0006).
GRANT USAGE ON SCHEMA public TO roadsen_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO roadsen_app;
-- Au cas où un GRANT identité résiduel (0001) subsisterait, on le RETIRE.
REVOKE SELECT, INSERT, UPDATE, DELETE
  ON organizations, users, memberships
  FROM roadsen_app;
-- Droits par défaut pour les futures tables créées par le propriétaire.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO roadsen_app;

-- ---------------------------------------------------------------------------
-- 2) roadsen_auth — owner des DEFINER, NON-BYPASSRLS (modèle 0007).
--
--    HISTORIQUE : 0004 créait roadsen_auth ... BYPASSRLS. Or sur Postgres MANAGÉ
--    (Render), l'utilisateur applicatif a CREATEROLE mais PAS BYPASSRLS :
--    « CREATE ROLE ... BYPASSRLS » échoue (42501). C'était l'attribut BYPASSRLS,
--    et lui seul, qui bloquait — PAS le CREATE ROLE.
--
--    MODÈLE 0007 : roadsen_auth reste, mais NON-BYPASSRLS. Il est :
--      - propriétaire des 6 fonctions SECURITY DEFINER d'auth/bootstrap ;
--      - SEUL détenteur du GRANT SELECT/INSERT sur les 3 tables d'IDENTITÉ.
--    Le franchissement de la RLS d'identité ne vient PLUS de BYPASSRLS mais de la
--    conjonction : (a) la fonction DEFINER s'exécute avec le privilège de table de
--    roadsen_auth + (b) elle pose le drapeau fail-closed app.auth_bootstrap qui
--    ouvre la branche RLS d'identité. Les deux sont requis. roadsen_app (qui peut
--    poser le drapeau) N'A PAS le privilège de table -> ne lit/écrit rien.
--    Les tables de DONNÉES restent org-scope strict, sans drapeau.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roadsen_auth') THEN
    CREATE ROLE roadsen_auth NOLOGIN NOSUPERUSER NOBYPASSRLS;
  ELSE
    -- garantit l'ABSENCE de BYPASSRLS même si le rôle préexistait (0004 partielle).
    ALTER ROLE roadsen_auth NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

-- roadsen_auth : accès schéma + DML d'identité (ce que les DEFINER touchent).
-- CREATE (pas seulement USAGE) : requis pour les ALTER FUNCTION ... OWNER TO
-- roadsen_auth de la chaîne (réattribuer un objet à un rôle exige que ce rôle ait
-- CREATE sur le schéma contenant l'objet).
GRANT USAGE, CREATE ON SCHEMA public TO roadsen_auth;
GRANT SELECT, INSERT ON organizations, memberships, users TO roadsen_auth;

-- ---------------------------------------------------------------------------
-- 3) APPARTENANCE DU USER DE CONNEXION (mono-utilisateur managed) — #42 runtime.
--    Le user de connexion (CURRENT_USER) doit être MEMBRE de roadsen_app (pour
--    `SET LOCAL ROLE roadsen_app` au runtime = barrière B1) ET de roadsen_auth
--    (pour `ALTER FUNCTION ... OWNER TO roadsen_auth` en migration). PG16+ :
--    GRANT role TO member confère l'option SET par défaut (SET ROLE autorisé).
-- ---------------------------------------------------------------------------
GRANT roadsen_app  TO CURRENT_USER;
GRANT roadsen_auth TO CURRENT_USER;

-- ---------------------------------------------------------------------------
-- NOTE : GRANT EXECUTE sur les fonctions DEFINER
-- ---------------------------------------------------------------------------
-- Les migrations 0002/0003/0004/0005 accordent EXECUTE sur chaque fonction à
-- roadsen_app (et révoquent PUBLIC). Ces GRANTs ne peuvent être rejoués ici
-- que si les fonctions existent déjà (créées par une migration partielle).
-- Si ce script est exécuté AVANT toute migration, ces GRANTs sont inutiles
-- (les fonctions n'existent pas encore) — ils seront posés par les migrations.
-- Si ce script est exécuté APRÈS les migrations, ils sont déjà posés.
-- Ce bloc est donc présentatif (non exécuté si les fonctions sont absentes).
--
-- Pour vérifier :
--   SELECT proname FROM pg_proc WHERE proname IN (
--     'provision_org', 'auth_find_user_by_email',
--     'auth_user_has_membership', 'auth_get_platform_role', 'app_current_org',
--     'provision_user', 'auth_get_user_profile'
--   );
-- Si les fonctions sont présentes et que les GRANTs manquent, exécuter :
--   GRANT EXECUTE ON FUNCTION provision_org(text, text, uuid) TO roadsen_app;
--   GRANT EXECUTE ON FUNCTION auth_find_user_by_email(text) TO roadsen_app;
--   GRANT EXECUTE ON FUNCTION auth_user_has_membership(uuid, uuid) TO roadsen_app;
--   GRANT EXECUTE ON FUNCTION auth_get_platform_role(uuid) TO roadsen_app;
--   GRANT EXECUTE ON FUNCTION app_current_org() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION provision_user(text, text, text) TO roadsen_app;
--   GRANT EXECUTE ON FUNCTION auth_get_user_profile(uuid) TO roadsen_app;
-- ---------------------------------------------------------------------------

-- Vérification finale (sortie dans la console Render).
SELECT
  rolname,
  rolcanlogin   AS "LOGIN",
  rolbypassrls  AS "BYPASSRLS",
  rolsuper      AS "SUPERUSER"
FROM pg_roles
WHERE rolname IN ('roadsen_app', 'roadsen_auth')
ORDER BY rolname;
-- Résultat attendu (modèle 0007) :
--  rolname      | LOGIN | BYPASSRLS | SUPERUSER
--  -------------|-------|-----------|----------
--  roadsen_app  | f     | f         | f
--  roadsen_auth | f     | f         | f   <-- NON-BYPASSRLS (différence vs 0004)
