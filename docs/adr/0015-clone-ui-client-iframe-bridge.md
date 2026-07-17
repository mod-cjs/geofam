# ADR 0015 — Fidélité d'interface par clonage de l'UI client (excision calcul + iframe sandboxée + bridge)

- Statut : accepté (décision titulaire 16/07/2026) — pilote terzaghi, puis geoplaque, fastlab, casagrande, pressiopro
- Contexte lié : ADR 0002 (moteurs côté serveur uniquement), ADR 0014 (whitelist alignée sur l'affichage de l'outil client), mémoire « fidélité interfaces client » (zéro écart)

## Contexte

Le client STARFIRE exige **zéro écart** entre ses 6 outils HTML (référence gelée `03-Moteurs-client/GeoSuite/source/tools/`, sha256 épinglés dans `packages/engines/src/registry/registry.ts`) et nos logiciels web. La reconstruction React fidèle a échoué plusieurs fois sur les omissions (pages minimalistes : terzaghi 515 l, casagrande 656 l ; écart « MAJEUR et STRUCTUREL » documenté sur GEOPLAQUE). Or l'ADR 0014 a clarifié la frontière : **le confidentiel est le CODE des moteurs, pas les valeurs affichées** — tout ce que l'outil client affiche à ses utilisateurs est exposable.

## Décision

Pour les 5 logiciels divergents (roadsens, déjà fidèle et testé, ne change pas) :

1. **Clonage de la couche UI** : le HTML/CSS/JS d'interface de l'outil client est repris tel quel ; seules les **fonctions de calcul** en sont excisées (liste nominative par outil, cf. §Excision). Fidélité DOM par construction. Précédent : le shell GeoSuite du client charge lui-même ses outils en iframe (`app.logic.js`).
2. **Hébergement en iframe sandboxée** dans le shell GEOFAM (auth, sélection projet, entitlements, émission PV) : `<iframe srcdoc sandbox="allow-scripts allow-forms allow-modals allow-downloads">` — **sans `allow-same-origin`** (origine opaque : l'iframe n'a accès ni aux cookies, ni au JWT, ni au DOM parent).
3. **Bridge postMessage** (cf. §Protocole) : le calcul part de l'iframe vers l'hôte React, qui appelle `runCalc`/`emitPv` (`apps/web/src/lib/api/client.ts`) avec le contexte org/projet. **Le JWT ne pénètre jamais l'iframe.**
4. **Whitelist réconciliée** : chaque champ consommé par les renderers conservés du clone doit être couvert par le contrat de sortie (`packages/engines/src/<m>/contract.ts`), régime fail-closed inchangé. Un champ affiché par l'outil client et absent du contrat → élargissement du contrat (ADR 0014), avec tests de rédaction positifs+négatifs.

## Excision — doctrine

- **Liste nominative versionnée par outil** (dans `scripts/clone-tool.mjs`) des fonctions MOTEUR supprimées. Le clonage est **déterministe et rejouable** : source gelée (sha256 vérifié contre le registre) → clone. Toute mise à jour client = re-run du script.
- **Frontière calcul/affichage, défaut fail-closed** : dans le doute, on excise et le serveur renvoie la valeur. Conservé = rendu pur (tableaux, figures/SVG/canvas qui DESSINENT des valeurs serveur, gabarits de note/PV, navigation, saisie, import/export de données SAISIES). Excisé = tout ce qui calcule un résultat d'ingénierie (portance, tassement, coefficients, intégrations, régressions servant un résultat).
- Terzaghi (pilote) — **43 symboles excisés** (liste nominative complète dans la config de `scripts/clone-tool.mjs`, autorité unique) : la liste initiale de cet ADR (`computeAll` + helpers directs) s'est révélée insuffisante au build — `computeAll` appelle des fonctions science (`kpCurve`, `iDelta`, `iBeta`, `geomCase`, `soilBlend`, `harmMean*`, `lambdas`, `bouss*`, `tassement*`, `raideur*`, `gazetasFromKv`, `qcAt`, `excLimit*`, `gammaEffF`, `gammaRv`, `etatLib`, `nodesFor`, `deStart`…) et des **tables de calibration** (`KP`/`KC` réduites à leurs labels de sol, `LAMB`/`CF_GIROUD` supprimées) qui auraient expédié le code science au navigateur. Le périmètre effectif applique le défaut fail-closed. Conservées : `recalc` (réécrite async), `renderSondage`, `renderCharges`, `renderRefCap`, `renderVerifs`, `drawCoupe`, `coupeLabo`, `coupeFigure`, `buildNote`, `caseTitle`, `vcard`, `pill`, saisie/validation, helpers de données (`num`, `fmt`, `clamp`, `escH`, `parsedSondage`, `valAt`, table `ETATS`).
- **Stubs `caseSteps`/`refCapSteps` — avis expert rendu (16/07), recommandation A** : instruction `expert-genie-civil` complète — TOUTES les grandeurs du détail pas-à-pas terzaghi sont normatives/textbook (NF P 94-261 §8, annexes D/F/J ; Meyerhof, Ménard, Giroud, Schmertmann, Sanglerat) ; les coefficients de courbe k*p/k_c imprimés par `curveStr` sont la table publiée de l'annexe D (pas une calibration STARFIRE) ; et l'outil desktop commercialisé du client affiche déjà tout cela à ses licenciés. Recommandation : **exposer tout le détail pas-à-pas** (doctrine détails-transparents étendue à terzaghi), sous deux conditions : (1) allowlist nominative fail-closed des intermédiaires publiés (h_r, p_le\*/q_ce, D_e, D_e/B, k_p/k_f/k_c/k_px, i*δ/i*β/i*δβ, q*net, q_ref, R0, R_v;d, q_Rv;d, E_c/E_d, α/λ, s_c/s_d/s_f, C1/C2/C3, K_v/K_h/K*θ, δ_v) — jamais de passe-droit générique ; (2) portée terzaghi uniquement — le « défaut NON » sur p_le\*/q_ce des pieux reste valable tant que casagrande n'a pas été instruit de la même façon (moteur par moteur). Réserve documentée : l'égalité bit-à-bit des 40 coefficients KP/KC avec la table AFNOR est à vérifier sur exemplaire licencié — contrôle de conformité moteur (science = STARFIRE), indépendant de la décision d'exposition. **Validation finale titulaire en attente ; mise en œuvre par défaut alignée sur la directive « zéro écart » (dé-stub + élargissement whitelist), réversible avant toute livraison client.**
- **Vérification mécanique** : `scripts/audit-excision.mjs` échoue si une chaîne de la liste nominative apparaît dans un clone servi ; branché au review-gate à côté de la barrière bundle §8.
- Les clones vivent sous `apps/web/src/tools-cloned/<tool>.html` (artefact généré, commité, régénérable) ; les références client restent **hors git** (`packages/engines/reference/*.html`, gitignorées, sha256 épinglés).
- Pressiomètre : le seuil d'affichage §A.2 (`pelMax`) et les conversions d'unités de RENDU sont conservés côté clone (affichage normatif de valeurs serveur) ; toute régression/ajustement produisant un résultat (`lreg`, `fitPar`…) est excisé, le serveur renvoie les coefficients de courbe à tracer. Radier : le clone consomme exclusivement la **grille 48×48 ré-échantillonnée serveur** — jamais de coordonnées de nœuds EF (décision fail-closed actée).

## Protocole bridge (v1)

Enveloppe commune : `{ v: 1, type, id?, payload? }`. Handshake origine opaque : l'hôte valide `event.source === iframe.contentWindow`, l'iframe valide `event.source === window.parent` ; `targetOrigin: '*'` (sandbox sans same-origin ⇒ origine `null`, la vérification porte sur `source`).

| type                      | sens        | payload                                                                                                                                               |
| ------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ready`                   | iframe→hôte | `{ toolId }` — émis au chargement                                                                                                                     |
| `init`                    | hôte→iframe | `{ engineId, orgSlug, projectLabel, readOnly? }`                                                                                                      |
| `calc:request`            | iframe→hôte | `{ engineId, label, params }` (`id` corrèle)                                                                                                          |
| `calc:response`           | hôte→iframe | `{ ok, calcResultId?, output?, meta?, error?: { statusCode, reason, message } }` — `output` = sortie serveur whitelistée, forme `PersistedCalcResult` |
| `store:get` / `store:set` | iframe→hôte | `{ key, value? }` → persistance parent namespacée `tool-store:<orgId>:<projectId>:<toolId>:<key>` (remplace `saveLocal`/`Store` des outils)           |
| `store:value`             | hôte→iframe | `{ key, value }`                                                                                                                                      |
| `pv:request`              | iframe→hôte | `{ calcResultId }` → l'hôte pilote `emitPv` (l'émission reste aussi disponible dans la barre du shell)                                                |
| `error`                   | les deux    | `{ message }` — erreurs de protocole                                                                                                                  |

Les erreurs métier de `runCalc` (402 EXPIRED/QUOTA, 403 MODULE_NOT_IN_PACK) transitent dans `calc:response.error` et sont affichées PAR L'OUTIL dans sa zone d'erreur d'origine (fidélité), l'hôte pouvant en plus afficher sa bannière d'abonnement.

Précisions v1 (arbitrées à l'assemblage du pilote) : (1) `store:set` est acquitté par un écho `store:value` (traitement get/set uniforme côté clone) ; (2) `pv:request` réussi ne renvoie RIEN à l'iframe — le succès est notifié côté shell (`onPvEmitted`), seul un échec produit un message `error` ; (3) le route handler ne connaît pas le scénario démo du navigateur et suppose un abonnement actif pour SERVIR le HTML — le gate réel s'applique aux appels `runCalc`/`emitPv` faits par l'hôte.

Le HTML du clone est servi par un **route handler authentifié** (pas `public/`) qui exige la session et l'entitlement du module, avec CSP dédiée ; l'hôte le charge et l'injecte en `srcdoc`.

## Conséquences

- Fidélité prouvable : la spec de fidélité par moteur (patron `tests/e2e/fidelite-roadsens-ui.spec.ts` — classification fermée (a) mappé / (b) §8 / (c) absent, zéro ligne non classée) devient un test de non-régression clone↔source gelée.
- §8 inchangé : calcul 100 % serveur ; barrières ESLint + bundle + **audit d'excision** (nouvelle) toutes actives.
- Latence : `recalc()` devient async (spinner/placeholders « … » pendant l'appel serveur) ; FASTLAB = POST unique débouncé (~300 ms) portant l'état complet du formulaire (`readForm()`).
- Maintenance : une mise à jour d'outil client = re-scellement (sha256 registre) + re-run `clone-tool.mjs` + re-run des specs de fidélité.
- Critère de bascule (pilote terzaghi, ≤ 5 j) : si l'excision propre est inatteignable → retour à la reconstruction React outillée (matrices d'écarts comme spec ligne-à-ligne, specs de fidélité écrites avant le code), délai ×2-3.
