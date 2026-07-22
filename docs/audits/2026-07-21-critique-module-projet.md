# Critique du module projet & plan de changements

**Date** : 21/07/2026 · **Périmètre** : liste des affaires `/projets` + les 4 onglets d'un projet
**Méthode** : lecture du code, mesures en base de recette et mesures réseau réelles.
Tout chiffre ci-dessous est **mesuré**, pas estimé — sauf les efforts (j-h), qui sont des estimations.

---

## 1. Ce qui est cassé, et qui est prouvé

### 1.1 Le tri « Modifié récemment » est faux

`projects.updated_at` ne bouge **jamais** quand on ajoute un calcul ou scelle un PV : il ne reflète
que l'édition des métadonnées du projet. Or c'est ce champ qui trie la liste **et** s'y affiche.

| Affaire           | `updated_at` (ce qui trie) | dernier calcul réel | calculs | PV  |
| ----------------- | -------------------------- | ------------------- | ------- | --- |
| Test              | 17/07 16:06                | **19/07 22:32**     | 7       | 0   |
| Route Dakar-Thiès | 17/07 12:52                | **19/07 16:32**     | 6       | 5   |
| test              | 17/07 12:50                | 17/07 13:16         | 2       | 1   |
| Pont de Mbodiène  | 17/07 12:21                | **18/07 10:54**     | **40**  | 4   |

« Pont de Mbodiène » — 40 calculs, 6 moteurs, actif le 18/07 — est classé **dernier**, sous « test »
(2 calculs, rien depuis le 17/07). L'écran de triage central du produit induit en erreur sur la
fonction même dont c'est le métier.

### 1.2 « Derniers calculs » affiche les plus anciens

`overview/page.tsx:82` : `calculs.slice(-3).reverse()` — appliqué à une liste que l'API renvoie
déjà triée `createdAt: 'desc'`. `slice(-3)` prend donc la **queue**, c'est-à-dire les **trois plus
anciens**. Même bug ligne 83 pour les PV. Correctif : une ligne.

### 1.3 Les dates relatives sont en tranches de 24 h, pas en jours

`ClientRelativeDate` fait `Math.floor((Date.now() - t) / 86400000)`. Un élément d'hier 23:00
consulté ce matin à 08:00 (9 h d'écart) affiche « aujourd'hui ». Sur des pièces quasi-probatoires,
c'est indéfendable. (La base est en UTC et le Sénégal est à UTC+0 : le fuseau n'est **pas** le
sujet, ne pas le sur-diagnostiquer.)

### 1.4 Deux vérités de tri qui se contredisent

`GET /projects` trie `createdAt: 'desc'` côté serveur ; le front retrie sur `updated_at`. Le tri
serveur ne sert donc à rien, et aucun des deux ne correspond à l'activité réelle.

### 1.5 Le champ « Description » est jeté en silence

La modale « Nouveau projet » propose une description. Il n'existe **aucune colonne `description`**
sur `Project`, et `createProjectSchema` n'accepte que `{name, domain}` — zod supprime le reste.
L'utilisateur saisit un texte qui disparaît sans un mot.

### 1.6 Ouvrir un projet transfère 4 Mo — dont 2,5 Mo de ma faute

Mesure réseau réelle sur « Pont de Mbodiène » (40 calculs) :

```
pvs           837 ko
calc-results 1656 ko   <- CalculsClient (légitime)
calc-results 1656 ko   <- mes compteurs d'onglets (ajoutés le 20/07)
TOTAL        4,05 Mo pour ouvrir UN onglet
```

La liste des calculs renvoie les lignes **entières**, `output` JSONB compris. Les compteurs
d'onglets que j'ai livrés hier appellent `listCalcResults` + `listPvs` **uniquement pour afficher
deux nombres** — ils doublent le coût d'ouverture d'un projet. C'est une régression que j'ai
introduite ; elle est en tête du plan.

Aggravant : `official_pvs` **n'a aucun index sur `project_id`** (seulement `orgId`).

### 1.7 L'interface promet une réversibilité qu'aucun code n'honore · **le plus grave**

La modale de suppression affirme (`ProjetsClient.tsx:472`) :

> « Cette action peut être annulée par un administrateur si besoin. »

Vérifié : il n'existe **aucun endpoint de restauration** (`projects.controller.ts` expose GET, GET/:id,
POST, PATCH/:id, DELETE/:id — rien d'autre), **aucun endpoint admin sur les projets**, et _toutes_
les lectures excluent `ARCHIVED` (`list`, `getById`, `rename`). L'enum `ACTIVE|SUSPENDED|ARCHIVED`
du back-office porte sur l'**organisation**, pas sur le projet.

Un projet archivé est donc **irrécupérable sans SQL manuel**. L'écran rassure l'utilisateur pour
lui faire franchir une action destructive, sur la foi d'une garantie qui n'existe pas. C'est le
défaut le plus grave du lot : les autres affichent faux, celui-ci **fait agir** sur du faux.
Correctif immédiat : honorer la phrase (livrer la restauration) ou la retirer.

### 1.8 « Supprimer » archive, et « Archiver » est déjà pris

`DELETE /projects/:id` fait `status → ARCHIVED`, ce qui exclut le projet de la liste **et** du
détail, **sans aucune interface de restauration**. Le bouton dit « Supprimer », en variante
_danger_ ; le toast dit « archivé ». Personne n'ose cliquer sur une affaire livrée contenant des
PV scellés — donc personne ne range, et la liste grossit indéfiniment.
Conséquence pour le plan : on ne peut pas ajouter un bouton « Archiver » avec la sémantique
actuelle, il ferait **disparaître** le projet sans retour.

### 1.9 La recherche n'existe pas — alors que trois endroits la promettent

Troisième affordance qui promet plus que le code ne tient (même famille que 1.7).

| Où                                | Ce que l'écran laisse croire | Ce qui existe réellement                                                                                                                                                                                                      |
| --------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Barre du haut, « Rechercher… ⌘K » | une recherche globale        | `CommandPalette` n'indexe que `navigation` + `actions` (« Aller aux Projets », « Nouveau calcul »). **Aucun appel** à `listProjects` / `listCalcResults` / `listPvs` : elle ne trouve ni une affaire, ni un calcul, ni un PV. |
| Liste des projets                 | recherche sur le contenu     | filtrage **client**, sur le seul champ `name`. Ni la description (qui n'existe pas, cf. 1.5), ni le client, ni la référence.                                                                                                  |
| Onglet PV                         | —                            | **aucune recherche, aucun filtre.** Sur une affaire à 40 PV, on scrolle.                                                                                                                                                      |

Il n'existe par ailleurs **aucun endpoint de recherche côté API** : `GET /projects` n'accepte aucun
paramètre `q`. Toute recherche est donc bornée à ce qui a déjà été chargé en mémoire.

Conséquence directe : la promesse « ⌘K » est le raccourci que tout utilisateur essaie en premier
pour retrouver une affaire. Il ouvre une palette qui ne sait pas la trouver.

**Effet sur la maquette** : elle affiche **trois** champs de recherche (« Rechercher une affaire,
un client, une réf. » · « Nom, n° d'affaire ou client… » · « N° de PV, repère, logiciel… »).
Aucun des trois n'est aujourd'hui adossé à quoi que ce soit. À traiter comme une fonctionnalité à
construire, pas comme un rebranchement — et à chiffrer :

- Recherche **client** étendue (nom + réf + client) sur la liste déjà chargée : **S** (~0,3 j).
- Recherche **de contenu dans la palette ⌘K** (affaires, puis calculs et PV) : **M** — suppose un
  endpoint de recherche tenant-scopé et une stratégie de débounce ; à ne pas confondre avec le
  simple filtre de liste.
- Recherche/filtre sur l'onglet PV : **S/M**, dépend de la pagination serveur.

---

## 2. Les trois défauts de fond (ce ne sont pas des options manquantes)

### D1 — Le domaine est un verrou, pas une étiquette · **le plus grave**

`matchesDomain` : un projet marqué `FD` n'apparaît **dans aucun autre logiciel**. Or une affaire
de pont, c'est des pieux (FD) **plus** des essais labo/GTR (LB) **plus** la chaussée d'accès (CH).
Le modèle oblige donc à créer **trois « projets » pour un seul marché** — donc trois listes de PV
pour un seul client, et aucun endroit où voir l'affaire entière.

C'est un défaut de **modèle**, pas une fonctionnalité absente. Tant qu'il tient, aucune
amélioration d'organisation ne produira l'effet attendu.

### D2 — Le modèle plat ne porte pas la réalité d'un BE

Ce qu'un bureau d'études manipule, dans l'ordre où il le cherche : **n° d'affaire** (la clé du
dossier papier et de la facture), **client / maître d'ouvrage**, **phase** (APS/APD/PRO/EXE),
**repère d'ouvrage** (culée C0, PK 12+400, sondage SP3), **indice de révision**.
Aucun n'existe. Et la recherche ne porte que sur `name` : sur 200 affaires, elle ne trouve rien
une fois sur deux.

### D3 — Rien ne distingue un essai d'un calcul retenu

« Pont de Mbodiène : 40 calculs, 4 PV » — donc ~36 essais. Il n'existe ni statut, ni suppression,
ni filtre, ni marqueur sur un calcul (`calc_results` n'a **ni colonne `status` ni colonne
`label`** ; le libellé affiché est dérivé du moteur à l'affichage). L'historique ne peut que
grossir, et rien n'indique quelle hypothèse fait foi.

---

## 3. Le parcours : pourquoi il est vécu comme « découpé »

- **`/projets/[id]` redirige vers `/calculs`.** « Vue d'ensemble » est le **premier** onglet
  affiché mais n'est **jamais** la page d'arrivée. Un onglet qui n'est jamais la porte d'entrée et
  qui occupe la première place est un onglet de trop.
- **« Vue d'ensemble » est une redite** : trois derniers calculs, trois derniers PV — disponibles
  en un clic avec plus de détail dans les onglets dédiés, sans aucun agrégat propre. Et il refait
  deux appels réseau déjà faits.
- **Le renommage est enterré au 4ᵉ onglet**, alors que la suppression a **deux** points d'entrée.
  Une action fréquente et anodine coûte plus de clics qu'une action rare et destructive : c'est
  l'inverse de ce qu'il faut.

**Cible : 4 onglets → 2** (« Calculs », « PV scellés »). Le nom devient éditable en ligne dans la
bande projet ; les métadonnées passent en popover sur la puce de référence ; archiver/supprimer
passe dans un menu « … ». Rien n'est perdu, tout coûte moins de clics.

---

## 4. Plan de changements

Effort en jours-homme pour un développeur solo, gate de ~9 min à chaque push.

> **Cadrage imposé par la revue adverse — le coût d'opportunité prime.**
> Le client attend la **livraison groupée des 5 logiciels fidèles** (rien ne part avant 5/5).
> Une première version de ce plan totalisait ~30 j-h : disproportionné pour retarder ce que le
> client attend. **Seul P0 est engagé maintenant (~3 j).** Tout le reste attend la livraison 5/5
> **et** une validation de volumétrie et de vocabulaire par STARFIRE — car P1/P2 reposent sur un
> usage _supposé_ (« 200 affaires ») alors que le réel mesuré est : **1 tenant, 4 projets,
> 55 calculs**. Les besoins « n° d'affaire », « repère », « retenu/écarté » sont **plausibles mais
> non validés**.
>
> Exception : le poids des payloads n'est **pas** une supposition — il est mesuré (4,05 Mo par
> ouverture de projet, cf. 1.6). P0-1 tient sur du mesuré.

### P0 — Rétablir la confiance et réparer ma régression · ≈ 3 j

Ces points ne sont pas des fonctionnalités : ce sont des écrans **qui mentent**. Un outil qui
affiche faux perd sa crédibilité plus vite qu'un outil incomplet.

| #    | Action                                                                                                                                                                                                                                                                                             | Effort    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| P0-1 | **Compteurs sans payload** : exposer `calcCount`, `pvCount`, `lastActivityAt` sur `GET /projects` et `GET /projects/:id` (2 requêtes `groupBy` fixes pour tout le tenant, jamais de N+1). Mes compteurs d'onglets cessent d'appeler les listes. **−2,5 Mo par ouverture de projet.**               | 0,75      |
| P0-2 | **Bug d'ordre de l'aperçu** (1.2) — voir note : on **supprime** l'onglet plutôt que corriger `slice(-3)`.                                                                                                                                                                                          | 0,1       |
| P0-3 | **Dernière activité réelle — agrégat EN LECTURE**, pas de colonne, pas de trigger : `MAX(project.updated_at, max(calc.created_at), max(pv.sealed_at))` scopé tenant, calculé et **trié côté serveur**, et **suppression du tri front** (fin des deux vérités, 1.4). Libellé « Dernière activité ». | 1,0       |
| P0-4 | **Dates** : jour calendaire (borne minuit locale) et **date absolue en premier**, le relatif en appoint.                                                                                                                                                                                           | 0,4       |
| P0-5 | **Description** : soit on la persiste (colonne + schéma), soit on **retire le champ**. Ne pas laisser un champ qui avale la saisie.                                                                                                                                                                | 0,3       |
| P0-6 | **Index manquants** : `(org_id, project_id, created_at DESC)` sur `calc_results`, `(org_id, project_id, sealed_at DESC)` sur `official_pvs`.                                                                                                                                                       | 0,2       |
| P0-7 | **Renommage en ligne** depuis la liste et l'en-tête (`renameProject` existe déjà).                                                                                                                                                                                                                 | 0,4       |
| P0-8 | **Réversibilité (1.7)** : retirer la phrase « annulable par un administrateur », ou livrer la restauration. Retirer coûte 5 min et supprime le mensonge ; livrer la restauration est plus juste mais plus cher — **à trancher**.                                                                   | 0,1 à 0,6 |

> **Pourquoi l'agrégat en lecture, et pas une colonne + trigger (P0-3).** La colonne matérialisée
> serait plus rapide et permettrait un tri index-only ; mais elle impose une migration, un backfill,
> et surtout un trigger sur le **write-path du scellement** — la zone la plus sensible du produit.
> À 4 projets et 55 calculs, c'est prématuré. L'agrégat en lecture a en outre **zéro désynchronisation
> par construction**, ce qui est exactement la propriété qui manquait au champ fautif. À reconsidérer
> seulement si une lenteur est **mesurée**, pas supposée.
>
> **Écarté également : le compteur applicatif** (mise à jour dans les services). C'est précisément
> le mécanisme qui a produit le bug 1.1 — six contrôleurs de calcul, `emitPv`, plus tout import
> futur : autant d'occasions d'oublier.
>
> **Garde-fou si l'on passe un jour à la colonne** : `last_activity_at` doit rester **distinct** de
> `updated_at` (Prisma `@updatedAt` réécrit ce dernier à chaque renommage) ; le trigger ne doit
> jamais lever d'exception (`official_pvs` n'a pas de FK vers `projects` et lui survit par design
> d'immuabilité — un horodatage d'affichage ne doit jamais faire échouer un scellement) ; backfill
> jamais `NULL`, sinon `ORDER BY … DESC` remonte les `NULL` en tête sous Postgres.

> **Sentinelle de non-régression exigée (DoD §9).** Aucun test ne couvre aujourd'hui l'ordre de ces
> listes — ni la spec e2e (qui ne vérifie que les compteurs), ni les tests unitaires (qui ne
> vérifient que les libellés moteurs). C'est exactement le bug qui revient. Test **rouge d'abord** :
> « un projet dont le dernier calcul est plus récent remonte en tête de liste ».

> **Ordre de déploiement.** Web sur Vercel (`main`) ↔ API sur Render (`recette`) : tout changement
> de contrat (compteurs, champ `lastActivityAt`) doit être **additif** et l'**API déployée d'abord**,
> sinon le web en production appelle un contrat qui n'existe pas encore.

### P1 — Rendre l'outil tenable à 200 affaires · ≈ 5,5 j · **GELÉ** jusqu'à 5/5 + validation STARFIRE

> Repose sur un usage supposé, non mesuré. À faire confirmer par STARFIRE (volumétrie réelle,
> vocabulaire) **avant** d'engager la moindre journée. Exception possible : P1-1 (verrou de
> domaine), qui est un défaut de modèle et non un ajout — voir décision 1.

| #    | Action                                                                                                                                                                                                                                                           | Effort |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| P1-1 | **D1 — domaine = étiquette, plus verrou.** Une affaire ouvre tous les logiciels ; le domaine devient un filtre par défaut réversible.                                                                                                                            | 0,75   |
| P1-2 | **`view=summary` sur la liste des calculs** (`id, engineId, createdAt, verdict, pvId` — jamais `input`/`output`). Suppose de **dériver le verdict côté serveur** : le précédent existe, `official_pvs.verdict` est déjà dénormalisé. Gain ≈ ×100 sur le payload. | 1,0    |
| P1-3 | **Réf. d'affaire + client** + recherche étendue (nom, réf, client) + filtres/tri associés.                                                                                                                                                                       | 1,5    |
| P1-4 | **Statut de calcul** : « retenu » / « écarté » + suppression d'un calcul **non scellé**. Marqueur **ni vert ni rouge** (ADR 0008 : ce n'est pas un verdict).                                                                                                     | 1,25   |
| P1-5 | **Filtres onglet Calculs** (moteur, scellé/non, période).                                                                                                                                                                                                        | 0,5    |
| P1-6 | **Corbeille réelle** : `deleted_at` pour la suppression, `ARCHIVED` retrouve son sens métier (terminé, consultable, masqué par défaut). Backfill obligatoire.                                                                                                    | 0,5    |

### P2 — Confort de livraison · ≈ 4,5 j · **GELÉ** jusqu'à 5/5

Sélection multiple de PV + téléchargement groupé (ZIP) et **bordereau de remise** — la vraie
demande métier : une page en-tête BE listant n° de PV, date de scellement, objet, logiciel,
verdict, empreinte tronquée (2,5 j) · marquage « remis le … » + export CSV (1 j) · chaînage
d'indice « remplace le PV n° … » (1 j).

> Le bordereau **ne modifie aucun PV** et **n'est pas scellé** : c'est un bordereau, pas une pièce
> probante. Ne pas le survendre.

### P3 — Restructuration du parcours (4 onglets → 2) · ≈ 2 j, **en dernier**

À faire **après** la livraison des 5 logiciels fidèles. Motif : le chantier de fidélité
(clone d'UI client, iframe + bridge) atterrit dans l'onglet Calculs ; restructurer avant, c'est
refaire le travail deux fois. Les routes `/overview`, `/calculs`, `/pv`, `/infos` sont câblées en
dur dans les e2e (`shell-parcours-coeur.spec.ts`) : réécrire les specs **avant** de merger, et
prévoir des redirections pour ne pas casser les favoris.

---

## 5. Ce que je recommande de NE PAS faire

- **Arborescence de dossiers libre**, GED de pièces jointes, workflow d'approbation multi-rôles,
  tableau de bord analytique. Des semaines de travail pour un gain nul sur la tâche réelle.
- **Vue matérialisée** pour la dernière activité : elle remplacerait un horodatage _faux_ par un
  horodatage _périmé_ — le bug qu'on corrige — et une MV ne porte pas de politique RLS.
- **Compteur applicatif** (mise à jour dans les services) : c'est exactement le mécanisme qui a
  produit le bug 1.1. Six contrôleurs de calcul, `emitPv`, plus tout import futur = autant
  d'oublis.
- **Pagination serveur de la liste des projets** maintenant : une ligne pèse ~250 octets ; le tri
  client tient jusqu'à ~1 000 lignes. Elle casse **ergonomiquement** (vers 30–40 affaires sans
  filtre) bien avant de casser techniquement. C'est l'onglet **Calculs** qui casse déjà, pas elle.
- **Confondre « client / affaire » avec le tenant.** Un regroupement suggéré par l'utilisateur ne
  doit jamais se substituer conceptuellement à l'organisation, sous peine de recréer un
  sous-multi-tenant non couvert par RLS.

---

## 6. Décisions qui te reviennent

Ces arbitrages **modifient un comportement déjà livré en préprod** : une revue automatisée ne vaut
pas validation humaine, ils te reviennent.

1. **Réversibilité (P0-8)** — retirer la phrase mensongère (5 min) ou livrer la restauration
   (~0,5 j) ? Mon avis : **livrer la restauration**, car la promesse est raisonnable et c'est elle
   qui rend l'archivage utilisable ; retirer la phrase règle l'honnêteté mais laisse une action
   destructive sans filet.
2. **D1 — le domaine reste-t-il un verrou ?** Le lever est la correction la plus structurante du
   lot et la moins chère (~0,75 j). Mon avis : **le lever**, car il force aujourd'hui à découper
   une affaire en trois projets. Attention : cela change la sélection de projet dans les
   6 logiciels — à ne pas glisser dans P0 sans ton accord explicite.
3. **Description (P0-5)** : la persister, ou retirer le champ ? Ne pas laisser un champ qui avale
   la saisie.
4. **Suppression d'un calcul déjà scellé** (si P1 est un jour engagé) : interdite (mon avis — le PV
   y renvoie), ou autorisée au motif que le PV est autoportant ? À trancher **avant** d'écrire le
   premier test.
5. **Onglet « Vue d'ensemble »** : le supprimer (recommandé — il est redondant et n'est jamais la
   page d'arrivée) ou seulement corriger son bug d'ordre ? Le supprimer touche des routes câblées
   dans les e2e.

---

## 7. Vocabulaire proposé

| Actuel               | Proposé                                  | Motif                                                                                  |
| -------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- |
| Projet / Mes projets | **Affaire** / **Mes affaires**           | Dans le métier, « projet » désigne l'ouvrage du maître d'ouvrage, pas le dossier du BE |
| Vue d'ensemble       | _(supprimé)_                             | Redite, jamais la page d'arrivée                                                       |
| PV & Livrables       | **PV scellés**                           | « Livrables » promet une GED qui n'existe pas                                          |
| Informations         | **Fiche affaire**                        | Et le renommage n'y est plus enterré                                                   |
| Modifié récemment    | **Dernière activité**                    | Et que ce soit vrai                                                                    |
| Supprimer            | **Archiver** / **Supprimer** (distincts) | Le code archive déjà ; le mot ment                                                     |
