-- =====================================================================
--  ROADSEN — PREUVE AUTOPORTANTE du modele 0007 (DEUX barrieres, SANS BYPASSRLS),
--            sous DEUX roles NON-superuser / NON-BYPASSRLS (SIMULATION RENDER).
--
--  BUT : prouver, en psql, que le modele tient quand :
--    - render_owner (owner des tables + DEFINER, SEUL detenteur du DML identite),
--      et render_app (runtime : DONNEES seulement, AUCUN privilege identite),
--    sont tous deux NON-superuser et NON-BYPASSRLS (profil managed Render).
--
--  Correctif revue adverse :
--    B1/B2 : le drapeau seul ne suffit pas -> on PROUVE que render_app, en posant
--            le drapeau a la main, NE LIT AUCUN hash d'autrui (refus de privilege).
--    M2    : auth_user_has_membership marche A FROID (lookup TenantGuard).
--
--  USAGE (local, base de recette ; PAS la prod) :
--    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f PROOF_render_simulation.sql
--  Le role d'execution doit pouvoir CREATE ROLE + SET ROLE. Les ASSERTIONS metier/
--  fuite s'executent SOUS render_app (SET ROLE), JAMAIS en superuser.
--
--  "PREUVE OK" final = succes. Toute violation -> ERREUR (ON_ERROR_STOP).
-- =====================================================================
\set ON_ERROR_STOP on

-- ---- 0) deux roles fideles a Render : NON super, NON bypass ----
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='render_owner') THEN
    CREATE ROLE render_owner LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS;
  ELSE ALTER ROLE render_owner LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='render_app') THEN
    CREATE ROLE render_app LOGIN NOSUPERUSER NOBYPASSRLS;
  ELSE ALTER ROLE render_app LOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  BEGIN GRANT render_owner TO CURRENT_USER; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN GRANT render_app   TO CURRENT_USER; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

DO $$
DECLARE s boolean; b boolean;
BEGIN
  SELECT rolsuper,rolbypassrls INTO s,b FROM pg_roles WHERE rolname='render_owner';
  IF s OR b THEN RAISE EXCEPTION 'render_owner doit etre non-super non-bypass'; END IF;
  SELECT rolsuper,rolbypassrls INTO s,b FROM pg_roles WHERE rolname='render_app';
  IF s OR b THEN RAISE EXCEPTION 'render_app doit etre non-super non-bypass'; END IF;
END $$;

-- ---- 1) schema possede par render_owner + modele 0007 ----
DROP SCHEMA IF EXISTS rls0007_proof CASCADE;
CREATE SCHEMA rls0007_proof AUTHORIZATION render_owner;
SET ROLE render_owner;
SET search_path = rls0007_proof, pg_catalog;

CREATE TABLE organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, slug text UNIQUE);
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE, password_hash text, full_name text);
CREATE TABLE memberships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE, role text, UNIQUE(org_id,user_id));
CREATE TABLE projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE, name text);

CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE v text := current_setting('app.current_org',true);
BEGIN IF v IS NULL OR length(btrim(v))=0 THEN RAISE EXCEPTION 'app.current_org non defini' USING ERRCODE='R0001'; END IF; RETURN v::uuid; END;$f$;
CREATE FUNCTION app_current_org_or_null() RETURNS uuid LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE v text := current_setting('app.current_org',true);
BEGIN IF v IS NULL OR length(btrim(v))=0 THEN RETURN NULL; END IF; RETURN v::uuid; END;$f$;
CREATE FUNCTION app_auth_bootstrap() RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE v text := current_setting('app.auth_bootstrap',true);
BEGIN RETURN v IS NOT NULL AND v='on'; END;$f$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY; ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE users         ENABLE ROW LEVEL SECURITY; ALTER TABLE users         FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships   ENABLE ROW LEVEL SECURITY; ALTER TABLE memberships   FORCE ROW LEVEL SECURITY;
ALTER TABLE projects      ENABLE ROW LEVEL SECURITY; ALTER TABLE projects      FORCE ROW LEVEL SECURITY;

CREATE POLICY ti ON organizations USING (id=app_current_org_or_null() OR app_auth_bootstrap()) WITH CHECK (id=app_current_org_or_null() OR app_auth_bootstrap());
CREATE POLICY ti ON memberships   USING (org_id=app_current_org_or_null() OR app_auth_bootstrap()) WITH CHECK (org_id=app_current_org_or_null() OR app_auth_bootstrap());
CREATE POLICY ti ON users USING (app_auth_bootstrap() OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=users.id AND m.org_id=app_current_org_or_null()))
                          WITH CHECK (app_auth_bootstrap() OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=users.id AND m.org_id=app_current_org_or_null()));
CREATE POLICY ti ON projects USING (org_id=app_current_org()) WITH CHECK (org_id=app_current_org());

CREATE FUNCTION provision_user(p_email text, p_hash text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=rls0007_proof,pg_catalog AS $f$
DECLARE v uuid := gen_random_uuid();
BEGIN PERFORM set_config('app.auth_bootstrap','on',true);
  INSERT INTO users(id,email,password_hash,full_name)
  VALUES (v, lower(btrim(p_email)), p_hash, 'Nom ' || lower(btrim(p_email)));
  PERFORM set_config('app.auth_bootstrap','off',true); RETURN v;
EXCEPTION WHEN OTHERS THEN PERFORM set_config('app.auth_bootstrap','off',true); RAISE; END;$f$;

CREATE FUNCTION auth_find_user_by_email(p_email text) RETURNS TABLE(id uuid, password_hash text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=rls0007_proof,pg_catalog AS $f$
BEGIN PERFORM set_config('app.auth_bootstrap','on',true);
  RETURN QUERY SELECT u.id,u.password_hash FROM users u WHERE u.email=lower(btrim(p_email)) LIMIT 1;
  PERFORM set_config('app.auth_bootstrap','off',true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('app.auth_bootstrap','off',true); RAISE; END;$f$;

CREATE FUNCTION auth_user_has_membership(p_user uuid, p_org uuid) RETURNS TABLE(role text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=rls0007_proof,pg_catalog AS $f$
BEGIN PERFORM set_config('app.auth_bootstrap','on',true);
  RETURN QUERY SELECT m.role FROM memberships m WHERE m.user_id=p_user AND m.org_id=p_org LIMIT 1;
  PERFORM set_config('app.auth_bootstrap','off',true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('app.auth_bootstrap','off',true); RAISE; END;$f$;

CREATE FUNCTION provision_org(p_name text, p_slug text, p_owner uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=rls0007_proof,pg_catalog AS $f$
DECLARE v uuid := gen_random_uuid(); prev text := COALESCE(current_setting('app.current_org',true),'');
BEGIN PERFORM set_config('app.auth_bootstrap','on',true); PERFORM set_config('app.current_org',v::text,true);
  INSERT INTO organizations(id,name,slug) VALUES (v,p_name,p_slug);
  INSERT INTO memberships(org_id,user_id,role) VALUES (v,p_owner,'OWNER');
  PERFORM set_config('app.current_org',prev,true); PERFORM set_config('app.auth_bootstrap','off',true); RETURN v;
EXCEPTION WHEN OTHERS THEN PERFORM set_config('app.current_org',prev,true); PERFORM set_config('app.auth_bootstrap','off',true); RAISE; END;$f$;

-- pv_emitter_context : identite a sceller dans un PV (org slug/nom + nom emetteur)
CREATE FUNCTION pv_emitter_context(p_org uuid, p_user uuid)
  RETURNS TABLE(org_slug text, org_name text, emitter_full_name text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=rls0007_proof,pg_catalog AS $f$
BEGIN PERFORM set_config('app.auth_bootstrap','on',true);
  RETURN QUERY SELECT o.slug, o.name, u.full_name FROM organizations o
               CROSS JOIN users u WHERE o.id=p_org AND u.id=p_user LIMIT 1;
  PERFORM set_config('app.auth_bootstrap','off',true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('app.auth_bootstrap','off',true); RAISE; END;$f$;

-- GRANTs SEPARES : render_app = DONNEES + EXECUTE seulement ; AUCUN privilege identite.
GRANT USAGE ON SCHEMA rls0007_proof TO render_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO render_app;
GRANT EXECUTE ON FUNCTION provision_user(text,text)           TO render_app;
GRANT EXECUTE ON FUNCTION auth_find_user_by_email(text)       TO render_app;
GRANT EXECUTE ON FUNCTION auth_user_has_membership(uuid,uuid) TO render_app;
GRANT EXECUTE ON FUNCTION provision_org(text,text,uuid)       TO render_app;
GRANT EXECUTE ON FUNCTION pv_emitter_context(uuid,uuid)       TO render_app;
GRANT EXECUTE ON FUNCTION app_current_org()                   TO render_app;
GRANT EXECUTE ON FUNCTION app_current_org_or_null()           TO render_app;
GRANT EXECUTE ON FUNCTION app_auth_bootstrap()                TO render_app;

RESET ROLE;

-- =====================================================================
--  ASSERTIONS — sous render_app (le runtime, AUCUN privilege identite).
-- =====================================================================
SET ROLE render_app;
SET search_path = rls0007_proof, pg_catalog;

DO $$
DECLARE uA uuid; uB uuid; oA uuid; oB uuid; n int;
        v_slug text; v_oname text; v_full text;
BEGIN
  -- (a)+(M2) provisioning / login / membership-lookup A FROID, sous render_app ---
  uA := provision_user('alice@x.test','hA');
  uB := provision_user('victim@x.test','SECRET-VICTIM');
  oA := provision_org('A','slug-a',uA);
  oB := provision_org('B','slug-b',uB);
  SELECT count(*) INTO n FROM auth_find_user_by_email('alice@x.test');
  IF n<>1 THEN RAISE EXCEPTION '(a) login a froid casse'; END IF;
  SELECT count(*) INTO n FROM auth_user_has_membership(uA,oA);
  IF n<>1 THEN RAISE EXCEPTION '(M2) membership-lookup a froid casse'; END IF;
  SELECT count(*) INTO n FROM auth_user_has_membership(uA,oB);
  IF n<>0 THEN RAISE EXCEPTION '(M2) fuite membership cross-tenant'; END IF;

  -- (PV) SENTINELLE EMISSION : pv_emitter_context renvoie slug+nom org + nom
  -- emetteur sous render_app (sans privilege identite direct) -> emission OK.
  SELECT org_slug, org_name, emitter_full_name INTO v_slug, v_oname, v_full
  FROM pv_emitter_context(oA, uA);
  IF v_slug <> 'slug-a' OR v_oname <> 'A' OR v_full <> ('Nom alice@x.test') THEN
    RAISE EXCEPTION '(PV) pv_emitter_context valeurs inattendues : %, %, %', v_slug, v_oname, v_full;
  END IF;

  -- (B2) NEGATIF : poser le drapeau ne donne AUCUN acces identite (privilege manquant)
  PERFORM set_config('app.auth_bootstrap','on',true);
  BEGIN
    PERFORM count(*) FROM users;       -- DOIT echouer : render_app n'a pas SELECT users
    RAISE EXCEPTION '(B2) FUITE : render_app a lu users malgre l absence de privilege';
  EXCEPTION WHEN insufficient_privilege THEN NULL; -- 42501 attendu
  END;
  PERFORM set_config('app.auth_bootstrap','off',true);

  -- pose des projets par tenant (chemin tenant normal)
  PERFORM set_config('app.current_org', oA::text, true);
  INSERT INTO projects(org_id,name) VALUES (oA,'P-A');
  PERFORM set_config('app.current_org', oB::text, true);
  INSERT INTO projects(org_id,name) VALUES (oB,'P-B');

  -- (c) DONNEES sans contexte -> RAISE bruyant
  PERFORM set_config('app.current_org','',true);
  BEGIN PERFORM count(*) FROM projects; RAISE EXCEPTION '(c) attendu RAISE projects';
  EXCEPTION WHEN sqlstate 'R0001' THEN NULL; END;

  -- (b) SELECT isolation
  PERFORM set_config('app.current_org', oA::text, true);
  SELECT count(*) INTO n FROM projects WHERE name='P-B';
  IF n<>0 THEN RAISE EXCEPTION '(b) fuite SELECT cross-tenant'; END IF;
  SELECT count(*) INTO n FROM projects WHERE name='P-A';
  IF n<>1 THEN RAISE EXCEPTION '(b) orgA ne voit pas son projet'; END IF;

  -- (b) INSERT cross-org refuse
  BEGIN INSERT INTO projects(org_id,name) VALUES (oB,'fraude');
    RAISE EXCEPTION '(b) INSERT cross-org aurait du etre refuse';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
           WHEN others THEN IF SQLSTATE LIKE '42%' OR SQLSTATE='23514' THEN NULL; ELSE RAISE; END IF;
  END;

  -- (b) UPDATE aveugle
  PERFORM set_config('app.current_org', oA::text, true);
  UPDATE projects SET name='x';
  PERFORM set_config('app.current_org', oB::text, true);
  SELECT count(*) INTO n FROM projects WHERE name='P-B';
  IF n<>1 THEN RAISE EXCEPTION '(b) UPDATE a fuite vers orgB'; END IF;

  -- (b) DELETE aveugle
  PERFORM set_config('app.current_org', oA::text, true);
  DELETE FROM projects;
  PERFORM set_config('app.current_org', oB::text, true);
  SELECT count(*) INTO n FROM projects WHERE name='P-B';
  IF n<>1 THEN RAISE EXCEPTION '(b) DELETE a fuite vers orgB'; END IF;

  RAISE NOTICE 'PREUVE OK — modele 0007 (2 barrieres, sans BYPASSRLS) valide sous owner+runtime non-superuser';
END $$;

RESET ROLE;
RESET app.current_org;
RESET app.auth_bootstrap;
DROP SCHEMA IF EXISTS rls0007_proof CASCADE;
-- roles render_owner/render_app laisses en place (jetables).


-- =====================================================================
--  PARTIE 2 — SCENARIO VRAI MONO-UTILISATEUR (#42 runtime) : la connexion = le
--  PROPRIETAIRE des tables, qui fait SET ROLE vers le role applicatif.
--
--  C'est EXACTEMENT Render : un SEUL utilisateur de connexion (proprietaire des
--  objets) ; l'app bascule en `SET LOCAL ROLE mono_app` (== roadsen_app) au runtime.
--  On prouve que CE SET ROLE prive REELLEMENT le proprietaire de son privilege de
--  table (point a valider, surligne par la revue) :
--    (a) connecte/role = mono_owner (PROPRIETAIRE) -> il LIT l'identite en direct
--        (privilege owner) : on le montre pour bien isoler l'effet du SET ROLE ;
--    (b) APRES `SET ROLE mono_app` -> l'acces DIRECT a l'identite ECHOUE
--        (insufficient_privilege) MEME si la session est le proprietaire : le role
--        courant devenu mono_app n'a aucun privilege identite + RLS s'applique ;
--    (c) sous mono_app, les fonctions SECURITY DEFINER (login/membership/
--        pv_emitter_context, owned par mono_auth) FONCTIONNENT (DEFINER ignore le
--        SET ROLE de l'appelant) ;
--    (d) sous mono_app, isolation des DONNEES cross-tenant (SELECT/INSERT/UPDATE).
--
--  Le role d'execution du script doit pouvoir CREATE ROLE + etre membre de
--  mono_owner pour `SET ROLE mono_owner` (idempotent ; superuser local OK).
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mono_app') THEN
    CREATE ROLE mono_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  ELSE ALTER ROLE mono_app NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mono_auth') THEN
    CREATE ROLE mono_auth NOLOGIN NOSUPERUSER NOBYPASSRLS;
  ELSE ALTER ROLE mono_auth NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  -- LE user de connexion : proprietaire des tables, CREATEROLE, NON-super NON-bypass.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mono_owner') THEN
    CREATE ROLE mono_owner LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS;
  ELSE ALTER ROLE mono_owner LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS; END IF;
  -- mono_owner est MEMBRE de mono_app + mono_auth (=> peut SET ROLE vers eux).
  GRANT mono_app  TO mono_owner;
  GRANT mono_auth TO mono_owner;
  -- le user du script doit pouvoir SET ROLE mono_owner.
  BEGIN GRANT mono_owner TO CURRENT_USER; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

-- garde-fou : aucun des 3 roles n'est super/bypass (sinon faux-vert).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
           WHERE rolname IN ('mono_owner','mono_app','mono_auth') LOOP
    IF r.rolsuper OR r.rolbypassrls THEN
      RAISE EXCEPTION '% ne doit etre ni super ni bypass', r.rolname;
    END IF;
  END LOOP;
END $$;

-- ---- schema POSSEDE par mono_owner (la connexion) + modele 0007 ----
DROP SCHEMA IF EXISTS rls0007_mono CASCADE;
CREATE SCHEMA rls0007_mono AUTHORIZATION mono_owner;
SET ROLE mono_owner;                       -- on est DESORMAIS le proprietaire (= la connexion Render)
SET search_path = rls0007_mono, pg_catalog;

CREATE TABLE organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, slug text UNIQUE);
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE, password_hash text, full_name text);
CREATE TABLE memberships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE, role text, UNIQUE(org_id,user_id));
CREATE TABLE projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE, name text);

CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE v text := current_setting('app.current_org',true);
BEGIN IF v IS NULL OR length(btrim(v))=0 THEN RAISE EXCEPTION 'app.current_org non defini' USING ERRCODE='R0001'; END IF; RETURN v::uuid; END;$f$;
CREATE FUNCTION app_current_org_or_null() RETURNS uuid LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE v text := current_setting('app.current_org',true);
BEGIN IF v IS NULL OR length(btrim(v))=0 THEN RETURN NULL; END IF; RETURN v::uuid; END;$f$;
CREATE FUNCTION app_auth_bootstrap() RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE v text := current_setting('app.auth_bootstrap',true);
BEGIN RETURN v IS NOT NULL AND v='on'; END;$f$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY; ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE users         ENABLE ROW LEVEL SECURITY; ALTER TABLE users         FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships   ENABLE ROW LEVEL SECURITY; ALTER TABLE memberships   FORCE ROW LEVEL SECURITY;
ALTER TABLE projects      ENABLE ROW LEVEL SECURITY; ALTER TABLE projects      FORCE ROW LEVEL SECURITY;

CREATE POLICY ti ON organizations USING (id=app_current_org_or_null() OR app_auth_bootstrap()) WITH CHECK (id=app_current_org_or_null() OR app_auth_bootstrap());
CREATE POLICY ti ON memberships   USING (org_id=app_current_org_or_null() OR app_auth_bootstrap()) WITH CHECK (org_id=app_current_org_or_null() OR app_auth_bootstrap());
CREATE POLICY ti ON users USING (app_auth_bootstrap() OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=users.id AND m.org_id=app_current_org_or_null()))
                          WITH CHECK (app_auth_bootstrap() OR EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=users.id AND m.org_id=app_current_org_or_null()));
CREATE POLICY ti ON projects USING (org_id=app_current_org()) WITH CHECK (org_id=app_current_org());

CREATE FUNCTION provision_user(p_email text, p_hash text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=rls0007_mono,pg_catalog AS $f$
DECLARE v uuid := gen_random_uuid();
BEGIN PERFORM set_config('app.auth_bootstrap','on',true);
  INSERT INTO users(id,email,password_hash,full_name) VALUES (v, lower(btrim(p_email)), p_hash, 'Nom '||lower(btrim(p_email)));
  PERFORM set_config('app.auth_bootstrap','off',true); RETURN v;
EXCEPTION WHEN OTHERS THEN PERFORM set_config('app.auth_bootstrap','off',true); RAISE; END;$f$;

CREATE FUNCTION auth_find_user_by_email(p_email text) RETURNS TABLE(id uuid, password_hash text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=rls0007_mono,pg_catalog AS $f$
BEGIN PERFORM set_config('app.auth_bootstrap','on',true);
  RETURN QUERY SELECT u.id,u.password_hash FROM users u WHERE u.email=lower(btrim(p_email)) LIMIT 1;
  PERFORM set_config('app.auth_bootstrap','off',true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('app.auth_bootstrap','off',true); RAISE; END;$f$;

CREATE FUNCTION auth_user_has_membership(p_user uuid, p_org uuid) RETURNS TABLE(role text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=rls0007_mono,pg_catalog AS $f$
BEGIN PERFORM set_config('app.auth_bootstrap','on',true);
  RETURN QUERY SELECT m.role FROM memberships m WHERE m.user_id=p_user AND m.org_id=p_org LIMIT 1;
  PERFORM set_config('app.auth_bootstrap','off',true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('app.auth_bootstrap','off',true); RAISE; END;$f$;

CREATE FUNCTION provision_org(p_name text, p_slug text, p_owner uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=rls0007_mono,pg_catalog AS $f$
DECLARE v uuid := gen_random_uuid(); prev text := COALESCE(current_setting('app.current_org',true),'');
BEGIN PERFORM set_config('app.auth_bootstrap','on',true); PERFORM set_config('app.current_org',v::text,true);
  INSERT INTO organizations(id,name,slug) VALUES (v,p_name,p_slug);
  INSERT INTO memberships(org_id,user_id,role) VALUES (v,p_owner,'OWNER');
  PERFORM set_config('app.current_org',prev,true); PERFORM set_config('app.auth_bootstrap','off',true); RETURN v;
EXCEPTION WHEN OTHERS THEN PERFORM set_config('app.current_org',prev,true); PERFORM set_config('app.auth_bootstrap','off',true); RAISE; END;$f$;

CREATE FUNCTION pv_emitter_context(p_org uuid, p_user uuid)
  RETURNS TABLE(org_slug text, org_name text, emitter_full_name text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=rls0007_mono,pg_catalog AS $f$
BEGIN PERFORM set_config('app.auth_bootstrap','on',true);
  RETURN QUERY SELECT o.slug,o.name,u.full_name FROM organizations o CROSS JOIN users u WHERE o.id=p_org AND u.id=p_user LIMIT 1;
  PERFORM set_config('app.auth_bootstrap','off',true);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('app.auth_bootstrap','off',true); RAISE; END;$f$;

-- ===== modele 0007 : DEFINER owned par mono_auth ; DML identite a mono_auth ;
--       mono_app = DONNEES seulement, AUCUN privilege identite =====
--
-- PRE-REQUIS DES ALTER OWNER (miroir EXACT de la chaine reelle 0004) : pour
-- reattribuer une fonction a mono_auth, mono_auth DOIT avoir CREATE sur le schema
-- qui la contient. On pose donc USAGE+CREATE AVANT les ALTER OWNER (sans CREATE :
-- « permission denied for schema rls0007_mono » sous un executant non-superuser).
GRANT USAGE, CREATE ON SCHEMA rls0007_mono TO mono_auth;
GRANT USAGE          ON SCHEMA rls0007_mono TO mono_app;
GRANT SELECT, INSERT ON organizations, memberships, users TO mono_auth;  -- identite -> mono_auth
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO mono_app;            -- donnees -> mono_app

ALTER FUNCTION provision_user(text,text)          OWNER TO mono_auth;
ALTER FUNCTION auth_find_user_by_email(text)      OWNER TO mono_auth;
ALTER FUNCTION auth_user_has_membership(uuid,uuid) OWNER TO mono_auth;
ALTER FUNCTION provision_org(text,text,uuid)      OWNER TO mono_auth;
ALTER FUNCTION pv_emitter_context(uuid,uuid)      OWNER TO mono_auth;
GRANT EXECUTE ON FUNCTION provision_user(text,text)           TO mono_app;
GRANT EXECUTE ON FUNCTION auth_find_user_by_email(text)       TO mono_app;
GRANT EXECUTE ON FUNCTION auth_user_has_membership(uuid,uuid) TO mono_app;
GRANT EXECUTE ON FUNCTION provision_org(text,text,uuid)       TO mono_app;
GRANT EXECUTE ON FUNCTION pv_emitter_context(uuid,uuid)       TO mono_app;
GRANT EXECUTE ON FUNCTION app_current_org()                   TO mono_app;
GRANT EXECUTE ON FUNCTION app_current_org_or_null()           TO mono_app;
GRANT EXECUTE ON FUNCTION app_auth_bootstrap()                TO mono_app;

-- IMPORTANT : on reste connecte/role = mono_owner (LE PROPRIETAIRE = la connexion
-- Render). On NE seede PAS via un superuser : c'est le proprietaire qui seede via
-- les DEFINER (owned mono_auth), exactement comme l'app en prod.

DO $$
DECLARE uA uuid; uB uuid; oA uuid; oB uuid; n int; v_slug text; v_name text; v_full text;
BEGIN
  -- contexte : on EST mono_owner (proprietaire). On bootstrappe via les DEFINER.
  uA := provision_user('alice@x.test','hA');
  uB := provision_user('victim@x.test','SECRET-VICTIM');
  oA := provision_org('A','slug-a',uA);
  oB := provision_org('B','slug-b',uB);
  PERFORM set_config('app.current_org', oA::text, true);
  INSERT INTO projects(org_id,name) VALUES (oA,'P-A');
  PERFORM set_config('app.current_org', oB::text, true);
  INSERT INTO projects(org_id,name) VALUES (oB,'P-B');
  PERFORM set_config('app.current_org','',true);

  -- (a) PROPRIETAIRE : un acces DIRECT a l'identite REUSSIT (privilege owner) ->
  --     c'est PRECISEMENT le risque mono-utilisateur que SET ROLE doit neutraliser.
  PERFORM set_config('app.auth_bootstrap','on',true); -- (owner soumis a FORCE RLS : besoin du drapeau pour voir)
  SELECT count(*) INTO n FROM users;
  PERFORM set_config('app.auth_bootstrap','off',true);
  IF n < 2 THEN RAISE EXCEPTION '(a) le proprietaire devrait lire l identite en direct (n=%)', n; END IF;
END $$;

-- (b)(c)(d) APRES bascule applicative : SET ROLE mono_app (== runtime withTenant/asAppRole)
SET ROLE mono_app;
SET search_path = rls0007_mono, pg_catalog;

DO $$
DECLARE n int; uA uuid; oNew uuid; v_slug text; v_name text; v_full text;
BEGIN
  -- (b) acces DIRECT a l'identite REFUSE meme si la SESSION est le proprietaire :
  --     le role COURANT est mono_app (sans privilege identite) -> 42501, AVANT la RLS.
  PERFORM set_config('app.auth_bootstrap','on',true); -- meme en posant le drapeau...
  BEGIN
    PERFORM count(*) FROM users;            -- ...le privilege manque -> insufficient_privilege
    RAISE EXCEPTION '(b) FUITE : sous SET ROLE mono_app, lecture directe users a reussi';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('app.auth_bootstrap','off',true);
  BEGIN PERFORM count(*) FROM organizations; RAISE EXCEPTION '(b) FUITE organizations';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM count(*) FROM memberships; RAISE EXCEPTION '(b) FUITE memberships';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- (c) les DEFINER marchent sous mono_app (DEFINER ignore le SET ROLE appelant).
  --     login a froid, puis provision d'une org + membership, puis pv_emitter_context
  --     et membership-lookup -> tout passe via mono_auth (owner des DEFINER).
  SELECT id INTO uA FROM auth_find_user_by_email('alice@x.test');
  IF uA IS NULL THEN RAISE EXCEPTION '(c) login via DEFINER casse sous mono_app'; END IF;

  oNew := provision_org('C','slug-c',uA);   -- ecriture identite via DEFINER, sous mono_app
  SELECT org_slug, org_name, emitter_full_name INTO v_slug, v_name, v_full
  FROM pv_emitter_context(oNew, uA);
  IF v_slug <> 'slug-c' OR v_full <> 'Nom alice@x.test' THEN
    RAISE EXCEPTION '(c) pv_emitter_context valeurs inattendues : %, %', v_slug, v_full;
  END IF;
  SELECT count(*) INTO n FROM auth_user_has_membership(uA, oNew);
  IF n <> 1 THEN RAISE EXCEPTION '(c) membership-lookup via DEFINER casse'; END IF;

  -- (d) isolation DONNEES sous mono_app : poser orgC, inserer un projet, ne voir que lui.
  PERFORM set_config('app.current_org', oNew::text, true);
  INSERT INTO projects(org_id,name) VALUES (oNew,'P-C');
  SELECT count(*) INTO n FROM projects;  -- ne voit que P-C (org courante)
  IF n <> 1 THEN RAISE EXCEPTION '(d) isolation donnees : attendu 1 projet, vu %', n; END IF;
  -- INSERT cross-org refuse (WITH CHECK / org differente)
  BEGIN
    INSERT INTO projects(org_id,name) VALUES (gen_random_uuid(),'fraude');
    RAISE EXCEPTION '(d) INSERT cross-org aurait du echouer';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation OR foreign_key_violation THEN NULL;
    WHEN others THEN IF SQLSTATE LIKE '42%' OR SQLSTATE IN ('23514','23503') THEN NULL; ELSE RAISE; END IF;
  END;
  -- sans contexte -> RAISE bruyant (donnees)
  PERFORM set_config('app.current_org','',true);
  BEGIN PERFORM count(*) FROM projects; RAISE EXCEPTION '(d) attendu RAISE projects sans contexte';
  EXCEPTION WHEN sqlstate 'R0001' THEN NULL; END;

  RAISE NOTICE 'PREUVE MONO-UTILISATEUR OK — SET ROLE mono_app prive le proprietaire de l acces identite ; DEFINER+isolation intacts';
END $$;

RESET ROLE;
RESET app.current_org;
RESET app.auth_bootstrap;
DROP SCHEMA IF EXISTS rls0007_mono CASCADE;
-- roles mono_* laisses en place (jetables).
