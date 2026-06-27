Les findings sont confirmés par lecture directe. Le test Toast (#10) est bien tautologique : il rend un composant local `AriaLiveZones` (l.21-33) jamais importé de `Toast.tsx`, asserte des constantes écrites en dur (l.86-118), et les cas couleur n'assertent que `toBeTruthy()`/`length > 3` — mutation-morts. L'en-tête de `mock-gating.test.ts` (#8) annonce « logique de runCalc/emitPv » alors que le fichier ne teste que `getMockEntitlements` — runCalc/emitPv ne sont jamais importés. Confirmé.

Je note une nuance importante non relevée dans les findings : le fichier `AGENTS.md` impose de lire `node_modules/next/dist/docs/` avant tout code Next 16 — contrainte pour la phase de correction, pas un défaut.

Voici le rapport.

---

# Rapport de revue adverse — Frontend ROADSEN (feat/design-system-lot0-lot1)

## 1. Verdict global

**Le frontend est solide sur la forme, fragile sur la preuve.** Lot 0 (tokens) et Lot 1 (design system) sont d'un bon niveau d'artisanat : structure claire, séparation propre, conscience a11y réelle (régions live, rôles, focus visibles existent — ils sont juste mal *placés* par endroits). Ce n'est pas un brouillon. Mais trois faiblesses de fond le rendent **non présentable au client en l'état**, et une partie de la suite de tests **ment sur ce qu'elle prouve**.

Les trois vraies faiblesses, par ordre de gravité réelle :

1. **Démo malhonnête (#1).** Tout calcul renvoie `PASS`. L'état NON CONFORME — qui est le cœur métier d'un outil de dimensionnement — est **inatteignable et non testé**. Un BE qui ne voit jamais un échec de vérification ne croira pas l'outil, ou pire le croira et émettra un PV sur une structure sous-dimensionnée. C'est le défaut le plus grave fonctionnellement, même s'il est dans le mock.

2. **Tests à faux-verts (#8, #10, #9, #31, #32, #33).** Plusieurs tests sont structurellement vides : Toast teste un composant local jamais branché au vrai (vérifié), l'en-tête mock-gating annonce une couverture qui n'existe pas (vérifié), et des e2e d'enforcement (PV bloqué, module verrouillé) sont sous des `if(isVisible)` sautables ou des `.or([aria-disabled])` globaux laxistes. **Le décompte « 213 tests » est trompeur** : une fraction ne deviendrait jamais rouge si on cassait le code couvert. C'est une violation directe de la DoD §9 (zéro faux-vert, esprit mutation). Pour une agence qui vend la rigueur de test comme différenciateur, c'est le point le plus coûteux en crédibilité.

3. **Dette d'isolation pré-câblée (#5, #27, #26, #28).** `org_01` en dur dans 7 écrans, `orgSlug` d'URL ignoré, `X-Org-Id` posé sur la *réponse* (code mort). En mock c'est tolérable, mais aujourd'hui un test « monté sur `/app/labo-thies/...` ne doit jamais afficher de données `org_01` » serait **rouge**. Le swap mock→réel touchera 7 fichiers au pire moment. À traiter avant le câblage backend, pas pendant.

**Contre-poids honnête (ce qui tient) :** l'architecture mock est correctement isolée derrière `client.ts` (le commentaire « seul endroit à remplacer » est *presque* vrai — il faut juste y ajouter le point de résolution org). Les composants UI ont une vraie discipline a11y de base. Les défauts de fidélité couleur (#18-22) sont réels mais cosmétiques et tous dans la même classe (hex hors token). La gouvernance sécurité est lucide : les commentaires distinguent déjà « l'UI gate, le serveur barre » — il faut juste purger le mot « défense » (#29) qui amalgame avec la défense-en-profondeur de l'ADR 0011.

**Ce rapport ne vaut pas validation humaine.** Les arbitrages F-08 (PV scellable sur verdict FAIL), la whitelist de sortie moteurs, et toute la preuve d'isolation réelle (ADR 0010 T1-T5) **remontent à l'humain et à `expert-genie-civil`/`ingenieur-securite`** — je signale, je ne tranche pas.

---

## 2. Corrections priorisées

### Bloquant avant toute démo client
| # | Fichier | Correctif |
|---|---|---|
| 1 | `src/lib/api/mock-data.ts` (fixtures) + `client.ts:218-239` (runCalc) | Ajouter ≥1 fixture `verdict:'FAIL'` réaliste (NE admissible < requis, sans pvId). Rendre runCalc **déterministe** selon le payload (seuil d'épaisseur → FAIL) ou via `?demo=fail`. **Jamais aléatoire.** Test e2e : ouvrir un FAIL, asserter VerdictBanner = « NON CONFORME ». Arbitrage F-08 (bloquer « Émettre PV » sur FAIL) → `expert-genie-civil` + `ingenieur-securite`, **remonte à l'humain**. |

### Bloquant avant de continuer le build (intégrité de la suite de tests — DoD §9)
| # | Fichier | Correctif |
|---|---|---|
| 10 | `src/components/ui/__tests__/Toast.test.tsx` | **Vérifié tautologique.** Réécrire contre le vrai `Toast.tsx` : exporter+importer `colorByType`, asserter les 4 clés contre valeurs de référence ; rendre le vrai `ToastCard` (renderToString) et grep role/aria-live. Supprimer `AriaLiveZones` local et les asserts `toBeTruthy()`/`length>3`. À défaut de pouvoir tester le vrai composant : **supprimer** les cas faux-verts (un cas absent vaut mieux qu'un faux-vert). Corriger le décompte 213. |
| 8 | `src/lib/api/__tests__/mock-gating.test.ts:6` | **Vérifié mensonger.** Corriger l'en-tête *immédiatement* (retirer la mention runCalc/emitPv), OU ajouter les tests. Couvrir en priorité le **403 MODULE_NOT_IN_PACK** et le **422 SERVER_ERROR** (calc non-DONE) — couverts nulle part. |
| 9 | `tests/e2e/shell-parcours-coeur.spec.ts:236-253` | Récrire le test « module verrouillé ». Supprimer `if(isVisible)`, bannir `.or([aria-disabled])` global. Ajouter `data-testid={engine-item-${id}}` + `data-locked` dans `CalculsClient.tsx`, cibler terzaghi/casagrande (verrouillés) ET burmister (contre-épreuve débloqué). Mutation : retirer le `<Lock>` doit rendre le test rouge. |
| 31, 32 | `tests/e2e/shell-parcours-coeur.spec.ts:208-223` + unit | Durcir D-02 « PV bloqué si expiré » : `expect(calcRow).toBeVisible()` en dur, assertion positive de la bannière co-localisée, `toHaveCount(0)` sur « Émettre un PV ». Ajouter un test prouvant que **runCalc rejette** (402) en expired/quota — angle mort actuel. |
| 33 | `tests/e2e/*.spec.ts` (dupliqué) | Dé-dupliquer le test de bundle confidentialité. Surtout : ajouter le **test négatif de non-inertie** (faux chunk contenant le marqueur → le grep doit échouer), au plus près du gate CI réel. Sans lui, rien ne garantit que le grep n'est pas inerte (mauvais chemin `.next/static`). |

### Majeur — à corriger dans le lot de câblage (avant backend)
| # | Fichier | Correctif |
|---|---|---|
| 5, 27 | 7 écrans (`MOCK_ORG_ID='org_01'`) | Hook/contexte `useOrgId(orgSlug)` = seule source de l'org (mock ET réel). Supprimer les 7 constantes. Test négatif : `/app/labo-thies/...` ne doit jamais afficher `org_01` (rouge aujourd'hui). |
| 2 | `providers/index.tsx:56`, `CommandPalette.tsx`, `aide/page.tsx`, `Topbar.tsx` | Palette de commandes morte. Câbler des items réels OU masquer le bouton ⌘K + retirer les raccourcis non implémentés (N/D/E/Ctrl+Entrée) d'aide et du footer. **Ne jamais afficher un raccourci non branché au client.** |
| 3 | `CommandPalette.tsx` (Provider) | Pas de restauration de focus à la fermeture. Capturer `document.activeElement` dans le **Provider** (qui survit au démontage), restaurer à `closePalette`. Test e2e 3 cas (Esc/backdrop/sélection). |
| 4 | `CalculsClient.tsx:587-601`, `OutputTable.tsx:199-220` | Régions aria-live montées déjà peuplées → annonce non fiable. Déclarer UNE région persistante hors des branches `panel.mode`. Cibler **CalculsClient** (parcours réel) en priorité. Composant DS partagé → repasser par `qa-test`. |
| 6 | `DomainTag.tsx`, `ProjetsClient.tsx:370`, etc. | `as Domain` neutralise la vérif de type. Faire porter DomainTag sur `ProjectDomain`, mapping `Record<ProjectDomain,...>` exhaustif sans cast, supprimer tous les `as Domain`. Test type-level `@ts-expect-error` sur record incomplet. |
| 7 | `engine-descriptors.ts:338,466,531` vs `mock-data.ts` | Décalage IDs descriptors (`pieux/radier/labo`) ↔ entitlements (`casagrande/geoplaque/fastlab`) → moteurs invisibles, pas verrouillés. Aligner les descriptors sur le vocabulaire d'entitlements (cf. mémoire `geosuite-engine-mapping`). Test de cohérence bidirectionnel. |

### Mineur — dette de finition (avant livraison, pas avant de continuer)
| # | Zone | Correctif |
|---|---|---|
| 11, 23 | runCalc rows en dur / `ENGINE_DOMAIN` dupliqué | Factoriser `ENGINE_DOMAIN` + `domainOfEngine()` dans `@/lib/`, rows-mock par domaine. Trancher la double source `CalcResult.domain`. |
| 12 | `ProjetLayoutClient.tsx:117` | `<Badge label={project.domain}>` → `<DomainTag domain={...} size="compact">` (affiche libellé, pas le code brut). |
| 13 | `overview/page.tsx:40-50` | Pas de `.catch` → skeleton infini au câblage. Pattern try/catch/finally + bloc erreur `role=alert` + « Réessayer » (cf. PvListClient). |
| 14 | `CalculsClient.tsx:758` | `|| modules.length === 0` = fail-open. Retirer ; distinguer « entitlements non chargés » (skeleton) de « aucun module » (tout verrouillé). |
| 18-22 | VerdictBanner / Badge / Field / Button / CalculsClient | Hex hors token. Réintégrer dans `globals.css` (clair+dark, ratio commenté). Palette warning (#20) et Badge en-cours (#19) → valider avec `designer-ux`. Garde-fou stylelint anti-hex. |
| 24 | `ProjetLayoutClient.tsx:143-169` | `<a href>` → `next/link` (full reload évité). **Lire `node_modules/next/dist/docs/` avant** (Next 16 modifié). |
| 25 | `ProjetsClient.tsx:247` | `as unknown as MouseEventHandler` → `type="submit" form="new-project-form"`. |
| 15, 16 | Toast / Tooltip a11y | Régions live vides (code mort), liaison aria Tooltip sur wrapper `display:contents`. À traiter au branchement, non bloquant. |
| 26, 28, 29, 30 | middleware / commentaires mock | Correctifs **documentaires** : honnêteté des commentaires (X-Org-Id réponse=mort, « défense »→« simulation »), annotations MOCK sur auth/cookie. Aucun changement de comportement. |
| 17 | excellence-v1 résiduels | Pas de test axe-core/jest-axe trouvé. Ajouter en CI (P1) + table de contraste (condition de gel). |

---

## 3. Plan d'action

**Maintenant (avant de présenter quoi que ce soit / avant de continuer le build) :**
1. **#1** — fixture FAIL + runCalc déterministe + test e2e NON CONFORME. *(Sans ça, la démo est trompeuse.)*
2. **#8, #10** — purger les faux-verts Toast et l'en-tête mensonger. *(Honnêteté de la suite ; c'est rapide et ça touche la crédibilité maison.)*
3. **#9, #31, #32, #33** — durcir les 4 e2e d'enforcement vides. *(L'enforcement abonnement/module n'est aujourd'hui prouvé par aucun test rouge-able.)*
4. Recompter et publier le **vrai** nombre de tests vivants.

**Lot de câblage backend (à faire avant le swap, pas pendant) :**
- **#5/#27** point de résolution `useOrgId` unique + test négatif d'isolation.
- **#2, #3, #4, #6, #7** — palette morte, focus, aria-live, types Domain, IDs moteurs.
- Corriger les commentaires trompeurs (#26, #28, #29, #30) *en même temps* que le câblage qu'ils décrivent.

**Dette assumée (acceptable tant qu'on est en MOCK, à tracer) :**
- Auth mock permissive + cookie non crypto (#30) — *normal en mock*, devient bloquant au câblage (JWT HS256 + httpOnly/Secure).
- `X-Org-Id` sur réponse (#26/#28) — *code mort en mock* ; la vraie frontière reste le **TenantGuard serveur** prouvé par `qa-test` (T1-T5).
- Fidélité couleur (#18-22) et a11y Tooltip/Toast (#15,#16) — finition, pas blocage.

**Distinction mock vs vraie faiblesse :**
- *Spécifique au mock, normal à ce stade :* org_01 en dur, auth permissive, X-Org-Id réponse, rows en dur. **Mais** #1 (jamais de FAIL) et #5 (isolation non simulée) sont des défauts mock qui **se paieront cher au câblage** s'ils ne sont pas traités tôt.
- *Vraies faiblesses indépendantes du mock :* les faux-verts de tests (#8,#9,#10,#31,#32,#33) — ils seraient faux quel que soit le backend. C'est le point qui doit être réglé en premier, car il fausse la confiance qu'on accorde à tout le reste.

**Rappel de gouvernance :** l'arbitrage F-08 (PV sur verdict FAIL), la whitelist de sortie moteurs, et la preuve d'isolation réelle ne se figent **pas** côté front sans `expert-genie-civil` / `ingenieur-securite` et **validation humaine**. Cette revue signale ; elle ne valide pas.

Fichiers de référence : `/Users/macbook/Desktop/roadsen/05-Plateforme/apps/web/src/lib/api/client.ts`, `/Users/macbook/Desktop/roadsen/05-Plateforme/apps/web/src/lib/api/mock-data.ts`, `/Users/macbook/Desktop/roadsen/05-Plateforme/apps/web/src/components/ui/__tests__/Toast.test.tsx`, `/Users/macbook/Desktop/roadsen/05-Plateforme/apps/web/src/lib/api/__tests__/mock-gating.test.ts`, `/Users/macbook/Desktop/roadsen/05-Plateforme/tests/e2e/shell-parcours-coeur.spec.ts`.