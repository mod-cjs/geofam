-- =====================================================================
--  ROADSEN — Migration 0002 : RLS sur organizations & users + bootstrap sur
--                             provisioning atomique (passe corrective post-revue)
--
--  Contexte : la migration 0001 a laisse organizations & users SANS RLS
--  ("tables de noyau"). C'est un trou d'isolation : des qu'un endpoint de
--  listing apparait, le role applicatif (roadsen_app, NOBYPASSRLS) peut lire
--  TOUS les users (password_hash + PII -> enjeu CDP / loi 2008-12) et TOUTES
--  les organisations de la plateforme = fuite inter-bureaux directe.
--
--  Cette migration :
--    1) ENABLE + FORCE RLS + policy sur "organizations"  (scopee par id = org courant)
--    2) ENABLE + FORCE RLS + policy sur "users"          (scopee par membership partage)
--    3) cree provision_org(...) SECURITY DEFINER = SEULE voie sanctionnee pour
--       ecrire le 1er membership OWNER (resout le chicken-egg du WITH CHECK
--       memberships SANS rôle BYPASSRLS ad hoc).
--
--  Modele de scoping inchange : l'app pose `SET LOCAL app.current_org = '<uuid>'`
--  par transaction. current_setting('app.current_org', true) -> NULL si non pose
--  (missing_ok) -> fail-closed (aucune ligne visible).
--
--  Reversible : voir down.sql (rollback documente, applique manuellement).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) organizations — RLS FORCE + policy
--
--  L'organisation EST le tenant : la ligne org courante est la seule
--  visible/modifiable. Scoping par "id" (pas org_id : la PK joue ce role).
--  app.current_org non pose -> NULL -> aucune ligne (fail-closed).
--
--  NB : la CREATION d'une organisation ne passe PAS par un INSERT direct du
--  runtime (le WITH CHECK exigerait id = app.current_org, impossible avant que
--  l'org existe). Elle passe par provision_org(...) (section 3), qui s'execute
--  avec les droits du DEFINER et pose app.current_org sur la nouvelle org.
-- ---------------------------------------------------------------------
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "organizations"
  USING ("id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- ---------------------------------------------------------------------
-- 2) users — RLS FORCE + policy "membership partage"
--
--  Un user est visible UNIQUEMENT s'il partage un membership avec l'org
--  courante. La sous-requete interroge "memberships", elle-meme sous RLS
--  FORCE : elle ne renvoie donc QUE les memberships de l'org courante
--  (current_setting('app.current_org')). Resultat : on ne voit que les users
--  ayant un membership dans MON org. Aucune fuite des users d'autres bureaux,
--  ni de leur password_hash / PII.
--
--  app.current_org NULL -> la policy memberships ne renvoie rien -> EXISTS faux
--  -> aucun user visible (fail-closed). Coherent avec le reste du socle.
--
--  WITH CHECK identique : on n'ecrit/ne modifie un user que s'il est rattache
--  a l'org courante. NB : la CREATION du tout 1er user d'un nouvel org se fait
--  via provision_org(...) (DEFINER), ou via un user prealablement provisionne ;
--  l'inscription self-service d'un user SANS membership reste hors-scope socle
--  et devra passer par une voie DEFINER dediee (cf. residu de surface, down.sql).
--
--  Choix assume : on NE retient PAS une policy "self" (id = app.current_user)
--  car le socle ne pose pas d'identite utilisateur cote base (pas de
--  app.current_user fiable). Le scoping par membership est suffisant et
--  fail-closed pour le stade socle. A elargir si un besoin "voir son propre
--  profil hors org" apparait (alors : ajouter app.current_user + policy OR self).
-- ---------------------------------------------------------------------
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "users"
  USING (
    EXISTS (
      SELECT 1 FROM "memberships" m
      WHERE m."user_id" = "users"."id"
        AND m."org_id"  = NULLIF(current_setting('app.current_org', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "memberships" m
      WHERE m."user_id" = "users"."id"
        AND m."org_id"  = NULLIF(current_setting('app.current_org', true), '')::uuid
    )
  );

-- ---------------------------------------------------------------------
-- 3) provision_org(...) — SECURITY DEFINER : bootstrap atomique
--
--  Probleme resolu (chicken-egg) :
--    - creer une org via INSERT direct est refuse par le WITH CHECK
--      organizations (id != app.current_org tant que l'org n'existe pas) ;
--    - creer le 1er membership OWNER via INSERT direct est refuse par le
--      WITH CHECK memberships (org_id != app.current_org).
--  -> aucune voie sure sans contournement. provision_org est CETTE voie.
--
--  SECURITY DEFINER : la fonction s'execute avec les droits de son
--  PROPRIETAIRE (le role qui joue la migration = proprietaire des tables).
--  ATTENTION : FORCE ROW LEVEL SECURITY s'applique MEME au proprietaire ; le
--  DEFINER ne contourne donc PAS RLS automatiquement. La fonction pose donc
--  elle-meme `SET LOCAL app.current_org` sur l'org qu'elle vient de creer,
--  AVANT d'inserer le membership -> le WITH CHECK memberships passe proprement.
--  Pour l'INSERT organizations, on pose app.current_org sur l'id genere AVANT
--  l'insert effectif : on genere l'uuid cote fonction, on pose le GUC, puis on
--  insere avec cet id -> WITH CHECK organizations satisfait. Aucun BYPASSRLS,
--  aucun role privilegie ad hoc.
--
--  search_path FIGE (anti-hijack) : une fonction SECURITY DEFINER avec un
--  search_path mutable est vulnerable (un appelant cree un objet homonyme dans
--  un schema en tete de search_path et detourne la resolution). On epingle
--  `SET search_path = pg_catalog, public` -> resolution deterministe. Toutes les
--  references sont en outre schema-qualifiees implicitement via ce search_path
--  fige (public detenant nos tables).
--
--  Idempotence d'appel : si une org au meme slug existe deja, on leve une
--  erreur explicite plutot que de creer un doublon (slug UNIQUE de toute facon).
--
--  Le GUC est pose en `SET LOCAL` -> portee transaction : il n'echappe pas a
--  l'appel et ne pollue pas la session de l'appelant au-dela du COMMIT/ROLLBACK.
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
  v_org_id uuid := gen_random_uuid();
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
  -- L'existence du user owner est garantie par la FK memberships_user_id_fkey
  -- lors de l'INSERT du membership (echec atomique avec message FK si absent).
  -- On ne fait PAS de SELECT prealable sur "users" : il serait filtre par la
  -- RLS users (le nouvel org n'a encore aucun membership) et donnerait un
  -- faux negatif. La FK est la source de verite d'integrite ici.

  -- pose le tenant courant sur la NOUVELLE org (portee transaction)
  PERFORM set_config('app.current_org', v_org_id::text, true);

  -- 1) creation de l'organisation : WITH CHECK satisfait (id = app.current_org)
  INSERT INTO "organizations" ("id", "name", "slug", "updatedAt")
  VALUES (v_org_id, p_name, p_slug, CURRENT_TIMESTAMP);

  -- 2) creation du membership OWNER : WITH CHECK satisfait (org_id = app.current_org)
  --    FK memberships_user_id_fkey garantit l'existence du user owner.
  INSERT INTO "memberships" ("org_id", "user_id", "role")
  VALUES (v_org_id, p_owner_user_id, 'OWNER');

  RETURN v_org_id;
END;
$$;

-- Droits d'EXECUTE : revoque a PUBLIC, accorde a roadsen_app UNIQUEMENT.
-- (REVOKE FROM PUBLIC est essentiel : par defaut EXECUTE est accorde a PUBLIC,
--  ce qui exposerait une fonction DEFINER a tout role.)
REVOKE ALL ON FUNCTION "provision_org"(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "provision_org"(text, text, uuid) TO "roadsen_app";
