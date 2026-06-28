# Backlog Phase 1 — définition (v3.1, post-challenge v3)

Réécrit après revue adverse `qa-challenger` du v3 (4 bloquants corrigés). **Source de vérité** ; les tickets GitHub se synchronisent dessus.

## Cadre de capacité & d'engagement

- **Objectif** : Phase 1 complète en **4 semaines**, **accélérée par Agent Teams** (agents en parallèle sur le buildable indépendant : extraction, endpoints, tests, doc).
- **Honnêteté (limites que les agents NE changent PAS)** : (1) le **goulot reste le développeur unique** — seul à relire/intégrer/valider ; la revue humaine + `qa-challenger` des zones critiques ne se parallélisent pas ; (2) **PR-1 et CDP sont des livrables tiers** (STARFIRE) non accélérables ; (3) les **dépendances dures** (socle → moteurs → prod) restent séquentielles. → Le backlog **vise tout en 4 sem.**, mais **n'engage en dur que ce qui est tenable**.
- **Capacité** : 2 sprints de 2 semaines, ~24 j utiles théoriques. **Engageable à ~80 % ≈ 19 j**, **~5 j de tampon** nommé (revue `qa-challenger` + reprise + aléa). La charge brute listée n'est jamais l'engagement.
- **Définition unique de « socle »** (ferme, ≈ 19 j) : S1.1, S1.2, S1.3, S1.4, S1.5, TM, S1.6, HG, IM, S1.9, CH-4, CDP-démarrage. **C'est le seul engagement ferme des 4 semaines.**
- **terzaghi + écran pilote = premier best-effort** (visés en tête de file, calibrés par `T0`) : ils consomment le tampon, donc **non garantis en dur**.
- **moteurs (terzaghi inclus) gatés par PR-1** : décision actée — **aucun moteur en prod tant que la conformité-STARFIRE n'est pas couverte** (cf. S2.8 / Gating CI).
- **Aucun délai ferme communiqué à STARFIRE avant le spike `T0`.**

## Décisions actées

- **Isolation** : **RLS Postgres FORCE + guards applicatifs dès la Phase 1** (restaure `02-Conception/schema.prisma`). « RLS _et_ guards », jamais l'un sans l'autre.
- **Règle CI RLS inversée** : **toute table du schéma `public` DOIT avoir RLS FORCE + policy**, sauf **allowlist explicite** (catalogues globaux, `engine_registry`, `_prisma_migrations`) revue en binôme.
- **Rôle DB applicatif runtime** : **sans `BYPASSRLS`, sans superuser, sans DDL** ; migrations via rôle distinct.
- **Immuabilité DB** : triggers `deny_mutation` (`audit_events`, `credit_ledger`) + `deny_official_pv` (`reports`) **posés en migration et testés**.
- **Policies nullable PAR TABLE** (pas de règle uniforme) : `material_library`, `signing_keys` → lecture `org = current OR org IS NULL` ; **`audit_events` → SELECT `org = current` STRICT** (jamais `OR IS NULL` : sinon tout tenant lit les logs plateforme). Écriture toujours `org = current` strict.
- **Scellement PV (Phase 1)** : hash (entrées+sorties+PDF) + HMAC + chaînage `prevHash→hash` append-only + **ancrage de tête EXPORTÉ hors du contrôle de l'opérateur** (horodatage tiers / e-mail client / dépôt externe) — sinon **non présenté comme atténuation**. **Limites énoncées** : HMAC = intégrité + détection d'altération externe, **PAS** non-répudiation ni anti-réécriture opérateur ; **risque accepté Phase 1 : compromission de la clé HMAC = chaîne forgeable rétroactivement**. **Signature Ed25519 opposable = Phase 2.**
- **Conformité science (MJ-6, tranché)** : **prod bloquée sans cas-tests STARFIRE** — aucun moteur ne va en prod avec `conformite-starfire` en skip. PR-1 devient donc **chemin critique absolu** de tout moteur livrable.
- **Équivalence client↔serveur** : **AUCUNE en Phase 1** (moteurs server-only, ADR 0002) + **test prouvant l'absence de calcul côté client**.
- **6 moteurs** : terzaghi (témoin) + burmister · Ménard · pieux = **best-effort gatés PR-1** ; FASTLAB & GEOPLAQUE = hors engagement de date.

## Convention

- 1 moteur = **1 story** « extraction + endpoint + golden-master » via le **harnais golden `HG`**, avec **N≥ cas** : nominal + **≥ 2 bornes** + **≥ 1 hors-domaine** (N venant de PR-1).
- **Golden signé, versionné, JAMAIS régénéré par la CI** ; il **embarque `engineSourceHash`** ; tout changement de golden = **diff PR + re-validation `expert-genie-civil`**.
- Dépendances explicites `dépend de`. Zones critiques → revue `qa-challenger` **réelle** + cases DoD.

---

## PRÉREQUIS TIERS (datés, clause d'escalade — chemins critiques)

- **PR-1 — Kit de démarrage STARFIRE** _(P0, owner: STARFIRE, deadline: J-3 avant le 1ᵉʳ moteur)_ — par moteur : cas-tests + **tolérance chiffrée signée** (rel/abs, NaN, bornes, bascule rel→abs près de zéro) ; + modèles PV ; + référentiel matériaux ; + licences ; + marque. **Clause d'escalade : retard de N j = Phase 1 décalée de N j, acté par avenant.** **Sans PR-1, aucun moteur en prod (MJ-6).** Relance écrite par `comms-client` **maintenant**.
- **CDP — go-live** _(P0, owner: STARFIRE = responsable de traitement + `fiscal-juridique`)_ — déclaration CDP, base du transfert (Frankfurt). **Prérequis daté, clause d'escalade.** Démarrage dès Sprint 1.

---

## SPRINT 1 (sem. 1–2) — Socle · **ENGAGEMENT FERME (≈ 19 j)**

- **T0 — Spike de calibrage `terzaghi`** `[1 j]` _(tout premier ticket ; = 1ᵉʳ jour de l'extraction terzaghi, instrumenté)_ — extraction HTML→TS + endpoint + golden minimal, **chronométré**. **Critère/seuil de décision** : si vélocité projetée **> 4 j/moteur**, déclencher l'arbitrage périmètre/avenant. _(NOUVEAU — arbitre objectif ; pas de double-compte : S1.7 = delta)_
- **S1.1 — Prisma + base de données** `[3 j]` — `packages/db`, migration minimale (Organization, User, Membership, Project) ; **règle CI inversée** (allowlist RLS via `pg_policies`) ; **rôle runtime sans `BYPASSRLS` + migrations via rôle distinct** (test : runtime ne peut pas désactiver RLS) ; **rejeu de la suite d'isolation sur le schéma migré dès cette migration** (post-migration = DoD §3 **[T]**, pas best-effort).
- **S1.2 — Contrat d'I/O moteurs (`packages/shared`)** `[1 j]` — schémas Zod importables par `web` ET `api` sans `@roadsen/engines` ; **sortie = whitelist** ; **la whitelist s'applique AUSSI à `errorDetail`/`inputs` persistés** (une exception moteur ne doit pas dumper d'intermédiaires révélant la formule).
- **S1.3 — Garde-fou confidentialité ACTIF** `[1 j]` _(P0)_ — `no-restricted-imports` engines→web (flat configs `web`+`api`, ESLint unique) ; **test négatif CI** ; contrôle de bundle vert **source-maps incluses** (ou source-maps off en prod) ; **e2e « API coupée ⇒ aucun résultat affiché »** (preuve que le front n'a aucun calcul local).
- **S1.4 — Stack de tests** `[1,5 j]` _(prérequis DUR de tout item réclamant `test:integration`)_ — Vitest/Jest/Playwright ; **définir `test:integration` (apps/api)** + **test négatif (échoue si isolation casse)** + **assertion « le job exécute ≥ 1 test » (`--passWithNoTests=false`, run à 0 test = échec)** pour empêcher la re-régression en faux-vert ; **témoin déterminisme durci** : sérialisation canonique **triée** sur N entrées **différentes + leurs permutations** (ordre Map/clés), **cross-process**, **version Node/V8 gelée** (le flottant dépend de l'archi — limite énoncée), **lockfile gelé + stub `Date.now`/`Math.random`** (grep seul contournable). _(corrige BL-3, MJ-7)_
- **S1.5 — Auth + RBAC** `[3 j]` — comptes + org ; **matrice RBAC rôle×module testée** (refus nommés) ; **`canSignPV`** ; **`PlatformRole` SUPPORT = lecture seule, SUPERADMIN audité** ; JWT court + refresh/révocation ; politique mot de passe ; **rate-limit IP + compte + back-off** (pas lockout dur seul).
- **TM — Threat model léger (amont)** `[0,5 j]` _(avant S1.6)_ — énumère les scénarios (lecture/écriture croisée, énumération d'IDs **dont `slug @unique`**, fuite via erreur/tri/count, post-migration, pooling, jobs async, back-office cross-tenant) dans un **registre versionné**. Oriente les policies.
- **S1.6 — Isolation RLS FORCE + guards + preuve** `[4,5 j]` _(P0, dépend S1.1, TM)_ — `SET LOCAL app.current_org` par transaction (extension Prisma) + guards ; **policies par table** (cf. décisions ; **`audit_events` strict**) ; **`current_setting` fail-closed** (fonction qui `RAISE` si NULL, pas `, true` silencieux) ; **test à travers le pool de PROD (PgBouncer documenté) sur le chemin HTTP ET le chemin worker** ; **intégrité référentielle inter-tenant : FK composites incluant `org_id`** (ex. `(profile_id, org_id) REFERENCES soil_profiles(id, org_id)`) ou trigger + test ; tests nommés : « RLS tient guard retiré », « 3 tables nullable », « INSERT enfant pointant un parent d'un autre tenant refusé ». _(corrige BL-4, MJ-3, MJ-5)_
- **HG — Harnais golden générique** `[1,5 j]` _(avant tout moteur hors spike)_ — lecteur `{entrées, sorties, tolérances signées}` ; comparateur par champ (`rel`/`abs`/`exact`, `NaN==NaN`, bornes, bascule rel→abs) ; vise la **valeur calculée** ; **champ `provenance` obligatoire + refus si la référence = le module testé (anti-auto-référence, testé)** ; profil « FEM » pour GEOPLAQUE. _(NOUVEAU)_
- **IM — Immuabilité DB** `[1 j]` — triggers `deny_mutation` + `deny_official_pv` en migration ; test : `UPDATE`/`DELETE` sur ligne scellée lève exception. _(NOUVEAU — B3)_
- **S1.9 — Socle API** `[1 j]` — NestJS + `@nestjs/swagger`, validation Zod (`nestjs-zod`), `ValidationPipe`, format d'erreur standard.
- **CH-4 — Registre des versions de moteur** `[0,5 j]` _(AVANT les moteurs)_ — chemin source EXACT + hash par moteur ; **lien hash↔golden instrumenté** : job CI recalcule `sha256` du fichier source et **échoue si ≠ `engineSourceHash`** ; **test négatif** (1 octet modifié sans re-signer ⇒ CI rouge). _(corrige MJ-8)_
- **CDP — démarrage** `[0,5 j]` — registre, mention d'information, base du transfert.

### Premier best-effort (en tête de file, hors socle ferme — consomme le tampon)

- **S1.7 — Moteur témoin `terzaghi` (delta après T0)** `[~1,5 j]` _(dépend PR-1, S1.2, HG, CH-4)_ — finalise extraction + `POST /calc/terzaghi` (Zod) + golden via HG dans tolérance ; **mode non-validant + skip visible si PR-1 absent** ; zéro formule client.
- **S1.8 — Frontend pilote `terzaghi`** `[2 j]` _(dépend S1.7)_ — saisie → API → note ; **zéro calcul moteur navigateur (DoD §8)** ; smoke Playwright.

> **Capacité S1** : socle ferme ≈ **19 j** (dans le ~80 % engageable) + tampon ~5 j. terzaghi+pilote (T0 1 j + S1.7 1,5 j + S1.8 2 j = 4,5 j) **piochent dans le tampon résiduel** — c.-à-d. seulement la part non consommée par la revue/reprise/aléa du socle ferme ; ils ne s'y ajoutent pas → **best-effort, non garantis**.

## SPRINT 2 (sem. 3–4) — Engageant · **BEST-EFFORT (gaté PR-1)**

> Visés dans la fenêtre, **non garantis en dur**. `T0` + l'avancement de S1 décident ; dépassement → avenant. **Aucun moteur en prod sans conformité-STARFIRE.**

- **S2.1 — `burmister`** `[≈ vélocité T0]` _(best-effort, dépend PR-1, HG, CH-4)_
- **S2.2 — `pressiomètre Ménard`** `[≈ T0]` _(best-effort, dépend PR-1, HG)_
- **S2.3 — `pieux` (NF P 94-262)** `[≈ T0]` _(best-effort, dépend PR-1, HG)_
- **S2.4 — Entitlements** `[2 j]` — modèle `Entitlement` (scopé `org_id`) ; gate **deny-by-default** (`/calc/:moteur` sans entitlement → **403 sans exécuter**) ; test « org A n'active pas org B ».
- **S2.5 — Livrables PV** `[4,5–5 j]` — (a) **PDF** (Puppeteer serveur ; **tout job pose `app.current_org`, rôle sans `BYPASSRLS`**, job sans contexte tenant échoue) ; (b) **scellement** (hash+HMAC+chaînage+**ancrage exporté hors opérateur**+limites énoncées) + **test de troncature** ; (c) **numérotation idempotente** (clé = projet+version moteur+entrées) + **régénérabilité testée (PV régénéré ⇒ hash identique)** + **enforcement `canSignPV`**. _(corrige B4/M2/MJ-4/MN-6)_
- **S2.6 — Threat model : tests de non-régression** `[1,5 j]` _(P0, dépend TM, S1.6)_ — **un test par scénario** (bijection avec le registre TM, vérifiée par test méta) ; **assertion sur la _forme_ de la policy** (refuse `USING(true)`). _(le rejeu post-migration est remonté en S1.1/S1.6, DoD §3 [T])_
- **S2.7 — Facturation manuelle + back-office** `[2 j]` — liste bureaux + état paiements (manuel), comptes ; **accès cross-tenant → `AuditEvent CROSS_TENANT_ACCESS`, SUPPORT lecture seule**.
- **S2.8 — Mise en production VERROUILLÉE** `[2,5 j]` _(jalon de gating — dépend S1.6, S2.6, S2.4, IM, CH-1, CH-2, CDP go-live)_ — **bloquants durs** : isolation verte **via pool de prod**, threat model traité, règle CI allowlist RLS, immuabilité DB active, rôle runtime sans `BYPASSRLS`, backups RPO/RTO restaurés-testés, entitlement deny-by-default, bundle vert (source-maps incl.), branch protection jobs requis, **AUCUN moteur en prod avec `conformite-starfire` en skip (MJ-6)**. Promotion préprod → prod (Render) + rollback.
- **CDP — go-live** `[1 j]` _(bloquant S2.8)_ — déclaration CDP, base du transfert. Juridique → `fiscal-juridique`.

## HORS ENGAGEMENT DE DATE (best-effort / avenant)

- **FASTLAB (epic) — par lots** _(dépend PR-1, HG)_ — Lot A granulo+Atterberg+VBS+GTR `[3 j]` · Lot B Proctor+CBR `[2 j]` · Lot C œdomètre Cc/Cs `[1 j]` · Lot D cisaillement `[2 j]`.
- **GEOPLAQUE (radier, FEM)** `[5 j]` — **harnais `HG` profil « FEM »** ; maillage + critère de convergence + **nombre d'itérations/seed gelés** sur le HTML d'origine (avec `expert-genie-civil`).

## CHORES / TRANSVERSES (datés, owners)

- **CH-1 — Secrets CI/CD + Render** `[1 j]` _(owner `devops-cloud` ; **S2.8 dépend de CH-1**)_ — gitleaks bloquant ; secrets préprod ≠ prod ; rotation.
- **CH-2 — Sauvegardes RPO/RTO restaurées-testées** `[1 j]` _(owner `devops-cloud` ; **S2.8 dépend de CH-2**)_ — **critère chiffré** (RPO/RTO + assertion row-count post-restauration).
- **CH-3 — Observabilité (Sentry préprod + logs)** `[1 j]` _(P2, owner `devops-cloud`)_ — **scrubbing PII / inputs avant envoi**.

## Gating CI (transverse)

- **Branch protection** : jobs `quality`/`unit`/`integration` **requis**, et **`integration` exécute ≥ 1 test** (run à 0 = échec).
- **Deux suites moteur** : `equivalence-portage` (toujours, oracle figé+versionné, anti-auto-référence) + `conformite-starfire` (**skip annoncé** si PR-1 absent → CI affiche « conformité science : **NON COUVERTE** ») ; **prod bloquée si skip (MJ-6)**.
- **Couverture** : seuil plancher bloquant sur `packages/engines`.

## Migrations multi-tenant (règle transverse renforcée)

Toute migration touchant `org_id` : **RLS FORCE + policy dans la même migration** + test `pg_policies` + **assertion sur la forme de la policy** (refuse `USING(true)`) + **rejeu de la suite d'isolation sur le schéma migré** (DoD §3 **[T]**) + **revue binôme `ingenieur-securite`**.

---

## Bilan capacité — honnête

| Bloc                                                                           | Charge            | Statut                                                                                                                                         |
| ------------------------------------------------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Socle ferme** (S1.1–S1.6, TM, HG, IM, S1.9, CH-4, CDP-démarrage)             | **≈ 19 j**        | **Engagé** (dans le ~80 % de 24 j). Seul engagement ferme.                                                                                     |
| Tampon nommé (revue `qa-challenger` + reprise + aléa)                          | ~5 j              | Réserve, non planifiée en stories.                                                                                                             |
| terzaghi (T0 1 + S1.7 1,5) + pilote (S1.8 2)                                   | ≈ 4,5 j           | **Best-effort** — pioche dans le tampon **résiduel** (la part non prise par revue/reprise/aléa du socle), ne s'y ajoute pas ; **non garanti**. |
| PV + entitlements + threat-tests + back-office + prod + CH-1/2/3 + CDP go-live | ≈ +16 j           | **Best-effort** → avenant.                                                                                                                     |
| burmister + Ménard + pieux                                                     | ≈ 3 × vélocité T0 | **Best-effort, gatés PR-1.**                                                                                                                   |

**Objectif** : tout en 4 semaines, accéléré par Agent Teams. **Engagement ferme** : le socle. **Le reste est best-effort** — limité par la revue humaine (goulot solo), PR-1/CDP (tiers, non accélérables) et les dépendances. **Le délai moteur ferme se décide après `T0` et dépend de la livraison PR-1 par STARFIRE** (MJ-6 : pas de science → pas de prod).
