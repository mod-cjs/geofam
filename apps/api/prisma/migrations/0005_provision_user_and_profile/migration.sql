-- =====================================================================
--  ROADSEN — Migration 0005 : provisioning d'utilisateur (onboarding SUPERADMIN)
--                             + lecture de profil "a froid" pour /auth/me
--
--  CONTEXTE / DECISION TITULAIRE
--  -----------------------------
--  La creation d'organisation est un ONBOARDING SUPERADMIN (pas de self-service) :
--  un SUPERADMIN plateforme cree les utilisateurs, puis les organisations, et
--  designe l'OWNER (un utilisateur EXISTANT). Cote base il manquait deux voies :
--
--    1) provision_user — creer un user HORS de tout tenant. Aujourd'hui le seul
--       chemin de creation d'un user etait le SEED superuser des tests (cf. note
--       "SUIVI" de rls-isolation.e2e). En prod, l'utilisateur applicatif n'est
--       pas superuser ; un INSERT direct sur "users" est refuse par la policy
--       0002/0004 (un nouvel user ne partage encore aucun membership avec l'org
--       courante, et hors onboarding aucun app.current_org n'est pose). Il faut
--       donc une fonction SECURITY DEFINER dediee, sur le modele de provision_org.
--
--    2) auth_get_user_profile — alimenter GET /auth/me. Ce point d'entree dit a
--       un utilisateur authentifie "qui je suis + a quelles orgs j'appartiens",
--       AVANT toute selection d'org (donc sans app.current_org). "users" et
--       "memberships" sont sous RLS scopee par org courant : illisibles a froid
--       par le runtime NOBYPASSRLS. On expose donc une fonction DEFINER en LECTURE
--       SEULE, au perimetre minimal (les memberships du SEUL user demande).
--
--  HYGIENE DEFINER (identique a 0002/0003/0004)
--  --------------------------------------------
--    - SECURITY DEFINER, OWNED BY roadsen_auth (NOLOGIN, BYPASSRLS) : ces voies
--      doivent franchir la RLS PAR CONCEPTION (creation/lecture hors tenant).
--    - search_path FIGE `pg_catalog, public` : anti-hijack (un appelant ne peut
--      pas detourner la resolution de nom via un schema en tete de search_path).
--    - EXECUTE revoque a PUBLIC, accorde au seul roadsen_app (le runtime).
--    - perimetre MINIMAL : provision_user ne renvoie que l'uuid cree ;
--      auth_get_user_profile ne renvoie QUE le user demande et SES memberships
--      (aucune donnee d'un autre user, aucun listing, aucune enumeration).
--
--  ENFORCEMENT D'AUTORISATION (rappel) : ces fonctions ne verifient PAS le JWT
--  ni le role SUPERADMIN (couche base). C'est l'APPELANT applicatif qui DOIT :
--    - n'exposer provision_user / provision_org qu'a une route @Roles(SUPERADMIN) ;
--    - n'appeler auth_get_user_profile QU'AVEC le sub du JWT verifie (jamais une
--      valeur cliente) -> un user ne lit que SON propre profil.
--  La FK / l'unicite garantissent l'integrite, PAS la legitimite (cf. 0004).
--
--  ADDITIVE : aucune table, aucune donnee modifiee. Cree 2 fonctions, accorde a
--  roadsen_auth l'INSERT sur "users" (necessaire a provision_user). N'edite PAS
--  les migrations anterieures.
--  Reversible : voir down.sql.
--  A REVOIR EN BINOME ingenieur-securite (DEFINER + contournement RLS = critique).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) roadsen_auth doit pouvoir INSERER dans "users"
--
--  0004 ne lui accordait que SELECT sur "users" (les 4 fonctions d'alors n'y
--  ecrivaient pas). provision_user y INSERE : on ajoute le privilege minimal.
--  (roadsen_auth reste NOLOGIN / NOSUPERUSER ; seul son BYPASSRLS + ce GRANT
--   permettent l'ecriture, au travers de la fonction DEFINER uniquement.)
-- ---------------------------------------------------------------------
GRANT INSERT ON "users" TO "roadsen_auth";

-- ---------------------------------------------------------------------
-- 1) provision_user — creation d'un utilisateur (DEFINER, onboarding)
--
--  L'application fournit un mot de passe DEJA HASHE (argon2id, cf. password.ts) :
--  la fonction NE HASHE PAS (aucun secret en clair ne transite par la base).
--  Email normalise lower(btrim(...)) — MEME normalisation que
--  auth_find_user_by_email(0003), pour que login et provisioning s'accordent.
--
--  Unicite : la contrainte UNIQUE(email) du schema est la source de verite. Un
--  doublon leve unique_violation (SQLSTATE 23505). On NE fait PAS de SELECT
--  prealable "email existe ?" : ce serait un oracle d'enumeration et une course.
--  L'appelant traduit 23505 en erreur BORNEE (cf. AuthService), sans divulguer
--  l'existence de l'email.
--
--  Hors-tenant : un user n'est pas org-scope (multi-org via memberships). On NE
--  pose donc AUCUN app.current_org ; l'INSERT passe grace au BYPASSRLS de l'owner
--  roadsen_auth. is_active = defaut true (schema) ; platform_role NULL (un
--  SUPERADMIN se promeut hors de cette voie nominale).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "provision_user"(
  p_email         text,
  p_password_hash text,
  p_full_name     text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_email   text := lower(btrim(p_email));
BEGIN
  -- garde-fous d'entree (defense en profondeur ; l'appelant valide deja en Zod).
  IF v_email IS NULL OR length(v_email) = 0 THEN
    RAISE EXCEPTION 'provision_user: p_email requis';
  END IF;
  IF p_password_hash IS NULL OR length(btrim(p_password_hash)) = 0 THEN
    RAISE EXCEPTION 'provision_user: p_password_hash requis';
  END IF;
  IF p_full_name IS NULL OR length(btrim(p_full_name)) = 0 THEN
    RAISE EXCEPTION 'provision_user: p_full_name requis';
  END IF;

  -- L'INSERT laisse la contrainte UNIQUE(email) trancher l'unicite : un doublon
  -- leve 23505 (unique_violation), propage tel quel pour que l'appelant le borne.
  INSERT INTO "users" ("id", "email", "password_hash", "full_name", "updated_at")
  VALUES (v_user_id, v_email, p_password_hash, btrim(p_full_name), CURRENT_TIMESTAMP);

  RETURN v_user_id;
END;
$$;

-- Owner = roadsen_auth (BYPASSRLS) : l'INSERT franchit la RLS users par la
-- voie auditee. EXECUTE revoque a PUBLIC, accorde au seul runtime roadsen_app.
ALTER FUNCTION "provision_user"(text, text, text) OWNER TO "roadsen_auth";
REVOKE ALL ON FUNCTION "provision_user"(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "provision_user"(text, text, text) TO "roadsen_app";

-- ---------------------------------------------------------------------
-- 2) auth_get_user_profile — profil + memberships d'UN user (DEFINER, lecture)
--
--  Alimente GET /auth/me. Renvoie une ligne PAR membership du user demande, avec
--  ses colonnes de profil repetees (profil constant) + les coordonnees de chaque
--  org et le role tenant. Un user SANS membership renvoie UNE ligne (LEFT JOIN)
--  avec org_id/org_name/org_slug/membership_role a NULL : l'appelant sait alors
--  "user connu, profil renvoye, zero org".
--
--  Un user INEXISTANT renvoie ZERO ligne (le WHERE u.id = p_user_id ne matche
--  pas) : l'appelant traite cela en 401/erreur (cas anormal : le sub vient d'un
--  JWT verifie ; un user supprime apres emission du token tombe ici).
--
--  PERIMETRE / ANTI-FUITE : filtre STRICT u."id" = p_user_id. La fonction ne
--  peut renvoyer QUE le user passe en argument et SES memberships -> aucune
--  donnee d'un autre user/tenant, aucun listing. L'appelant DOIT passer le sub
--  du JWT verifie (jamais une valeur cliente) : un user ne lit que SON profil.
--  password_hash N'EST PAS renvoye (PII / secret inutile a /auth/me).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "auth_get_user_profile"(p_user_id uuid)
RETURNS TABLE (
  user_id         uuid,
  email           text,
  full_name       text,
  platform_role   "PlatformRole",
  org_id          uuid,
  org_name        text,
  org_slug        text,
  membership_role "Role"
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    u."id",
    u."email",
    u."full_name",
    u."platform_role",
    o."id",
    o."name",
    o."slug",
    m."role"
  FROM "users" u
  LEFT JOIN "memberships"  m ON m."user_id" = u."id"
  LEFT JOIN "organizations" o ON o."id" = m."org_id"
  WHERE u."id" = p_user_id;
$$;

ALTER FUNCTION "auth_get_user_profile"(uuid) OWNER TO "roadsen_auth";
REVOKE ALL ON FUNCTION "auth_get_user_profile"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "auth_get_user_profile"(uuid) TO "roadsen_app";
