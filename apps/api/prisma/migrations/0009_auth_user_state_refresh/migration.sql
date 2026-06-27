-- =====================================================================
--  ROADSEN — Migration 0009 : etat du compte au REFRESH (M3, revue securite)
--
--  CONTEXTE / PROBLEME RESOLU
--  --------------------------
--  Le refresh des tokens (AuthService.refresh) etait STATELESS : un refresh token
--  valide reemettait des access tokens SANS revalider l'etat du compte en base.
--  Consequence : un compte desactive (is_active = false) ou SUPPRIME apres
--  l'emission du refresh token continuait a obtenir des access tokens frais
--  pendant toute la duree de vie du refresh (~7 j). Fenetre d'abus non bornee par
--  une desactivation cote admin.
--
--  CORRECTION : on revalide l'EXISTENCE + l'etat ACTIF du compte a CHAQUE refresh.
--  Le refresh recharge deja les memberships frais (ADR 0010) -> cette verif d'etat
--  se fait dans le MEME chemin DEFINER « a froid » (pas de contexte tenant en
--  main au refresh). Cout acceptable : le refresh n'a lieu qu'~toutes les 5 min.
--
--  POURQUOI UNE NOUVELLE FONCTION DEFINER
--  --------------------------------------
--  "users" est sous RLS scopee par org courant (0004/0007) : illisible « a froid »
--  par le runtime NOBYPASSRLS en requete ordinaire. Comme les autres lectures
--  d'identite hors tenant (auth_find_user_by_email, auth_get_user_profile), on
--  passe par une fonction SECURITY DEFINER owned par roadsen_auth, qui pose le
--  drapeau fail-closed app.auth_bootstrap (modele 0007) puis le referme.
--
--  auth_get_user_profile EXISTE deja mais N'EXPOSE PAS is_active (il ne renvoie
--  ni le drapeau d'activite ni un signal d'existence exploitable sans memberships).
--  Plutot que d'elargir son contrat (utilise par /auth/me, perimetre PII minimal),
--  on cree une fonction DEDIEE au perimetre encore plus etroit : pour un user_id
--  donne, renvoie UNE ligne (id, is_active) si le user existe, ZERO ligne sinon.
--  Aucun email, aucun hash, aucun membership : strictement l'etat de compte.
--
--  HYGIENE DEFINER (identique a 0005/0007)
--  ---------------------------------------
--    - SECURITY DEFINER, OWNED BY roadsen_auth, drapeau app.auth_bootstrap pose a
--      l'entree et REFERME avant tout RETURN / sur erreur (jamais de fuite hors
--      fonction).
--    - search_path FIGE `pg_catalog, public` (anti-hijack).
--    - EXECUTE revoque a PUBLIC, accorde au seul roadsen_app.
--    - perimetre MINIMAL : filtre STRICT u.id = p_user_id ; aucun listing, aucune
--      enumeration. L'appelant DOIT passer le sub du JWT verifie (jamais une
--      valeur cliente) -> un user n'interroge que SON propre etat.
--
--  PRE-REQUIS du OWNER TO (executant membre de roadsen_auth + CREATE sur le
--  schema) : poses en 0004, re-affirmes en 0007/0008. On NE les re-pose PAS ici
--  (toujours en place a 0009) ; l'OWNER TO ci-dessous est DUR (pas de DO/EXCEPTION
--  tolerant) : un echec doit CASSER la migration au deploy (lecon 0004->0007).
--
--  ADDITIVE : aucune table, aucune donnee, aucune migration anterieure modifiee.
--  Cree 1 fonction DEFINER. N'edite PAS 0001..0008.
--  Reversible : voir down.sql.
--  A REVOIR EN BINOME ingenieur-securite (DEFINER + lecture identite = critique).
-- =====================================================================

-- ---------------------------------------------------------------------
-- auth_get_user_state — etat de compte d'UN user (DEFINER, lecture « a froid »)
--
--  Renvoie (user_id, is_active) si le user existe, ZERO ligne s'il est INTROUVABLE
--  (user supprime depuis l'emission du refresh token). L'appelant (refresh) traite
--  « zero ligne » ET « is_active = false » de maniere identique -> 401 (pas de
--  nouveaux tokens). password_hash / email / memberships NON renvoyes (inutiles ici).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "auth_get_user_state"(p_user_id uuid)
RETURNS TABLE (
  user_id   uuid,
  is_active boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('app.auth_bootstrap', 'on', true);
  RETURN QUERY
    SELECT u."id", u."is_active"
    FROM "users" u
    WHERE u."id" = p_user_id
    LIMIT 1;
  PERFORM set_config('app.auth_bootstrap', 'off', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.auth_bootstrap', 'off', true);
  RAISE;
END;
$$;

-- Owner = roadsen_auth (detenteur du privilege identite + drapeau) : la lecture
-- franchit la RLS users « a froid » par la voie auditee, SANS BYPASSRLS. OWNER TO
-- DUR : un echec casse la migration (cf. en-tete, lecon 0004->0007).
ALTER FUNCTION "auth_get_user_state"(uuid) OWNER TO "roadsen_auth";
REVOKE ALL ON FUNCTION "auth_get_user_state"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "auth_get_user_state"(uuid) TO "roadsen_app";
