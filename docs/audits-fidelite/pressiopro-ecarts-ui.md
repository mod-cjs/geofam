# PressioPro — rapport d'écarts de fidélité d'interface (client ↔ plateforme)

> **Objet** : preuve documentée des écarts d'**interface**, de **fonctionnement** et
> d'**affichage** entre l'outil PressioPro fourni par le client (GeoSuite) et notre portage
> web GEOFAM. Exigence client : **ZÉRO écart**. Ce rapport sert de **baseline « avant »**
> et de **checklist de recette** — il ne corrige rien.
> Doctrine (ADR 0014, « zéro écart ») : tout ce que l'outil client AFFICHE est exposable ;
> un masquage §8 d'une valeur affichée par le client est **lui-même un écart**.

## Références comparées

| Côté                         | Cible                                                                                                   | Mode d'accès                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **Client** (référence, gelé) | `03-Moteurs-client/GeoSuite/source/tools/pressiometre__1_.html` (2 423 lignes)                          | Lecture source, LECTURE seule |
| **Nous — code local**        | `05-Plateforme/apps/web/src/app/app/[orgSlug]/logiciels/pressiopro/page.tsx` (3 116 lignes, état 16/07) | Lecture du source             |
| **Contrats serveur**         | `packages/engines/src/pressiometre/contract.ts` (+ `pressio-etalonnage`, `pressio-calibrage`)           | Lecture du source             |

- **Inventaire client exhaustif** : `docs/audits-fidelite/pressiopro-inventaire-client.json`
  (navigation, sections, champs, tables, figures, actions, workflows).

> **Portée honnête** : la fidélité NUMÉRIQUE des 3 moteurs est couverte par les suites
> d'équivalence golden-master de `packages/engines` (hors périmètre ici). Le présent
> rapport porte sur l'**interface, le fonctionnement et l'affichage** bout-en-bout.

---

## Synthèse : verdict global

**Le cœur métier est bien porté, la périphérie de l'outil est amputée.** Contrairement à
GEOPLAQUE (paradigme CAO ≠ formulaire), PressioPro est nativement un outil à formulaires
et onglets : notre page reprend la même logique (profondeurs en barre de chips, onglets,
tables de paliers, seuils p₀/p_f, dépouillement, profil) et le lot « zéro écart » du 14/07
a rendu le panneau Résultats largement fidèle (KPI ×2, courbe P–V corrigée annotée,
extrapolation, paramètres normalisés, synthèse β/mE, mesures corrigées par phase).

Les écarts restants sont néanmoins **nombreux et immédiatement visibles** pour un
utilisateur de l'outil client :

1. **La page Export n'existe pas chez nous** (CSV essai, CSV global, JSON export/import,
   Imprimer/PDF) — tout le circuit de sortie/échange du client a disparu (le PV scellé ne
   couvre que partiellement « Imprimer »).
2. **Le Log de sondage a perdu son dessin** : plus de coupe SVG lithologique (couleurs +
   motifs + nappe + classes de qualité), plus de sélecteurs normalisés ISO — une table de
   texte libre à la place.
3. **Le Profil a perdu le log pressiométrique combiné** (coupe + barres E_M/p_L + pastilles
   catégorie), et fusionne 2 graphiques client en 1.
4. **Les garde-fous opérateur sont absents** : « Résultat non corrigé » (a=0 / a forcé /
   Pe par défaut), « E_M = 0 », §A.2 appareillage inadapté, vérificateur de cohérence des
   paramètres, aperçu E_M temps réel lors du choix des seuils.
5. **Pas d'Exemple, pas d'auto-sauvegarde, pas de réinitialisation, pas de toasts** ;
   identification projet amputée (chantier/équipe/opérateur/date/n° calibrage).

**Synthèse chiffrée (88 éléments client inventoriés)** :
**25 % PRÉSENT (22)** · **37,5 % PARTIEL (33)** · **37,5 % ABSENT (33)** · **0 MASQUÉ-§8**
(un sous-champ contrat manquant est signalé en R1).

---

## 1. Inventaire structurel de l'outil client (résumé)

Détail complet dans `pressiopro-inventaire-client.json`. Structure :

- **Navigation** : 8 pages `data-page` en barre basse, dans cet ordre :
  `Log` (active au démarrage) · `Étalon.` · `Calibrage` · `Projet` · `Mesures` ·
  `Résultats` · `Profil` · `Export`.
- **Header** : titre + sous-titre dynamique `{Sondage} · {Projet}` ; boutons
  `🧪 Exemple` (jeu fictif complet), `Sauvegarder` (localStorage), `Réinitialiser`
  (modale de confirmation). Auto-sauvegarde `pressiopro_v32` rechargée au démarrage.
- **Barre de profondeurs** : chips cliquables + `×` (confirm si données) + `+` (prompt).
- **Figures** : 6 canvas Chart.js (`chartPV`, `chartEtal`, `chartCalib`, `chartEM`,
  `chartPLM`, `chartSpec`) + 2 SVG générés (`drawBoreholeLog` = coupe lithologique,
  `drawPressioLog` = log pressiométrique combiné) + ~26 icônes SVG inline.
- **Corrections métrologiques** : étalonnage (sonde dans l'air → Vs, Pe) et calibrage
  (forage libre → a), chacun avec table de saisie 15/30/60 s, calcul, courbe, résidus,
  R²/RMS et bouton « Appliquer » vers l'onglet Projet.
- **Workflows** : appareillage → projet (identification + corrections + calculateur Ph +
  vérif de cohérence) → log (coupe dessinée) → mesures par profondeur (seuils avec aperçu
  live) → résultats (garde-fous + KPI + catégorie + courbe annotée) → profil
  (auto-dépouillement) → export/import/print. Modales + toasts sur toutes les actions.

## 2. Inventaire de notre page React

- **Bandeau** : titre PressioPro + sous-titre statique, `ProjectPicker` (« Sondage
  (projet) », domaine LB, persistance serveur), bouton global `Dépouiller →`.
- **Barre de profondeurs** : chips + `✕` + `+ Profondeur` (libellé auto « Profondeur N »,
  champ « Profondeur z (m) » séparé dans l'onglet Projet).
- **7 onglets** : `Projet & appareillage` · `Étalonnage` · `Calibrage` · `Log de sondage` ·
  `Mesures & seuils` · `Courbe & résultats` · `Profil`. **Pas d'onglet Export.**
- **Projet & appareillage** : repère + z ; catalogue sondes (18, Vs auto) et gaines (5)
  repris fidèlement ; a/Ph/Pe/Vs/K₀ ; γ + nappe. Pas d'identification étendue, pas de
  calculateur Ph, pas de vérif de cohérence, défauts Ph/Pe = 0 (client : 0.177/1.25).
- **Étalonnage / Calibrage** : tables **P/V₆₀ seulement** (client : V15/V30/V60 + Δ60/30),
  calcul **serveur** (`pressio-etalonnage`/`pressio-calibrage`), résultats en table
  Grandeur/Valeur/Unité (Vs, Vs réel, V_pe, Pe, pente d'air, R², RMS ; a, c₀/c₁/c₂,
  équation), courbes SVG (points + ajustée + lignes Pe/1,2Vs), tableaux de résidus,
  boutons « Appliquer » (parité applyEtalonnage/applyCalibrage).
- **Log** : table 8 colonnes (De/À/Nature/État/Prél./Qual./RQD/Description) en **inputs
  texte libres**, documentaire, non repris dans le PV. **Aucun dessin, aucune légende.**
- **Mesures & seuils** : selects p₀/p_f (« Auto » + « Palier i — P = … bar »), table
  P/V15/V30/V60 + Δ60/30 calculé, ajout/suppression de paliers.
- **Courbe & résultats** : `PressioCurve` (lectures V₃₀ + fluage), `DepouillementPanel`
  (KPI ×8, `PressioCourbeCorrigee` avec courbe inverse + Vs+2V(p₀) + lignes p₁/pf/pLM +
  fluage axe droit, extrapolation A/B/pLM/asymptote/errV/méthode, tables Pression/Volume,
  synthèse β/mE/plage auto, mesures corrigées avec badges de phase), table « détail
  complet » (rows serveur : p_L, p_L*, p_f*, p_f, p_E, p₀, σ_h0, E_M, ratio, α, E_y,
  catégorie + description, consolidation, p_L méthode), **PV scellé** (divergence positive).
- **Profil** : bouton `Calculer le profil →` (1 runCalc serveur PAR profondeur), table
  Prof/E_M/p_L/p_f/E_M-p_L\*/α/Catégorie, `ProfilDepthChart` (E_M + p_L + p_f **fusionnés
  sur un seul graphe**), `BaudSpectralChart` (isolignes 4/8/14/22 + points).

---

## 3. MATRICE DE COMPLÉTUDE

Statuts : **PRÉSENT** (fidèle, divergences mineures notées) · **PARTIEL** (présent mais
incomplet/différent) · **ABSENT** · **MASQUÉ-§8** (champ non whitelisté serveur — aucun
cas plein ici ; le sous-champ manquant est signalé en R1).

### 3.a Transversal (header, navigation, persistance)

| #   | Élément client                                                                                              | Chez nous                                                                                       | Statut  | Détail                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Header : sous-titre dynamique `{Sondage} · {Projet}`                                                        | Sous-titre statique « Dépouillement d'essai… »                                                  | PARTIEL | Le contexte sondage/projet n'est pas rappelé en tête (le ProjectPicker l'affiche indirectement)                                                         |
| T2  | Bouton `🧪 Exemple` (jeu fictif complet : étalonnage + calibrage + 4 profondeurs + coupe, calcul immédiat)  | —                                                                                               | ABSENT  | Aucun jeu de démonstration ; l'app démarre vide sans guide                                                                                              |
| T3  | Bouton `Sauvegarder` (localStorage)                                                                         | —                                                                                               | ABSENT  | Aucune sauvegarde de la SAISIE (le projet serveur ne stocke que les calculs lancés)                                                                     |
| T4  | Bouton `Réinitialiser` + modale « Tout effacer ? »                                                          | —                                                                                               | ABSENT  | Pas de reset ; il faut recharger la page (et tout perdre, cf. T5)                                                                                       |
| T5  | Auto-sauvegarde `pressiopro_v32` + rechargement au démarrage                                                | —                                                                                               | ABSENT  | Un refresh navigateur PERD toute la saisie (paliers, coupe, appareillage)                                                                               |
| T6  | Barre de profondeurs : chips + `×` + `+`                                                                    | Chips + `✕` + `+ Profondeur`                                                                    | PRÉSENT | Divergences : libellé auto (client : prompt « Profondeur (ex : 16 m) ») ; pas de confirm avant suppression d'une profondeur avec données ; pas de toast |
| T7  | Toasts de feedback (sauvegarde, application, calcul OK, erreurs de saisie)                                  | Cartes d'erreur uniquement                                                                      | ABSENT  | Aucune confirmation visuelle des actions réussies (Appliquer, etc.)                                                                                     |
| T8  | Navigation : 8 pages, ordre Log→Étalon.→Calibrage→Projet→Mesures→Résultats→Profil→Export, démarrage sur Log | 7 onglets, ordre Projet→Étalonnage→Calibrage→Log→Mesures→Résultats→Profil, démarrage sur Projet | PARTIEL | Page **Export absente** (cf. §3.h) ; ordre et page d'accueil différents                                                                                 |

### 3.b Page Projet

| #   | Élément client                                                                                                          | Chez nous                                                 | Statut  | Détail                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| P1  | Champ `Projet` (texte libre, alimente le header)                                                                        | Nom du projet serveur (ProjectPicker)                     | PARTIEL | Repositionnement SaaS assumable, mais pas de champ libre ni d'effet header                                      |
| P2  | Champ `Chantier`                                                                                                        | —                                                         | ABSENT  |                                                                                                                 |
| P3  | Champ `Sondage N°` (BH-01, global, alimente header + profil + exports)                                                  | « Repère (sondage) — libellé d'affichage » PAR PROFONDEUR | PARTIEL | Sémantique différente : client = identifiant du sondage global ; nous = libellé de profondeur                   |
| P4  | Champ `Équipe`                                                                                                          | —                                                         | ABSENT  |                                                                                                                 |
| P5  | Champ `Opérateur`                                                                                                       | —                                                         | ABSENT  | Figure aussi dans les barres info étalonnage/calibrage du client                                                |
| P6  | Champ `Date` (préremplie)                                                                                               | —                                                         | ABSENT  |                                                                                                                 |
| P7  | Champ `N° calibrage`                                                                                                    | —                                                         | ABSENT  | Traçabilité métrologique du PV                                                                                  |
| P8  | Type sonde : select 18 options / 6 groupes, auto-Vs + toast                                                             | Même catalogue 18/6, auto-Vs                              | PRÉSENT | Toast absent ; nous affichons « — Vs=… cm³ » dans l'option (enrichissement)                                     |
| P9  | Type gaine : select 5 options (documentaire)                                                                            | Même catalogue                                            | PRÉSENT | Nous affichons « — a≈… » dans l'option                                                                          |
| P10 | `Longueur de passe (m)` (déf. 1.0)                                                                                      | —                                                         | ABSENT  | Documentaire (méthode de forage)                                                                                |
| P11 | `Zc — Haut. mano/sonde (m)` (déf. 0.8, synchronisé au calculateur Ph)                                                   | —                                                         | ABSENT  |                                                                                                                 |
| P12 | `Nappe Zw (m/TN)` + hint u₀ dynamique + encart « 💧 Essai sous nappe »                                                  | Champ « Nappe Z_w (m) — 0 si absente »                    | PARTIEL | Champ OK ; hint u₀ et alerte sous-nappe absents                                                                 |
| P13 | `a — Coeff. d'expansion propre (cm³/MPa)` (déf. 0) + hint calibrage + bouton « Remettre a = 0 »                         | Champ « a (cm³/MPa) » + hint condensé                     | PARTIEL | Bouton « Remettre a = 0 » absent ; hint ⚠ complet absent                                                        |
| P14 | `Vs — Volume initial sonde (cm³)` (déf. 535)                                                                            | Champ « Vs (cm³) », déf. 535                              | PRÉSENT |                                                                                                                 |
| P15 | `Ph — Colonne eau (bar)` (déf. **0.177**) + note « = 0,1×(Zs+Zc) »                                                      | Champ « P_h (bar) », déf. **0**                           | PARTIEL | Valeur par défaut différente ; note formule absente                                                             |
| P16 | `Pe — Résist. propre sonde (bar)` (déf. **1.25**)                                                                       | Champ « P_e (bar) », déf. **0**                           | PARTIEL | Valeur par défaut différente — le dépouillement « à défauts » ne donne PAS les mêmes nombres que l'outil client |
| P17 | `K₀` (déf. 0.5)                                                                                                         | Champ « K₀ », déf. 0.5                                    | PRÉSENT |                                                                                                                 |
| P18 | `γ — Poids volumique sol (kN/m³)` (déf. **19** affiché)                                                                 | Champ vide (déf. moteur 19 implicite)                     | PARTIEL | Même comportement de calcul mais le client AFFICHE 19                                                           |
| P19 | Calculateur `🧮 Ph = γw × (Zs + Zc)` : Zs, Zc, Ph calculé + « ↑ Appliquer »                                             | —                                                         | ABSENT  | Assistance opérateur clé ; Zs saisi ici alimente aussi le hint u₀                                               |
| P20 | Hint « Formules NF EN ISO 22476-4 : Vc = Vr − a×Pr · Pc = Pr + Ph − Pe »                                                | Texte pédagogique (a/Vs/Pe, Annexe D)                     | PARTIEL | Formules explicites non affichées sur l'onglet Projet                                                           |
| P21 | Bouton `🔍 Vérifier la cohérence des paramètres` + alertes normatives (a < 6 §B.4.2.1 ; Vs vs Ø sonde ; Pe §B.4.3 ; Ph) | —                                                         | ABSENT  | Toute la validation métrologique interactive a disparu                                                          |

### 3.c Page Log (coupe de sondage)

| #   | Élément client                                                                                                                                          | Chez nous                             | Statut  | Détail                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| L1  | Table coupe : De/À/Nature/État/Prél./Qual./RQD %/Description + ✕                                                                                        | Mêmes 8 colonnes + ✕                  | PARTIEL | Colonnes identiques mais TOUT en input texte libre (aucune liste normalisée)                |
| L2  | Select `Nature` : 22 sols/roches ISO 14688-1/14689-1 en 7 groupes (chacun avec couleur + motif)                                                         | Input texte libre                     | ABSENT  | Perte de la nomenclature normalisée ET du lien couleur/motif du dessin                      |
| L3  | Select `État` : consistance (Très molle→Dure) / densité (Très lâche→Très dense) ISO 14688-2                                                             | Input texte libre                     | ABSENT  |                                                                                             |
| L4  | Select `Qual.` 1–5 CONTRAINT par `Prél.` (A→1-5, B→3-5, C→5, NF EN ISO 22475-1 §6.2)                                                                    | Inputs libres, aucune contrainte      | ABSENT  | La règle normative de cohérence n'est plus appliquée                                        |
| L5  | Bouton « Ajouter une couche » (préremplit De = À précédent)                                                                                             | « + Ajouter une couche » (ligne vide) | PRÉSENT | Préremplissage De absent                                                                    |
| L6  | **Log de sondage SVG** (drawBoreholeLog) : colonne lithologique colorée + 7 motifs, bande qualité, axe profondeurs, libellés par couche, nappe dessinée | —                                     | ABSENT  | La FIGURE principale de l'onglet a disparu (le client la dessine en direct à chaque saisie) |
| L7  | Légende sols utilisés + classes de qualité colorées                                                                                                     | —                                     | ABSENT  |                                                                                             |

### 3.d Page Étalonnage

| #   | Élément client                                                                                                                             | Chez nous                                                                    | Statut  | Détail                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| E1  | Barre info contextuelle : 📋 projet · 🔩 sonde+Vs · 📅 date · 🔧 gaine+a · 👤 opérateur                                                    | —                                                                            | ABSENT  | Dépend aussi des champs P4–P6 absents                                                                               |
| E2  | Carte intro « Annexe B & D » : distinction ① calibrage volume / ② étalonnage résistance avec formules                                      | Paragraphe condensé (Vs/Pe, pente d'air ≠ a)                                 | PARTIEL | Le fond y est ; formules Vc/Pc(Vr) et mise en garde structurée absentes                                             |
| E3  | Table saisie : `# / P (bar) / V 15s / V 30s / V 60s / Δ60/30 (coloré) / ✕`                                                                 | Table `P (bar) / V₆₀ (cm³) / ✕`                                              | PARTIEL | **V15 et V30 non saisissables**, Δ60/30 (contrôle « pas de fluage sonde libre ») absent, n° de ligne absent         |
| E4  | Bouton « Ajouter un point » (P préremplie +1, scroll)                                                                                      | « + Ajouter un palier » (vide)                                               | PRÉSENT | Préremplissage absent                                                                                               |
| E5  | Bouton « Calculer et appliquer les paramètres » (calcule + affiche ; l'application reste un bouton séparé)                                 | « Calculer l'étalonnage → » (serveur)                                        | PRÉSENT | Même séquence en 2 temps ; libellé différent                                                                        |
| E6  | KPI kg4 : pente air (≠ a) · Vs ajusté (+ Vs réel) · Pe (à V=1,2×Vs) · R² + **label qualité** (Excellent/Très bon/Acceptable/Mauvais)       | Table Grandeur/Valeur/Unité (Vs, Vs réel, V_pe, Pe, pente d'air ×2, R², RMS) | PARTIEL | Valeurs toutes présentes (rows serveur) mais présentation table ≠ cartes KPI ; **jugement qualitatif du R² absent** |
| E7  | Note 📌 « Pe = pression lue à V = 1,2 × Vs — interpolée sur vos mesures »                                                                  | Explication dans l'intro                                                     | PARTIEL |                                                                                                                     |
| E8  | chartEtal : points + droite ajustée + lignes Pe / 1,2×Vs + **annotations texte** + légende + titre « Droite ajustée V60 = {Vs} + {a} × P » | `EtalonnageChart` SVG : points + ligne ajustée + lignes Pe/vPe               | PARTIEL | Annotations texte, légende, équation-titre et tooltips absents                                                      |
| E9  | Tableau des résidus `#/P/V mesuré/V ajusté/Résidu` coloré (>2 / >0.5)                                                                      | Même table, résidu coloré (>2)                                               | PRÉSENT | Seuil intermédiaire ambre absent                                                                                    |
| E10 | « Erreur quadratique moyenne : … cm³ »                                                                                                     | Row « RMS des résidus »                                                      | PRÉSENT |                                                                                                                     |
| E11 | Bouton « Appliquer Vs et Pe dans les corrections » (+ toast + retour Projet)                                                               | « Appliquer Vs et Pe dans l'appareillage » (+ retour onglet)                 | PRÉSENT | Toast absent                                                                                                        |

### 3.e Page Calibrage

| #   | Élément client                                                                                                                  | Chez nous                                                                                        | Statut  | Détail                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------- |
| C1  | Barre info contextuelle (5 items)                                                                                               | —                                                                                                | ABSENT  |                                                                                                               |
| C2  | Carte intro « Annexe D §4 » + ⚠ « à ne pas confondre avec l'étalonnage »                                                        | Paragraphe condensé                                                                              | PARTIEL |                                                                                                               |
| C3  | Table saisie `#/P/V15/V30/V60/Δ60/30/✕`                                                                                         | Table `P / V₆₀ / ✕`                                                                              | PARTIEL | V15/V30/Δ60-30/n° absents (mêmes manques que E3)                                                              |
| C4  | Bouton « Calculer et visualiser la courbe de calibrage »                                                                        | « Calculer le calibrage → » (serveur)                                                            | PRÉSENT |                                                                                                               |
| C5  | KPI kg3 : c₀ / c₁ / c₂ (notation exponentielle)                                                                                 | Rows c₀/c₁/c₂ dans la table + équation                                                           | PARTIEL | Valeurs présentes, cartes KPI absentes                                                                        |
| C6  | Badge `R² = … — qualité · RMS = … bar` + équation Pc = c0 + c1×V + c2×V²                                                        | Rows R²/RMS + ligne équation (fmtExp)                                                            | PARTIEL | **Label qualité (Excellent/Bon/Vérifier) absent**                                                             |
| C7  | chartCalib : points + **courbe polynomiale deg 2 échantillonnée (60 pas, remplie)** + légende + tooltips                        | `CalibrageChart` : points + polyligne des **V60 ajustés aux points mesurés**                     | PARTIEL | La courbe continue lissée est remplacée par une ligne brisée entre résidus ; ni fill, ni légende, ni tooltips |
| C8  | Tableau des résidus `P/V60 mesuré/V60 ajusté/Résidu` coloré                                                                     | Même table                                                                                       | PRÉSENT |                                                                                                               |
| C9  | Encadré « Application — coefficient a » (a = pente dV/dP en cm³/MPa + formule Vc) + bouton « Appliquer a dans les corrections » | Rows a (cm³/bar + indicatif cm³/MPa) + bouton « Appliquer a dans l'appareillage » (a×10, parité) | PRÉSENT | Encadré explicatif réduit ; toast absent                                                                      |

### 3.f Page Mesures

| #   | Élément client                                                                                                                                                               | Chez nous                                                                               | Statut  | Détail                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| M1  | Selects seuils 🔵 p₀ / 🔴 p_f — options « L{i} P=… bar V60=… » + « — Non défini — »                                                                                          | Selects 🔵/🔴 — options « Palier i — P = … bar » + « Auto (détermination moteur) »      | PRÉSENT | V60 absent du libellé d'option ; « Auto » explicite (équivalent fonctionnel de « Non défini »)                                |
| M2  | **Aperçu seuils temps réel** (seuilPreview) : Pf/PLM corrigés, V1/V2, n paliers, ΔP/ΔV, **E_M ≈ … MPa live**, ratio, **suggestion auto « β=… : L…→L… »**, alerte si p₀ ≥ p_f | —                                                                                       | ABSENT  | Outil de travail central de l'opérateur pour caler les seuils ; la suggestion auto β du moteur n'est pas montrée avant calcul |
| M3  | Grille mesures : `#/P (bar)/V 15s/V 30s/V 60s/Δ60/30 coloré/ΔV\/ΔP (aide)/✕` + **lignes p₀ et p_f surlignées**                                                               | Table `P/V à 15 s/V à 30 s/V à 60 s/Δ60/30/✕`                                           | PARTIEL | Colonne d'aide ΔV/ΔP absente, n° absent, surlignage des lignes-seuils absent, code couleur Δ60/30 absent                      |
| M4  | « Ajouter une ligne » : P préremplie = dernière + 0.05, scroll bas                                                                                                           | « + Ajouter un palier » (ligne vide)                                                    | PARTIEL | Préremplissage du pas de pression absent                                                                                      |
| M5  | Bouton « Calculer — Dépouillement complet » DANS l'onglet (validations locales + toasts + bascule Résultats)                                                                 | Bouton « Dépouiller → » dans le bandeau global (validations serveur, bascule Résultats) | PRÉSENT | Emplacement différent (bandeau vs bas de l'onglet) ; messages d'erreur en carte, pas de toast                                 |

### 3.g Page Résultats

| #   | Élément client                                                                                                                                                                                                 | Chez nous                                                                              | Statut  | Détail                                                                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Garde-fou rouge « ⚠ Résultat non corrigé » : a=0 (calibrage non renseigné) · **a forcé à 0** (a×Pmax > 0.5×V60moy) · Pe vide (étalonnage non appliqué)                                                         | —                                                                                      | ABSENT  | a=0/Pe : reconstructible front (valeurs saisies). **`aForced`/`aUsed` ne sont PAS whitelistés** dans `pressiometre/contract.ts` → la part « a forcé à 0 » est un **écart de contrat à corriger (ADR 0014 : le client AFFICHE cet avertissement)** |
| R2  | Garde-fou rouge « ⚠ E_M = 0 — plage pseudo-élastique invalide » + consigne                                                                                                                                     | Rien (E_M s'affiche à 0)                                                               | ABSENT  |                                                                                                                                                                                                                                                   |
| R3  | Garde-fou ambre §A.2 « Appareillage : résistance propre élevée — p_el > limite (… pour p_LM=…) »                                                                                                               | —                                                                                      | ABSENT  | Reconstructible front : Pe (saisi) et p_L (row exposée) suffisent                                                                                                                                                                                 |
| R4  | KPI ligne 1 : E_M · p_L · P_f · E/P_LM avec **badge coloré Remanié/N.C./Précons.**                                                                                                                             | KPI E_M/p_L/P_f/E-P_LM                                                                 | PARTIEL | Badge de consolidation absent des KPI (la row texte « État de consolidation » existe plus bas)                                                                                                                                                    |
| R5  | KPI ligne 2 : P*\_LM · P*\_f · α Ménard · E_y=E/α                                                                                                                                                              | KPI identiques                                                                         | PRÉSENT |                                                                                                                                                                                                                                                   |
| R6  | **Bandeau catégorie A–E coloré** : grande lettre + nom (« Sol ferme (cat. C) ») + description                                                                                                                  | Rows texte « Catégorie de sol » + « Description de la catégorie » dans la table détail | PARTIEL | L'information y est, la mise en scène signature (bandeau coloré par catégorie) a disparu                                                                                                                                                          |
| R7  | chartPV : mesures V60 + courbe inverse + ligne Vs+2V1 + fluage Δ60/30 (axe droit) + légende + tooltips + **lignes verticales encadrées p₁ / pf (p₂) / pLM** + **flèche E_M entre p₀ et p_f avec « EM=… MPa »** | `PressioCourbeCorrigee` : mêmes 4 séries + lignes p₁/pf/pLM (simples) + légendes texte | PARTIEL | **Flèche E_M absente**, labels non encadrés (« pf » vs « pf (p₂) »), pas de tooltips interactifs, pas de code couleur des axes                                                                                                                    |
| R8  | Carte Extrapolation §D.4.3 : A, B, p_LM à V=Vs+2·V(p₀), p_LM asymptote (réf.), ajustement moyen, ✓ méthode, hint direct/extrapolé                                                                              | Bloc identique (A/B exponentiels, pLM ×2, errV, méthode)                               | PRÉSENT |                                                                                                                                                                                                                                                   |
| R9  | Tables « Paramètres normalisés » Pression (9 lignes dont P\*\_LM répétée) / Volume (4 lignes)                                                                                                                  | Tables Pression (7 lignes) / Volume (4 lignes)                                         | PRÉSENT | Ligne « P\*\_LM » dupliquée et ligne « p_L méthode » sorties de la table (méthode affichée dans le bloc extrapolation) — écart de détail                                                                                                          |
| R10 | Bloc Synthèse : E_M·p_f·p_L (+méthode) ; β·mE·plage auto ; **ratio → consolidation** ; α·E_y ; **rappel corrections a/Ph/Pe/Vs**                                                                               | Ligne « Synthèse : β · mE · Plage auto L→L »                                           | PARTIEL | Réduit à la ligne β/mE/plage ; consolidation et rappel des corrections utilisées absents du bloc                                                                                                                                                  |
| R11 | Tableau des mesures corrigées `#/P brut/P corr./V60 corr./Δ60/30/Phase (badges)`                                                                                                                               | Table identique avec badges de phase                                                   | PRÉSENT |                                                                                                                                                                                                                                                   |
| R12 | Toast « Dépouillement OK — {label} »                                                                                                                                                                           | —                                                                                      | ABSENT  |                                                                                                                                                                                                                                                   |
| R13 | Titre « Dépouillement — {label} · NF EN ISO 22476-4 »                                                                                                                                                          | « Dépouillement — NF EN ISO 22476-4 » (+ label dans le titre de courbe)                | PRÉSENT |                                                                                                                                                                                                                                                   |

### 3.h Page Profil

| #   | Élément client                                                                                                                                                                                           | Chez nous                                                                                     | Statut  | Détail                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| F1  | **Log pressiométrique combiné** (drawPressioLog SVG) : piste lithologie (coupe du Log) + pastilles catégorie A–E + piste barres E_M colorées + piste barres p_L avec repère p_f + axe profondeur + nappe | —                                                                                             | ABSENT  | Figure de synthèse la plus riche de l'outil ; c'est le lien Log ↔ résultats                 |
| F2  | Légende sols + catégories (A très mou → E roche)                                                                                                                                                         | —                                                                                             | ABSENT  |                                                                                             |
| F3  | Table profil : Prof. (m) / E_M / p_L / p_f / E/P / α / Cat. (badge)                                                                                                                                      | Table identique (Catégorie en texte)                                                          | PRÉSENT | Badge coloré → texte                                                                        |
| F4  | Graphique dédié « E_M vs profondeur » (y inversé, rempli)                                                                                                                                                | Fusionné dans `ProfilDepthChart`                                                              | PARTIEL | 1 graphe combiné au lieu de 2 dédiés ; pas de tooltips/légende Chart.js                     |
| F5  | Graphique dédié « P_LM et P_f vs profondeur »                                                                                                                                                            | Fusionné dans `ProfilDepthChart`                                                              | PARTIEL | Idem                                                                                        |
| F6  | Diagramme spectral Baud (2005) : isolignes E/P = 4/8/14/22 + points essais + **tooltips par essai** + **hint explicatif** (α de Ménard-Rousseau)                                                         | `BaudSpectralChart` : isolignes + points                                                      | PARTIEL | Tooltips et note explicative absents ; libellé de l'essai au survol absent                  |
| F7  | **Dépouillement automatique** à l'ouverture de l'onglet (calcDepth local instantané pour toute profondeur non calculée)                                                                                  | Bouton explicite « Calculer le profil → » (1 appel serveur PAR profondeur, consomme du quota) | PARTIEL | Divergence assumée du modèle serveur ; l'utilisateur client n'a JAMAIS à demander le profil |
| F8  | Titre « Profil en profondeur — {sondage} »                                                                                                                                                               | « Profil en profondeur — dépouillement de toutes les profondeurs »                            | PARTIEL | N° de sondage absent (champ P3)                                                             |

### 3.i Page Export

| #   | Élément client                                                              | Chez nous                          | Statut  | Détail                                                                                                                            |
| --- | --------------------------------------------------------------------------- | ---------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| X1  | « CSV — essai courant » (mesures + résultats EM/PLM/Pf/α)                   | —                                  | ABSENT  |                                                                                                                                   |
| X2  | « CSV global — toutes profondeurs » (synthèse + toutes les mesures)         | —                                  | ABSENT  |                                                                                                                                   |
| X3  | « JSON complet » (projet + depths + coupe + étalonnage + calibrage)         | —                                  | ABSENT  |                                                                                                                                   |
| X4  | « Imprimer / PDF » (window.print + CSS @media print dédiée)                 | PV scellé serveur (numéroté, HMAC) | PARTIEL | Le PV couvre le livrable officiel mais PAS l'impression libre de l'écran (coupe, profil, courbes) ; divergence en partie positive |
| X5  | « Charger fichier JSON » (restaure tout l'état + recalcule)                 | —                                  | ABSENT  | Sans X3/X5, aucun échange de dossier entre collègues ni reprise de session                                                        |
| X6  | Carte « À propos » (PressioPro v3.2, périmètre, hors-ligne/auto-sauvegarde) | —                                  | ABSENT  |                                                                                                                                   |

---

## 4. Synthèse chiffrée et classement

### Comptage (88 éléments)

| Statut    | Nombre                         | Part       |
| --------- | ------------------------------ | ---------- |
| PRÉSENT   | 22                             | **25,0 %** |
| PARTIEL   | 33                             | **37,5 %** |
| ABSENT    | 33                             | **37,5 %** |
| MASQUÉ-§8 | 0 (1 sous-champ signalé en R1) | 0 %        |

Par page : Résultats et Mesures sont les mieux portées (cœur « zéro écart » du 14/07) ;
Export (0/6 présent), Log (1/7) et l'identification Projet sont les plus dégradées.

### Écarts MAJEURS (fonctionnalité perdue, visible immédiatement)

1. **Page Export entièrement absente** (X1–X5) : CSV essai/global, JSON export/import,
   Imprimer/PDF. Aucun circuit de sortie ni d'échange de dossier.
2. **Aucune persistance de la saisie** (T3/T5) + pas de reset (T4) : un refresh perd tout
   (le client recharge automatiquement son auto-sauvegarde).
3. **Log de sondage : dessin SVG + nomenclature ISO absents** (L2–L4, L6–L7) : l'onglet
   est réduit à une table de texte libre sans figure ni contrainte normative.
4. **Log pressiométrique combiné du Profil absent** (F1–F2).
5. **Garde-fous opérateur absents** (R1–R3, P21, M2) : résultat non corrigé, E_M=0,
   §A.2 appareillage, vérification de cohérence, aperçu E_M temps réel + suggestion auto β
   au choix des seuils. R1 inclut un **écart de contrat** (`aForced` non whitelisté).
6. **Identification projet amputée** (P2, P4–P7, P10–P11) : chantier, équipe, opérateur,
   date, n° calibrage, passe, Zc — traçabilité du dossier et des PV.
7. **Bouton 🧪 Exemple absent** (T2) : pas de prise en main guidée.

### Écarts MOYENS (présent mais dégradé)

8. **Défauts Ph/Pe différents** (P15/P16 : 0 vs 0.177/1.25) — à saisie minimale, les
   résultats ne coïncident pas avec l'outil client.
9. **Étalonnage/Calibrage : V15/V30 et Δ60/30 non saisissables** (E3/C3) — le contrôle
   « Δ60/30 ≈ 0 » de la procédure normative disparaît.
10. **Calculateur Ph** (P19) et hints nappe/u₀ (P12) absents.
11. **Courbe de calibrage** : ligne brisée entre résidus au lieu de la courbe polynomiale
    continue (C7) ; labels qualité R² absents (E6/C6).
12. **Profil : 2 graphiques fusionnés en 1** (F4/F5) ; profil non automatique (F7).
13. **Résultats : bandeau catégorie A–E, badge consolidation, flèche E_M, synthèse riche
    réduits** (R4, R6, R7, R10).
14. **Toasts absents partout** (T7, E11, C9, M5, R12).

### Écarts FAIBLES (cosmétique / détail)

15. Ordre des onglets et page d'accueil différents (T8) ; libellés d'options de seuils
    sans V60 (M1) ; préremplissages de saisie absents (E4, M4, L5) ; n° de ligne et
    surlignage p₀/p_f absents (M3) ; annotations texte/tooltips/légendes Chart.js
    remplacés par des SVG statiques (E8, R7, F6) ; ligne P\*\_LM dupliquée absente (R9) ;
    sous-titre header statique (T1) ; γ par défaut non affiché (P18).

### Ajouts de notre page (non présents chez le client — à trancher)

- **Courbe « lectures » `PressioCurve`** (P brut en bar, V₃₀, fluage) affichée AVANT le
  panneau dépouillement : le client n'a AUCUNE courbe des lectures brutes (sa seule courbe
  est la P–V corrigée en MPa). Doublon visuel avec `PressioCourbeCorrigee`, axes différents
  (bar vs MPa, V₃₀ vs V₆₀) — source de confusion pour un utilisateur du client.
- **Table « Résultats du dépouillement (détail complet) »** (rows génériques
  Grandeur/Valeur/Unité) : présentation ajoutée qui répète les KPI et les tables
  normalisées — même motif que la table « Diagnostics » flaggée sur GEOPLAQUE.
- **Champ « Profondeur z (m) » séparé du repère** (le client dérive z du libellé saisi au
  prompt, ex. « 16 m ») : adaptation raisonnable mais double saisie non-client.

### Divergences positives (à documenter, pas à « corriger »)

- **Calcul 100 % serveur** (moteurs `pressiometre`, `pressio-etalonnage`,
  `pressio-calibrage`) — conformité DoD §8, aucune régression front.
- **PV scellé numéroté** (identité + horodatage + intégrité) au lieu d'une impression.
- **Multi-projets serveur** avec entitlements/quota (ProjectPicker).

---

## 5. Les 5 écarts les plus visibles pour un utilisateur de l'outil client

1. **« Où est l'Export ? »** — la 8e page a disparu : plus de CSV, plus de JSON
   (export ET import), plus d'Imprimer/PDF. C'est le canal par lequel le géotechnicien
   sort ses dépouillements vers son rapport.
2. **« Mon log de sondage ne se dessine plus »** — la coupe SVG colorée (lithologies,
   motifs, nappe, classes de qualité) et les listes de sols ISO sont remplacées par une
   table de champs texte nue ; et au Profil, le log pressiométrique combiné
   (coupe + E_M + p_L + catégories) n'existe plus.
3. **« J'ai tout perdu en rechargeant la page »** — pas d'auto-sauvegarde, pas de bouton
   Sauvegarder, pas d'Exemple pour démarrer, pas de Réinitialiser.
4. **« L'outil ne me prévient plus »** — plus d'aperçu E_M temps réel ni de suggestion
   automatique (β) au choix des seuils p₀/p_f, plus d'alertes « Résultat non corrigé »,
   « E_M = 0 », cohérence des paramètres (a/Vs/Pe/Ph), appareillage §A.2 ; aucune
   confirmation (toasts).
5. **« Ce ne sont pas les mêmes valeurs par défaut »** — Ph=0 et Pe=0 chez nous contre
   0.177/1.25 chez le client : à saisie identique minimale, les pressions corrigées et
   tout le dépouillement diffèrent de l'outil d'origine.
