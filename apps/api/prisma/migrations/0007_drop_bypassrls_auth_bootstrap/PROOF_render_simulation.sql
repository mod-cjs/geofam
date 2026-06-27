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
