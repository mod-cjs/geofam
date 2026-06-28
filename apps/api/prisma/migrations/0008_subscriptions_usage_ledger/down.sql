-- =====================================================================
--  ROADSEN — Rollback de la migration 0008 (abonnements + ledger d'usage)
--
--  Prisma Migrate ne joue PAS les "down" : plan de rollback DOCUMENTE, a
--  appliquer manuellement (psql). Ordre INVERSE de migration.sql.
--
--  ATOMIQUE : enveloppe dans une transaction (BEGIN/COMMIT). Une erreur
--  intermediaire -> ROLLBACK manuel, aucun etat partiel.
--
--  AVERTISSEMENT — DESTRUCTIF SUR ABONNEMENTS + USAGE.
--  Ce down DROP subscriptions et usage_ledger : tout abonnement et tout
--  historique de consommation sont PERDUS. En preprod/prod, SAUVEGARDER d'abord
--  (le ledger est la verite auditable de la facturation).
--
--  NOTE DEPLOIEMENT (manage) : si l'ALTER FUNCTION ... OWNER TO roadsen_auth de
--  la migration a echoue faute de droits, jouer cette section en tant que role
--  apte (proprietaire de la fonction). Les GRANTs/REVOKES tombent avec le DROP.
-- =====================================================================

BEGIN;

-- 0) Colonne verdict de official_pvs (ADR 0012) — additive, retiree ici.
--    (DDL autorise malgre les triggers d'immuabilite, qui ne bloquent que le DML.)
ALTER TABLE "official_pvs" DROP CONSTRAINT IF EXISTS "official_pvs_verdict_chk";
ALTER TABLE "official_pvs" DROP COLUMN IF EXISTS "verdict";

-- 1) Fonction de provisionnement (revoke + drop) ----------------------------
REVOKE ALL ON FUNCTION
  "provision_subscription"(uuid, text, text[], timestamptz, timestamptz, integer)
  FROM "roadsen_app";
DROP FUNCTION IF EXISTS
  "provision_subscription"(uuid, text, text[], timestamptz, timestamptz, integer);

-- 2) Triggers + fonction d'immuabilite du ledger ----------------------------
DROP TRIGGER IF EXISTS "usage_ledger_no_update" ON "usage_ledger";
DROP TRIGGER IF EXISTS "usage_ledger_no_delete" ON "usage_ledger";
DROP FUNCTION IF EXISTS "usage_ledger_immutable"();

-- 3) Tables (policies/RLS tombent avec la table). usage_ledger AVANT
--    subscriptions (FK composite enfant -> parent). ---------------------------
DROP TABLE IF EXISTS "usage_ledger";
DROP TABLE IF EXISTS "subscriptions";

COMMIT;
