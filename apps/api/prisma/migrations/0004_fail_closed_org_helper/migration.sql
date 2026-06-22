-- =====================================================================
--  ROADSEN — Migration 0004 : helper de scoping FAIL-CLOSED BRUYANT (#42)
--
--  CONTEXTE / PROBLEME RESOLU
--  --------------------------
--  Les policies 0001/0002 scopent par :
--      NULLIF(current_setting('app.current_org', true), '')::uuid
--  Le 2e argument `true` (missing_ok) renvoie NULL si le GUC n'est pas pose,
--  AU LIEU de lever une erreur. Consequence : un `SET LOCAL app.current_org`
--  OUBLIE par l'application ne provoque PAS d'erreur ; il rend simplement
--  "0 ligne". C'est fail-closed (pas de fuite), mais SILENCIEUX : un bug de
--  scoping applicatif (transaction non passee par withTenant, contexte non
--  pose) ressemble a "tenant vide" et passe inapercu en tests/preprod, jusqu'a
--  un comportement faussement nominal en prod.
--
--  Cette migration remplace ce scoping silencieux par un HELPER BRUYANT :
--      app_current_org() RETURNS uuid
--  qui RAISE EXCEPTION si le GUC est NULL/vide, et renvoie l'uuid sinon. Les
--  policies des 4 tables (organizations, users, memberships, projects) sont
--  REECRITES pour l'appeler. Objectif : un SET LOCAL oublie echoue FORT
--  (erreur explicite, traceable), ne renvoie pas un "0 ligne" trompeur.
--
--  PIEGE CENTRAL — pourquoi ce RAISE ne casse PAS le login / provision_org
--  ----------------------------------------------------------------------
--  Login et provisioning ont lieu AVANT tout contexte tenant (cf. 0002/0003) :
--  ils lisent users/memberships SANS app.current_org pose. Si leurs requetes
--  passaient par les policies des tables, le nouveau RAISE les ferait echouer.
--
--  Ces lectures passent par des fonctions SECURITY DEFINER (provision_org,
--  auth_find_user_by_email, auth_user_has_membership, auth_get_platform_role).
--  Une fonction SECURITY DEFINER s'execute avec les droits de son PROPRIETAIRE,
--  MAIS `FORCE ROW LEVEL SECURITY` s'applique meme au proprietaire — SAUF si ce
--  proprietaire possede l'attribut BYPASSRLS.
--
--  Etat AVANT 0004 :
--    - LOCAL : le proprietaire est `roadsen` = SUPERUSER (donc BYPASSRLS
--      implicite). Les fonctions DEFINER contournent RLS -> login OK. MAIS
--      cela MASQUE le probleme : en prod, le proprietaire des objets n'est PAS
--      superuser.
--    - PROD-LIKE (Render : owner NON-superuser, NON-BYPASSRLS) : les fonctions
--      DEFINER sont soumises a RLS. auth_find_user_by_email lit "users" sous
--      la policy 0002 (membership partage avec app.current_org). app.current_org
--      n'etant pas pose au login -> AUCUNE ligne -> login deja SILENCIEUSEMENT
--      CASSE en prod, avant meme ce ticket. (Prouve empiriquement : la fonction
--      DEFINER owned par un role non-bypass renvoie 0 ligne sans org pose.)
--
--  CORRECTION 0004 (prod-safe, sans superuser) :
--    On cree un role DEDIE `roadsen_auth` — NOLOGIN, NOSUPERUSER, BYPASSRLS —
--    et on lui DONNE la propriete des 4 fonctions DEFINER d'auth/bootstrap.
--    Ces fonctions DOIVENT lire/ecrire a travers les tenants PAR CONCEPTION
--    (login a froid, bootstrap d'org) : leur accorder BYPASSRLS est le contour
--    LEGITIME et explicite de la RLS, et non un assouplissement de la policy.
--    `roadsen_auth` est NOLOGIN -> ce n'est JAMAIS une surface de connexion ;
--    il ne sert qu'a porter ces 4 fonctions auditees, search_path fige,
--    EXECUTE revoque a PUBLIC, accorde au seul `roadsen_app`. Le runtime
--    (`roadsen_app`) reste NOBYPASSRLS : il ne peut RIEN lire hors policy en
--    requete ordinaire ; il ne franchit la RLS QUE via ces 4 portes etroites.
--
--  Resultat prouve : en PROD-LIKE (owner non-superuser), login et provision_org
--  fonctionnent (les fonctions bypassent la RLS via leur owner BYPASSRLS dedie),
--  tandis qu'une requete tenant ordinaire sans SET LOCAL echoue FORT (RAISE).
--
--  ADDITIVE : aucune table, aucune donnee modifiee. Reecrit 4 policies, cree
--  1 fonction (app_current_org) + 1 role (roadsen_auth), reattribue la propriete
--  de 4 fonctions existantes. N'edite PAS 0001/0002/0003.
--  Reversible : voir down.sql.
--  A REVOIR EN BINOME dev-backend + qa-challenger (zone critique : isolation).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) app_current_org() — helper de scoping FAIL-CLOSED BRUYANT
--
--  current_setting('app.current_org', true) : missing_ok=true -> NULL si non
--  pose (au lieu d'une erreur native peu explicite). On transforme ce NULL /
--  chaine vide en RAISE EXCEPTION explicite, code SQLSTATE dedie ('R0001',
--  classe applicative) pour le distinguer cote app si besoin.
--
--  STABLE : le GUC ne change pas dans une requete. PARALLEL SAFE : lecture pure.
--  SECURITY INVOKER (defaut) : ce helper NE doit PAS bypasser RLS ; il sert
--  justement A la RLS. search_path fige par prudence (pg_catalog) bien que la
--  fonction n'appelle que des routines de catalogue.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "app_current_org"()
RETURNS uuid
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
DECLARE
  v_raw text := current_setting('app.current_org', true);
BEGIN
  IF v_raw IS NULL OR length(btrim(v_raw)) = 0 THEN
    -- SET LOCAL app.current_org oublie : on echoue FORT plutot que "0 ligne".
    RAISE EXCEPTION 'app.current_org non defini : aucun contexte tenant pose (SET LOCAL manquant)'
      USING ERRCODE = 'R0001';
  END IF;
  RETURN v_raw::uuid; -- un GUC mal forme (non-uuid) leve une erreur de cast = fail-closed bruyant aussi
END;
$$;

-- Helper utilisable par tout role qui evalue les policies (PUBLIC) : il ne
-- divulgue rien (il ne fait que lire le GUC de la session courante).
REVOKE ALL ON FUNCTION "app_current_org"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "app_current_org"() TO PUBLIC;

-- ---------------------------------------------------------------------
-- 2) Reecriture des 4 policies tenant pour utiliser app_current_org()
--
--  CREATE OR REPLACE POLICY n'existe pas avant PG15 ; on DROP puis CREATE
--  (idempotent via IF EXISTS). Le nom et la portee (permissive, ALL implicite)
--  restent identiques a 0001/0002 ; seule l'expression de scoping change :
--  NULLIF(current_setting(...,true),'')::uuid  ->  app_current_org().
-- ---------------------------------------------------------------------

-- memberships (cree en 0001)
DROP POLICY IF EXISTS "tenant_isolation" ON "memberships";
CREATE POLICY "tenant_isolation" ON "memberships"
  USING ("org_id" = "app_current_org"())
  WITH CHECK ("org_id" = "app_current_org"());

-- projects (cree en 0001)
DROP POLICY IF EXISTS "tenant_isolation" ON "projects";
CREATE POLICY "tenant_isolation" ON "projects"
  USING ("org_id" = "app_current_org"())
  WITH CHECK ("org_id" = "app_current_org"());

-- organizations (cree en 0002 ; scope par id = org courant)
DROP POLICY IF EXISTS "tenant_isolation" ON "organizations";
CREATE POLICY "tenant_isolation" ON "organizations"
  USING ("id" = "app_current_org"())
  WITH CHECK ("id" = "app_current_org"());

-- users (cree en 0002 ; scope par membership partage avec l'org courante)
--  La sous-requete memberships est elle-meme sous RLS FORCE : sans contexte,
--  app_current_org() RAISE deja a son evaluation -> fail-closed bruyant.
DROP POLICY IF EXISTS "tenant_isolation" ON "users";
CREATE POLICY "tenant_isolation" ON "users"
  USING (
    EXISTS (
      SELECT 1 FROM "memberships" m
      WHERE m."user_id" = "users"."id"
        AND m."org_id"  = "app_current_org"()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "memberships" m
      WHERE m."user_id" = "users"."id"
        AND m."org_id"  = "app_current_org"()
    )
  );

-- ---------------------------------------------------------------------
-- 3) Role DEDIE roadsen_auth (NOLOGIN, NOSUPERUSER, BYPASSRLS) +
--    reattribution des 4 fonctions DEFINER d'auth/bootstrap.
--
--  POURQUOI : ces 4 fonctions lisent/ecrivent A FROID, AVANT tout contexte
--  tenant (login, resolution membership, role plateforme, bootstrap d'org).
--  Elles DOIVENT franchir la RLS par conception. En prod l'owner des objets
--  n'est pas superuser : sans owner BYPASSRLS dedie, FORCE RLS les soumettrait
--  aux policies et le RAISE de app_current_org() (ou simplement l'absence de
--  contexte) ferait echouer login et provisioning.
--
--  roadsen_auth NOLOGIN : aucune surface de connexion. BYPASSRLS : franchit la
--  RLS UNIQUEMENT au travers de ces 4 fonctions (auditees, perimetre minimal,
--  search_path fige, EXECUTE limite a roadsen_app). NOSUPERUSER : moindre
--  privilege strict — pas de DDL, pas de superpouvoir, juste le bypass RLS.
--
--  Le runtime roadsen_app demeure NOBYPASSRLS : en requete ordinaire il reste
--  pleinement soumis a la RLS. La defense en profondeur tient : 4 portes
--  etroites DEFINER + RLS bruyante partout ailleurs.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roadsen_auth') THEN
    CREATE ROLE "roadsen_auth" NOLOGIN NOSUPERUSER BYPASSRLS;
  ELSE
    -- garantit l'etat attendu meme si le role preexistait
    ALTER ROLE "roadsen_auth" NOLOGIN NOSUPERUSER BYPASSRLS;
  END IF;
END
$$;

-- roadsen_auth doit pouvoir USE le schema et acceder aux tables qu'il lit/ecrit
-- au travers des fonctions DEFINER (provision_org ecrit organizations+memberships).
GRANT USAGE ON SCHEMA public TO "roadsen_auth";
GRANT SELECT, INSERT ON "organizations", "memberships" TO "roadsen_auth";
GRANT SELECT ON "users" TO "roadsen_auth";

-- Reattribution de la PROPRIETE des 4 fonctions au role dedie. Apres ALTER
-- OWNER, le DEFINER s'execute avec les droits (et le BYPASSRLS) de roadsen_auth.
-- Les GRANT EXECUTE a roadsen_app poses en 0002/0003 restent valides (ils
-- portent sur la fonction, pas sur le proprietaire).
ALTER FUNCTION "provision_org"(text, text, uuid)            OWNER TO "roadsen_auth";
ALTER FUNCTION "auth_find_user_by_email"(text)              OWNER TO "roadsen_auth";
ALTER FUNCTION "auth_user_has_membership"(uuid, uuid)       OWNER TO "roadsen_auth";
ALTER FUNCTION "auth_get_platform_role"(uuid)               OWNER TO "roadsen_auth";

-- ---------------------------------------------------------------------
-- 3bis) provision_org — REDEFINITION (forward-fix de 0002, NON destructive)
--
--  CORRECTIF (revue adverse) — FUITE DE CONTEXTE TENANT.
--  La version 0002 fait `set_config('app.current_org', v_org_id, true)`. Le 3e
--  argument `true` = TRANSACTION-local, et NON function-local : apres le RETURN,
--  le GUC reste pose sur l'org fabriquee pour le RESTE de la transaction
--  appelante (prouve empiriquement : un current_setting apres l'appel renvoie
--  encore v_org_id jusqu'au COMMIT). Si provision_org est un jour appele DANS
--  une $transaction Prisma suivie d'autres requetes, celles-ci s'executeraient
--  dans le contexte de l'org creee -> fenetre cross-tenant HORS TenantGuard.
--
--  Fix : on CAPTURE le contexte courant a l'entree et on le RESTAURE avant le
--  RETURN. Restauration a '' (chaine vide) si aucun contexte prealable -> apres
--  l'appel, une requete tenant sans SET LOCAL RAISE bien via app_current_org()
--  (fail-closed bruyant preserve), au lieu d'heriter de la nouvelle org.
--
--  CORRECTIF (revue adverse) — p_owner_user_id ARBITRAIRE.
--  La seule barriere d'integrite est la FK memberships_user_id_fkey : n'importe
--  quel user EXISTANT peut etre fait OWNER d'une org creee. L'APPELANT (#41)
--  DOIT imposer p_owner_user_id = sub du JWT verifie, JAMAIS une valeur fournie
--  par le client. A enforcer au cablage applicatif (cf. backlog #41). Cette
--  fonction ne peut pas verifier le JWT elle-meme (couche base).
--
--  CREATE OR REPLACE preserve le proprietaire courant (roadsen_auth, pose par
--  l'ALTER OWNER ci-dessus) ; on le re-affirme malgre tout par prudence.
--  search_path fige + SECURITY DEFINER inchanges (modele 0002).
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
  -- contexte tenant prealable a l'appel (a restaurer avant tout RETURN).
  -- current_setting(..., true) -> NULL si non pose ; on normalise en '' pour
  -- que la restauration redonne un etat "sans contexte" fail-closed bruyant.
  v_prev_org text := COALESCE(current_setting('app.current_org', true), '');
BEGIN
  -- garde-fous d'entree
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'provision_org: p_name requis';
  END IF;
  IF p_slug IS NULL OR length(btrim(p_slug)) = 0 THEN
    RAISE EXCEPTION 'provision_org: p_slug requis';
  END IF;
  IF p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'provision_org: p_owner_user_id requis';
  END IF;
  -- SECURITE D'AUTORISATION (a enforcer cote appelant #41) : p_owner_user_id
  -- DOIT etre le sub du JWT verifie de l'appelant, jamais une valeur cliente.
  -- La FK memberships_user_id_fkey ne garantit QUE l'existence du user, PAS sa
  -- legitimite. Ne pas exposer cette fonction a une entree utilisateur brute.

  -- pose le tenant courant sur la NOUVELLE org (portee transaction)
  PERFORM set_config('app.current_org', v_org_id::text, true);

  -- 1) creation de l'organisation : WITH CHECK satisfait (id = app.current_org).
  --    NB owner roadsen_auth = BYPASSRLS : le WITH CHECK ne s'applique en fait
  --    pas, mais on conserve la pose du GUC pour rester correct si l'owner
  --    venait a perdre BYPASSRLS.
  INSERT INTO "organizations" ("id", "name", "slug", "updatedAt")
  VALUES (v_org_id, p_name, p_slug, CURRENT_TIMESTAMP);

  -- 2) creation du membership OWNER : WITH CHECK satisfait (org_id = app.current_org)
  --    FK memberships_user_id_fkey garantit l'existence du user owner.
  INSERT INTO "memberships" ("org_id", "user_id", "role")
  VALUES (v_org_id, p_owner_user_id, 'OWNER');

  -- RESTAURE le contexte prealable AVANT de rendre la main : aucune fuite du
  -- contexte de l'org fabriquee vers le reste de la transaction appelante.
  PERFORM set_config('app.current_org', v_prev_org, true);
  RETURN v_org_id;
EXCEPTION
  WHEN OTHERS THEN
    -- en cas d'erreur, on restaure aussi le contexte avant de propager.
    PERFORM set_config('app.current_org', v_prev_org, true);
    RAISE;
END;
$$;

-- CREATE OR REPLACE preserve l'owner, mais on le re-affirme (idempotent).
ALTER FUNCTION "provision_org"(text, text, uuid) OWNER TO "roadsen_auth";
-- EXECUTE deja revoque a PUBLIC / accorde a roadsen_app en 0002 ; CREATE OR
-- REPLACE ne touche pas les droits. On re-affirme par idempotence defensive.
REVOKE ALL ON FUNCTION "provision_org"(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "provision_org"(text, text, uuid) TO "roadsen_app";

-- ---------------------------------------------------------------------
-- 4) NOTE — FK composite incluant org_id (critere #42.6)
--
--  Le motif "FK composite (org_id, parent_id) -> (org_id, id)" empeche un
--  enfant org-scope de pointer un parent d'un AUTRE tenant. Il suppose une
--  paire PARENT/ENFANT tous deux porteurs d'un org_id.
--
--  Parmi les tables actuelles {organizations, users, memberships, projects} :
--    - organizations : pas d'org_id (l'org EST le tenant).
--    - users         : pas d'org_id (multi-org via memberships).
--    - memberships(org_id) -> organizations(id) : le parent (organizations)
--      n'a PAS d'org_id, donc pas de FK composite (org_id, .) possible.
--    - projects(org_id) -> organizations(id) : idem.
--  AUCUNE paire enfant-org-scope -> parent-org-scope n'existe encore (pas de
--  table enfant de "projects" portant org_id). On NE cree donc PAS de schema
--  fictif : le critere FK composite est DIFFERE jusqu'a l'arrivee d'une telle
--  table (ex. "soundings"/"layers" rattachees a un project org-scope). A ce
--  moment-la : PK/FK composite incluant org_id + test "enfant pointant un parent
--  d'un autre tenant -> refus".
--
--  La coherence org_id EXISTANTE (memberships/projects -> organizations) reste
--  garantie par les FK simples de 0001 ET par la policy tenant (WITH CHECK :
--  org_id = app_current_org()), qui empeche d'ecrire une ligne hors du tenant
--  courant. Un enfant ne peut donc deja etre cree que dans l'org courant.
-- ---------------------------------------------------------------------
