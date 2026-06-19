# ROADSEN — Cadre d'ingénierie & environnement de travail (Phase 1)

Runbook du socle technique : comment on monte le poste, comment on développe, comment on teste, comment on livre. Ce document est la référence opérationnelle ; il est cohérent avec la **Definition of Done** du `CLAUDE.md` projet.

Décisions déjà arrêtées (non rediscutées ici) :

- **API & calculs serveur** : NestJS + Prisma
- **Front** : Next.js + Tailwind + shadcn/ui + PWA
- **Base** : PostgreSQL 16 managé (Render)
- **Réseau/CDN/stockage** : Cloudflare (DNS / R2 / WAF)
- **Hébergement** : Render
- **Phase 2** : e-mail Resend, paiement PayDunya
- **Monorepo** : pnpm workspaces + Turborepo ; Node LTS 20 via fnm

> **Confidentialité — cœur du projet.** Les 6 moteurs de calcul sont confidentiels et s'exécutent **côté serveur uniquement**. Ils vivent dans `packages/engines`, importé **exclusivement** par `apps/api`, **jamais** par `apps/web`. Le navigateur envoie des entrées, reçoit des résultats. Garde-fou en place : règle ESLint `no-restricted-imports` + séparation par package (voir `.eslintrc.cjs` et ADR 0002).

---

## 1. Mise en place du poste (macOS)

Contexte poste : macOS Monterey, Homebrew lent → on installe en direct (curl / corepack) quand c'est possible. Tout est scripté dans `scripts/setup-macos.sh` ; ci-dessous les commandes exactes, à exécuter une fois.

### 1.1 fnm + Node 20 (sans Homebrew)

```bash
# fnm via le script officiel (rapide, pas de brew)
curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell

# Ajouter à ~/.zshrc (le script setup-macos.sh le fait automatiquement) :
export PATH="$HOME/.local/share/fnm:$PATH"
eval "$(fnm env --use-on-cd)"

# Recharger le shell, puis :
fnm install 20
fnm default 20
fnm use 20
node -v        # -> v20.x
```

Un fichier `.nvmrc`/`.node-version` à la racine du repo (`20`) permet à `fnm` de basculer automatiquement à l'entrée du dossier (`--use-on-cd`).

### 1.2 pnpm via corepack (pas d'install globale séparée)

```bash
corepack enable
corepack prepare pnpm@9.12.0 --activate
pnpm -v        # -> 9.12.0
```

Le champ `packageManager` du `package.json` racine épingle la version : tout le monde (et la CI) utilise exactement la même.

### 1.3 Docker Desktop (Postgres local)

Installer **Docker Desktop** depuis le site officiel (https://www.docker.com/products/docker-desktop/). Une fois lancé :

```bash
pnpm db:up      # démarre Postgres 16 (docker-compose.postgres.yml)
pnpm db:logs    # suit les logs
pnpm db:down    # arrête
```

La base locale est en Postgres **16** — même version majeure que la base managée Render, pour éviter les divergences de comportement.

### 1.4 Outils éditeur & clients

| Outil | Rôle | Installation |
|---|---|---|
| **VS Code** | éditeur principal | site officiel (ou `code` si déjà présent) |
| Extensions VS Code | ESLint, Prettier, Prisma, Tailwind, Docker, Vitest, Playwright, GitHub Actions | recommandées via `.vscode/extensions.json` (VS Code propose de les installer à l'ouverture du repo) |
| **TablePlus** | client PostgreSQL (inspection, requêtes) | site officiel (.dmg direct) |
| **Bruno** | client API (collections versionnées dans le repo, alternative locale à Postman) | site officiel (.dmg direct) |
| **git** | déjà fourni par les Command Line Tools de Xcode | `xcode-select --install` si absent |
| **GitHub CLI (`gh`)** | labels/jalons, PR en ligne de commande | `.pkg` depuis github.com/cli/cli/releases (évite brew) |

### 1.5 Dépendances projet & hooks

```bash
cd 05-Plateforme
pnpm install            # installe tout le monorepo
git init                # si pas déjà un dépôt
pnpm exec husky         # active les hooks git (pre-commit + commit-msg)
```

> Le tout est automatisé : `bash scripts/setup-macos.sh` enchaîne fnm → Node 20 → corepack/pnpm → vérif Docker → `pnpm install` → hooks. Idempotent.

---

## 2. Comptes & services à ouvrir

| Service | Usage Phase 1 | Notes |
|---|---|---|
| **GitHub** | dépôt, CI/CD (Actions), Projects, Dependabot | repo privé `starfire/roadsen` (ou compte titulaire) ; activer la protection de branche `main` |
| **Cloudflare** | DNS, CDN, WAF, R2 (stockage PV — actif Phase 2) | gratuit pour DNS/WAF de base ; R2 = stockage sans frais d'egress |
| **Render** | hébergement `apps/api` (web service) + `apps/web` + PostgreSQL managé | choisir une **région** proche de l'Afrique de l'Ouest (Frankfurt par défaut, latence acceptable) ; environnements **préprod** puis **prod** |
| **Registrar domaine** | nom de domaine (ex. `.com` / `.sn`) | DNS délégué à Cloudflare (NS) après achat |
| **Sentry** (préprod) | erreurs runtime API + front | offre gratuite suffisante en Phase 1 |

> Le suivi du coût récurrent (Render + domaine + éventuel Sentry payant) est à tenir aligné sur le budget de cadrage. Les frais **PayDunya** (Phase 2) sont proportionnels au CA et distincts des coûts d'infrastructure : à ne pas mélanger dans la facture STARFIRE.

---

## 3. Architecture du monorepo

```
05-Plateforme/
├─ apps/
│  ├─ api/                 # NestJS + Prisma — SEUL à importer @roadsen/engines
│  │  └─ (nest new à scaffolder)
│  └─ web/                 # Next.js + Tailwind + shadcn/ui + PWA
│     └─ (create-next-app à scaffolder)
├─ packages/
│  ├─ engines/             # MOTEURS — CONFIDENTIEL, SERVEUR UNIQUEMENT
│  │  ├─ src/              #   modules TS purs & déterministes (golden-master)
│  │  └─ README.md         #   cartographie GeoSuite + règle de confidentialité
│  └─ shared/              # types + schémas Zod partagés api <-> web
│     └─ src/              #   ne dépend JAMAIS de @roadsen/engines
├─ docs/adr/               # décisions d'architecture (ADR numérotés)
├─ scripts/                # setup-macos.sh, gh-project-setup.sh
├─ .github/                # workflows CI, dependabot, templates issue/PR
├─ .husky/                 # hooks pre-commit + commit-msg
├─ pnpm-workspace.yaml · turbo.json · tsconfig.base.json
├─ .eslintrc.cjs · .prettierrc · commitlint.config.cjs
├─ docker-compose.postgres.yml · .env.example · .gitignore
└─ package.json            # scripts turbo (dev/build/lint/test/...)
```

**Frontières (non négociables) :**

- `packages/engines` ← importé **seulement** par `apps/api`. Modules **purs** (mêmes entrées → mêmes sorties), pas de DOM, pas d'I/O. C'est la propriété intellectuelle confidentielle.
- `packages/shared` ← types & contrats Zod, partagés entre `api` et `web`. **Ne dépend pas** de `engines` (sinon le front tirerait les moteurs par transitivité — la règle ESLint le bloque aussi sur `shared`).
- `apps/web` ← ne connaît que `shared` et l'API HTTP. Aucun calcul métier confidentiel côté client.

---

## 4. Méthode de développement

### 4.1 TDD (rouge → vert → refactor)

1. **Rouge** : écrire le test qui décrit le comportement attendu — il échoue.
2. **Vert** : écrire le minimum de code pour le faire passer.
3. **Refactor** : nettoyer sans changer le comportement (les tests restent verts).

Sur correction de bug : on reproduit d'abord par un test **rouge**, puis on corrige.

### 4.2 Golden-master sur les moteurs (les cas-tests STARFIRE = la spec)

Les moteurs ne se « spécifient » pas : ils se **vérifient** contre des références.

- Les **cas-tests STARFIRE** (entrées → sorties attendues) sont figés en fixtures et deviennent la spec exécutable.
- À l'extraction d'un moteur HTML → module TS, deux équivalences sont prouvées :
  - **module extrait ↔ origine HTML** (non-régression d'extraction) ;
  - **recalcul serveur ↔ résultat client affiché** (cohérence bout en bout).
- Toute évolution d'un moteur fourni passe par `expert-genie-civil` puis avenant — jamais une retouche silencieuse (gouvernance « moteur gelé »).

### 4.3 BDD léger (Given / When / Then)

Les critères d'acceptation des issues et les noms de tests s'écrivent en **Given / When / Then** — lisibles par le client, directement traduisibles en tests (notamment d'isolation : *Given un user du tenant A, When il liste les projets, Then il ne voit que ceux de A*).

### 4.4 Branches courtes, PR, commits conventionnels

- **Trunk-based léger** : `main` toujours déployable ; branches **courtes** par feature/fix, mergées vite via **Pull Request**.
- Nommage : `feat/<sujet>`, `fix/<sujet>`, `chore/<sujet>`.
- **Commits conventionnels** (`feat(api): …`, `fix(web): …`) — validés par commitlint au commit (voir `commitlint.config.cjs`). Ils alimentent un historique lisible et, plus tard, un changelog.

---

## 5. Stratégie de tests (pyramide)

```
        e2e (Playwright)          ← peu nombreux, parcours critiques
     intégration (API + DB)       ← contrats, RLS/isolation, migrations
  unitaire (Vitest) — large base  ← moteurs, logique métier, mappers, Zod
```

| Niveau | Outil | Couvre |
|---|---|---|
| **Unitaire** | Vitest | moteurs (`packages/engines`), logique métier, validation Zod (`shared`), helpers |
| **Intégration** | Vitest + Postgres (service CI) | endpoints API, persistance Prisma, **isolation multi-tenant** (RLS + guards), migrations |
| **e2e** | Playwright | parcours utilisateur critiques (login, créer un projet, lancer un calcul, générer un PV) |

Familles de tests spécifiques ROADSEN :

- **Équivalence moteurs** (non-régression) : `module extrait ↔ origine` et `serveur ↔ client`, dans la tolérance convenue. Échec = blocage.
- **Tests d'isolation** : un tenant ne voit/altère jamais les données d'un autre — y compris **après migration de schéma**.
- **Golden tests PV** : un PV recalculé serveur est scellé (identité + horodatage + intégrité), numéroté, **régénérable** à l'identique.
- **Seuils de couverture élevés** sur `packages/engines` et le code métier (la couverture cosmétique du front n'est pas l'objectif ; la justesse du calcul l'est).

---

## 6. CI/CD & portes qualité (GitHub Actions)

Fichier : `.github/workflows/ci.yml`. Deux moments :

### 6.1 Sur Pull Request → portes bloquantes (pas de merge si rouge)

| Job | Vérifie | Mappe à la DoD |
|---|---|---|
| `quality` | **lint** (inclut le garde-fou confidentialité moteurs) + **typecheck** + **build** | « Code mergé dans le style du dépôt » · confidentialité |
| `unit` | **Vitest** + couverture | « Calculs conformes » (golden) · « Tests verts » |
| `integration` | API + **Postgres** (service) + migrations + **isolation multi-tenant** | « Isolation prouvée » · « Tests verts » |

→ Protection de branche `main` à activer côté GitHub : **PR obligatoire**, ces jobs requis verts, pas de push direct.

### 6.2 Au merge sur `main` → e2e + déploiement préprod

| Job | Action | Mappe à la DoD |
|---|---|---|
| `e2e` | **Playwright** sur les parcours critiques | « Tests e2e pertinents verts » |
| `deploy-preprod` | déclenche les **deploy hooks Render** (api + web) | « Déployable en préprod (rollback possible) » |

Rollback : Render conserve l'historique des déploiements → **« Rollback » en un clic** vers le déploiement précédent. À tester réellement une fois en préprod (ne pas le supposer).

### 6.3 Hygiène des dépendances

- **Dependabot** (`.github/dependabot.yml`) : PR hebdomadaires (npm + GitHub Actions), mineures/patch groupées.
- `pnpm audit` à intégrer comme étape informative (et bloquante sur vulnérabilités hautes une fois la base stabilisée).

> Mapping DoD complet : code mergé (`quality`) · tests verts (`unit`+`integration`+`e2e`) · isolation (`integration`) · calculs conformes (`unit` golden) · livrables scellés (golden PV) · revue `qa-challenger` (hors CI, étape humaine avant client) · déployable préprod (`deploy-preprod`).

---

## 7. Gestion de projet — GitHub Projects (recommandé)

Outil : **GitHub Projects** (board lié au dépôt). Avantage : issues, PR, commits et board au même endroit ; lien automatique issue ↔ PR ↔ commit ; accès **lecture** facile pour le client.

### 7.1 Board — colonnes

| Colonne | Signification |
|---|---|
| **Backlog** | idées / demandes non encore prêtes |
| **Ready** | issue prête (passe la **DoR**), priorisée, peut être prise |
| **In progress** | une branche est ouverte, travail en cours |
| **Review** | PR ouverte, CI verte, en attente de revue (dont `qa-challenger`) |
| **Done** | mergé + préprod ok (passe la **DoD**) |

### 7.2 Liaison issue → PR → commit

- Une issue par unité de travail. Branche nommée d'après l'issue.
- La PR référence l'issue (`Closes #123`) → le merge ferme l'issue et la déplace en **Done**.
- Les commits conventionnels portent le scope (`feat(api): …`) ; ils restent rattachés à la PR.

### 7.3 Automatisations (workflows intégrés GitHub Projects)

- Issue ajoutée → **Backlog**.
- PR ouverte / issue assignée → **In progress**.
- PR en attente de revue → **Review**.
- Issue/PR fermée → **Done**.

### 7.4 Labels & jalons

- **Labels** (créés par `scripts/gh-project-setup.sh`) : `type:*`, `area:*` (api/web/engines/infra/security), `priority:*`, `blocked`, `needs-review`, `dependencies`, `ci`.
- **Jalons Phase 1** (créés par le même script) : Socle plateforme · Intégration moteurs · Module Chaussées · Fondations superficielles · Fondations profondes (pieux) · Durcissement & préprod.
- **Accès client** : lecture sur le dépôt/board → visibilité sur l'avancement sans droit d'écriture.

### 7.5 Definition of Ready (DoR) — avant de démarrer une issue

- Objectif et valeur clairs.
- Critères d'acceptation **testables** (Given/When/Then).
- Dépendances identifiées (moteur, schéma, autre issue).
- Impact **confidentialité/sécurité** évalué (calcul côté serveur ? données tenant ?).
- Estimation grossière (S/M/L).
- Maquette / contrat d'API disponible si nécessaire.

### 7.6 Definition of Done (DoD) — rappel

Reprise telle quelle du `CLAUDE.md` : code mergé · tests verts CI · isolation prouvée · cas-tests STARFIRE dans la tolérance (+ équivalences) · livrables scellés régénérables · **revue `qa-challenger`** · déployable préprod. Une issue ne va en **Done** que si tout est vrai.

---

## 8. Qualité de code & traçabilité

| Élément | Mise en œuvre |
|---|---|
| **TypeScript strict** | `tsconfig.base.json` : `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals/Parameters`… |
| **ESLint + Prettier** | `.eslintrc.cjs` (+ garde-fou confidentialité), `.prettierrc` ; `eslint-config-prettier` évite les conflits |
| **Husky + lint-staged** | `pre-commit` → lint+format sur les fichiers staged ; `commit-msg` → commitlint |
| **Commits conventionnels** | commitlint (`commitlint.config.cjs`) |
| **ADR** | `docs/adr/` — décisions structurantes numérotées et immuables (0001 = process, 0002 = moteurs côté serveur) |
| **OpenAPI / Swagger** | NestJS (`@nestjs/swagger`) expose le contrat d'API ; sert de doc et de base aux tests d'intégration |
| **Sentry** | erreurs runtime API + front en **préprod** (DSN via variable d'env, jamais commité) |
| **Secrets** | `.env` hors git (`.gitignore`), modèle dans `.env.example` ; en préprod/prod via le dashboard Render. Générer les secrets : `openssl rand -base64 48` |

---

## 9. Flux de travail type d'une feature (bout en bout)

1. **Issue** créée (template *Fonctionnalité*), critères d'acceptation Given/When/Then, passe la **DoR** → colonne **Ready**.
2. **Branche** courte depuis `main` : `feat/<sujet>`.
3. **TDD** : test rouge → code → vert → refactor. Pour un moteur : on part des **cas-tests STARFIRE** (golden).
4. **Commits conventionnels** ; les hooks (lint-staged + commitlint) garantissent format et style à chaque commit.
5. **Pull Request** (template DoD) référençant l'issue (`Closes #N`) → colonne **Review**.
6. **CI** : `quality` + `unit` + `integration` doivent être **verts** — sinon pas de merge.
7. **Revue** : relecture + **`qa-challenger`** (revue adverse) ; le garde-fou ESLint confirme qu'aucun import moteur n'a fui côté web.
8. **Merge** sur `main` → CI lance **e2e** puis **déploiement préprod Render** ; l'issue passe en **Done**.
9. **Vérification réelle** en préprod (santé du service, parcours, rollback possible) — on **constate**, on ne suppose pas.

---

## 10. Ce qui n'est pas dans ce socle (et où ça va)

- **Extraction des moteurs** GeoSuite → `packages/engines` : menée par `integrateur-moteurs` + `qa-test` (emplacement déjà préparé, voir `packages/engines/README.md`).
- **Isolation multi-tenant détaillée** (RLS FORCE, guards, matrice RBAC, threat model) : `ingenieur-securite`.
- **Sauvegardes / RPO-RTO / observabilité / coût / runbook incident** : plan d'exploitation séparé (`devops-cloud`), une fois l'hébergement Render provisionné.
- **Resend / PayDunya** : Phase 2 (placeholders déjà dans `.env.example`).
```
