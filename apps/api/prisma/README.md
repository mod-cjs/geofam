# Socle base de données multi-tenant — RLS FORCE (issue #38)

Persistance PostgreSQL du socle ROADSEN. L'isolation entre tenants repose
sur **deux barrières** (défense en profondeur) :

1. **RLS `FORCE` cote base** (`migrations/0001_init_rls`) — barrière ultime,
   indépendante du code applicatif.
2. **Guard applicatif** — `PrismaService.withTenant()` pose
   `SET LOCAL app.current_org` par transaction, alimenté par le contexte
   tenant de la requête (`TenantContextMiddleware` → AsyncLocalStorage).

## Modèle de scoping

- Chaque table **métier** porte `org_id` (FK `organizations`).
- Policy `tenant_isolation` : `org_id = current_setting('app.current_org', true)::uuid`
  en `USING` **et** `WITH CHECK` (lecture _et_ écriture scopées).
- `current_setting(..., true)` = `missing_ok` : si l'org n'est pas posé,
  renvoie `NULL` → `org_id = NULL` est UNKNOWN → **aucune ligne** (fail-closed).
- `FORCE ROW LEVEL SECURITY` applique RLS **même au propriétaire** des tables.
- Le rôle applicatif runtime (`roadsen_app`) est créé **`NOBYPASSRLS`** et
  n'est ni superuser ni propriétaire.

> `organizations` et `users` n'ont pas de `org_id` (l'org _est_ le tenant,
> l'utilisateur peut être multi-org). Leur accès est scopé par
> membership/identité au niveau applicatif. Voir « points à challenger ».

## Appliquer (dev local)

```bash
pnpm db:up                              # Postgres 16 local (docker-compose)
pnpm --filter @roadsen/api prisma:generate
pnpm --filter @roadsen/api prisma:migrate:deploy   # joue 0001_init_rls
```

`migrate dev` régénère normalement le SQL depuis le schéma ; ici la migration
0001 est **écrite à la main** pour porter le DDL RLS (que Prisma ne génère pas).
Garder schéma et migration cohérents : toute évolution du schéma se fait via une
**nouvelle** migration, jamais en éditant 0001 une fois appliquée.

## Rollback

Plan documenté dans `migrations/0001_init_rls/down.sql` (Prisma ne joue pas les
down automatiquement → application manuelle via `psql`). Sur base partagée,
**rollback en binôme avec `ingenieur-securite`** + test d'isolation post-rollback.

## Prouver l'isolation

`test/rls-isolation.e2e-spec.ts` — se connecte comme rôle applicatif et vérifie :
fail-closed sans org, étanchéité SELECT, `WITH CHECK` sur INSERT cross-org,
non-effet d'un UPDATE aveugle sur un autre org.

```bash
pnpm db:up
pnpm --filter @roadsen/api prisma:migrate:deploy
RLS_TEST_DATABASE_URL="postgresql://roadsen_app:...@localhost:5432/roadsen_dev" \
  pnpm --filter @roadsen/api test:isolation
```

> Si aucune base n'est joignable, le test se marque **SKIP** (non exécuté),
> il ne passe **pas** en faux-vert. Le gating CI doit traiter « 0 test
> d'isolation exécuté » comme un échec (à régler avec `qa-test`).
