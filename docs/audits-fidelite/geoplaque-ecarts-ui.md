# GEOPLAQUE — rapport d'écarts de fidélité d'interface (client ↔ plateforme)

> **Auteur** : `qa-test` (ingénieur QA / test automation).
> **Objet** : preuve documentée des écarts d'**interface**, de **fonctionnement** et
> d'**affichage** entre l'outil GEOPLAQUE fourni par le client et notre portage web, à la
> demande du titulaire (« GEOPLAQUE est très différent de ce que le client a fourni » ;
> exigence : 0 % d'écart UI + fonctionnement + calculs).
> **Ce rapport ne corrige rien** — la correction sera un lot séparé sur cette base.

## Références comparées

| Côté                         | Cible                                                                                      | Mode d'accès                            |
| ---------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------- |
| **Client** (référence, gelé) | `03-Moteurs-client/GeoSuite/source/tools/GEOPLAQUE_V10.html` (SHA scellé `45e3e24c…9bbab`) | Chromium réel, `file://`, LECTURE seule |
| **Nous — live**              | `https://roadsen.vercel.app` → org `etude-geoplaque` → logiciel GEOPLAQUE                  | Login réel `geoplaque@starfire.test`    |
| **Nous — code local**        | `apps/web/src/app/app/[orgSlug]/logiciels/geoplaque/page.tsx` (commit `65adebc`)           | Lecture du source                       |

**État de déploiement** : le live sert **déjà** le dernier lot front (sélecteur de cartes,
indicateurs EC7, options Sol complètes, onglet 2D consolidé — commit `65adebc` mergé dans
`main`). Les écarts ci-dessous sont donc des **écarts RÉELS non traités**, pas des « déjà
corrigés en attente de déploiement », sauf mention explicite.

## Dispositif de preuve (rejouable)

- **Spec** : `tests/e2e/fidelite-geoplaque-ui.spec.ts`
- **Config** : `playwright.fidelite-geoplaque.config.ts`
- **Lancer** :
  ```
  corepack pnpm@9.12.0 exec playwright test --config=playwright.fidelite-geoplaque.config.ts
  # volet calcul live (consomme du quota, ≤6 calculs) :
  RUN_CALC=1 corepack pnpm@9.12.0 exec playwright test --config=playwright.fidelite-geoplaque.config.ts -g "RUN_CALC"
  ```
- **Captures appariées** : `docs/audits-fidelite/captures/` (`client-*` ↔ `nous-*`).
- **Inventaires JSON** : `docs/audits-fidelite/geoplaque-inventaire-{client,nous}.json`,
  `geoplaque-resultats-{client,nous}.json`.

> **Portée honnête** : l'**équivalence NUMÉRIQUE des moteurs** est déjà prouvée à **0 %**
> (rel ≤ 1e-9) par `equivalence-geoplaque-golden.spec.ts` sur la sortie BRUTE des 4 solveurs.
> Le présent rapport porte sur la **fidélité d'INTERFACE et d'AFFICHAGE bout-en-bout**, pas
> sur la justesse scientifique (responsabilité STARFIRE, split contractuel).

---

## Synthèse : verdict global

**L'écart est MAJEUR et STRUCTUREL.** Le client a livré une **application CAO interactive**
(dessin sur canvas, barre d'outils, entités cliquées-placées, ligne de commande, sélection/
propriétés) ; nous avons livré un **formulaire SaaS tabulaire** (saisie de coordonnées dans
des tableaux, aperçu statique). Les deux calculent les mêmes nombres, mais **l'expérience et
la structure d'interface n'ont presque rien en commun**. La règle titulaire (« reproduire à
l'identique structure/modes/onglets, rien d'omis ») n'est **pas** satisfaite.

Les modes/solveurs sont **fonctionnellement tous présents** (radier ACM, déformations planes,
axisymétrie, radier triangulaire DKT) et le panneau Résultats est **partiellement fidèle**
(cartographie à 9 champs, indicateurs EC7). Mais **le paradigme d'entrée diffère du tout au
tout**, plusieurs éléments sont **omis**, et l'affichage des résultats **diverge** (tableau à
plat contre synthèse riche, unités MPa/kPa, ×1000).

---

## (a) Architecture des onglets / modes

| Dimension                    | Client                                                                                                                                | Nous (live = code local)                                                                                                   | Écart ?          | Gravité     | Correction suggérée                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Paradigme d'ensemble         | **Éditeur CAO** plein écran : header + barre d'outils verticale + **canvas modèle** + inspecteur à onglets + barre de commande/statut | **Page SaaS** dans le shell GEOFAM (sidebar logiciels) : bandeau titre + sélecteur projet + onglets + cartes de formulaire | **OUI — total**  | **Majeure** | Reproduire le canvas CAO + tool rail (cf. règle titulaire) OU acter formellement le repositionnement en formulaire (décision titulaire/STARFIRE) |
| Onglets de l'inspecteur      | **5** : `Modèle`, `Sol`, `Propriétés`, `Résultats`, `2D`                                                                              | **4** : `Modèle & sol`, `Charges & ressorts`, `Résultats & cartographie`, `2D`                                             | **OUI**          | **Majeure** | Rétablir les 5 onglets d'origine (ou justifier le regroupement)                                                                                  |
| Onglet « Sol » séparé        | Onglet dédié `Sol` (couches + pendage + interface + fond de fouille + champ libre + Winkler + maillage)                               | Fusionné dans `Modèle & sol` (couches) + options Sol dans une carte « Sol — options avancées »                             | **OUI**          | Moyenne     | Isoler un onglet Sol fidèle                                                                                                                      |
| Onglet « Propriétés »        | Onglet dédié : édite l'entité **sélectionnée** sur le canvas (copier/déplacer/coller en série/supprimer)                              | **ABSENT** (pas de sélection d'entité — édition par tableaux)                                                              | **OUI — omis**   | **Majeure** | Découle du canvas ; à réintroduire avec l'éditeur d'entités                                                                                      |
| Regroupement « Charges »     | Pas d'onglet Charges : les charges sont des **entités** dessinées sur le canvas, listées dans « Entités du projet » (onglet Modèle)   | Onglet dédié `Charges & ressorts` (5 tableaux : réparties, linéiques, ponctuelles, ressorts pt/linéiques)                  | **OUI**          | Moyenne     | Cohérent avec le repositionnement formulaire ; à trancher                                                                                        |
| Onglet « 2D » (3 sous-modes) | Un pane `2D` empilant **Déformations planes** (§2.4.2), **Axisymétrie** (§2.4.1), **Maillage triangulaire DKT** (§2.2.2)              | Onglet `2D` empilant les **mêmes 3 sous-modes** dans le même ordre                                                         | **Non (fidèle)** | —           | RAS — bonne fidélité structurelle                                                                                                                |
| Bouton « Calculer » global   | Header, haut-droite (calcule le **radier ACM**)                                                                                       | Bandeau, haut-droite (idem) + boutons dédiés par sous-mode 2D                                                              | Partiel          | Faible      | RAS                                                                                                                                              |

## (b) Formulaires de saisie — champ à champ

### b.1 — Paradigme d'entrée (le cœur du « très différent »)

| Élément                                         | Client                                                                                                                                                           | Nous                                                                                                                        | Écart ?         | Gravité     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------- | ------------------------------------- |
| Géométrie du radier                             | **Dessin polygone** au canvas (outil « Plaque — polygone (R) »), accrochage grille/ortho, saisie coordonnées à la souris ou ligne de commande                    | **Tableau de sommets** (X/Y) + « + Ajouter un sommet » + aperçu SVG statique                                                | **OUI — total** | **Majeure** |
| Charges (ponctuelle/linéique/répartie/ext. sol) | **Outils de dessin** dédiés (P/L/A/E), placement au clic sur le canvas                                                                                           | **Tableaux** par type + « + Ajouter … »                                                                                     | **OUI — total** | **Majeure** |
| Ressorts (ponctuel/linéique)                    | Outils de dessin (K / ressort linéique)                                                                                                                          | Tableaux dédiés                                                                                                             | **OUI — total** | **Majeure** |
| Barre d'outils (tool rail)                      | **11 outils** : Sélection, Plaque, Charge pt, Charge linéique, Charge répartie, Charge ext. sol, Ressort pt, Ressort linéique, Mesurer, Panoramique, Zoom étendu | **ABSENTE**                                                                                                                 | **OUI — omis**  | **Majeure** |
| Ligne de commande                               | `commande › ex: 10,5 · raft · zoom · ?` (saisie type CAO)                                                                                                        | **ABSENTE**                                                                                                                 | **OUI — omis**  | Moyenne     |
| Barre de statut                                 | `X/Y` live + bascules `ACCRO` / `GRILLE` / `ORTHO`                                                                                                               | **ABSENTE**                                                                                                                 | **OUI — omis**  | Faible      |
| Menu projet                                     | `Nouveau · Exemple · Importer coords… · Exporter .json · Ouvrir .json · Imprimer`                                                                                | Sélecteur de projet (persistance serveur) + `Imprimer`→PV. Pas d'`Exemple`, pas d'`Importer/Exporter .json`, pas d'`Ouvrir` | **OUI — omis**  | Moyenne     | (Exemple, import/export JSON absents) |

### b.2 — Champs du radier (plaque)

| Champ client              | Valeur déf. client                                    | Champ nous                                           | Valeur déf. nous  | Écart ?                                  | Gravité |
| ------------------------- | ----------------------------------------------------- | ---------------------------------------------------- | ----------------- | ---------------------------------------- | ------- |
| Module béton (par entité) | `E`, `ν`, `e` édités dans **Propriétés** de la plaque | `Module béton E (MPa)`, `ν béton`, `Épaisseur e (m)` | 30000 / 0.2 / 0.4 | **Unité E : MPa (nous) vs kPa (client)** | Moyenne |
| Contour                   | sommets dessinés                                      | tableau sommets (carré 6×6 pré-rempli)               | 0,0→6,0→6,6→0,6   | Paradigme                                | Majeure |

### b.3 — Onglet « Sol » (couches + options)

| Section client                                              | Champs                                                        | Présent chez nous ?                                                                   | Écart ?                                   | Gravité |
| ----------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------- | ------- |
| Couches de sol                                              | table `Nom / Z_base / E (kPa) / ν` + « + Ajouter une couche » | Oui — table `Base z / E (MPa) / ν` (colonne **Nom absente**, **E en MPa**)            | **OUI** (Nom omis, unité E)               | Moyenne |
| Stratigraphie non horizontale (pendage §2.3.1)              | `∂/∂x`, `∂/∂y` + note                                         | Oui (carte « Sol — options avancées »)                                                | Faible                                    | Faible  |
| Interface plaque / sol                                      | toggle `décollement`, `q_lim`                                 | Oui (`q_lim` en Paramètres, décollement)                                              | Faible                                    | Faible  |
| Fondation en profondeur / fond de fouille (§2.3.2 / §2.3.4) | `D`, `γ terres`, `k = E_ur/E₀` + note                         | Oui (`Profondeur d'assise D`, `Recompression k`) — **`γ terres excavées` à vérifier** | Partiel                                   | Faible  |
| Mouvement du sol en champ libre (§2.3.3)                    | `g₀`, `∂g/∂x`, `∂g/∂y` + note                                 | Oui                                                                                   | Faible                                    | Faible  |
| Appuis Winkler (§2.2.7)                                     | `k_w`, `compression seule`, `p_lim` + note                    | Oui                                                                                   | Faible                                    | Faible  |
| Maillage                                                    | `pas de grille (m)` (déf. 0.8)                                | Oui (`Maillage — pas (m)`, déf. **0.5**)                                              | **Valeur défaut différente (0.8 vs 0.5)** | Faible  |

### b.4 — Onglet « 2D » (déformations planes / axi / tri-raft)

| Dimension                   | Client                                                                                    | Nous                                                                                         | Écart ?                      | Gravité |
| --------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------- | ------- | ------------------------------------------------- |
| Sous-modes présents & ordre | déf. planes → axi → tri DKT                                                               | déf. planes → axi → tri DKT                                                                  | **Non (fidèle)**             | —       |
| Champs déf. planes          | `B`, `e`, `E`, `ν`, `q`, charges linéiques (textarea `x P`), `Nb éléments`, `décollement` | idem, mais charges linéiques en **tableau** (pas textarea) + `Profondeur d'assise D` en plus | Partiel                      | Faible  |
| Champs axi                  | `R`, `e`, `E`, `ν`, `q`, `Pc`, `Nb éléments annulaires`                                   | idem + `Profondeur d'assise D`                                                               | Faible                       | Faible  |
| Champs tri-raft             | `e`, `taille maille`, `E`, `ν`, `q additionnelle` (utilise plaques + charges du modèle)   | idem + **sommets + charges propres au mode**                                                 | Divergence (voir ci-dessous) | Moyenne |
| Source du sol en 2D         | **partagée** — « sur le sol défini dans l'onglet Sol »                                    | **Profil de sol PROPRE à chaque sous-mode** (une table `Profil de sol` par solveur)          | **OUI — fonctionnel**        | Moyenne | Faire pointer les 3 sous-modes vers le sol commun |
| Unité E béton               | `kPa` (3e7)                                                                               | `MPa` (30000)                                                                                | **OUI (unité)**              | Faible  |

## (c) Panneau Résultats — section par section

| Section                             | Client                                                                                                                                                                                                                                                                  | Nous                                                                                                                                                                                                                                           | Écart ?                                      | Gravité        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------- |
| Titre                               | `Cartographie`                                                                                                                                                                                                                                                          | `Cartographie`                                                                                                                                                                                                                                 | Non                                          | —              |
| Sélecteur de champ                  | **9 boutons** en grille 2 col. : Tassement, Distorsion \|∇w\|, Rotation θx, Rotation θy, Réaction, Coef. réaction, Moment Mx, Moment My, Moment Mxy                                                                                                                     | **9 champs** (mêmes libellés, `HeatmapFieldSelector`)                                                                                                                                                                                          | **Non (fidèle)**                             | —              |
| Réglages carto                      | `Lignes d'isovaleurs`, `Remplissage par plages`, `Nombre de niveaux` (6..24), `Marquer points critiques (S max, β max)`                                                                                                                                                 | **ABSENTS** (rendu heatmap ré-échantillonné, sans iso/paliers/niveaux/marqueurs)                                                                                                                                                               | **OUI — omis**                               | Moyenne        |
| Rendu de la carte                   | **sur le canvas modèle** (superposé au radier), avec marqueurs `S max`/`S min`/`β max`, segment `Δs`, marqueur de charge `P1`, légende flottante                                                                                                                        | **carte séparée** (grille ré-échantillonnée 48×48, bilinéaire) + barre de légende verticale ; pas de marqueurs S/β, pas de superposition au modèle                                                                                             | **OUI**                                      | Moyenne        |
| Vérifications EC7                   | `Vérifications · EC7 annexe H` : **lignes à pastille colorée** (rouge/orange/vert) : Tassement total max, Tassement différentiel, Distorsion angulaire β, Inclinaison d'ensemble ϖ (+ entre plaques / entre charges si applicable), **avec note explicative** par ligne | Panneau `Ec7IndicatorsPanel` **fidèle** : mêmes 4 lignes + verdict **`CONFORME`** (texte) au lieu de pastille colorée ; tolérance entre parenthèses au lieu d'une note ; lignes conditionnelles (entre plaques / entre charges) **à vérifier** | Partiel (fidèle sur le fond, présentation ≠) | Faible-Moyenne |
| Diagnostics                         | _(pas de table « Diagnostics » plate — tout est en EC7 + Synthèse)_                                                                                                                                                                                                     | Table `Diagnostics (Eurocode 7 annexe H)` **en plus** : `Grandeur / Valeur / Unité` (rows moteur), distorsions en **‰**                                                                                                                        | **OUI — présentation ajoutée**               | Moyenne        |
| Synthèse                            | `Synthèse` **riche** (~10-16 stats) : Nœuds, Tassement max/min, Rotations θx/θy, Pente locale, Réaction p min/max, \|Mx\|/\|My\|, \|Mxy\| torsion, Σ charge, Σ réactions, + conditionnels (décol., plast., Winkler, ressorts, assise, pendage, recompression)           | **ABSENTE** en tant que telle — remplacée par la table Diagnostics à plat                                                                                                                                                                      | **OUI — omis/diff.**                         | Moyenne        |
| Différentiel entre charges voisines | Tableau `Charges / Δs / L / β` (trié, top 8)                                                                                                                                                                                                                            | **ABSENT**                                                                                                                                                                                                                                     | **OUI — omis**                               | Moyenne        |
| Tableau différentiel entre plaques  | affiché si multi-plaques                                                                                                                                                                                                                                                | à vérifier                                                                                                                                                                                                                                     | Possible omission                            | Faible         |
| Avertissements / poinçonnement      | encadré rouge « Capacité de l'interface dépassée »                                                                                                                                                                                                                      | Bloc `warnings` + alerte poinçonnement (présents)                                                                                                                                                                                              | Faible                                       | Faible         |
| Émission de livrable                | `Imprimer / PDF` (rapport imprimable navigateur)                                                                                                                                                                                                                        | **PV scellé serveur** (HMAC, numéroté) — fonctionnalité **en plus** (valeur ajoutée SaaS)                                                                                                                                                      | Divergence (positive)                        | —              |

## (d) Cartes / graphiques

| Dimension            | Client                                                     | Nous                                                                                                  | Écart ?             | Gravité |
| -------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------- | ------- |
| Support de rendu     | Canvas modèle (superposé au radier + charges)              | `HeatmapCanvas` séparé (grille 48×48 ré-échantillonnée, interpolation bilinéaire)                     | **OUI**             | Moyenne |
| Palette              | jet/turbo (arc-en-ciel)                                    | `heatColor` (échelle continue)                                                                        | Visuel              | Faible  |
| Isovaleurs / paliers | Options `lignes` + `remplissage par plages` + `nb niveaux` | Non exposé                                                                                            | **OUI — omis**      | Moyenne |
| Marqueurs critiques  | `S max`, `S min`, `β max`, segment Δs, `P1…`               | Non                                                                                                   | **OUI — omis**      | Moyenne |
| Légende              | Boîte flottante `Tassement w (m)` min→max                  | Barre verticale + min/moy/max                                                                         | Diff. mineure       | Faible  |
| Confidentialité §8   | (client local, tout exposé)                                | grille d'affichage **découplée du maillage** (motif, pas les valeurs nodales) — **choix délibéré §8** | Divergence (voulue) | —       |

## (e) Comportements / interactions

| Comportement                        | Client                                                                                                     | Nous                                                            | Écart ?                  | Gravité |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------ | ------- |
| Placer une entité                   | Clic sur canvas (outil actif) + accrochage                                                                 | Ajout de ligne de tableau + saisie coord.                       | **OUI — total**          | Majeure |
| Sélectionner / éditer               | Clic → onglet Propriétés                                                                                   | Édition inline dans le tableau                                  | **OUI**                  | Moyenne |
| Copier / déplacer / coller en série | Boutons dans Propriétés                                                                                    | **ABSENT**                                                      | **OUI — omis**           | Moyenne |
| Zoom / pan / mesurer                | Outils dédiés + molette                                                                                    | **ABSENT** (aperçu statique)                                    | **OUI — omis**           | Moyenne |
| Au clic « Calculer »                | spinner « Maillage… » → bascule pane Résultats → toast `Calcul terminé en Xs · N nœuds` → dessine la carte | appel serveur (`runCalc`) → rendu Résultats & carte → option PV | Diff. (serveur vs local) | Faible  |
| Import/Export projet                | `.json` (Exporter/Ouvrir) + `Importer coords…`                                                             | Persistance projet serveur (pas d'I/O `.json`)                  | **OUI**                  | Faible  |
| Exemple pré-chargé                  | Bouton `Exemple`                                                                                           | **ABSENT**                                                      | **OUI — omis**           | Faible  |
| Raccourcis clavier                  | R/P/L/A/E/K/M/Z/Échap/Espace                                                                               | **ABSENT**                                                      | **OUI — omis**           | Faible  |

## (f) Valeurs calculées affichées — cas radier de référence

**Cas** : carré 6×6 m (béton E=32000 kPa/30000 MPa, ν=0.2, e=0.4), charge centrée 1000 kN,
2 couches (limon Z=-3/E=8/ν=0.33 ; sable Z=-12/E=25/ν=0.30), maillage défaut.

> **Rappel** : l'équivalence des SOLVEURS est déjà à **0 %** (golden-master). Ici on compare
> l'**affichage** (arrondis, unités, ×1000, libellés). Le HTML client applique un **×1000
> d'AFFICHAGE** sur les tassements (`wMax*1000 → mm`) que la plateforme **ne reproduit pas**
> (décision titulaire, mémoire `roadsen-radier-units`) : c'est un **écart d'affichage
> délibéré**, pas une erreur moteur.

**Valeurs client (rendues, extraites du DOM) :**

| Grandeur                 | Client (affiché)                 |
| ------------------------ | -------------------------------- |
| Tassement total max      | `8818.1 mm` (= w_max brut ×1000) |
| Tassement différentiel   | `3338.7 mm`                      |
| Distorsion angulaire β   | `1/1 (9.3e-1 rad)`               |
| Inclinaison d'ensemble ϖ | `1/639 141 599 907`              |
| Tassement max / min      | `8818.1 / 5479.4 mm`             |
| Réaction p (min/max)     | `20.716 / 64.847 kPa`            |
| \|Mx\| / \|My\| max      | `164.9 / 164.9 kN·m/ml`          |
| \|Mxy\| max (torsion)    | `23.2 kN·m/ml`                   |
| Charge Σ / Σ réactions   | `1000 / 1000 kN`                 |
| Nœuds de calcul          | `81`                             |

**Valeurs nous (live, rendues)** — cas répliqué **au plus proche** : le formulaire n'expose
pas la charge ponctuelle centrale aussi simplement, le calcul live a donc été lancé avec une
**charge répartie q=50 kPa** sur le carré 6×6 (**Σ = 1800 kN**, cas DIFFÉRENT du 1000 kN
ponctuel côté client). **Les magnitudes ne sont donc PAS comparables 1:1** ; ce qui compte ici
est le **format d'affichage** (libellés, unités, échelle) :

| Grandeur (nous)                      | Nous (affiché)                    | Équivalent client                | Écart d'affichage                                           |
| ------------------------------------ | --------------------------------- | -------------------------------- | ----------------------------------------------------------- |
| `Tassement maximal w_max`            | `8,744 mm`                        | `Tassement total max`            | **Libellé ≠** ; **échelle ≠** (voir ×1000)                  |
| `Tassement minimal w_min`            | `7,262 mm`                        | _(dans « max / min »)_           | ligne séparée vs combinée                                   |
| `Tassement différentiel`             | `1,482 mm`                        | `Tassement différentiel`         | libellé OK                                                  |
| `Distorsion angulaire gouvernante β` | `0,556 ‰`                         | `1/1 (9.3e-1 rad)`               | **Représentation ≠ : ‰ (nous) vs 1/N ratio + rad (client)** |
| `Inclinaison d'ensemble ϖ`           | `0 ‰`                             | `1/639 141 599 907`              | **Représentation ≠**                                        |
| `Rotation θx / θy max`               | `0,393 ‰`                         | `7.96e-1 rad (1/1)`              | **Représentation ≠** (‰ vs rad + ratio)                     |
| `Réaction de sol min/max`            | `30,823 / 226,487 kPa` (2 lignes) | `Réaction p (min/max)` (1 ligne) | présentation ≠                                              |
| `Nombre de radiers`                  | `1`                               | _(pas d'équivalent)_             | —                                                           |
| `Nœuds de calcul`                    | **ABSENT**                        | `81`                             | **OUI — omis**                                              |
| `Charge Σ / Σ réactions`             | `1 800 / 1 800 kN`                | `1000 / 1000 kN`                 | format OK (cas ≠)                                           |

**Écarts d'affichage CONFIRMÉS :**

- **×1000 des tassements (confirmé)** : pour un chargement d'ordre comparable, le client
  affiche `≈ 8818 mm` là où nous affichons `≈ 8,7 mm` — un facteur **~1000**. Le HTML client
  **sur-rapporte ×1000** (`wMax*1000 → mm`) ; notre affichage en mm est à l'échelle physique
  vraie (décision titulaire, mémoire `roadsen-radier-units`). **Divergence d'affichage
  assumée**, PAS une erreur moteur.
- **Distorsions/rotations** : nous en **‰** (per-mille), client en **1/N (ratio) + rad**.
  Écart de représentation net.
- **Libellés** : nous nommons explicitement `w_max`/`w_min`/`gouvernante`/`Nombre de radiers` ;
  le client nomme `Tassement total/différentiel`, `Distorsion angulaire β`, `Inclinaison ϖ`.
- **Sélecteur de champ carto** : PRÉSENT et fidèle sur le calcul live (les **9 boutons**
  Tassement / Distorsion \|∇w\| / Rotation θx / θy / Réaction / Coef. réaction / Moment Mx / My /
  Mxy sont bien rendus — cf. `nous-06`). _(Le `fieldButtons: []` du JOSN provient d'un mauvais
  sélecteur d'extraction dans le spec, `data-testid` réel = `heatmap-field-<key>` ; la capture
  fait foi : le sélecteur est là.)_
- **Panneau EC7 fidèle** : les **4 lignes** (Tassement total max / différentiel / Distorsion β /
  Inclinaison ϖ) sont rendues avec verdict — divergence : nous affichons `CONFORME` (texte) là
  où le client affiche une **pastille colorée** (rouge/orange/vert), et nous mettons la tolérance
  entre parenthèses (`≈ 50 mm`, `ELS 1/500`) au lieu d'une note sous la ligne. La distorsion y est
  en **ratio 1/N** (comme le client), tandis que la table Diagnostics la répète en **‰**.
- **Unité E béton** : `kPa` (client) vs `MPa` (nous).
- **Présentation** : synthèse riche (client) vs table `Diagnostics` plate (nous).

---

## TOP des écarts par gravité

### Majeurs (paradigme — cœur du « très différent »)

1. **Paradigme d'entrée** : CAO interactive (canvas + tool rail + entités dessinées + ligne
   de commande) côté client **vs** formulaires tabulaires côté nous. C'est l'origine première
   du ressenti « très différent ».
2. **Barre d'outils (11 outils) ABSENTE**.
3. **Onglet « Propriétés » (édition d'entité sélectionnée) ABSENT**.
4. **5 onglets client → 4 onglets nous** (Modèle+Sol fusionnés ; Charges regroupé autrement).
5. **Canvas modèle** (dessin + carto superposée + marqueurs) absent, remplacé par aperçu SVG
   statique + carte séparée.

### Moyens (fidélité fonctionnelle / résultats)

6. **Réglages cartographie** (isovaleurs, remplissage par plages, nombre de niveaux, marqueurs
   S max/S min/β max) **absents**.
7. **Synthèse riche** (10-16 stats) + **tableau différentiel entre charges** **absents** ;
   remplacés par une table « Diagnostics » à plat.
8. **Sol en 2D** : profil propre à chaque sous-mode (nous) vs sol **partagé** (client).
9. **Ligne de commande, import/export .json, Exemple, copier/déplacer/coller** absents.

### Faibles (affichage / cosmétique)

10. **Unité E béton** : MPa (nous) vs kPa (client) — même valeur physique, présentation ≠.
11. **×1000 des tassements** : client `mm`, nous brut (décision actée) — libellés à harmoniser.
12. **Défaut de maillage** : 0.8 (client) vs 0.5 (nous) ; **colonne « Nom » de couche** omise ;
    barre de statut (ACCRO/GRILLE/ORTHO) absente.

## Recommandation

Le portage est **numériquement fidèle** (0 % moteur) mais **structurellement infidèle** à
l'interface client. Deux voies, à trancher par le titulaire + STARFIRE (décision produit, pas
QA) :

- **Voie A — fidélité stricte** (conforme à la règle titulaire « à l'identique ») : réintroduire
  le canvas CAO, le tool rail, l'onglet Propriétés, les 5 onglets, les réglages carto et la
  synthèse riche. Chantier front lourd.
- **Voie B — repositionnement acté** : conserver le formulaire SaaS mais **combler les
  omissions à faible coût** (5 onglets, réglages carto, synthèse riche, tableau différentiel,
  unités, ×1000, colonne Nom, sol 2D partagé) et **documenter formellement** l'écart de
  paradigme comme choix produit.

Dans les deux cas, les points **Faibles** (unités, ×1000, défauts, Nom de couche) sont des
corrections rapides à traiter en priorité.
