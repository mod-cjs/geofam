-- =====================================================================
--  ROADSEN — Migration 0001 : socle multi-tenant + RLS FORCE
--
--  Cette migration cree le schema du socle (organizations, users,
--  memberships, projects) PUIS active l'isolation au niveau base :
--    - ROW LEVEL SECURITY + FORCE ROW LEVEL SECURITY sur chaque table a org_id
--    - policy d'isolation par org_id s'appuyant sur current_setting('app.current_org')
--
--  Modele de scoping : l'application pose `SET LOCAL app.current_org = '<uuid>'`
--  en debut de chaque transaction (cf. PrismaService / TenantContextMiddleware).
--  RLS = filet de securite cote base ; le guard applicatif = defense en profondeur.
--
--  IMPORTANT : le role applicatif runtime NE DOIT PAS avoir BYPASSRLS.
--  Le proprietaire de la table contourne RLS par defaut -> d'ou le FORCE,
--  qui applique RLS MEME au proprietaire. Voir la section roles en bas.
--
--  Reversible : voir prisma/migrations/0001_init_rls/down.sql (rollback documente).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Types enumeres
-- ---------------------------------------------------------------------
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'ENGINEER', 'TECHNICIAN', 'VIEWER');
CREATE TYPE "PlatformRole" AS ENUM ('SUPERADMIN', 'SUPPORT');
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- ---------------------------------------------------------------------
-- 2) Tables
-- ---------------------------------------------------------------------
CREATE TABLE "organizations" (
  "id"        UUID         NOT NULL DEFAULT gen_random_uuid(),
  "name"      TEXT         NOT NULL,
  "slug"      TEXT         NOT NULL,
  "status"    "OrgStatus"  NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations" ("slug");

CREATE TABLE "users" (
  "id"            UUID           NOT NULL DEFAULT gen_random_uuid(),
  "email"         TEXT           NOT NULL,
  "password_hash" TEXT,
  "full_name"     TEXT           NOT NULL,
  "platform_role" "PlatformRole",
  "is_active"     BOOLEAN        NOT NULL DEFAULT true,
  "created_at"    TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3)   NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users" ("email");

CREATE TABLE "memberships" (
  "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
  "org_id"     UUID         NOT NULL,
  "user_id"    UUID         NOT NULL,
  "role"       "Role"       NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memberships_org_id_fkey" FOREIGN KEY ("org_id")
    REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "memberships_org_id_user_id_key" ON "memberships" ("org_id", "user_id");
CREATE INDEX "memberships_org_id_idx" ON "memberships" ("org_id");
CREATE INDEX "memberships_user_id_idx" ON "memberships" ("user_id");

CREATE TABLE "projects" (
  "id"            UUID            NOT NULL DEFAULT gen_random_uuid(),
  "org_id"        UUID            NOT NULL,
  "name"          TEXT            NOT NULL,
  "status"        "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
  "created_by_id" UUID            NOT NULL,
  "created_at"    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3)    NOT NULL,
  CONSTRAINT "projects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "projects_org_id_fkey" FOREIGN KEY ("org_id")
    REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "projects_org_id_idx" ON "projects" ("org_id");
CREATE INDEX "projects_org_id_status_idx" ON "projects" ("org_id", "status");

-- ---------------------------------------------------------------------
-- 3) Isolation multi-tenant — RLS FORCE
--
--  current_setting('app.current_org', true) :
--    - 2e argument `true` = "missing_ok" -> renvoie NULL si la variable
--      n'est pas posee, AU LIEU de lever une erreur. Sans org pose,
--      `org_id = NULL` est UNKNOWN -> AUCUNE ligne visible (fail-closed).
--    - le cast ::uuid sur NULL reste NULL (pas d'erreur).
--
--  Une SEULE policy permissive par table couvre SELECT/INSERT/UPDATE/DELETE
--  via USING (lignes visibles/modifiables) + WITH CHECK (lignes ecrites).
--  WITH CHECK empeche d'INSERER ou de deplacer une ligne vers un autre org.
-- ---------------------------------------------------------------------

-- memberships
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "memberships"
  USING ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- projects
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "projects"
  USING ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- NOTE — organizations & users :
--  Ce sont des tables de NOYAU (pas de colonne org_id : l'organisation EST
--  le tenant, l'utilisateur peut etre multi-org). Leur acces ne se scope pas
--  par org_id mais par appartenance/identite, gere au niveau applicatif
--  (guards RBAC + requetes scopees par membership). On NE leur applique donc
--  PAS la policy org_id ici. A revoir avec ingenieur-securite si l'on veut
--  une policy "self/membership" cote base (cf. points a challenger).

-- ---------------------------------------------------------------------
-- 4) Roles & droits — le runtime ne contourne PAS RLS
--
--  Conventionnellement, le proprietaire des tables (role qui a joue la
--  migration) contourne RLS. FORCE ci-dessus neutralise ce contournement
--  POUR LE PROPRIETAIRE. En complement, le runtime applicatif doit se
--  connecter avec un role NON-proprietaire et NON-superuser, SANS BYPASSRLS.
--
--  Ce bloc est idempotent et defensif : il cree le role applicatif s'il
--  n'existe pas et lui accorde le strict DML. Il N'attribue PAS de mot de
--  passe (gere hors-migration via secret / Render). En managed (Render),
--  l'utilisateur fourni n'est de toute facon ni superuser ni proprietaire.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'roadsen_app') THEN
    CREATE ROLE "roadsen_app" NOLOGIN NOBYPASSRLS;
  ELSE
    -- garantit l'absence de BYPASSRLS meme si le role preexistait
    ALTER ROLE "roadsen_app" NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO "roadsen_app";
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "organizations", "users", "memberships", "projects"
  TO "roadsen_app";
-- defaut pour de futures tables creees par le proprietaire :
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "roadsen_app";
