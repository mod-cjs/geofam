# ADR 0011 — Enforcement d'abonnement (guard, decompte atomique, contrat d'entitlements)

- Statut : accepte
- Date : 2026-06-27
- Concretise : ADR 0009 (decision abonnements/entitlements/expiration deja prise),
  F-05 de l'inventaire (C-01, B-28). Zone CRITIQUE (isolation + monetisation).
  Binome dev-backend + ingenieur-securite ; tests negatifs obligatoires (qa-test).

## Contexte

ADR 0009 a tranche le QUOI : chaque organisation porte un abonnement
{ pack, entitlements, dateDebut, dateFin, quota, consommation }, l'acces se ferme au
**premier atteint** entre `now > dateFin` et `consommation >= quota`, et l'enforcement
est **cote serveur** via un guard ajoute apres `TenantGuard`. Cet ADR concretise le
COMMENT : modele de donnees, placement et logique du guard, **decompte atomique
anti-course**, codes de reponse, isolation sous RLS, et le **contrat d'API
d'entitlements** que le frontend Lot 2 consomme pour gater l'UI (defense en profondeur).

Principe directeur (rappel 0009) : **l'UI gate, le serveur barre.** Aucune protection
ne repose sur l'UI seule.

## Decision

### 1. Modele de donnees (minimal)

Deux tables nouvelles, **org-scopees** (porteuses de `org_id`, sous RLS FORCE comme le
reste). Proposition de schema — **a appliquer par dev-backend dans une migration dediee
(0008)**, je ne touche pas au schema fige.

**`subscriptions`** — 1 ligne active par org (cardinalite 1:1 logique en P1) :

| colonne                   | type                                        | role                                                                                                                                   |
| ------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | uuid PK                                     |                                                                                                                                        |
| `org_id`                  | uuid NOT NULL, FK→organizations, **UNIQUE** | un seul abonnement actif/org en P1                                                                                                     |
| `pack`                    | text NOT NULL                               | `ROUTES` / `FONDATIONS` / `COMPLETE` (cf. devis)                                                                                       |
| `entitlements`            | text[] NOT NULL                             | liste des `engineId`/features debloques (derive du pack mais STOCKE explicitement → un pack peut etre amende sans changer le code)     |
| `date_debut`              | timestamptz NOT NULL                        |                                                                                                                                        |
| `date_fin`                | timestamptz NOT NULL                        | fenetre de validite (dimension DUREE)                                                                                                  |
| `quota`                   | integer NOT NULL                            | nb max d'unites consommables (dimension QUOTA). `NULL`/sentinelle = illimite **a NE PAS faire en P1** : quota toujours fini, explicite |
| `consommation`            | integer NOT NULL DEFAULT 0                  | **compteur derive/cache** du ledger (cf. §3)                                                                                           |
| `created_at`/`updated_at` | timestamptz                                 |                                                                                                                                        |

**`usage_ledger`** — journal d'usage **append-only** (la verite de la consommation) :

| colonne           | type                                                  | role                                          |
| ----------------- | ----------------------------------------------------- | --------------------------------------------- |
| `id`              | uuid PK                                               |                                               |
| `org_id`          | uuid NOT NULL, FK→organizations                       | pivot d'isolation                             |
| `subscription_id` | uuid NOT NULL, FK composite (org_id, .)→subscriptions | rattache a l'abonnement de SON tenant         |
| `kind`            | text NOT NULL                                         | `CALC` / `PV` (l'unite consommee)             |
| `ref_id`          | uuid NULL                                             | calc_result_id / official_pv_id (tracabilite) |
| `user_id`         | uuid NOT NULL                                         | qui a consomme                                |
| `created_at`      | timestamptz NOT NULL DEFAULT now()                    | **horodatage SERVEUR**                        |

Regles :

- `usage_ledger` est **append-only** : aucun UPDATE/DELETE accorde au runtime
  (triggers d'immuabilite, sur le patron de `official_pvs` en 0006). Le ledger est la
  source de verite auditable ; `subscriptions.consommation` n'est qu'un compteur
  materialise pour eviter un `COUNT(*)` a chaque check (perf), **reconciliable** par
  `SELECT count(*) FROM usage_ledger WHERE …`.
- RLS FORCE + policy `org_id = app_current_org()` sur les DEUX tables (meme patron que
  `projects`/`calc_results`). Un tenant ne lit/ecrit jamais l'abonnement ni le ledger
  d'un autre. **A prouver par test d'isolation** (cf. §6 T-ISO).
- FK composite `(org_id, subscription_id) → subscriptions(org_id, id)` pour interdire
  qu'un ledger pointe l'abonnement d'un autre tenant (patron NOTE §4 de 0004 / 0006).

> Decision assumee : on stocke `entitlements` en colonne `text[]` plutot qu'une table
> de jointure normalisee. En P1 (6 moteurs, 3 packs, provisionnement manuel) c'est
> suffisant et plus simple a auditer. Normaliser = backlog si la granularite des
> features explose.

### 2. Le `SubscriptionGuard` — placement et logique

Place dans la chaine **apres `TenantGuard`, avant `RolesGuard`** (l'org est resolue et
le membership prouve ; on connait `req.tenant.orgId`) :

```
RecetteAccessGuard → Throttler → JwtAuthGuard → TenantGuard → SubscriptionGuard → RolesGuard
```

Le guard ne s'applique **qu'aux routes qui consomment un entitlement** — calcul et PV.
Decore explicitement (deny-by-default cote metier) :

- `@RequiresEntitlement(engineId)` — module/moteur requis (lecture du descripteur de
  route ; le `engineId` vient du body/param de la route de calcul).
- `@Consumes('CALC' | 'PV')` — marque qu'un appel REUSSI doit decrementer le quota.

Logique du guard (lecture seule, SOUS le contexte tenant deja pose) :

1. Charger l'abonnement de `req.tenant.orgId` (1 ligne, sous RLS). **Absent** →
   `403` (org sans abonnement = mauvais provisionnement, pas un quota epuise).
2. **Module hors pack** : `engineId ∉ entitlements` → **`403 Forbidden`**
   (le client n'a PAS le droit a ce module ; ce n'est pas une question de temps/quota).
3. **Abonnement expire** : `now_serveur > date_fin` → **`402 Payment Required`**
   (acces lecture-seule cote UI ; le calcul/PV est barre). `now_serveur` = `now()`
   **base de donnees**, JAMAIS une date fournie par le client.
4. **Quota epuise** : `consommation >= quota` → **`402 Payment Required`**.
5. Sinon → laisse passer. **Le decompte n'a PAS lieu ici** (cf. §3 : il a lieu a
   l'usage EFFECTIF, dans la transaction qui ecrit le resultat, pas au passage du guard).

> Choix des codes (explicite pour le frontend) :
>
> - **403** = « tu n'as structurellement pas ce module » (hors pack). Pas de remede
>   cote client sinon changer de pack.
> - **402** = « l'acces est ferme par expiration OU quota » (dimension temporelle/usage).
>   Distinguer les deux par un corps d'erreur typé (`reason: "EXPIRED" | "QUOTA"`) pour
>   que l'UI affiche le bon etat (bandeau expire vs quota epuise). Le code HTTP seul ne
>   suffit pas a l'UX ; le `reason` est porte dans le body (cf. §4 contrat d'erreur).

### 3. Decompte atomique du quota (anti-course) — point le plus delicat

Le guard (§2 etape 4) ne fait qu'un **pre-check optimiste** (UX rapide, evite de lancer
un calcul couteux pour rien). Il **ne fait pas autorite** sur le quota : deux requetes
concurrentes pourraient toutes deux passer le pre-check a `consommation = quota - 1`.

**La verite du decompte est posee atomiquement DANS la transaction qui ecrit le
resultat consommant**, par un **increment conditionnel** :

```sql
-- Dans la MEME transaction tenant (withTenant) que l'INSERT calc_results / official_pvs :
-- 1) Reserve une unite SI et seulement si le quota n'est pas atteint ET pas expire.
UPDATE subscriptions
   SET consommation = consommation + 1,
       updated_at   = now()
 WHERE org_id        = app_current_org()      -- isolation (RLS le re-impose aussi)
   AND consommation  < quota                  -- garde quota (anti-course)
   AND now()        <= date_fin               -- garde expiration (temps SERVEUR)
RETURNING id;
-- 0 ligne affectee  -> quota epuise OU expire entre-temps -> ABORT (rollback), 402.
-- 1 ligne affectee  -> unite reservee atomiquement.

-- 2) INSERT usage_ledger (append-only) : trace l'unite consommee.
-- 3) INSERT le resultat (calc_results / official_pvs).
-- COMMIT : tout ou rien. Si l'ecriture du resultat echoue, la reservation est annulee.
```

Pourquoi c'est correct :

- L'`UPDATE … WHERE consommation < quota` est **atomique** : Postgres verrouille la
  ligne `subscriptions` pour la duree de la transaction. Deux requetes concurrentes
  serialisent sur cette ligne ; la seconde voit `consommation` deja incremente et son
  `WHERE` echoue si le quota est atteint → **0 ligne** → on leve 402. Pas de depassement.
- C'est un **increment conditionnel** (preferable a `SELECT … FOR UPDATE` puis check
  applicatif + UPDATE : une seule requete, fenetre de course nulle). Si on prefere le
  `FOR UPDATE` explicite (lisibilite), il doit englober check + increment dans la meme
  tx — equivalent mais plus verbeux.
- Le decompte est **lie a l'usage effectif** : on n'incremente QUE si le resultat est
  bien produit et persiste (meme transaction). Un calcul qui echoue (moteur rejette les
  params, divergence cas-test) **ne consomme pas** — le rollback annule la reservation.
  Decision explicite ADR 0009 : « decompte a l'usage effectif ».
- **Isolation** : `org_id = app_current_org()` + RLS FORCE garantissent qu'un tenant ne
  decremente JAMAIS le quota d'un autre, meme si l'`org_id` etait force cote app (RLS
  re-filtre). **A prouver** (T-ISO §6).

Point a prouver par test (honnetete) : la propriete anti-course n'est pas evidente « sur
le papier ». Il faut un **test de concurrence reel** (N requetes paralleles a
`consommation = quota - 1` → exactement 1 succes, N-1 en 402) contre **Postgres reel**
(pas un mock), conforme a la discipline e2e de la DoD §9.

### 4. Contrat d'API d'entitlements (consomme par le frontend Lot 2)

Endpoint **`GET /me/entitlements`** — `@NoTenant`? **Non** : scope tenant (l'abonnement
est par org). Requiert `X-Org-Id` (org courante, resolue par le middleware ADR 0010) et
passe par `TenantGuard`. Reponse :

```jsonc
// 200 OK
{
  "orgId": "<uuid>",
  "pack": "ROUTES",
  "modules": ["burmister", "terzaghi"], // engineId AUTORISES (= entitlements)
  "expiresAt": "2026-12-31T23:59:59Z", // = date_fin (ISO, source serveur)
  "expired": false, // now_serveur > date_fin (calcule serveur)
  "quota": { "limit": 500, "used": 137, "remaining": 363 },
  "serverTime": "2026-06-27T10:00:00Z", // ANCRE de temps : l'UI n'utilise JAMAIS
  // l'horloge locale pour juger l'expiration
}
```

Usage cote shell (defense en profondeur — l'UI gate, le serveur barre) :

- **C-01 (selecteur de moteur) / B-28 (bibliotheque)** : moteurs `∉ modules` →
  grises/masques (« non inclus dans votre pack »). Source = `modules`.
- **Abonnement expire** (`expired: true`) → bandeau « abonnement expire » + UI en
  lecture seule (pas de bouton Calculer / Emettre PV).
- **Quota** : afficher `remaining` (« N calculs restants ») ; a 0 → CTA calcul desactive.
- **`serverTime` + `expiresAt`** : l'UI calcule l'expiration **par rapport a
  `serverTime`**, jamais a `Date.now()` du navigateur (une horloge cliente truquee ne
  doit pas debloquer l'UI ; et de toute facon le serveur barre).

**Contrat d'erreur** des routes consommantes (calcul/PV), pour que l'UI distingue les
etats (B-19 vs etats abonnement) :

```jsonc
// 403 — module hors pack
{ "statusCode": 403, "reason": "MODULE_NOT_IN_PACK", "message": "Module non inclus dans votre abonnement" }
// 402 — expire
{ "statusCode": 402, "reason": "EXPIRED",  "message": "Abonnement expiré" }
// 402 — quota
{ "statusCode": 402, "reason": "QUOTA",    "message": "Quota d'utilisation atteint" }
```

Les messages restent **generiques et tenant-safe** (pas de fuite d'existence de
ressource d'un autre tenant ; coherent avec l'anti-enumeration ADR 0010).

### 5. Cache cote frontend et fraicheur

`GET /me/entitlements` est mis en cache court cote shell (TanStack Query), **invalide** :

- au passage d'un 402/403 sur une route consommante (re-fetch → mettre a jour le bandeau),
- apres chaque calcul/PV reussi (le `remaining` a bouge),
- au switch d'org (D-04 : `queryClient.clear()`).

Honnetete : le `remaining` affiche peut etre obsolete de quelques secondes (autre
session du meme org qui consomme). **Sans gravite** : le serveur barre au decompte
atomique (§3). L'UI peut afficher « N restants » et recevoir un 402 au calcul suivant —
l'intercepteur met alors a jour l'etat. C'est le comportement attendu, pas un bug.

## Threat model (feature sensible : monetisation + isolation)

| #    | Scenario d'attaque / d'erreur                                        | Controle                                                                                                                                                              | Test                                                                    |
| ---- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| TM-1 | Client force une `date` d'evaluation pour paraitre non-expire        | Temps = `now()` **base de donnees** uniquement (§2.3, §3) ; aucune date cliente lue                                                                                   | T-TIME : requete avec date future dans le body → ignoree, 402 si expire |
| TM-2 | Course : N calculs paralleles a quota-1 → depassement                | Increment conditionnel atomique `WHERE consommation < quota` (§3)                                                                                                     | T-RACE : N paralleles → exactement 1 succes                             |
| TM-3 | Tenant A consomme le quota / lit l'abonnement de B                   | RLS FORCE + `org_id = app_current_org()` sur subscriptions/usage_ledger ; FK composite                                                                                | T-ISO : sous contexte A, lecture/UPDATE de l'abo de B → 0 ligne         |
| TM-4 | Appel direct d'une route moteur en contournant l'UI (UI gating seul) | `SubscriptionGuard` serveur barre 402/403 independamment de l'UI                                                                                                      | T-GUARD : curl direct hors pack/expire/quota → barre                    |
| TM-5 | Calcul couteux lance puis echoue → consomme quand meme ?             | Decompte dans la MEME tx que l'ecriture du resultat ; echec → rollback → pas de consommation                                                                          | T-FAIL : moteur rejette params → consommation inchangee                 |
| TM-6 | Falsifier le ledger (effacer une conso pour « rendre » du quota)     | `usage_ledger` append-only (triggers immuabilite, pas de privilege UPDATE/DELETE runtime)                                                                             | T-IMMUT : UPDATE/DELETE ledger → refus                                  |
| TM-7 | Le claim `role`/`orgs` du JWT (ADR 0010) sert a debloquer un module  | Le `SubscriptionGuard` lit l'abonnement EN BASE, jamais le JWT ; le JWT ne porte pas d'entitlement                                                                    | couvert par T-GUARD (token n'influe pas)                                |
| TM-8 | Re-emission d'un PV brule un 2e quota                                | Idempotence : `UNIQUE(org_id, calc_result_id)` sur official_pvs (0006) ; ne decrementer que sur emission REELLE (INSERT effectif), pas sur la re-emission idempotente | T-PV-IDEM : re-emettre le meme calc → pas de 2e conso                   |

TM-8 est un **point a cadrer avec dev-backend** : le decompte PV doit etre lie a
l'INSERT reel dans `official_pvs` (1er scellement), pas a chaque appel de la route
d'emission. L'idempotence d'emission (0006) doit donc englober le decompte — **a
prouver**, c'est un piege classique de double-comptage.

## Consequences

### Impact backend (pour dev-backend)

1. **Migration 0008** (proposee, non appliquee par moi) : tables `subscriptions` +
   `usage_ledger`, RLS ENABLE+FORCE + policies `app_current_org()`, FK composite,
   triggers d'immuabilite sur `usage_ledger` (patron 0006), GRANTs runtime minimaux
   (pas d'UPDATE/DELETE sur le ledger ; UPDATE sur subscriptions limite a la conso).
   **A revoir en binome ingenieur-securite (isolation) + qa-challenger (atomicite,
   immuabilite).**
2. **`SubscriptionGuard`** (§2) + decorateurs `@RequiresEntitlement` / `@Consumes`,
   insere apres `TenantGuard`.
3. **Decompte atomique** (§3) cable dans les transactions de calcul et d'emission PV
   (`withTenant`), increment conditionnel + INSERT ledger + INSERT resultat, tout-ou-rien.
4. **`GET /me/entitlements`** (§4), scope tenant, expose `serverTime`.
5. **Provisionnement** (ADR 0009, manuel P1) : creer une ligne `subscriptions` a la
   creation d'org (pack/dates/quota), via une fonction DEFINER ou la console fast-follow.
6. **Aucune modification** de 0004/0006/0007 ni d'un livrable gele ; tout est additif.

### Impact frontend (Lot 2 — pour dev-frontend)

- Consomme `GET /me/entitlements` (§4) pour gater C-01, B-28, bandeau expire, quota.
- Gere les erreurs `402 {reason}` / `403 {reason}` (§4) dans l'intercepteur (distinct
  des erreurs moteur B-19 et reseau B-20) ; invalide le cache entitlements au 402/403.
- Calcule l'expiration sur `serverTime`, jamais l'horloge locale.
- Rappel : UI = gating de confort ; ne suppose JAMAIS qu'un module masque est inatteignable.

### Points a prouver par test (honnetete d'ingenieur)

- **T-RACE** (anti-course) et **T-ISO** (isolation) sont les deux portes critiques : sans
  elles vertes contre **Postgres reel**, la decision n'est pas tenue. Une assertion « ca
  serialise sur la ligne » sans test de concurrence est une supposition, pas une preuve.
- **T-FAIL** et **TM-8** (double-comptage / consommation sur echec) sont les pieges les
  plus probables a l'implementation ; les tester en ROUGE d'abord (DoD §9).
- L'increment conditionnel suppose `quota` toujours fini et non-NULL (§1) ; un `quota`
  NULL casserait le `WHERE consommation < quota` (NULL → faux → tout barre). Garde-fou
  schema : `quota NOT NULL`.

## Liens

- ADR 0009 (decision abonnements/entitlements/expiration — le QUOI).
- ADR 0010 (resolution org/identite — la meme org resolue alimente le scope ici).
- Migrations 0004 (helper RLS fail-closed), 0006 (patron immuabilite / FK composite /
  numerotation atomique) — patrons reutilises, **non modifies**.
- Inventaire F-05, C-01, B-28, B-19/B-20 (distinction des etats d'erreur).
