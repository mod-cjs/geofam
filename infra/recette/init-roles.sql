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

-- Accès au schéma et DML sur les tables tenant (migration 0001).
GRANT USAGE ON SCHEMA public TO roadsen_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON organizations, users, memberships, projects
  TO roadsen_app;
-- Droits par défaut pour les futures tables créées par le propriétaire.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO roadsen_app;

-- ---------------------------------------------------------------------------
-- 2) roadsen_auth — rôle des fonctions SECURITY DEFINER (migration 0004)
--    NOLOGIN     : aucune surface de connexion directe.
--    NOSUPERUSER : moindre privilège — pas de superuser.
--    BYPASSRLS   : INTENTIONNEL — ces fonctions lisent/écrivent à travers
--                  les tenants PAR CONCEPTION (login à froid, bootstrap d'org).
--                  Le BYPASSRLS est circonscrit aux 4 fonctions DEFINER auditées,
--                  avec search_path figé et EXECUTE révoqué à PUBLIC.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roadsen_auth') THEN
    CREATE ROLE roadsen_auth NOLOGIN NOSUPERUSER BYPASSRLS;
  ELSE
    -- Garantit les attributs même si le rôle préexistait.
    ALTER ROLE roadsen_auth NOLOGIN NOSUPERUSER BYPASSRLS;
  END IF;
END
$$;

-- Accès au schéma et aux tables nécessaires aux fonctions DEFINER.
GRANT USAGE ON SCHEMA public TO roadsen_auth;
GRANT SELECT, INSERT ON organizations, memberships TO roadsen_auth;
GRANT SELECT ON users TO roadsen_auth;

-- ---------------------------------------------------------------------------
-- NOTE : GRANT EXECUTE sur les fonctions DEFINER
-- ---------------------------------------------------------------------------
-- Les migrations 0002/0003/0004 accordent EXECUTE sur chaque fonction à
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
--     'auth_user_has_membership', 'auth_get_platform_role', 'app_current_org'
--   );
-- Si les fonctions sont présentes et que les GRANTs manquent, exécuter :
--   GRANT EXECUTE ON FUNCTION provision_org(text, text, uuid) TO roadsen_app;
--   GRANT EXECUTE ON FUNCTION auth_find_user_by_email(text) TO roadsen_app;
--   GRANT EXECUTE ON FUNCTION auth_user_has_membership(uuid, uuid) TO roadsen_app;
--   GRANT EXECUTE ON FUNCTION auth_get_platform_role(uuid) TO roadsen_app;
--   GRANT EXECUTE ON FUNCTION app_current_org() TO PUBLIC;
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
-- Résultat attendu :
--  rolname      | LOGIN | BYPASSRLS | SUPERUSER
--  -------------|-------|-----------|----------
--  roadsen_app  | f     | f         | f
--  roadsen_auth | f     | t         | f
