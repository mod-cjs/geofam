# GEOPLAQUE — matrice de complétude d'interface v2 (client ↔ plateforme)

> **Objet** : rafraîchissement du rapport `geoplaque-ecarts-ui.md` (v1, conservé intact) au
> format **matrice de complétude** : une ligne par élément de l'outil client, statut
> PRÉSENT / PARTIEL / ABSENT / MASQUÉ-§8. Baseline « avant » et checklist de recette —
> un élément oublié ici est un écart livré au client.
> **Doctrine (ADR 0014, « zéro écart »)** : tout ce que l'outil client AFFICHE est
> exposable ; un masquage §8 d'une valeur affichée par le client est **lui-même un écart
> à corriger** (signalé ⚠ ci-dessous). **Exception actée** (#54) : les localisations de
> nœuds EF du radier (`*At`, segments tracés) restent masquées, la carte est remplacée
> par la grille 48×48 ré-échantillonnée serveur.

## Références comparées

| Côté                             | Cible                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Client** (gelé, lecture seule) | `03-Moteurs-client/GeoSuite/source/tools/GEOPLAQUE_V10.html` (2 661 lignes, lu intégralement par zones)                                  |
| **Nous — code**                  | `05-Plateforme/apps/web/src/app/app/[orgSlug]/logiciels/geoplaque/page.tsx` (3 901 lignes) + `ec7-indicators.ts` + `lib/api/adapters.ts` |
| **Contrats serveur**             | `packages/engines/src/{radier,plane-strain,axi,tri-raft}/contract.ts`                                                                    |
| **Inventaire client v2**         | `docs/audits-fidelite/geoplaque-inventaire-client-v2.json`                                                                               |

## Ce qui a changé depuis la v1 (état au 16/07)

La v1 reste globalement exacte sur le verdict (« écart MAJEUR et STRUCTUREL : CAO vs
formulaire »), mais **plusieurs points de la v1 sont désormais périmés** :

- **Vérifications EC7** : les **pastilles colorées** vert/orange/rouge sont maintenant
  rendues (LEVEL_DOT) **avec** le mot CONFORME/ATTENTION/DÉPASSEMENT — la v1 disait
  « texte seul ». Les lignes conditionnelles (entre plaques / entre charges) sont
  **présentes** (ec7-indicators.ts).
- **Synthèse riche** : la table Diagnostics couvre désormais la quasi-totalité de la
  Synthèse client (θx/θy, pente, p min/max, |Mx|/|My|/|Mxy|, Σ charge, Σ réactions,
  Σ Winkler, Σ ressorts, nœuds décollés) — la v1 la disait « ABSENTE ».
- **Cartes multi-champs** : les 9 cartes (contrat `champs`) sont servies et
  sélectionnables — confirmé au code (HEATMAP_FIELDS, même ordre que le client).
- **Options Sol** : complètes (pendage, assise D/γ/k, champ libre, Winkler), avec les
  mêmes valeurs par défaut que le client.

Le reste de la v1 (paradigme CAO, tool rail, onglet Propriétés, ligne de commande,
réglages carto, import/export, ×1000, unités) demeure exact et est repris ci-dessous.

---

## 1. Inventaire structurel de l'outil client (résumé)

Détail exhaustif dans `geoplaque-inventaire-client-v2.json`. Architecture : **éditeur
CAO plein écran** — header (marque + menu 6 boutons + Calculer) · tool-rail vertical
**11 outils** · **canvas modèle** (dessin, cartographie superposée, marqueurs, HUD X/Y,
helpbar, légende flottante) · inspecteur à **5 onglets** (`Modèle`, `Sol`, `Propriétés`,
`Résultats`, `2D`) · **ligne de commande** + barre de statut `ACCRO/GRILLE/ORTHO` ·
toasts + spinner. Workflows : dessin → sélection/Propriétés → Sol → Calculer (bascule
auto Résultats, toast « Calcul terminé en Xs · N nœuds ») → exploration carto/EC7/
synthèse → note de calcul imprimable ; persistance `.json` locale + import coords +
Exemple préchargé.

## 2. Inventaire de notre page React (résumé)

**Page SaaS** dans le shell GEOFAM : bandeau titre (GEOPLAQUE + sous-titre) + sélecteur
de projet (ProjectPicker, domaine FD) + bouton `Calculer →` (masqué sur l'onglet 2D) ·
**4 onglets** : `Modèle & sol` (Plaque (radier) : E MPa/ν/e + table sommets ; Profil de
sol : Base z/E MPa/ν ; Paramètres de calcul : pas 0.5/q_lim/décollement ; Sol — options
avancées : pendage, assise D/γ/k, champ libre, Winkler) · `Charges & ressorts` (Vue en
plan SVG statique + 5 tables : réparties (avec colonne `sur`), linéiques, ponctuelles
(x,y,Fz,Mx,My), ressorts ponctuels, ressorts linéiques) · `Résultats & cartographie`
(HeatmapCanvas 48×48 + sélecteur 9 champs + légende verticale 3 crans + panneau EC7 à
pastilles + table Diagnostics Grandeur/Valeur/Unité + warnings + bouton `Émettre le PV
scellé`) · `2D` (3 blocs empilés : déformations planes / axi / tri-raft, chacun avec son
profil de sol propre, son bouton Calculer, DiagTable, profils SVG (ps/axi) et PvBar).
Calcul serveur (`runCalc`, moteur `radier` / `plane-strain` / `axi` / `tri-raft`),
bascule auto vers Résultats, invalidation du résultat à toute modification de saisie.

---

## 3. MATRICE DE COMPLÉTUDE

Statuts : **PRÉSENT** (fidèle ou équivalent direct) · **PARTIEL** (présent mais forme/
contenu incomplet) · **ABSENT** · **MASQUÉ-§8** (non whitelisté au contrat serveur —
⚠ = affiché par le client donc écart ADR 0014 à corriger ou à faire acter ; ✔ = exception
actée #54).

### A. Structure générale (header, rail, canvas, barres)

| #   | Élément client                                                              | Chez nous                                                                                          | Statut  | Détail                                                                                                                                                |
| --- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Marque « GEOPLAQUE — plaques sur sol multicouche élastique » + logo         | Bandeau « GEOPLAQUE / Radier & plaque sur sol multicouche · éléments finis · Eurocode 7 annexe H » | PARTIEL | Sous-titre différent, pas de logo strates                                                                                                             |
| A2  | Menu « Nouveau » (réinitialise projet)                                      | — (« Nouveau calcul » ne réinitialise que le résultat)                                             | ABSENT  | Pas de remise à zéro du modèle                                                                                                                        |
| A3  | Menu « Exemple » (cas préchargé 16×10, 12 poteaux 700/1000/1400 kN, e=0.35) | —                                                                                                  | ABSENT  | Aucun cas de démonstration                                                                                                                            |
| A4  | Menu « Importer coords… » (X;Y par ligne → plaque)                          | —                                                                                                  | ABSENT  |                                                                                                                                                       |
| A5  | Menu « Exporter .json »                                                     | —                                                                                                  | ABSENT  | Persistance projet serveur à la place (divergence de modèle)                                                                                          |
| A6  | Menu « Ouvrir .json »                                                       | —                                                                                                  | ABSENT  | Un utilisateur client ne peut pas rejouer ses fichiers existants                                                                                      |
| A7  | Menu « Imprimer » (note de calcul navigateur)                               | « Émettre le PV scellé » (serveur)                                                                 | PARTIEL | PV = plus-value SaaS, mais la note navigateur complète (modèle+paramètres+figure+hypothèses) n'existe pas côté nous ; contenu du PV audité séparément |
| A8  | Bouton « Calculer » (header, haut-droite)                                   | `Calculer →` (bandeau, haut-droite)                                                                | PRÉSENT | Masqué sur l'onglet 2D (boutons par sous-mode, comme le client)                                                                                       |
| A9  | Outil « Sélection (Échap) »                                                 | —                                                                                                  | ABSENT  | Pas de notion de sélection d'entité                                                                                                                   |
| A10 | Outil « Plaque — polygone (R) » (dessin)                                    | Table de sommets + « + Ajouter un sommet »                                                         | ABSENT  | Équivalent fonctionnel tabulaire, pas l'outil de dessin                                                                                               |
| A11 | Outil « Charge ponctuelle (P) »                                             | Table Charges ponctuelles                                                                          | ABSENT  | idem                                                                                                                                                  |
| A12 | Outil « Charge linéique (L) »                                               | Table Charges linéiques                                                                            | ABSENT  | idem                                                                                                                                                  |
| A13 | Outil « Charge répartie sur plaque (A) »                                    | Table Charges réparties                                                                            | ABSENT  | idem                                                                                                                                                  |
| A14 | Outil « Charge extérieure sur le sol (E) »                                  | Colonne `sur` (raft/soil) des réparties                                                            | ABSENT  | idem (le concept est couvert)                                                                                                                         |
| A15 | Outil « Ressort ponctuel (K) »                                              | Table Ressorts ponctuels                                                                           | ABSENT  | idem                                                                                                                                                  |
| A16 | Outil « Ressort linéique »                                                  | Table Ressorts linéiques                                                                           | ABSENT  | idem                                                                                                                                                  |
| A17 | Outil « Mesurer (M) »                                                       | —                                                                                                  | ABSENT  | Aucun équivalent                                                                                                                                      |
| A18 | Outil « Panoramique (Espace) »                                              | —                                                                                                  | ABSENT  | Aperçu statique, pas de navigation                                                                                                                    |
| A19 | Outil « Zoom étendu (Z) »                                                   | —                                                                                                  | ABSENT  |                                                                                                                                                       |
| A20 | Canvas modèle (espace CAO : grille, entités, carto superposée)              | Vue en plan SVG statique (Charges) + HeatmapCanvas séparé (Résultats)                              | PARTIEL | Rôle d'affichage partiellement couvert ; rôle d'ÉDITION totalement absent                                                                             |
| A21 | HUD coordonnées curseur X/Y                                                 | —                                                                                                  | ABSENT  |                                                                                                                                                       |
| A22 | Barre d'aide contextuelle (helpbar par outil)                               | —                                                                                                  | ABSENT  |                                                                                                                                                       |
| A23 | Légende flottante sur le canvas (titre champ + barre + graduations)         | Légende verticale à côté de la carte                                                               | PARTIEL | 3 graduations (max/moy/min) vs 4–8 chez le client                                                                                                     |
| A24 | Ligne de commande (`x,y`, `raft`, `solve`, `array c r dx dy`, `?`…)         | —                                                                                                  | ABSENT  |                                                                                                                                                       |
| A25 | Barre de statut : bascules ACCRO / GRILLE / ORTHO                           | —                                                                                                  | ABSENT  |                                                                                                                                                       |
| A26 | Toasts (ok/err : « Plaque créée », « Calcul terminé… »)                     | Bandeaux d'erreur `role=alert`                                                                     | PARTIEL | Pas de confirmations positives                                                                                                                        |
| A27 | Spinner « Maillage… »                                                       | Bouton « Calcul… » + aria-busy                                                                     | PARTIEL |                                                                                                                                                       |
| A28 | 5 onglets : Modèle · Sol · Propriétés · Résultats · 2D                      | 4 onglets : Modèle & sol · Charges & ressorts · Résultats & cartographie · 2D                      | PARTIEL | Propriétés absent ; Modèle+Sol fusionnés ; Charges devenu un onglet (chez le client ce sont des entités du canvas) ; libellés ≠                       |

### B. Onglet Modèle (client)

| #   | Élément client                                                                 | Chez nous                             | Statut  | Détail                                                |
| --- | ------------------------------------------------------------------------------ | ------------------------------------- | ------- | ----------------------------------------------------- |
| B1  | Titre du projet (champ libre)                                                  | ProjectPicker (nom du projet serveur) | PARTIEL | Pas de champ libre ; nom transmis au payload `projet` |
| B2  | Client / Maître d'ouvrage                                                      | —                                     | ABSENT  | Info d'en-tête de la note de calcul                   |
| B3  | Affaire / N°                                                                   | —                                     | ABSENT  |                                                       |
| B4  | Auteur                                                                         | —                                     | ABSENT  |                                                       |
| B5  | « Entités du projet » : liste unifiée cliquable (swatch, résumé, ✕, sélection) | Tables par type avec ✕                | PARTIEL | Suppression OK ; pas de liste unifiée ni de sélection |

### C. Onglet Sol (client)

| #   | Élément client                                                                     | Chez nous                                   | Statut  | Détail                                                                  |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------- | ------- | ----------------------------------------------------------------------- |
| C1  | Note « Cote de référence = 0 en surface… substratum rigide »                       | —                                           | ABSENT  | Note pédagogique omise                                                  |
| C2  | Couches — colonne « Nom »                                                          | —                                           | ABSENT  | Table sans nom de couche                                                |
| C3  | Couches — Z_base / E (kPa) / ν + ✕                                                 | Base z (m) / **E (MPa)** / ν + ✕            | PRÉSENT | Écart d'unité affichée : kPa (client) vs MPa (nous)                     |
| C4  | « + Ajouter une couche »                                                           | idem                                        | PRÉSENT |                                                                         |
| C5  | Couches par défaut : Couche 1 (−10, 2e4 kPa, 0.33) + Couche 2 (−30, 5e4 kPa, 0.33) | 1 ligne vide (nu 0.33)                      | ABSENT  | Défauts non repris — première impression ≠                              |
| C6  | Pendage ∂(prof.)/∂x et ∂/∂y (§2.3.1) + note                                        | idem + note                                 | PRÉSENT |                                                                         |
| C7  | « Autoriser le décollement (sans traction) »                                       | « Décollement autorisé »                    | PRÉSENT | Libellé abrégé                                                          |
| C8  | « Seuil de plastification de l'interface q_lim (kPa) — 0 = désactivé »             | « Contrainte limite q_lim (kPa) »           | PRÉSENT | Libellé ≠ (placé dans « Paramètres de calcul »)                         |
| C9  | Assise D / γ terres excavées / k = E_ur/E₀ (§2.3.2 + §2.3.4)                       | idem (mêmes libellés, mêmes défauts 0/18/1) | PRÉSENT |                                                                         |
| C10 | Champ libre g₀ / ∂g/∂x / ∂g/∂y (§2.3.3)                                            | idem                                        | PRÉSENT |                                                                         |
| C11 | Winkler k_w / compression seule / p_lim (§2.2.7)                                   | idem + note                                 | PRÉSENT |                                                                         |
| C12 | Maillage — pas de la grille (m), **défaut 0.8**, min 0.3                           | « Maillage — pas (m) », **défaut 0.5**      | PARTIEL | Valeur par défaut différente → résultats par défaut ≠ de l'outil client |

### D. Onglet Propriétés (client — édition de l'entité sélectionnée)

| #   | Élément client                                                                                   | Chez nous                                                 | Statut  | Détail                                                          |
| --- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ------- | --------------------------------------------------------------- |
| D1  | Boutons « Copier / Déplacer / Coller en série »                                                  | —                                                         | ABSENT  | Aucune duplication/translation d'entité                         |
| D2  | Plaque : E (kPa), ν, e + table Sommets #/X/Y                                                     | Carte « Plaque (radier) » : E (MPa), ν, e + table sommets | PRÉSENT | E en MPa ; une seule plaque éditable (le client gère N plaques) |
| D3  | Charge ponctuelle : X, Y, Fz, Mx, My                                                             | Table x/y/Fz (kN)/Mx/My                                   | PRÉSENT |                                                                 |
| D4  | Ressort ponctuel : X, Y, k + note explicative (pieu/micropieu, R=k·w)                            | Table x/y/k (kN/m)                                        | PARTIEL | Note pédagogique absente                                        |
| D5  | Charge linéique : X₁Y₁X₂Y₂, q (kN/ml)                                                            | Table x1/y1/x2/y2/q (kN/m)                                | PRÉSENT | Unité affichée kN/m vs kN/ml                                    |
| D6  | Ressort linéique : X₁Y₁X₂Y₂, k (kN/m par m) + note                                               | Table x1/y1/x2/y2/k (kN/m/m)                              | PARTIEL | Note absente                                                    |
| D7  | Charge répartie/ext. : coins, q (kPa), select « Appliquée sur : la plaque / le sol (extérieur) » | Table x1/y1/x2/y2/q (kPa)/`sur`                           | PRÉSENT |                                                                 |
| D8  | « Supprimer cette entité »                                                                       | ✕ par ligne                                               | PRÉSENT |                                                                 |

### E. Onglet Résultats (client)

| #   | Élément client                                                                                             | Chez nous                                                         | Statut      | Détail                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Sélecteur 9 champs (Tassement, Distorsion \|∇w\|, θx, θy, Réaction, Coef. réaction, Mx, My, Mxy)           | HeatmapFieldSelector — mêmes libellés, même ordre                 | PRÉSENT     | Contrat `champs` (9 clés)                                                                                                                                                                            |
| E2  | Case « Lignes d'isovaleurs »                                                                               | —                                                                 | ABSENT      | Rendu lissé sans isolignes                                                                                                                                                                           |
| E3  | Case « Remplissage par plages (paliers) »                                                                  | —                                                                 | ABSENT      |                                                                                                                                                                                                      |
| E4  | Select « Nombre de niveaux » (6–24)                                                                        | —                                                                 | ABSENT      |                                                                                                                                                                                                      |
| E5  | Case « Marquer les points critiques (S max, β max) »                                                       | —                                                                 | MASQUÉ-§8 ✔ | Exception actée #54 : localisations `*At` non whitelistées                                                                                                                                           |
| E6  | Carte SUPERPOSÉE au modèle + marqueurs S max/S min/β max + segment Δs + couple P_i–P_j + indices P1/K1/KL1 | Carte séparée 48×48 avec contour + charges dessinés               | PARTIEL     | Superposition partielle (contour/charges oui, marqueurs critiques non — couverts par l'exception #54)                                                                                                |
| E7  | Palettes : turbo (positifs) + divergente bleu/blanc/rouge symétrique (champs signés θ/M)                   | `heatColor` unique pour tous les champs                           | PARTIEL     | Un moment ± n'est pas lisible sans palette divergente centrée sur 0                                                                                                                                  |
| E8  | Légende : nom champ + unité + 4–8 graduations (+ « · n plages »)                                           | Titre + unité + 3 graduations                                     | PARTIEL     |                                                                                                                                                                                                      |
| E9  | EC7 « Tassement total max » : pastille + valeur mm + note avec localisation (x, y)                         | Pastille + valeur + repère « ≈ 50 mm » + verdict texte            | PRÉSENT     | Localisation masquée (exception #54) ; note → repère court                                                                                                                                           |
| E10 | EC7 « Tassement différentiel » : pastille + note segment (x,y)→(x,y)                                       | Pastille + valeur + « ≈ 20 mm »                                   | PRÉSENT     | Coordonnées masquées (exception #54)                                                                                                                                                                 |
| E11 | EC7 « Distorsion angulaire β » : « 1/N (x.xe−x rad) » + localisation                                       | « 1/N » seul                                                      | PARTIEL     | La valeur en rad n'est pas affichée ; localisation = exception                                                                                                                                       |
| E12 | EC7 « Inclinaison d'ensemble ϖ » : « 1/N » + pastille                                                      | idem                                                              | PRÉSENT     |                                                                                                                                                                                                      |
| E13 | EC7 « Distorsion entre plaques » (si multi-plaques) : 1/N · Δs mm                                          | Indicateur conditionnel (rows)                                    | PRÉSENT     | Δs inter-plaques aussi en ligne Diagnostics                                                                                                                                                          |
| E14 | EC7 « Distorsion entre charges (max) » : 1/N · Δs mm / L m + note couple i↔j                               | Indicateur « Distorsion max entre charges voisines » (ratio seul) | PARTIEL     | Δs, L et le couple i↔j ne sont pas affichés (le contrat `worstLoadPair` expose pourtant ds/L/ki/kj/p1/p2)                                                                                            |
| E15 | Table « Différentiel entre charges voisines » : Charges \| Δs \| L \| β — 8 pires paires + total           | —                                                                 | MASQUÉ-§8 ⚠ | `loadPairs.edges` NON whitelisté (`radier/contract.ts` n'expose que `worstLoadPair`). Client l'affiche → écart ADR 0014 : whitelister les paires (positions saisies + Δs/L/β dérivés, rien de nodal) |
| E16 | Synthèse « Nœuds de calcul » (+ « · n plaques »)                                                           | « Nombre de radiers » seul                                        | MASQUÉ-§8 ⚠ | `N` non whitelisté (méthode EF au contrat). Client l'affiche → à corriger OU à faire acter comme extension de l'exception #54 (décision titulaire+expert)                                            |
| E17 | Synthèse « Tassement max / min » (mm)                                                                      | 2 lignes w_max / w_min (mm)                                       | PRÉSENT     | ×1000 client non repris (décision actée, mémoire radier-unités)                                                                                                                                      |
| E18 | « Rotation θx max » (rad exponentiel + 1/N)                                                                | Ligne en ‰                                                        | PARTIEL     | Représentation ≠ (‰ vs rad + ratio)                                                                                                                                                                  |
| E19 | « Rotation θy max »                                                                                        | idem                                                              | PARTIEL     | idem                                                                                                                                                                                                 |
| E20 | « Pente locale max \|∇w\| » (rad + 1/N)                                                                    | Ligne en ‰                                                        | PARTIEL     | idem                                                                                                                                                                                                 |
| E21 | « Réaction p (min/max) » (kPa)                                                                             | 2 lignes p_min / p_max                                            | PRÉSENT     |                                                                                                                                                                                                      |
| E22 | « \|Mx\| / \|My\| max » (kN·m/ml)                                                                          | 2 lignes                                                          | PRÉSENT     |                                                                                                                                                                                                      |
| E23 | « \|Mxy\| max (torsion) »                                                                                  | idem                                                              | PRÉSENT     |                                                                                                                                                                                                      |
| E24 | « Charge appliquée Σ » (kN)                                                                                | idem                                                              | PRÉSENT     |                                                                                                                                                                                                      |
| E25 | « Σ réactions sol » (kN)                                                                                   | idem                                                              | PRÉSENT     |                                                                                                                                                                                                      |
| E26 | « Σ réaction Winkler » + compteurs (n décol. + n plast.)                                                   | Ligne Σ seule (conditionnelle, null si off)                       | PARTIEL     | Compteurs Winkler non exposés                                                                                                                                                                        |
| E27 | « Σ réaction ressorts » + nb (ponctuels + linéiques)                                                       | Ligne Σ seule                                                     | PARTIEL     | Comptes non affichés (déductibles de la saisie)                                                                                                                                                      |
| E28 | « Σ résistances (équilibre) » kN + écart %                                                                 | —                                                                 | ABSENT      | Calculable côté front à partir de Σ exposées (sumReact+sumWink+sumSpr vs totalLoad) — correction sans toucher au contrat                                                                             |
| E29 | « Nœuds décollés » + (n itér.)                                                                             | Ligne « Nœuds décollés » (compte)                                 | PARTIEL     | `iters` volontairement serveur (méthode) — partie itérations à faire acter                                                                                                                           |
| E30 | « Nœuds plastifiés » + seuil q_lim                                                                         | —                                                                 | MASQUÉ-§8 ⚠ | `plastNodes` NON whitelisté (hors `RadierOutputSchema`). Client l'affiche → écart ADR 0014 (compte scalaire, même nature que `decolNodes` déjà exposé)                                               |
| E31 | « Cote d'assise D » (écho, ⚠ si proche substratum)                                                         | —                                                                 | ABSENT      | Écho d'entrée (visible dans le formulaire) ; le flag `foundTooDeep` n'existe pas chez nous                                                                                                           |
| E32 | « Pendage stratigraphie ∂/∂x · ∂/∂y » (écho)                                                               | —                                                                 | ABSENT      | Écho d'entrée                                                                                                                                                                                        |
| E33 | « Recompression σv0 kPa · k » (écho)                                                                       | —                                                                 | ABSENT      | σv0 = D×γ calculé — affichable front                                                                                                                                                                 |
| E34 | Encadré rouge « ⚠ Capacité de l'interface dépassée (poinçonnement)… »                                      | Bloc « Avertissements du calcul » (warning overCap du contrat)    | PRÉSENT     | Présentation liste vs encadré dédié                                                                                                                                                                  |
| E35 | Note d'hypothèses (θx=∂w/∂y, Kirchhoff, Steinbrenner+Boussinesq, substratum, limites EC7 indicatives)      | Note « calcul serveur / §8 » uniquement                           | ABSENT      | Texte scientifique statique — copiable tel quel                                                                                                                                                      |

### F. Onglet 2D (client)

| #   | Élément client                                                                                                                                         | Chez nous                                                                                              | Statut  | Détail                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Déf. planes — champs B / e / E (kPa) / ν / q / Nb éléments / Décollement (défauts 10 / 0.5 / 3e7 / 0.2 / 100 / 60)                                     | Mêmes champs, mêmes défauts (E = 30000 MPa)                                                            | PRÉSENT | Unité E : MPa vs kPa (même valeur physique)                                                                                                                 |
| F2  | Déf. planes — charges ponctuelles linéiques : TEXTAREA « x P » une par ligne                                                                           | Table x / P (kN/ml) + bouton ajouter                                                                   | PARTIEL | Équivalent fonctionnel, forme ≠                                                                                                                             |
| F3  | « Calculer (déformations planes) »                                                                                                                     | idem                                                                                                   | PRÉSENT |                                                                                                                                                             |
| F4  | Déf. planes — stats : max/min combinés, diff, M max (+/−), p max, « Charge / réaction Σ … (équilibre ✓ / x %) », [D], [décollement n·itér], Rigidité D | DiagTable : w_max, w_min, diff, M_max, M_min, p_max, charge, réaction, z_0, nœuds décollés, Rigidité D | PARTIEL | Toutes les grandeurs présentes ; « équilibre ✓/% » non calculé, itérations absentes, lignes séparées vs combinées                                           |
| F5  | Déf. planes — figure SVG 3 bandes (w mm / M / p, zéro pointillé, axe x)                                                                                | ProfilesChart 3 bandes (`profils` au contrat)                                                          | PRÉSENT | Mêmes couleurs, même ordre                                                                                                                                  |
| F6  | Axi — champs R / e / E / ν / q / Pc / Nb éléments annulaires (défauts 6 / 0.4 / 3e7 / 0.2 / 120 / 0 / 50)                                              | Mêmes champs, mêmes défauts                                                                            | PRÉSENT | + champ D local (cf. F11)                                                                                                                                   |
| F7  | « Calculer (axisymétrique) »                                                                                                                           | idem                                                                                                   | PRÉSENT |                                                                                                                                                             |
| F8  | Axi — stats : centre/bord, diff, M_r max, M_t max, p max, Σ (équilibre), [D]                                                                           | DiagTable : w_c, w_bord, w_max, w_min, diff, M_r, M_t, p_max, Σ, z_0                                   | PRÉSENT | Équilibre % non affiché                                                                                                                                     |
| F9  | Axi — figure SVG 4 bandes (w / M_r / M_t / p)                                                                                                          | ProfilesChart 4 bandes                                                                                 | PRÉSENT |                                                                                                                                                             |
| F10 | Tri DKT — champs e / taille maille / E / ν / q add. (défauts 0.5 / 1.0 / 3e7 / 0.2 / 0)                                                                | Mêmes champs, mêmes défauts                                                                            | PRÉSENT |                                                                                                                                                             |
| F11 | 2D — sol et cote D **partagés** avec l'onglet Sol                                                                                                      | Profil de sol + D **propres à chaque solveur**                                                         | PARTIEL | Divergence fonctionnelle : 3 saisies de sol au lieu d'une (déjà relevée v1)                                                                                 |
| F12 | Tri DKT — utilise les PLAQUES + CHARGES de l'onglet Modèle                                                                                             | Sommets + charges propres au mode (+ bandeau de divergence solveur)                                    | PARTIEL | Le client ne ressaisit rien ; chez nous double saisie                                                                                                       |
| F13 | « Mailler & calculer (DKT) »                                                                                                                           | idem                                                                                                   | PRÉSENT |                                                                                                                                                             |
| F14 | Tri — stats : « Maillage : n plaques · N nœuds · nt triangles », w max/min, diff, p max, Σ, [D]                                                        | DiagTable : w_max/min, diff, réaction max, Σ, z_0, nombre de radiers                                   | PARTIEL | N nœuds / nt triangles masqués §8 ⚠ (client les affiche — même décision que E16)                                                                            |
| F15 | Tri — figure : maillage triangulaire RÉEL coloré par tassement (jet) + légende bleu→rouge                                                              | —                                                                                                      | ABSENT  | Le contrat tri-raft expose `champDeflexion` (48×48) et l'adapter produit `heatmaps`, mais le bloc TriRaftBlock ne rend AUCUNE carte — correction front pure |
| F16 | Messages de garde (« Renseigne au moins une charge… », « Aucune plaque… »)                                                                             | Placeholders équivalents par bloc                                                                      | PRÉSENT |                                                                                                                                                             |

### G. Comportements / interactions

| #   | Élément client                                                                            | Chez nous                                                   | Statut  | Détail                                                     |
| --- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------- | ---------------------------------------------------------- |
| G1  | Dessin d'entités au canvas (clics, accrochage grille, ortho, fermeture Entrée/clic droit) | Saisie tabulaire                                            | ABSENT  | Cœur du paradigme CAO                                      |
| G2  | Sélection au clic → bascule onglet Propriétés                                             | —                                                           | ABSENT  |                                                            |
| G3  | Glisser-déposer d'une entité                                                              | —                                                           | ABSENT  |                                                            |
| G4  | Copier / Coller en série / Déplacer / Dupliquer (Ctrl+C/V/D, boutons)                     | —                                                           | ABSENT  |                                                            |
| G5  | Réseau « array cols rows dx dy » (trame de poteaux en 1 commande)                         | —                                                           | ABSENT  | Douloureux à ressaisir ligne à ligne chez nous             |
| G6  | Mesurer (2 clics)                                                                         | —                                                           | ABSENT  |                                                            |
| G7  | Pan / zoom molette / zoom étendu                                                          | —                                                           | ABSENT  |                                                            |
| G8  | Raccourcis outils R/P/L/A/E/K/M/Z + Échap/Entrée/Suppr                                    | —                                                           | ABSENT  |                                                            |
| G9  | Bascules ACCRO (F9) / GRILLE / ORTHO (F8)                                                 | —                                                           | ABSENT  |                                                            |
| G10 | Calculer → bascule AUTOMATIQUE sur Résultats                                              | `setTab('resultats')` après runCalc                         | PRÉSENT |                                                            |
| G11 | Toast « Calcul terminé en Xs · N nœuds »                                                  | —                                                           | ABSENT  | N masqué §8 (cf. E16) ; la durée serait affichable         |
| G12 | Modification du modèle → invalidation des résultats                                       | useEffect sur buildPayload → reset résultat + retour Modèle | PRÉSENT | Comportement même légèrement plus strict (retour d'onglet) |

### H. Livrable

| #   | Élément client                                                                                                                                                                                                                                                             | Chez nous                                            | Statut  | Détail                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | Note de calcul imprimable complète : en-tête projet, tables modèle/charges/ressorts/sol, « Paramètres de calcul » (12 lignes méthodes+options), figure du canvas, EC7 avec localisations, table TOUTES paires de charges, synthèse, note d'hypothèses, bouton Imprimer/PDF | PV scellé émis serveur (HMAC, numéroté, régénérable) | PARTIEL | Paradigme différent (assumé, plus-value SaaS) ; la complétude du CONTENU du PV vs la note client est à auditer séparément (audit PV) — au minimum les échos de paramètres et la note d'hypothèses manquent aussi à l'écran (E31–E33, E35) |

---

## 4. Synthèse chiffrée

**117 éléments client inventoriés** (A:28 · B:5 · C:12 · D:8 · E:35 · F:16 · G:12 · H:1) :

| Statut    | Nombre | Part                                                                                                                                      |
| --------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| PRÉSENT   | 38     | **32,5 %**                                                                                                                                |
| PARTIEL   | 29     | **24,8 %**                                                                                                                                |
| ABSENT    | 46     | **39,3 %**                                                                                                                                |
| MASQUÉ-§8 | 4      | **3,4 %** (1 acté ✔ : points critiques/localisations E5 ; **3 non actés ⚠** : paires voisines E15, N nœuds E16/F14, nœuds plastifiés E30) |

Lecture honnête : les **46 ABSENT** sont dominés par le paradigme CAO (rail 11 outils,
canvas, interactions G1–G9, menu fichier) — c'est UN écart structurel qui se décline en
~30 lignes. Hors paradigme CAO, la couverture « formulaire » des données et résultats
est bien meilleure (54/71 ≈ 76 % PRÉSENT+PARTIEL sur les sections C/D/E/F), mais des écarts
serveur (⚠ §8 non actés) et d'affichage (rad/1/N vs ‰, équilibre %, échos de
paramètres, note d'hypothèses) subsistent.

### Classement des écarts

**MAJEURS (structurels)**

1. Paradigme d'entrée CAO absent : canvas + tool-rail 11 outils + sélection/Propriétés + ligne de commande + statut (A9–A25, D1, G1–G9).
2. Architecture d'onglets : 5 → 4, onglet Propriétés supprimé, Modèle+Sol fusionnés (A28).
3. Menu projet absent : Exemple, Importer coords, Exporter/Ouvrir .json, Nouveau (A2–A6) — l'utilisateur client perd ses fichiers et son cas de démo.
4. Figure du maillage triangulaire DKT absente (F15) — alors que la donnée serveur existe déjà.
5. Réglages de cartographie absents : isovaleurs, plages, niveaux, marqueurs critiques (E2–E5) + palette divergente des champs signés (E7).

**MOYENS (fonctionnels / résultats)** 6. ⚠ Trois masquages §8 NON actés de valeurs affichées par le client : table « Différentiel entre charges voisines » (E15), « Nœuds de calcul » / « N nœuds · nt triangles » (E16, F14, G11), « Nœuds plastifiés » (E30) → whitelister ou faire acter (titulaire + STARFIRE). 7. Sol 2D propre à chaque solveur au lieu du sol partagé (F11) + double saisie géométrie tri-raft (F12). 8. Informations projet (Client / Affaire / Auteur) absentes (B2–B4) — en-tête de toute note de calcul de BE. 9. Détails EC7 : β sans valeur rad (E11), couple i↔j sans Δs/L (E14 — données déjà au contrat), Σ résistances/équilibre % (E28), échos de paramètres (E31–E33), note d'hypothèses (E35), compteurs Winkler/ressorts/itérations (E26/E27/E29). 10. Notes pédagogiques omises (C1, D4, D6) et note de calcul navigateur (H1, partiellement couvert par le PV).

**FAIBLES (affichage / cosmétique)** 11. Unité E : kPa (client) vs MPa (nous) — partout (C3, D2, F1). 12. Représentation des distorsions/rotations : ‰ (nous) vs rad + 1/N (client) (E18–E20) ; ×1000 des tassements non repris (décision actée — à faire figurer dans la doc utilisateur). 13. Défauts : pas de maillage 0.5 vs 0.8 (C12), couches par défaut absentes (C5), colonne Nom (C2). 14. Légende 3 crans (E8), toasts/spinner (A26/A27), libellés abrégés (C7/C8), sous-titre de marque (A1).

## 5. Les 5 écarts les plus VISIBLES pour un utilisateur de l'outil client

1. **« Où est-ce que je dessine ? »** — il ouvre GEOPLAQUE et cherche le canvas, la
   barre d'outils et la ligne de commande : tout a disparu, remplacé par des tableaux de
   coordonnées. Premier contact = logiciel différent (écart n°1, MAJEUR).
2. **« Où sont mes fichiers et l'exemple ? »** — pas de `Exemple`, pas d'`Ouvrir .json`
   / `Importer coords…` : impossible de recharger ses projets existants ou de montrer le
   cas de démonstration 12 poteaux (écart n°3).
3. **« Ma carte ne se règle plus »** — pas d'isovaleurs, pas de plages, pas de nombre de
   niveaux, pas de marqueurs S max/β max, pas de palette bleu/rouge pour les moments ;
   et en mode triangulaire, **aucune figure du tout** (écarts n°4/5).
4. **« Il manque des lignes dans mes résultats »** — pas de « Nœuds de calcul », pas de
   tableau des paires de charges voisines, pas de « Nœuds plastifiés », pas de
   Σ résistances/équilibre, pas d'échos de paramètres ni d'hypothèses ; rotations en ‰
   au lieu de rad + 1/N ; tassements ~×1000 plus petits que ce qu'il a l'habitude de
   lire (décision d'unité actée mais TRÈS visible — à expliquer dans la doc/PV).
5. **« Je ressaisis tout trois fois »** — le sol se redéfinit dans chaque solveur 2D et
   la géométrie se ressaisit pour le mode triangulaire, là où l'outil client partage
   sol + modèle entre tous les modes (écart n°7).

## 6. Rappels de doctrine et suites

- ADR 0014 : les 3 masquages ⚠ (E15/E16+F14/E30) sont des **écarts serveur** —
  extension de whitelist `radier/contract.ts` + `tri-raft/contract.ts` à faire passer
  par `ingenieur-securite` + décision titulaire (N nœuds/nt = comptes de maillage :
  soit whitelister, soit faire acter l'extension de l'exception #54).
- E14, E28, E33, F4 (équilibre %), F15 : corrections **front pures** — les données sont
  déjà exposées par les contrats.
- La décision produit v1 (Voie A fidélité stricte CAO vs Voie B repositionnement
  formulaire acté) reste **non tranchée** ; cette matrice sert de checklist de recette
  dans les deux cas.
