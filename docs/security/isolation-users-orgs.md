# Isolation `users` & `organizations` — note threat (migration 0002)

Passe corrective post-revue adverse. Référence : `apps/api/prisma/migrations/0002_users_orgs_policy_bootstrap/`.

## Problème traité

La migration 0001 laissait `organizations` et `users` **sans RLS** (justifié à l'époque comme « tables de noyau »). Conséquence : le rôle applicatif `roadsen_app` (NOBYPASSRLS) pouvait, dès l'apparition d'un endpoint de listing, lire **tous** les users de la plateforme — y compris `password_hash` et PII (nom, e-mail) — et **toutes** les organisations. Fuite inter-bureaux directe + enjeu CDP / loi 2008-12 (minimisation, confidentialité des données personnelles).

Second trou : le bootstrap d'un nouvel org était en impasse. Le `WITH CHECK` de `memberships` (0001) exige `org_id = app.current_org`, donc impossible d'écrire le 1er membership OWNER de façon sûre sans rôle BYPASSRLS ad hoc.

## Contrôles posés

### `organizations` — RLS FORCE + policy `tenant_isolation`

- `USING`/`WITH CHECK` : `id = current_setting('app.current_org', true)::uuid`.
- Seule la ligne de l'org courante est visible/modifiable.
- `app.current_org` non posé → `NULL` → aucune ligne (fail-closed).

### `users` — RLS FORCE + policy `tenant_isolation` (scoping par membership partagé)

- Un user n'est visible que si `EXISTS` un membership le reliant à l'org courante.
- La sous-requête lit `memberships`, **elle-même sous RLS FORCE** : elle ne renvoie que les memberships de `app.current_org`. Le filtrage est donc transitif et cohérent, sans dépendre d'une colonne `org_id` sur `users`.
- Pas de policy « self » (`id = app.current_user`) : le socle ne pose pas d'identité utilisateur fiable côté base. Choix assumé, fail-closed. À élargir seulement si un besoin « voir son propre profil hors org » émerge (alors : introduire `app.current_user` + branche `OR self`).

### `provision_org(p_name, p_slug, p_owner_user_id)` — SECURITY DEFINER

- **Seule** voie sanctionnée pour écrire le 1er membership OWNER.
- Résout le chicken-egg : la fonction génère l'uuid de l'org, pose `set_config('app.current_org', <id>, true)` (portée transaction), puis insère org + membership → les deux `WITH CHECK` passent.
- `FORCE ROW LEVEL SECURITY` s'applique aussi au propriétaire/DEFINER : c'est pourquoi la fonction **pose elle-même le GUC** au lieu de compter sur un contournement implicite. Aucun BYPASSRLS, aucun rôle privilégié ad hoc.
- `search_path = pg_catalog, public` **figé** (anti-hijack : empêche un appelant de détourner la résolution de noms via un objet homonyme).
- `REVOKE ALL ... FROM PUBLIC` puis `GRANT EXECUTE ... TO roadsen_app` : la fonction DEFINER n'est exécutable que par le rôle applicatif.

## Preuve par test (cas concrets — à câbler dans `qa-test`)

Sous connexion `roadsen_app` (NOBYPASSRLS), dans des transactions distinctes :

1. **Provisioning** : `INSERT users` (user A) → `SELECT provision_org('BE Alpha','be-alpha', A)` renvoie `orgA`. Idem `orgB` avec user B. (L'INSERT du tout 1er user passe par voie DEFINER / seed — voir résidu.)
2. **Isolation org (lecture)** : `SET LOCAL app.current_org = orgA` → `SELECT * FROM organizations` ne renvoie **que** `orgA` ; jamais `orgB`.
3. **Isolation users (lecture)** : sous `orgA` → `SELECT * FROM users` ne renvoie **que** les users ayant un membership dans `orgA` (user A). User B **invisible** ; `password_hash`/PII de B jamais exposés.
4. **Fail-closed** : sans `SET LOCAL app.current_org` (GUC absent) → `SELECT * FROM organizations` et `SELECT * FROM users` renvoient **0 ligne**.
5. **Écriture croisée refusée** : sous `orgA`, `UPDATE organizations SET name=... WHERE id = orgB` → 0 ligne touchée ; `UPDATE users ... WHERE id = B` → 0 ligne touchée.
6. **WITH CHECK** : sous `orgA`, tentative de déplacer un membership vers `orgB` → rejet RLS.
7. **provision_org cloisonné** : `provision_org` exécutable par `roadsen_app` ; vérifier `REVOKE` effectif pour PUBLIC (un rôle tiers sans grant échoue sur `permission denied`).
8. **Post-migration** : rejouer 1–6 après application de 0002 sur une base déjà en 0001 (non-régression du cloisonnement existant `memberships`/`projects`).

> Honnêteté d'ingénieur : ces cas n'ont **pas** été exécutés ici (sandbox sans base PostgreSQL). Le SQL est revu statiquement ; la preuve réelle = exécution de la matrice ci-dessus par `qa-test` sur Postgres, avant toute mise en prod (jalon CDP).

## Résidu de surface / ce qui reste GATÉ

- **Pas d'endpoint de listing `users` ni `organizations`** tant que la matrice de test ci-dessus n'est pas verte en CI. La policy est fail-closed, mais l'absence d'endpoint reste la barrière de premier niveau.
- **Inscription self-service d'un user sans membership** : hors-scope socle. La RLS `users` empêche de créer/lire un user non rattaché à l'org courante. Tout flux « créer le tout 1er user d'un org » (ou un user orphelin destiné à un futur invite) doit passer par une **voie DEFINER dédiée** (ex. `provision_user(...)`) à concevoir, pas par un INSERT runtime. Le seed initial / l'INSERT du 1er user passé à `provision_org` relève aujourd'hui d'une opération privilégiée (migration/seed sous le propriétaire), à formaliser.
- **`provision_org` ne vérifie pas l'unicité applicative du slug** au-delà de l'index UNIQUE (0001) : un slug en doublon échoue sur la contrainte (message brut). Acceptable au socle ; à habiller côté API.
- **Pas d'`app.current_user`** côté base : aucune granularité intra-org au niveau RLS (le RBAC intra-org reste porté par les guards applicatifs + la colonne `role` du membership). Défense en profondeur applicative obligatoire, jamais la RLS seule.
- **Revue binôme `dev-backend`** requise sur le câblage : le `PrismaService` doit invoquer `provision_org` via `$queryRaw`/`$executeRaw` paramétré (jamais d'INSERT direct sur `organizations`), et continuer de poser `SET LOCAL app.current_org` par transaction. C'est du ressort de `dev-backend` (fichiers `apps/api/src/**`), hors périmètre de cette passe.
