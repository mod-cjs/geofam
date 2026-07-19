-- =====================================================================
--  ROADSEN — Migration 0024 : DOCUMENT CLIENT AUTOPORTANT dans official_pvs (B1)
--
--  Zone CRITIQUE (integrite + regenerabilite du livrable). Corrige un DEFAUT du
--  scellement option-3 (revue adverse B1) : jusqu'ici seul sha256(print_html)
--  etait scelle, mais les OCTETS du document ne vivaient que dans calc_snapshots
--  (MUTABLE, UPSERT). Re-capturer un calcul APRES emission ecrasait la source ->
--  GET /pvs/:id/document tombait en 409, livrable PERDU. Or un PV officiel doit
--  etre AUTOPORTANT et REGENERABLE (DoD §5).
--
--  Correctif : official_pvs porte desormais une COPIE FIGEE du document scelle :
--    - document_html   TEXT NULL : les octets EXACTS du print_html au scellement
--      (NULL pour les PV sans capture / autres moteurs -> retro-compat, fallback PDF).
--    - document_format TEXT NULL : format du document (aujourd'hui 'html').
--  Ces colonnes suivent l'esprit de input_canonical : ecrites A L'INSERT, jamais
--  mutees (triggers d'immuabilite de 0006 inchanges). calc_snapshots redevient un
--  simple CACHE d'avant-scellement.
--
--  ADDITIVE : ALTER TABLE ADD COLUMN ... NULL (non bloquant, aucun defaut a
--  recalculer, pas de reecriture de table). N'edite PAS 0001..0023. Le trigger
--  d'immuabilite d'official_pvs interdit toujours UPDATE/DELETE au runtime ; l'INSERT
--  (deja accorde a roadsen_app) couvre les nouvelles colonnes. Reversible : voir down.sql.
--  A REVOIR EN BINOME ingenieur-securite + qa-challenger.
-- =====================================================================

ALTER TABLE "official_pvs"
  ADD COLUMN "document_html"   TEXT,
  ADD COLUMN "document_format" TEXT;
