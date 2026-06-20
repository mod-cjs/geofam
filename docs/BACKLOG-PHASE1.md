# Backlog Phase 1 — définition (v2, post-challenge)

Refonte du backlog après revue adverse multi-agents. **Source de vérité** ; les tickets GitHub sont synchronisés dessus.

## Décisions actées

- **Isolation** : **RLS Postgres FORCE + guards applicatifs dès la Phase 1** (restaure `02-Conception/schema.prisma`). « RLS _et_ guards », jamais l'un sans l'autre.
- **Scellement PV** : Phase 1 = **hash (entrées+sorties+PDF) + HMAC + chaînage d'audit append-only** (intégrité/détection d'altération). **Signature Ed25519 opposable = Phase 2**. Pas d'eIDAS.
- **Cas-tests & tolérances** : fournis et **signés par STARFIRE, par moteur** (prérequis daté). À défaut, **plan B** : golden-master « équivalence portage » (module TS ↔ HTML d'origine), **marqué non-validant** (intégrité du portage, pas justesse science).
- **6 moteurs maintenus**. **FASTLAB & GEOPLAQUE = hors engagement de date** (best-effort ; dépassement → avenant via la clause d'extraction).
- **Capacité solo** : ~15 j nets / sprint, chargés à **80 %**. Toute story est **estimée** (0.5/1/2/3/5 j) et a des **critères testables**.

## Convention

- 1 moteur = **1 story** « extraction + endpoint + golden-master » (la valeur testable = l'endpoint qui renvoie le golden).
- Dépendances explicites `dépend de #N`. Zones critiques (moteurs, isolation, PV, paiement) → revue `qa-challenger` **réelle** + cases DoD cochées.

---

## PRÉREQUIS (hors sprint — daté, owner STARFIRE)

- **PR-1 — Kit de démarrage STARFIRE** _(P0, blocked, owner: STARFIRE, deadline: J-3 avant Sprint 1)_ — par moteur : cas-tests (entrées+résultats) + **tolérance chiffrée signée** (mode relatif/absolu, NaN, bornes) ; + modèles de PV ; + référentiel matériaux AGEROUTE ; + règles de licences ; + marque. Relance écrite portée par `comms-client`. _(remplace #22 monobloc)_

---

## SPRINT 1 — Socle non négociable (recentré)

- **S1.1 — Prisma + base de données** `[2 j]` — emplacement `packages/db` (aligné CI), 1ʳᵉ migration **minimale** (Organization, User, Membership, Project) ; toute table à `org_id` active **RLS FORCE + policy dans la même migration** ; test CI « aucune table `org_id` sans RLS » (`pg_policies`). _(reprend #6)_
- **S1.2 — Contrat d'I/O moteurs (`packages/shared`)** `[1 j]` — schémas **Zod** + types inférés, importables par `web` ET `api` **sans** dépendre de `@roadsen/engines`. _Avant les endpoints._ **(NOUVEAU)**
- **S1.3 — Garde-fou confidentialité ACTIF** `[1 j]` _(P0)_ — règle `no-restricted-imports` engines→web portée dans les **flat configs** `apps/web` **et** `apps/api`, **version ESLint unique** ; **test négatif CI** (import moteur depuis web ⇒ lint échoue) ; contrôle de bundle vert. _(fusionne #7 + #28)_
- **S1.4 — Stack de tests** `[1 j]` — **Vitest** (`engines`,`shared`), **Jest** (`apps/api`, idiomatique Nest), **Playwright** installé dans `apps/web` (+ script `test:e2e` + config + smoke) ; témoin **déterminisme** (même entrée → même sortie ×100). _(reprend #8 ; corrige Playwright fantôme)_
- **S1.5 — Auth + RBAC** `[3 j]` — comptes + organisation (tenant) ; **matrice RBAC rôle×module avec enforcement serveur testé** (sondeur ≠ route admin ; ingénieur d'un autre tenant refusé) ; JWT court + refresh/révocation ; politique mot de passe ; rate-limit/lockout login. _(reprend #9)_
- **S1.6 — Isolation RLS FORCE + guards + preuve** `[3 j]` _(P0, dépend de S1.1)_ — `SET LOCAL app.current_org` par transaction (extension Prisma) + guards applicatifs **en plus** ; **test : un tenant ne lit ni n'écrit chez un autre, RLS active même guard retiré**. _(réécrit #10 ; supprime « isolation durcie = Phase 2 »)_
- **S1.7 — Moteur témoin : terzaghi** `[3 j]` _(dépend de PR-1, S1.2)_ — extraction TS pur déterministe (sans DOM) + endpoint `POST /calc/terzaghi` (Zod) + **golden-master** dans tolérance ; aucune formule côté client. _(fusionne #11 + #12)_
- **S1.8 — Frontend pilote terzaghi** `[2 j]` _(dépend de S1.7)_ — écran saisie → appel API → affichage note ; **zéro formule client** ; le smoke Playwright (S1.4) couvre ce parcours. **(NOUVEAU)**
- **S1.9 — Socle API** `[1 j]` — NestJS + `@nestjs/swagger` (OpenAPI), validation tranchée une fois (Zod via `nestjs-zod`), `ValidationPipe` global, format d'erreur standard. **(NOUVEAU)**
- **CDP — démarrage** `[0.5 j]` _(dépend de rien, livré sur tout le projet)_ — registre des traitements, mention d'information, base légale du transfert (Frankfurt). _(début de #23 dès S1)_

> Capacité S1 ≈ 17,5 j → **au-dessus du plafond 80 % (~12 j)** : si PR-1 glisse, S1.7/S1.8 décalent et S1 = socle pur (S1.1→S1.6, S1.9).

## SPRINT 2 — Engageant

- **S2.1 — burmister (chaussées)** `[3 j]` _(dépend PR-1)_ — extraction + `POST /calc/burmister` + golden-master.
- **S2.2 — pressiomètre Ménard** `[2 j]` _(dépend PR-1)_
- **S2.3 — pieux (NF P 94-262)** `[3 j]` _(dépend PR-1)_
- **S2.4 — Entitlements** `[2 j]` — modèle **`Entitlement` (scopé `org_id`)** au schéma ; gate **deny-by-default** : `/calc/:moteur` sans entitlement actif → **403 sans exécuter** ; avec → 200 ; test « org A n'active pas org B ». **(NOUVEAU modèle + reprend #19)**
- **S2.5 — Livrables PV** `[3 j]` — découpé : (a) **génération PDF** (Puppeteer serveur) ; (b) **scellement de base** (hash entrées+sorties+PDF + HMAC + chaînage `prevHash→hash` append-only + test de détection d'altération) ; (c) **numérotation idempotente** + régénération. _(reprend #18, scindé)_
- **S2.6 — Threat model isolation** `[1 j]` _(P0, dépend S1.6)_ — par scénario, **un test d'isolation par scénario**, bloquant de non-régression pour la prod. _(reprend #27, remonté P0)_
- **S2.7 — Facturation manuelle + back-office minimal** `[2 j]` — liste bureaux + état paiements (manuel), création/désactivation comptes. _(reprend #20)_
- **S2.8 — Mise en production VERROUILLÉE** `[2 j]` _(dépend S1.6, S2.6, S2.4, CDP)_ — **bloquants durs** : tests d'isolation verts, threat model traité, contrôle CI « pas de table `org_id` sans RLS », **backups RPO/RTO restaurés-testés**, gate entitlement deny-by-default actif, bundle vert. Promotion préprod → prod (Render) + rollback. _(réécrit #21)_
- **CDP — go-live** `[1 j]` _(bloquant de S2.8)_ — déclaration CDP (prérequis client daté, STARFIRE = responsable de traitement), base du transfert. Partie juridique → `fiscal-juridique`. _(reprend #23)_

## HORS ENGAGEMENT DE DATE (maintenus en scope — best-effort / avenant si dépassement)

- **FASTLAB (epic) — par lots** _(dépend PR-1)_ — Lot A : granulo + Atterberg + VBS + GTR `[3 j]` · Lot B : Proctor + CBR `[2 j]` · Lot C : œdomètre Cc/Cs `[1 j]` · Lot D : cisaillement `[2 j]`. Chaque lot = golden-master + endpoint ; quels lots en Phase 1 vs avenant à acter. _(éclate #16)_
- **GEOPLAQUE (radier, FEM)** `[5 j]` — **tolérance relative** (pas bit-à-bit), maillage + critère de convergence **gelés** sur le HTML d'origine (avec `expert-genie-civil`). Distinguer équivalence-au-HTML vs justesse-science. _(reprend #17)_

## CHORES / TRANSVERSES

- **CH-1 — Secrets CI/CD + Render** `[1 j]` — deploy hooks + env (sans valeurs sensibles dans le ticket) ; **secret-scanning CI bloquant** (gitleaks) ; secrets préprod ≠ prod ; rotation JWT/PV. _(reprend #24 + P1-9)_
- **CH-2 — Sauvegardes RPO/RTO restaurées-testées** `[1 j]` — porte dure, pas une checkbox. _(reprend #25)_
- **CH-3 — Observabilité (Sentry préprod + logs)** `[1 j]` _(P2)_. _(reprend #26)_
- **CH-4 — Registre des versions de moteur** `[0.5 j]` _(P2)_ — chemin source EXACT + hash par moteur (`GeoSuite/source/tools/...`), archiver les versions obsolètes de la racine (risque d'extraction du mauvais fichier).

## Migrations multi-tenant (règle transverse)

Toute migration touchant une table à `org_id` : RLS FORCE+policy dans la **même** migration + test CI + **revue binôme `ingenieur-securite`** avant merge.
