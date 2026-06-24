# Runbook — Déploiement recette ROADSEN (API + Swagger)

Environnement : `@recette` / `@science-unsigned`  
Surface : API NestJS seule (pas d'UI front). STARFIRE rejoue ses cas-tests via Swagger.  
Données : **TEST UNIQUEMENT** — aucune donnée client réelle ne transite en recette.

---

## Pré-requis

- Accès au dashboard Render (compte ryhow99@gmail.com).
- Accès au dépôt GitHub (push sur la branche `recette`).
- Secrets générés localement (ne jamais les committer) :
  ```
  openssl rand -hex 64   # JWT_SECRET
  openssl rand -hex 64   # PV_SIGNING_SECRET
  openssl rand -hex 32   # RECETTE_API_KEY  → à communiquer à STARFIRE
  ```

---

## Étapes de déploiement

### 0. Vérifier que §0 build-pkgs est terminé

Les commandes `buildCommand` et `startCommand` du `render.yaml` supposent que
`node apps/api/dist/main.js` est générable par `turbo run build --filter=@roadsen/api...`.
Si l'agent `build-pkgs` n'a pas encore finalisé le packaging de `@roadsen/engines`
et `@roadsen/shared`, ne pas pousser en recette — le build Render échouera.

Points à confirmer avec `build-pkgs` avant de pousser :

- `@roadsen/engines/package.json` : champ `main` ou `exports` pointant sur `dist/`.
- `@roadsen/shared/package.json` : idem.
- `turbo run build --filter=@roadsen/api...` produit `apps/api/dist/main.js`.

### 1. Créer et pousser la branche recette

Le hook `pre-push` bloque le push direct sur `main`. Utiliser une branche dédiée :

```bash
git checkout -b recette
git push -u origin recette
```

Render surveille cette branche. Chaque `git push origin recette` déclenche un
redéploiement automatique.

### 2. Connecter le Blueprint Render (première fois)

1. Dashboard Render → **New → Blueprint**
2. Sélectionner le dépôt GitHub (`roadsen`)
3. Sélectionner la branche **`recette`**
4. Render détecte `05-Plateforme/render.yaml` (rootDir configuré dans le Blueprint).
   Si non détecté automatiquement : pointer manuellement vers `05-Plateforme/render.yaml`.
5. Render liste les ressources à créer :
   - `roadsen-api-recette` (web, Node, Frankfurt)
   - `roadsen-db-recette` (PostgreSQL 16, Frankfurt)
6. Valider → **Apply**

### 3. Saisir les secrets dans le dashboard

Dashboard → **roadsen-api-recette** → **Environment** → **Add Secret** :

| Clé                 | Valeur                 | Remarque                                  |
| ------------------- | ---------------------- | ----------------------------------------- |
| `JWT_SECRET`        | `openssl rand -hex 64` | Secret de signature JWT                   |
| `PV_SIGNING_SECRET` | `openssl rand -hex 64` | Scellement des PV                         |
| `RECETTE_API_KEY`   | `openssl rand -hex 32` | Communiquer à STARFIRE par canal sécurisé |

Les variables non-secrètes (`NODE_ENV`, `NODE_VERSION`, `ROADSEN_EXPOSE_DOCS`) sont
déclarées dans `render.yaml` avec leurs valeurs — pas besoin de les resaisir.

### 4. Rôles PostgreSQL (si CREATEROLE manquant)

Les migrations 0001 et 0004 créent les rôles `roadsen_app` et `roadsen_auth`
via des blocs DO idempotents. Si `preDeployCommand` (`prisma migrate deploy`)
échoue avec `permission denied to create role` :

1. Dashboard → **roadsen-db-recette** → **Shell**
2. Copier-coller le contenu de `infra/recette/init-roles.sql`
3. Vérifier la sortie de la requête finale :
   ```
   roadsen_app  | LOGIN=f | BYPASSRLS=f | SUPERUSER=f
   roadsen_auth | LOGIN=f | BYPASSRLS=t | SUPERUSER=f
   ```
4. Dashboard → **roadsen-api-recette** → **Manual Deploy** → relancer.

**Point à trancher par le titulaire :** si l'utilisateur managé Render n'a pas
CREATEROLE et ne peut pas l'obtenir (plan starter), le script fallback ci-dessus
suffit. Si Render accorde CREATEROLE aux utilisateurs managés sur le plan starter,
les migrations s'en chargent seules (vérifier dans les logs du premier déploiement).

### 5. Vérification post-déploiement

Remplacer `<HOST>` par `https://roadsen-api-recette.onrender.com`.

**a. Santé API**

```bash
curl -s <HOST>/v1/health
# Attendu : {"status":"ok"}
```

**b. Swagger UI**

```
GET <HOST>/docs
```

Ouvrir dans un navigateur → Swagger UI doit se charger sans erreur.  
Vérifier que les sections `calc`, `health`, `auth`, `projects` sont présentes.

**c. Smoke test POST /calc/terzaghi** (endpoint `@Public`, pas de token JWT requis)

```bash
curl -s -X POST <HOST>/calc/terzaghi \
  -H "Content-Type: application/json" \
  -H "X-Recette-Key: <RECETTE_API_KEY>" \
  -d '{
    "soilLayers": [
      {
        "thickness": 2.0,
        "gamma": 18,
        "phi": 30,
        "cohesion": 0,
        "name": "sable"
      }
    ],
    "foundationDepth": 1.5,
    "foundationWidth": 1.0,
    "foundationLength": 1.5,
    "loadAngle": 0,
    "groundwaterDepth": 5.0
  }'
# Attendu : {"ok":true,"meta":{...},"output":{...}}
```

Note : `/calc/terzaghi` est actuellement `@Public` (pilote #45). L'en-tête
`X-Recette-Key` n'est pas vérifié applicativement sur cet endpoint — il est
documenté ici comme convention pour STARFIRE. Le guard `RECETTE_API_KEY` sera
instrumenté sur les endpoints non-@Public lors du câblage auth.

**d. Vérifier les logs Render**
Dashboard → **roadsen-api-recette** → **Logs** :

- Aucune ligne `Error` ou `Exception` au démarrage.
- Ligne confirmant l'écoute sur le port (`Listening on port <PORT>`).
- Aucune ligne `assertNoDevHeadersInProd` (ce serait un crash de boot).
- Migrations Prisma : `All migrations have been successfully applied.`

### 6. Communication des accès à STARFIRE

Transmettre par canal sécurisé (pas par email en clair) :

- URL de base : `https://roadsen-api-recette.onrender.com`
- URL Swagger : `https://roadsen-api-recette.onrender.com/docs`
- Clé d'accès recette : `RECETTE_API_KEY` (en-tête `X-Recette-Key`)
- Rappel : données TEST uniquement — étiquetage `@science-unsigned`

---

## Rollback

### Rollback Render (en cas de déploiement cassé)

1. Dashboard → **roadsen-api-recette** → **Events**
2. Sélectionner le déploiement précédent (statut `Live`)
3. Cliquer **Rollback to this deploy**

Render rebascule le trafic vers le déploiement précédent sans downtime.

### Rollback de migration (down.sql)

Chaque migration dispose d'un `down.sql` documenté dans
`apps/api/prisma/migrations/<migration>/down.sql`. En cas de migration cassée :

1. Identifier la migration à annuler.
2. Exécuter son `down.sql` manuellement dans le Shell Render :
   Dashboard → **roadsen-db-recette** → **Shell** → coller le contenu du `down.sql`.
3. Corriger le code, pousser sur `recette` → Render redéploie.

⚠️ Les `down.sql` sont documentés mais non exécutés automatiquement par Prisma.
Toujours tester sur une copie de la base avant d'exécuter en recette.

---

## Checklist secrets

- [ ] `JWT_SECRET` saisi dans Dashboard (jamais dans le repo)
- [ ] `PV_SIGNING_SECRET` saisi dans Dashboard (jamais dans le repo)
- [ ] `RECETTE_API_KEY` saisi dans Dashboard + communiqué à STARFIRE
- [ ] `ROADSEN_DEV_HEADERS` ABSENT du Dashboard (sa présence = crash boot en prod)
- [ ] `SHADOW_DATABASE_URL` ABSENT du Dashboard (dev local uniquement)

---

## Rappel conformité

- Toutes les données recette sont **TEST UNIQUEMENT** — étiquetage `@science-unsigned`.
- Aucune donnée personnelle réelle ni donnée client STARFIRE ne doit transiter.
- MJ-6 : la mise en production réelle (données réelles, accès public) est
  conditionnée à la conformité des cas-tests STARFIRE et à la déclaration CDP
  (loi sénégalaise 2008-12 + transfert hors Sénégal vers Render Frankfurt).
  Cette recette n'est PAS une mise en production.
