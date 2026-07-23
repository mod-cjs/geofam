-- 0027 — ETIQUETTE D'AFFICHAGE `name` sur calc_results ET official_pvs
--
-- POURQUOI
-- Aujourd'hui, tous les calculs (et tous les PV) d'un meme moteur s'affichent a
-- l'identique : aucune colonne ne porte de libelle. On ajoute une ETIQUETTE
-- D'AFFICHAGE, MUTABLE, DISTINCTE DU CONTENU — et, pour le PV, DISTINCTE DU
-- CONTENU SCELLE. NULLABLE, et c'est le contrat : `name IS NULL` = pas de nom
-- personnalise (le front retombe sur un mnemonique calcule). On n'invente aucun
-- libelle pour les lignes existantes.
--
-- ADDITIVE ET REJOUABLE (`IF NOT EXISTS`) : aucune colonne retiree, aucune donnee
-- reecrite, aucun verrou long (ADD COLUMN nullable sans defaut = operation de
-- catalogue seule sous PostgreSQL 11+). Plan de rollback : down.sql (a jouer
-- manuellement — Prisma Migrate ne joue pas les « down », cf. convention du depot).
--
-- ISOLATION : calc_results et official_pvs sont deja sous RLS FORCE + policy
-- `tenant_isolation` (scope `org_id = app_current_org()`, 0006). Une colonne
-- supplementaire n'ouvre aucun chemin de lecture nouveau (la policy porte sur la
-- LIGNE, pas sur la liste des colonnes) et les GRANT de 0006 sont au niveau TABLE
-- (ils couvrent les colonnes futures en SELECT/INSERT). Meme raisonnement qu'en
-- 0022/0026 pour `domain`/`archived_at`.
--
-- ⚠️ POINT SENSIBLE (a faire revoir par ingenieur-securite avant toute prod) :
-- official_pvs est IMMUABLE (trigger 0006 + AUCUN privilege UPDATE au runtime).
-- Le `name` du PV est une ETIQUETTE, PAS du contenu scelle : il n'entre NI dans
-- input_canonical NI dans le HMAC/content_hash. Pour le rendre renommable SANS
-- casser l'immuabilite du sceau, on ouvre une breche MINIMALE et PROUVEE :
--   1) un privilege UPDATE au NIVEAU COLONNE, sur la SEULE colonne `name` ;
--   2) le trigger d'immuabilite est remplace par une variante qui autorise un
--      UPDATE UNIQUEMENT si TOUTES les autres colonnes sont inchangees.
-- Toute tentative de reecrire une colonne scellee (input_canonical, hmac, output,
-- identite, numero...) reste REFUSEE, exactement comme avant.

-- ---------------------------------------------------------------------
-- 1) calc_results.name — calcul MUTABLE : simple colonne nullable.
--    calc_results a deja le DML complet (SELECT/INSERT/UPDATE/DELETE) pour
--    roadsen_app (0006) : le GRANT au niveau table couvre la colonne future.
-- ---------------------------------------------------------------------
ALTER TABLE "calc_results" ADD COLUMN IF NOT EXISTS "name" TEXT;

-- ---------------------------------------------------------------------
-- 2) official_pvs.name — ETIQUETTE HORS SCEAU, sur une table IMMUABLE.
-- ---------------------------------------------------------------------
ALTER TABLE "official_pvs" ADD COLUMN IF NOT EXISTS "name" TEXT;

-- Privilege UPDATE au NIVEAU COLONNE : roadsen_app ne peut ecrire QUE `name`.
-- Un UPDATE touchant n'importe quelle autre colonne echoue faute de privilege,
-- AVANT meme le trigger — premiere des deux barrieres. (0006 avait
-- REVOKE UPDATE, DELETE ON official_pvs FROM roadsen_app ; on ne rend ICI que
-- UPDATE(name), jamais DELETE, jamais UPDATE sur une autre colonne.)
GRANT UPDATE ("name") ON "official_pvs" TO "roadsen_app";

-- Seconde barriere : le trigger BEFORE UPDATE. On remplace la fonction utilisee
-- par le trigger d'UPDATE (le trigger de DELETE garde official_pvs_immutable(),
-- qui RAISE toujours -> un PV ne se supprime JAMAIS). La nouvelle fonction
-- autorise l'UPDATE UNIQUEMENT si la ligne, PRIVEE de sa colonne `name`, est
-- STRICTEMENT identique avant/apres : seule l'etiquette peut bouger, TOUT le
-- reste (contenu scelle) reste immuable. La comparaison porte sur to_jsonb(row)
-- MOINS la cle 'name' -> elle couvre AUSSI toute colonne ajoutee a l'avenir
-- (fail-closed par construction : un futur champ scelle serait protege sans
-- retouche de ce trigger).
CREATE OR REPLACE FUNCTION "official_pvs_seal_immutable_update"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  -- `-` (jsonb, text) retire la cle 'name' des deux cotes ; IS DISTINCT FROM
  -- compare le RESTE. Toute difference hors `name` = tentative de reecriture du
  -- contenu scelle -> REFUS (meme ERRCODE 'R0002' que l'immuabilite d'origine).
  IF (to_jsonb(NEW) - 'name') IS DISTINCT FROM (to_jsonb(OLD) - 'name') THEN
    RAISE EXCEPTION 'official_pvs est IMMUABLE hormis son etiquette name : UPDATE hors-name interdit sur un PV scelle'
      USING ERRCODE = 'R0002';
  END IF;
  RETURN NEW;
END;
$$;

-- Bascule le trigger d'UPDATE vers la nouvelle fonction. Le trigger de DELETE
-- (official_pvs_no_delete -> official_pvs_immutable) reste INCHANGE.
DROP TRIGGER IF EXISTS "official_pvs_no_update" ON "official_pvs";
CREATE TRIGGER "official_pvs_no_update"
  BEFORE UPDATE ON "official_pvs"
  FOR EACH ROW EXECUTE FUNCTION "official_pvs_seal_immutable_update"();
