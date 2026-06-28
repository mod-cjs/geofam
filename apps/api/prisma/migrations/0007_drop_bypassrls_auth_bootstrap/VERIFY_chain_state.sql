-- =====================================================================
--  ROADSEN — VERIFICATION POST-DEPLOIEMENT de la chaine 0001..0007 (schema public)
--
--  A executer APRES `prisma migrate deploy` sur la base (Render/recette), avec le
--  MEME user que le deploiement. Ce script NE MODIFIE RIEN : il ASSERTE que l'etat
--  final du schema public = exactement le modele valide par PROOF_render_simulation.
--  Toute divergence -> ERREUR (ON_ERROR_STOP) ; sinon « VERIF CHAINE OK ».
--
--  Couvre : attributs de roles, owner des 7 DEFINER, presence des helpers,
--  GRANT/REVOKE identite (roadsen_app sans DML identite ; roadsen_auth avec),
--  branche drapeau dans les policies d'identite, app_current_org() fail-closed
--  conserve sur les tables de DONNEES, pv_emitter_context presente.
-- =====================================================================
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_bypass boolean; v_super boolean; v_login boolean;
  v_cnt int; v_def text;
BEGIN
  -- 1) roles : roadsen_app et roadsen_auth NON-super NON-bypass ; roadsen_auth NOLOGIN
  SELECT rolbypassrls, rolsuper INTO v_bypass, v_super FROM pg_roles WHERE rolname='roadsen_app';
  IF v_bypass OR v_super THEN RAISE EXCEPTION 'roadsen_app ne doit etre ni bypass ni super'; END IF;
  SELECT rolbypassrls, rolsuper, rolcanlogin INTO v_bypass, v_super, v_login FROM pg_roles WHERE rolname='roadsen_auth';
  IF v_bypass THEN RAISE EXCEPTION 'roadsen_auth NE DOIT PAS etre BYPASSRLS (modele 0007)'; END IF;
  IF v_super THEN RAISE EXCEPTION 'roadsen_auth ne doit pas etre superuser'; END IF;
  IF v_login THEN RAISE EXCEPTION 'roadsen_auth doit etre NOLOGIN'; END IF;

  -- 2) les 7 fonctions DEFINER sont owned par roadsen_auth (NON-bypass)
  SELECT count(*) INTO v_cnt
  FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
  WHERE p.proname IN ('provision_org','provision_user','auth_find_user_by_email',
        'auth_user_has_membership','auth_get_platform_role','auth_get_user_profile','pv_emitter_context')
    AND r.rolname='roadsen_auth';
  IF v_cnt <> 7 THEN RAISE EXCEPTION '7 DEFINER attendues owned par roadsen_auth, trouve %', v_cnt; END IF;

  -- 3) helpers presents : app_current_org, app_current_org_or_null, app_auth_bootstrap
  SELECT count(*) INTO v_cnt FROM pg_proc
  WHERE proname IN ('app_current_org','app_current_org_or_null','app_auth_bootstrap');
  IF v_cnt <> 3 THEN RAISE EXCEPTION '3 helpers attendus, trouve %', v_cnt; END IF;

  -- 4) BARRIERE 1 : roadsen_app n'a AUCUN DML sur les 3 tables d'identite
  IF has_table_privilege('roadsen_app','users','SELECT')
     OR has_table_privilege('roadsen_app','users','INSERT')
     OR has_table_privilege('roadsen_app','users','UPDATE')
     OR has_table_privilege('roadsen_app','users','DELETE')
     OR has_table_privilege('roadsen_app','organizations','SELECT')
     OR has_table_privilege('roadsen_app','memberships','SELECT')
  THEN RAISE EXCEPTION 'roadsen_app NE DOIT PLUS avoir de DML sur l identite (barriere 1)'; END IF;

  -- 5) roadsen_auth A le DML identite necessaire aux DEFINER
  IF NOT (has_table_privilege('roadsen_auth','users','SELECT')
          AND has_table_privilege('roadsen_auth','users','INSERT')
          AND has_table_privilege('roadsen_auth','organizations','SELECT')
          AND has_table_privilege('roadsen_auth','memberships','INSERT'))
  THEN RAISE EXCEPTION 'roadsen_auth doit detenir SELECT/INSERT sur l identite'; END IF;

  -- 5bis) roadsen_auth a USAGE + CREATE sur public (pre-requis des ALTER OWNER de
  --       la chaine : reattribuer un objet a roadsen_auth exige CREATE sur le schema).
  IF NOT has_schema_privilege('roadsen_auth','public','USAGE')
  THEN RAISE EXCEPTION 'roadsen_auth doit avoir USAGE sur public'; END IF;
  IF NOT has_schema_privilege('roadsen_auth','public','CREATE')
  THEN RAISE EXCEPTION 'roadsen_auth doit avoir CREATE sur public (ALTER OWNER chaine)'; END IF;

  -- 6) roadsen_app conserve le DML sur les tables de DONNEES (projects)
  IF NOT has_table_privilege('roadsen_app','projects','SELECT')
  THEN RAISE EXCEPTION 'roadsen_app doit garder le DML sur projects (donnees)'; END IF;

  -- 7) policies d'identite : branche drapeau presente (app_auth_bootstrap dans qual)
  SELECT count(*) INTO v_cnt
  FROM pg_policies
  WHERE schemaname='public' AND tablename IN ('users','organizations','memberships')
    AND policyname='tenant_isolation'
    AND qual LIKE '%app_auth_bootstrap%';
  IF v_cnt <> 3 THEN RAISE EXCEPTION '3 policies d identite avec branche drapeau attendues, trouve %', v_cnt; END IF;

  -- 8) policies de DONNEES : PAS de drapeau, et app_current_org() fail-closed bruyant
  SELECT count(*) INTO v_cnt
  FROM pg_policies
  WHERE schemaname='public' AND tablename IN ('projects','calc_results','pv_counters','official_pvs')
    AND qual LIKE '%app_auth_bootstrap%';
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'AUCUNE table de donnees ne doit referencer le drapeau d auth'; END IF;
  -- app_current_org() doit RAISE quand le contexte est absent (fail-closed bruyant)
  PERFORM set_config('app.current_org','',true);
  BEGIN
    PERFORM app_current_org();
    RAISE EXCEPTION 'app_current_org() doit RAISER sans contexte (fail-closed bruyant #42)';
  EXCEPTION WHEN sqlstate 'R0001' THEN NULL; END;

  -- 9) FORCE RLS actif sur les 4 tables socle (+ tables PV si 0006 applique)
  SELECT count(*) INTO v_cnt FROM pg_class
  WHERE relname IN ('users','organizations','memberships','projects')
    AND relrowsecurity AND relforcerowsecurity;
  IF v_cnt <> 4 THEN RAISE EXCEPTION 'FORCE RLS attendu sur les 4 tables socle, trouve %', v_cnt; END IF;

  -- 10) RUNTIME (#42) : le user de connexion DOIT etre MEMBRE de roadsen_app
  --     (pour `SET LOCAL ROLE roadsen_app`) ET de roadsen_auth (ALTER OWNER en
  --     migration). pg_has_role(member, role, 'MEMBER') = appartenance effective.
  IF NOT pg_has_role(CURRENT_USER, 'roadsen_app', 'MEMBER')
  THEN RAISE EXCEPTION 'le user de connexion DOIT etre membre de roadsen_app (SET ROLE runtime)'; END IF;
  IF NOT pg_has_role(CURRENT_USER, 'roadsen_auth', 'MEMBER')
  THEN RAISE EXCEPTION 'le user de connexion DOIT etre membre de roadsen_auth (ALTER OWNER migration)'; END IF;
  -- et il doit pouvoir reellement SET ROLE roadsen_app (option USAGE/SET) :
  BEGIN
    EXECUTE 'SET LOCAL ROLE "roadsen_app"';
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'le user de connexion ne peut pas SET ROLE roadsen_app (option SET manquante ?)';
  END;

  RAISE NOTICE 'VERIF CHAINE OK — etat public = modele PROOF (2 barrieres, sans BYPASSRLS) + runtime SET ROLE pret';
END $$;
