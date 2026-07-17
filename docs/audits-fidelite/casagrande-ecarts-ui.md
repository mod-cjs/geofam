# CASAGRANDE — rapport d'écarts de fidélité d'interface (client ↔ plateforme)

> **Auteur** : auditeur fidélité d'interface (mission « zéro écart »).
> **Objet** : preuve documentée des écarts d'**interface**, de **fonctionnement** et
> d'**affichage** entre l'outil CASAGRANDE fourni par le client (`casagrande_V5.html`)
> et notre portage web (logiciel CASAGRANDE de GEOFAM), exigence client ferme :
> **ZÉRO écart**. **Ce rapport ne corrige rien** — il sert de baseline « avant » et de
> checklist de recette pour le lot de correction.

## Références comparées

| Côté                         | Cible                                                                                                                                                   | Mode d'accès                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Client** (référence, gelé) | `03-Moteurs-client/GeoSuite/source/tools/casagrande_V5.html` (1 833 lignes)                                                                             | Lecture exhaustive du source, LECTURE seule |
| **Nous — code local**        | `apps/web/src/app/app/[orgSlug]/logiciels/casagrande/page.tsx` (656 lignes) + `apps/web/src/lib/api/adapters.ts` (`buildPieuxRows`/`buildPieuxDetails`) | Lecture du source                           |
| **Contrat serveur**          | `packages/engines/src/pieux/contract.ts` (`PieuxOutputSchema`, whitelist stricte)                                                                       | Lecture du source                           |

> **Portée honnête** : audit STATIQUE (lecture de code des deux côtés), pas de
> captures Playwright appariées comme pour GEOPLAQUE. L'équivalence NUMÉRIQUE du
> moteur est couverte ailleurs (`engine.equivalence.test.ts`, golden-master) ; le
> présent rapport porte sur la **fidélité d'INTERFACE et d'AFFICHAGE**.
> Inventaire client machine-lisible : `casagrande-inventaire-client.json`.

> **Doctrine applicable (ADR 0014, « zéro écart », révisée 13/07)** : tout ce que
> l'outil client **affiche** est exposable — le confidentiel est le **code** moteur,
> pas les valeurs. Un masquage §8 d'une valeur affichée par le client est **lui-même
> un écart à corriger** (statut `MASQUÉ-§8` ci-dessous = écart, pas une excuse).
> Seule exception actée à ce jour : les localisations de nœuds EF du **radier**
> (sans objet ici). NB : les mémoires `roadsen-engine-output-whitelist-ple-qce`
> (défaut NON pour ple\*/qce) et `roadsen-details-transparents-rescope-s8` (« zéro
> écart ») sont en **tension** sur ce moteur — l'élargissement de la whitelist pieux
> est une décision expert + titulaire à acter, mais chaque valeur affichée par le
> client et masquée chez nous est comptée ÉCART dans ce rapport.

---

## Synthèse : verdict global

**L'écart est MAJEUR, surtout sur la restitution des résultats.** Contrairement à
GEOPLAQUE (paradigme CAO ≠ formulaire), CASAGRANDE client est déjà un outil à
**formulaires + onglets** : notre structure d'onglets est **fidèle à 80 %**
(5 onglets, même ordre, mêmes regroupements de saisie pour l'essentiel). Le cœur de
l'écart est ailleurs :

1. **Les 5 figures SVG du client sont toutes absentes** (coupe géotechnique live,
   log q_c(z), courbe charge—tassement, courbe de portance en profondeur, profils
   t-z du frottement négatif). L'outil client est fortement graphique ; le nôtre est
   100 % tabulaire.
2. **Le panneau Résultats est réduit à une table à plat** : pas de cartes KPI, pas de
   table Résistances Rm/Rk/Rd, pas de frottement latéral par couche, synthèse
   géométrique amputée, sous-détails (p_le\*, D_ef/B, k_p, ξ, γ_R;d1) masqués alors
   que le client les affiche — et **les avertissements normatifs (⚠) ne sont pas
   affichés du tout** alors que le contrat serveur les expose.
3. **L'onglet Coefficients a quasiment disparu** (6 tables + 12 champs éditables chez
   le client → 1 bloc de texte en lecture seule chez nous). La non-éditabilité est
   une décision de sécurité ACTÉE (coeffs autoritatifs serveur, audit adverse) mais
   l'affichage des tables normatives, lui, n'a aucune raison d'être omis.

## Inventaire structurel — outil client (résumé ; détail exhaustif dans le JSON)

- **Navigation** : 5 onglets numérotés — `01 Projet & pieu` · `02 Frottement négatif`
  · `03 Profil de sol` · `04 Coefficients` · `05 Résultats & vérifs` — + 2 actions
  épinglées : `Remplir la fiche fictivement`, `Calculer la portance →`.
- **Onglet 01** (9 cartes) : Identification (nom projet, sondage/pieu) · Géométrie
  (section segmentée circ/carré/rect/quelconque, B, b, A_p, P, z₀, D) · Type de pieu
  (select 20 catégories « n°. AB — nom » + info dynamique classe/refoulement/micro) ·
  Béton (f_ck, armé/non armé, contrôles courants/renforcés) · Charges (comp/trac, G,
  Q, essais de chargement) · Groupe (n, m, S) · Méthode (PMT/CPT/c-φ + info) ·
  Approche (DA1/2/3 + info) · Nappe & modèle (nappe, N profils, S investigation,
  redistribution, hints ξ dynamiques).
- **Onglet 02** : zone F.N. (auto s₀/H_c ou imposée z_t/z_b) · interaction sol-pieu
  (Q, K·tanδ) · action « Reprendre Q et la coupe du projet » · **résultats live** :
  4 KPI (N_max, G_sn, point neutre, tassement tête) + SVG 3 panneaux
  (tassements/frottement/effort axial vs z) + notice.
- **Onglet 03** : table de couches (# / nature à pastille / épaisseur / pl\* / E_M /
  q_c / c' / φ' / γ, **colonnes masquées selon la méthode**, démarrage à vide, pill
  profondeur totale) · pénétrogramme CPT (générer depuis les couches, + point,
  collage/import, table éditable) · **coupe géotechnique SVG live** (strates
  hachurées, nappe, pieu à l'échelle, zone q_b) · **log q_c(z) SVG** (courbe, zone
  d'influence, écrêtage 1,3·moy, q_ce).
- **Onglet 04** : facteurs partiels éditables (γ_b γ_s γ_t γ_s;t · γ_G γ_Q ψ₀ ψ₂) ·
  fluage éditable (8 coefficients) · ξ dynamique · **table des facteurs appliqués au
  pieu sélectionné** (k_p,max, k_c,max, courbes Q, α_PMT, α_CPT, q_s,max par nature)
  · tables EC7 Annexe A (A.3/A.4/A.6-A.8).
- **Onglet 05** : avertissements ⚠ · verdict + taux gouvernant + méthode/approche ·
  4 KPI (R_b avec sous-détail p_le*/D_ef/k_p, R_s, R_c;d, tassement) · table
  Résistances (Brut/Caract./Calcul × pointe/frottement/total/fluage + hint ξ/γ_R;d1)
  · table Vérifications (combinaison + F_d/R_d/taux/✓) · frottement latéral par
  couche · **courbe charge—tassement SVG** · synthèse géométrique (10 lignes) ·
  vérification béton (verdict, σ vs limites, formules f_ck*/f_cd) · **courbe de
  portance en profondeur SVG** (4 combinaisons + repères de charge) · « ⎙ Imprimer
  la note » (CSS print dédié).
- Comptage : ~49 inputs, 9 segmentés, 3 selects, 13 tables, 5 figures SVG, 8 KPI.

## Inventaire structurel — notre page React

- **Bandeau** : titre CASAGRANDE + sous-titre norme · sélecteur de projet (domaine
  FD, persistance serveur) · bouton `Calculer →` (gating abonnement/quota).
- **Onglets (5, même ordre)** : `Pieu & méthode` · `Frottement négatif` ·
  `Profil de sol` · `Options` · `Résultats`.
- **Pieu & méthode** : catégorie (select 20, sans abréviations AB) · section (select)
  · B / b / A_p+P (garde > 0) · Fiche D · Cote de départ z₀ · méthode (select) ·
  approche DA (select, combinaisons dans le libellé) · sens · G · Q · « Essais
  renforcés » (oui/non).
- **Frottement négatif** : **opt-in par case à cocher** (fnOn) · mode auto/imposé
  (select) · s₀/H_c ou z_t/z_b · Q, K·tanδ · notes statiques. Pas de résultats dans
  l'onglet (résultats FN = lignes de la table Résultats).
- **Profil de sol** : nappe (déplacée ici) · table de couches (Sol/H/pl\*/EM/qc/c/φ/γ,
  **toutes colonnes toujours visibles**, 2 lignes par défaut, min 1) · + Ajouter une
  couche · carte pénétrogramme (méthode CPT) : pas, textarea de collage, **aperçu
  live en lecture seule** (`CptPreview`, détection virgule décimale).
- **Options** : effet de groupe (n/m/S) · N profils / S / redistribution · béton
  **opt-in** (f_ck, armé, k₃) · bloc informatif coefficients EC7 (lecture seule,
  « fixés côté serveur », rejet 400 de toute valeur non normative).
- **Résultats** : bandeau verdict PASS/FAIL · alerte `fn-missing` (downdrag demandé
  non calculé) · table à plat Grandeur/Valeur/Unité/Statut (taux gouvernant, R_b;k,
  R_s;k, R_c;k, R_c;d|R_t;d, R_c;cr;k, tassement ELS, F_d/R_d par vérification,
  G_sn/N_max/z_N + note, taux béton ELU/ELS + f_cd) · détails (catégorie, méthode, B,
  D) · **PV scellé** (remplace l'impression).
- **Ajouts sans équivalent client** (divergences positives ou filets) : gating
  d'abonnement, invalidation du résultat à toute modification de saisie, garde
  section quelconque, aperçu anti-corruption CPT, alerte downdrag silencieux, PV
  scellé numéroté.
- **Aucune figure** (0 SVG).

---

## MATRICE DE COMPLÉTUDE (une ligne par élément client)

Statuts : **PRÉSENT** · **PARTIEL** · **ABSENT** · **MASQUÉ-§8** (champ non
whitelisté par `PieuxOutputSchema` — par doctrine ADR 0014, **écart à corriger**
puisque le client l'affiche).

### Navigation & en-tête

| #   | Élément client                               | Chez nous                              | Statut  | Détail                                                                                             |
| --- | -------------------------------------------- | -------------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| 1   | Onglet `01 Projet & pieu`                    | `Pieu & méthode`                       | PARTIEL | Libellé ≠ ; identification projet remplacée par le sélecteur serveur ; béton/groupe/nappe déplacés |
| 2   | Onglet `02 Frottement négatif`               | `Frottement négatif` (position 2 idem) | PARTIEL | Saisie fidèle mais opt-in + résultats déportés dans Résultats                                      |
| 3   | Onglet `03 Profil de sol`                    | `Profil de sol`                        | PARTIEL | Table présente ; coupe + log q_c absents                                                           |
| 4   | Onglet `04 Coefficients`                     | `Options` (bloc info)                  | PARTIEL | 6 tables + 12 champs éditables → 1 ligne de texte lecture seule                                    |
| 5   | Onglet `05 Résultats & vérifs`               | `Résultats`                            | PARTIEL | Contenu fortement réduit (cf. section Résultats)                                                   |
| 6   | Action `Remplir la fiche fictivement`        | —                                      | ABSENT  | Aucun exemple pré-chargé                                                                           |
| 7   | Action `Calculer la portance →`              | `Calculer →` (bandeau)                 | PRÉSENT | Même geste (calcul + bascule Résultats) ; libellé raccourci                                        |
| 8   | Marque CASAGRANDE + « Fondations Profondes » | Titre + sous-titre                     | PRÉSENT | —                                                                                                  |
| 9   | Référentiel NF P 94-262 / EC7 / 3 méthodes   | Sous-titre                             | PRÉSENT | —                                                                                                  |

### Onglet 01 — Projet & pieu

| #   | Élément client                                                   | Chez nous                                | Statut  | Détail                                                                                                                                            |
| --- | ---------------------------------------------------------------- | ---------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10  | Nom du projet (texte libre)                                      | ProjectPicker (projet serveur)           | PARTIEL | Persistance serveur = divergence assumée SaaS ; texte libre perdu                                                                                 |
| 11  | Sondage / pieu (`p_pieu`)                                        | —                                        | ABSENT  | Le payload envoie `pieu:` = nom du **projet** ; pas de champ dédié                                                                                |
| 12  | Section segmentée (Circulaire/Carrée/Rectangulaire/Quelconque)   | select 4 options                         | PRÉSENT | Segmenté→select (présentation)                                                                                                                    |
| 13  | Diamètre B (m), libellé dynamique « Côté / largeur B »           | idem, libellé conditionnel               | PRÉSENT | Défaut '0.6' = placeholder client                                                                                                                 |
| 14  | Largeur b (m) (rect)                                             | idem                                     | PRÉSENT | —                                                                                                                                                 |
| 15  | A_p (m²) + P (m) (quelconque)                                    | idem + garde > 0                         | PRÉSENT | Garde front en PLUS (filet anti-portance nulle)                                                                                                   |
| 16  | Profondeur tête z₀ (m)                                           | « Cote de départ z₀ (m) »                | PARTIEL | Libellé ≠                                                                                                                                         |
| 17  | Profondeur base D (m)                                            | « Fiche D (m) », défaut 12               | PARTIEL | Libellé ≠ ; défaut 12 vs placeholder client 15.0                                                                                                  |
| 18  | Hint « la base doit être dans une couche du profil »             | —                                        | ABSENT  | —                                                                                                                                                 |
| 19  | Type de pieu : select 20 cat. « 1. FS — Foré simple… »           | select 20 « 1 · Foré simple… »           | PARTIEL | **Abréviations normalisées (FS, FB, FTP…) omises**                                                                                                |
| 20  | `pieu-info` dynamique (classe, refoulement→fluage, micropieu)    | —                                        | ABSENT  | Classe/refoulement invisibles avant calcul                                                                                                        |
| 21  | Béton : f_ck (MPa)                                               | Options → opt-in béton                   | PARTIEL | Présent mais **opt-in** (client calcule toujours) + déplacé d'onglet                                                                              |
| 22  | Béton : segmenté Armé / Non armé                                 | select Armé/Non armé                     | PRÉSENT | —                                                                                                                                                 |
| 23  | Béton : « Contrôles d'intégrité » Courants/Renforcés             | select « k₃ » 1,0/1,2                    | PARTIEL | Libellé métier remplacé par le symbole technique                                                                                                  |
| 24  | Béton : hint (C_max/k₁ déduits, sans objet acier/traction)       | —                                        | ABSENT  | —                                                                                                                                                 |
| 25  | Sollicitation Compression/Traction                               | select                                   | PRÉSENT | —                                                                                                                                                 |
| 26  | G permanent (kN)                                                 | idem                                     | PRÉSENT | —                                                                                                                                                 |
| 27  | Q variable (kN)                                                  | idem                                     | PRÉSENT | —                                                                                                                                                 |
| 28  | « Essais de chargement (traction ELS-QP) » Non réalisés/Réalisés | « Essais renforcés » Non/Oui             | PARTIEL | **Libellé sémantiquement faux** (essais de chargement ≠ essais renforcés) ; hint plafond 0,15·R_s absent                                          |
| 29  | Groupe de pieux n / m / S + hint                                 | Options → Effet de groupe                | PRÉSENT | Déplacé d'onglet ; hint réduit à « 0 = isolé »                                                                                                    |
| 30  | Méthode segmentée + `meth-info` dynamique                        | select (pl\*/qc/c,φ)                     | PARTIEL | Sélecteur OK ; info dynamique absente                                                                                                             |
| 31  | Approche DA segmentée + `da-info` dynamique                      | select avec combinaisons dans le libellé | PARTIEL | Info condensée dans l'option ; détail pédagogique perdu                                                                                           |
| 32  | Profondeur de la nappe (m)                                       | Onglet Sol                               | PARTIEL | Déplacée ; **champ vide : client → 0 m (nappe en surface), nous → 500 m (pas de nappe)** — divergence de comportement à saisie vide (méthode c-φ) |
| 33  | N profils + hint ξ₃/ξ₄ **dynamique**                             | Options                                  | PARTIEL | Champ présent ; ξ résultants jamais affichés (cf. #67/#78)                                                                                        |
| 34  | Surface d'investigation S (m²) + hint E.2.1                      | Options + hint statique                  | PRÉSENT | —                                                                                                                                                 |
| 35  | Redistribution « Non / Structure rigide (÷1,1) »                 | « Non / Oui »                            | PARTIEL | Libellé appauvri                                                                                                                                  |

### Onglet 02 — Frottement négatif

| #   | Élément client                                                                                                                             | Chez nous                                                | Statut    | Détail                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 36  | Mode segmenté Automatique / Hauteur imposée                                                                                                | select                                                   | PRÉSENT   | —                                                                                                                                                                |
| 37  | Tassement en surface s₀ (mm)                                                                                                               | idem                                                     | PRÉSENT   | —                                                                                                                                                                |
| 38  | Profondeur compressible H_c (m)                                                                                                            | idem                                                     | PRÉSENT   | —                                                                                                                                                                |
| 39  | Zone imposée : « de (m) » / « … jusqu'à (m) »                                                                                              | idem                                                     | PRÉSENT   | —                                                                                                                                                                |
| 40  | Charge structurelle en tête Q (kN)                                                                                                         | idem                                                     | PRÉSENT   | —                                                                                                                                                                |
| 41  | Terme K·tanδ                                                                                                                               | idem                                                     | PRÉSENT   | —                                                                                                                                                                |
| 42  | Bouton « Reprendre Q et la coupe du projet » (préremplissage Q=G, K·tanδ selon refoulement, s₀=90, H_c=9)                                  | —                                                        | ABSENT    | L'utilisateur ressaisit tout à la main                                                                                                                           |
| 43  | Calcul FN **live** à l'ouverture de l'onglet (toujours actif)                                                                              | Case à cocher opt-in + calcul global serveur             | PARTIEL   | Workflow inversé : chez le client le FN est un panneau de résultats immédiat                                                                                     |
| 44  | 4 KPI : Effort axial max · G_sn · Point neutre · **Tassement tête pieu**                                                                   | 3 lignes de table (G_sn, N_max, z_N)                     | PARTIEL   | KPI→lignes ; **tassement tête pieu (wHead) non exposé** (MASQUÉ-§8, le client l'affiche)                                                                         |
| 45  | Figure « Profils en profondeur » — 3 panneaux SVG (tassement sol/pieu, frottement axial ±limites + point neutre, effort axial N) + légende | —                                                        | MASQUÉ-§8 | Profils w(z)/f(z)/N(z) non whitelistés par `PieuxOutputSchema` ; le client les AFFICHE → écart à corriger (élargir la sortie ou produire une courbe client-safe) |
| 46  | Notice d'interprétation (G_sn action permanente à ajouter, point neutre, validation œdométrique)                                           | Note statique différente (« reporté à titre indicatif ») | PARTIEL   | Fond proche, texte ≠                                                                                                                                             |

### Onglet 03 — Profil de sol

| #   | Élément client                                                                                            | Chez nous                                        | Statut  | Détail                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| 47  | Bouton + Ajouter une couche                                                                               | idem                                             | PRÉSENT | —                                                                                                                           |
| 48  | Bouton Remplir la fiche fictivement (rappel dans l'onglet)                                                | —                                                | ABSENT  | cf. #6                                                                                                                      |
| 49  | Pill « Profondeur totale : X m » (live)                                                                   | —                                                | ABSENT  | —                                                                                                                           |
| 50  | Colonne # (index) + pastille couleur de nature                                                            | —                                                | ABSENT  | Table sans index ni code couleur                                                                                            |
| 51  | Nature : select 5 natures (Argile/Limon, Sable/Grave, Craie, Marne/M-calc., Roche altérée)                | select 5 (libellés proches)                      | PRÉSENT | « Marne » vs « Marne / M-calc. », « Roche » vs « Roche altérée » (libellés courts)                                          |
| 52  | **Colonnes masquées selon la méthode** (pl\*/E_M ↔ q_c ↔ c'/φ')                                           | Toutes les colonnes toujours visibles            | PARTIEL | L'utilisateur voit des colonnes sans objet ; hint « colonnes inutiles masquées » sans équivalent                            |
| 53  | γ (kN/m³)                                                                                                 | idem (en-tête « γ » sans unité)                  | PRÉSENT | Unité d'en-tête omise                                                                                                       |
| 54  | Suppression de ligne (jusqu'à 0 couche ; démarrage à vide)                                                | ✕ (min 1 ligne ; 2 lignes par défaut)            | PARTIEL | État initial ≠ (2 couches pré-créées) et plancher 1                                                                         |
| 55  | Pénétrogramme : « ↻ Générer depuis les couches »                                                          | — (le moteur régénère si collage vide)           | ABSENT  | Comportement serveur équivalent mais **invisible** : pas de bouton ni de points affichés                                    |
| 56  | Pénétrogramme : « + Point » + édition/suppression point à point                                           | —                                                | ABSENT  | Saisie uniquement par collage                                                                                               |
| 57  | Pas (m) du pénétrogramme                                                                                  | idem                                             | PRÉSENT | —                                                                                                                           |
| 58  | Collage « z qc » + « Importer le collage »                                                                | textarea + parsing live fidèle (`parseCptPaste`) | PRÉSENT | Import implicite (live) + aperçu anti-virgule en PLUS                                                                       |
| 59  | Table des points z/q_c (éditable)                                                                         | `CptPreview` (lecture seule)                     | PARTIEL | Visualisation OK, édition impossible                                                                                        |
| 60  | **Figure Coupe géotechnique live** (strates hachurées, cotes, nappe, pieu à l'échelle, zone q_b, légende) | —                                                | ABSENT  | Constructible côté front depuis la SAISIE seule (aucun besoin du moteur) — écart pur front                                  |
| 61  | **Figure Log q_c(z)** (courbe, zone d'influence, plafond 1,3·moy, ligne q_ce, ligne D)                    | —                                                | ABSENT  | Courbe traçable depuis la saisie ; les surcouches q_ce/écrêtage sont MASQUÉ-§8 (`qce` non whitelisté — le client l'affiche) |

### Onglet 04 — Coefficients

| #   | Élément client                                                                                                                        | Chez nous                                                | Statut    | Détail                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 62  | Notice « Coefficients NF P 94-262 » (traçabilité des tables)                                                                          | —                                                        | ABSENT    | —                                                                                                                                                                                                               |
| 63  | Facteurs partiels résistances **éditables** (γ_b 1,10 · γ_s 1,10 · γ_t 1,10 · γ_s;t 1,15)                                             | Lecture seule γ_b/γ_s/γ_s;t (γ_t non affiché)            | PARTIEL   | Non-éditabilité = décision sécurité ACTÉE (coeffs autoritatifs serveur, rejet 400 — audit adverse) : à documenter comme divergence assumée, pas à « corriger » ; γ_t manquant à l'affichage                     |
| 64  | Note γ_R;d1 automatique (1,15 / 1,40 craie / 2,0 injection)                                                                           | —                                                        | MASQUÉ-§8 | `grd` non whitelisté ; le client affiche la règle ET la valeur retenue (hint Résultats)                                                                                                                         |
| 65  | Pondération actions γ_G 1,35 · γ_Q 1,50 · ψ₀ 0,7 · ψ₂ 0,3 (éditables)                                                                 | γ_G/γ_Q affichés lecture seule                           | PARTIEL   | ψ₀ et ψ₂ non affichés (ψ₂ existe dans `DEFAULT_COEFFS` mais pas dans le bloc info)                                                                                                                              |
| 66  | Charge de fluage : 8 coefficients éditables (0,70/0,70 · 0,50/0,70 · γ_cr 0,90/1,10 · traction 1,10/1,50)                             | 1 seule valeur affichée (« ξ fluage compression = 0.9 ») | PARTIEL   | 7 coefficients sur 8 invisibles                                                                                                                                                                                 |
| 67  | Info ξ **dynamique** « N = 1 profil → ξ₃ = 1.40 · ξ₄ = 1.40 » (recalcul live avec S, redistribution)                                  | —                                                        | MASQUÉ-§8 | `xi3`/`xi4` non whitelistés ; le client les affiche (ici ET dans Résultats)                                                                                                                                     |
| 68  | **Table des facteurs appliqués au pieu sélectionné** : k_p,max · k_c,max · courbes Q · α_PMT · α_CPT · q_s,max par nature (dynamique) | —                                                        | MASQUÉ-§8 | Tables normatives PUBLIÉES (F.4.2.1/G.4.2.1/F.5.2/G.5.2) affichées par le client ; notre contrat les traite en confidentiel → conflit ADR 0014 à trancher (expert + titulaire, cf. mémoire whitelist ple\*/qce) |
| 69  | Tables EC7 Annexe A (A.3 actions, A.4 sols, A.6/A.7/A.8 résistances R1–R4) + note DA                                                  | —                                                        | ABSENT    | Contenu STATIQUE publiable sans aucune fuite (texte de norme) — écart pur front                                                                                                                                 |

### Onglet 05 — Résultats & vérifs

| #   | Élément client                                                                                                                                                                       | Chez nous                                                                       | Statut    | Détail                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 70  | **Notice avertissements ⚠** (ancrage h < 3·B, D hors profil, couches non couvertes α, micropieu, q_s/2 > 25 m, effet de groupe C_e / J.2(3), plafond traction 0,15·R_s)              | —                                                                               | ABSENT    | **Le contrat expose `warnings` (redactés, test anti-fuite #45/#48) mais le front ne les rend nulle part** — perte d'information de sécurité normative ; écart pur front                                                        |
| 71  | Bandeau erreur « Calcul impossible » + message précis (« Aucune couche de sol définie… », « D doit être supérieure à z₀ »)                                                           | « Erreur moteur — calcul non abouti. » générique                                | PARTIEL   | `erreur` (borné, whitelisté) non affiché ; l'utilisateur ne sait pas quoi corriger                                                                                                                                             |
| 72  | Verdict ✓/✗ + « Taux le plus défavorable X % · pieu méthode en sens · approche DA »                                                                                                  | Bandeau PASS/FAIL sans taux ni contexte ; taux gouvernant en 1ʳᵉ ligne de table | PARTIEL   | Fond présent, présentation appauvrie                                                                                                                                                                                           |
| 73  | KPI « R_b — pointe » (MN) + sous-détail « p_le\* = X MPa · D_ef/B = X · k_p = X (k_p,max = X) »                                                                                      | Ligne « Résistance de pointe R_b;k (kN) »                                       | PARTIEL   | R_b **brut** absent (seul R_b;k sort) ; sous-détail p_le\*/q_ce/D_ef/k_p = MASQUÉ-§8 (`qbDetail`, `ple`, `qce`, `kfac`, `kmax`, `Def`, `debR` non whitelistés — le client les affiche)                                         |
| 74  | KPI « R_s — frottement » (MN, « sur X m de fût »)                                                                                                                                    | Ligne « R_s;k (kN) »                                                            | PARTIEL   | R_s brut absent ; longueur de fût mobilisée absente                                                                                                                                                                            |
| 75  | KPI « R_c;d — calcul ELU »                                                                                                                                                           | Ligne R_c;d / R_t;d (libellé conditionnel)                                      | PRÉSENT   | —                                                                                                                                                                                                                              |
| 76  | KPI « Tassement (ELS car.) » (mm, Frank & Zhao)                                                                                                                                      | Ligne « Tassement estimé (ELS) (mm) »                                           | PRÉSENT   | Mention de méthode omise                                                                                                                                                                                                       |
| 77  | Table Résistances : colonnes **Brut R_m / Caract. R_k / Calcul R_d** × Pointe/Frottement/Total/Fluage                                                                                | R_b;k, R_s;k, R_c;k, R_c;d, R_c;cr;k en lignes                                  | PARTIEL   | Colonne **Brut** (R_b, R_s, R_c) et **R_d par terme** (R_b;d, R_s;d) = MASQUÉ-§8 (non whitelistés ; le client les affiche)                                                                                                     |
| 78  | Hint « ξ₃ = X · ξ₄ = X (N, S, √(S/2500), ÷1,1) · γ_R;d1 = X »                                                                                                                        | —                                                                               | MASQUÉ-§8 | Mêmes champs que #67 ; affichés par le client sous la table Résistances                                                                                                                                                        |
| 79  | Table Vérifications : état-limite + **sous-libellé de combinaison** (« 1,35·G + 1,50·Q · R2 (NA) ») × F_d / R_d / **Taux %** / ✓✗                                                    | 2 lignes par vérification (F_d avec statut, R_d)                                | PARTIEL   | Le **taux par vérification** n'est pas affiché ALORS QUE le contrat l'expose (`verifications[].taux`) — écart pur front ; sous-libellé `comb` non whitelisté (client l'affiche)                                                |
| 80  | **Table Frottement latéral par couche** (nature + pastille / cote / ép. mobilisée / q_s kPa / R_s,i kN / total)                                                                      | —                                                                               | MASQUÉ-§8 | `fric[]` non whitelisté (révèle courbes α/q_s,max par couche) ; le client AFFICHE cette table → conflit ADR 0014 à trancher explicitement                                                                                      |
| 81  | **Figure Courbe charge—tassement** (Frank & Zhao, point ELS marqué, hint E*M/k*τ)                                                                                                    | —                                                                               | MASQUÉ-§8 | `settle.pts` (courbe de mobilisation) non whitelisté ; seul `tassementELS` sort ; le client affiche la courbe complète                                                                                                         |
| 82  | Table Synthèse géométrique (10 lignes : cat→classe, A_b + périmètre, D, D_ef + D_ef/B, couche porteuse, zone d'influence, a·b, γ_R;d1, C_e + motif, formule fluage)                  | Détails : catégorie, méthode, B, D                                              | PARTIEL   | A_b/périmètre calculables depuis la saisie (écart front) ; D_ef, γ_R;d1, C_e, zone d'influence, couche porteuse = MASQUÉ-§8 (le client les affiche)                                                                            |
| 83  | Bouton « ⎙ Imprimer la note » (window.print, CSS print imprimant TOUS les onglets)                                                                                                   | « Émettre le PV scellé » (+ actions post-émission)                              | PARTIEL   | Divergence POSITIVE actée (PV serveur scellé > impression navigateur) — à documenter, pas à corriger ; mais aucune vue imprimable de la saisie complète                                                                        |
| 84  | Carte Résistance du béton : verdict ✓/✗ + table **σ_ELU / σ_ELS (MPa) vs limites f_cd / 0,3·k₃·f_ck\*** + taux + note formules (C_max, k₁, k₂, f_ck\*, α_cc, γ_c)                    | Lignes taux béton ELU %, taux béton ELS %, f_cd (MPa)                           | PARTIEL   | Taux + f_cd exposés ; **σ appliquées et limite ELS absentes** (σ = F_d/A_b, calculable ; limite ELS non whitelistée) ; formules k₁/k₂/C_max/f_ck\* = MASQUÉ-§8 assumé par le contrat MAIS affichées par le client → à trancher |
| 85  | Message explicatif « non applicable » (traction / catégorie non couverte, avec la raison)                                                                                            | Ligne « Vérification béton : Non applicable »                                   | PARTIEL   | Raison (`reason`) non exposée/affichée                                                                                                                                                                                         |
| 86  | **Figure Courbe de portance avec la profondeur** (4 combinaisons ELU/ELS vs D, bande de coupe stratigraphique, repères 1,35G+1,5Q et G+Q, ligne D courante, légende, note μ = β/γ_R) | —                                                                               | MASQUÉ-§8 | Aucune sortie de courbe au contrat (elle exigerait `portanceCore` sur ~110 profondeurs) ; le client l'affiche — c'est l'aide au choix de l'ancrage, cœur de l'usage métier                                                     |
| 87  | Footer (« CASAGRANDE v1 … outil d'aide au prédimensionnement… validés par un ingénieur géotechnicien »)                                                                              | —                                                                               | ABSENT    | Disclaimer professionnel perdu                                                                                                                                                                                                 |

### Workflows

| #   | Workflow client                                                                                   | Chez nous                                                          | Statut  | Détail                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 88  | Saisie → Calculer → Résultats complets (tables + 2 figures + béton + portance) → Imprimer la note | Saisie → Calculer (serveur) → table à plat → PV scellé             | PARTIEL | Squelette identique ; restitution amputée (cf. #70–86)                                                                             |
| 89  | Exemple complet en 1 clic (fillFictitious)                                                        | —                                                                  | ABSENT  | Démo/onboarding impossible à l'identique                                                                                           |
| 90  | CPT bout-en-bout : générer/coller/éditer les points + log visuel avec q_ce                        | Collage + aperçu lecture seule, pas de log                         | PARTIEL | cf. #55/#56/#59/#61                                                                                                                |
| 91  | FN live à l'ouverture + préremplissage 1 clic + 3 profils                                         | Opt-in + saisie manuelle + 3 lignes de table                       | PARTIEL | cf. #42–45                                                                                                                         |
| 92  | Recalcul local immédiat, hints/figures live à chaque saisie                                       | Calcul serveur à la demande + invalidation du résultat à la saisie | PARTIEL | Modèle SaaS (recalcul serveur = DoD §8) — divergence structurelle assumée ; le feedback visuel live (coupe) reste réalisable front |

---

## Synthèse chiffrée

**92 éléments client inventoriés** :

| Statut                        | Nombre | Part     |
| ----------------------------- | ------ | -------- |
| PRÉSENT                       | 28     | **30 %** |
| PARTIEL                       | 38     | **41 %** |
| ABSENT                        | 18     | **20 %** |
| MASQUÉ-§8 (= écart, ADR 0014) | 8      | **9 %**  |

Soit **70 % des éléments de l'outil client en écart** (partiel, absent ou masqué).
Les 8 MASQUÉ-§8 (#45, 64, 67, 68, 78, 80, 81, 86 — plus les composantes masquées de
#44, 61, 73, 77, 82, 84) correspondent tous à des valeurs **affichées par l'outil
client** : par doctrine ADR 0014 ce sont des écarts à corriger via élargissement
gouverné de `PieuxOutputSchema` (décision expert + titulaire, cf. mémoire
`roadsen-engine-output-whitelist-ple-qce`).

## Classement des écarts

### MAJEURS (visibles immédiatement par tout utilisateur du client)

1. **Les 5 figures SVG absentes** : coupe géotechnique live (#60), log q_c(z) (#61),
   courbe charge—tassement (#81), courbe de portance en profondeur (#86), profils
   t-z du frottement négatif (#45). L'outil passe de « graphique » à « tabulaire ».
2. **Avertissements normatifs non affichés** (#70) — perte d'information de
   sécurité (ancrage < 3·B, couches non couvertes, plafond traction…) alors que le
   serveur les fournit déjà. Correction 100 % front.
3. **Panneau Résultats amputé** : pas de KPI, table Résistances sans colonne Brut ni
   R_d par terme (#73/74/77), pas de frottement par couche (#80), synthèse
   géométrique réduite à 4 lignes (#82), sous-détails p_le\*/D_ef/k_p/ξ/γ_R;d1
   masqués (#73/78), taux par vérification non affiché bien que déjà exposé (#79).
4. **Onglet Coefficients quasi disparu** (#62–69) : ni les tables normatives
   appliquées au pieu (k_p,max/k_c,max/α/q_s,max), ni les tables EC7 Annexe A, ni
   les ξ dynamiques, ni les coefficients de fluage.
5. **Frottement négatif dégradé** (#42–46) : opt-in au lieu du live, pas de
   préremplissage « Reprendre Q et la coupe du projet », pas de KPI, tassement de
   tête absent, pas de profils.

### MOYENS (fonctionnels / de contenu)

- Champ « Sondage / pieu » absent (#11) ; exemple pré-chargé absent (#6/#89/#48).
- Colonnes de la table de sol non masquées selon la méthode (#52) ; pas d'index ni
  de pastilles couleur (#50) ; profondeur totale absente (#49) ; démarrage à 2
  couches vs vide (#54).
- Pénétrogramme non éditable point à point, pas de génération visible (#55/56/59).
- Hints dynamiques absents (pieu-info #20, meth-info #30, da-info #31, ξ #33/67).
- Libellé « Essais renforcés » sémantiquement faux (#28) ; « Contrôles d'intégrité »
  devenu « k₃ » (#23) ; abréviations de catégories omises (#19).
- **Nappe vide : 0 m (client) vs 500 m (nous)** — divergence de défaut (#32).
- Béton : σ appliquées/limite ELS/formules non affichées, raison « non applicable »
  perdue (#84/85) ; opt-in au lieu de systématique (#21).
- Message d'erreur générique au lieu du motif précis (#71) ; verdict sans taux ni
  contexte dans le bandeau (#72).

### FAIBLES (cosmétique / libellés)

- Libellés « Fiche D » / « Cote de départ z₀ » vs client (#16/17) ; défaut D 12 vs
  15 (#17) ; « Oui » vs « Structure rigide (÷1,1) » (#35) ; libellés courts de
  natures de sol (#51) ; segmentés remplacés par des selects (#12/25/30/31/36) ;
  footer/disclaimer absent (#87) ; notices/hints statiques omis (#18/24/62).
- Impression → PV scellé (#83) et persistance projet serveur (#10) : divergences
  POSITIVES à documenter formellement, pas à corriger.

## Les 5 écarts les plus visibles pour un utilisateur de l'outil client

1. **Aucun graphique** — il ne retrouve ni la coupe géotechnique qui se dessine
   pendant la saisie, ni la courbe charge—tassement, ni la courbe de portance en
   profondeur (son outil de choix d'ancrage), ni les profils de frottement négatif,
   ni le log q_c(z).
2. **Des résultats « à plat »** — au lieu du verdict contextualisé + 4 KPI + table
   Résistances Brut/Caractéristique/Calcul + frottement par couche + synthèse
   géométrique, une unique table Grandeur/Valeur/Unité — sans les intermédiaires
   qu'il a l'habitude de lire (p_le\*, k_p, D_ef/B, ξ₃/ξ₄, γ_R;d1, C_e).
3. **Plus d'avertissements** — les ⚠ qui l'alertaient (ancrage insuffisant < 3·B,
   couche non couverte par la norme, plafond de traction) ont disparu de l'écran.
4. **L'onglet Coefficients est vide de substance** — ni les facteurs qu'il pouvait
   ajuster, ni les tables normatives (k_p,max, α, q_s,max) qu'il consultait pour
   justifier sa note de calcul.
5. **Le frottement négatif ne « vit » plus** — plus de calcul immédiat à l'ouverture,
   plus de bouton de reprise du projet, plus de point neutre visualisé sur 3 profils :
   une case à cocher et 3 lignes de tableau.

## Recommandation (pour le lot de correction — hors périmètre de ce rapport)

1. **Front seul, sans décision** (rapide) : avertissements (#70), erreur détaillée
   (#71), taux par vérification (#79), tables statiques EC7 (#69), coupe
   géotechnique + log q_c depuis la saisie (#60/61 base), colonnes conditionnelles
   (#52), libellés (#16/17/19/23/28/35), exemple pré-chargé (#6), champ sondage/pieu
   (#11), pénétrogramme éditable (#55/56/59), défaut nappe (#32), A_b/périmètre
   (#82 partiel), bandeau verdict complet (#72).
2. **Élargissement gouverné du contrat pieux** (décision expert + titulaire, ADR
   0014 vs mémoire whitelist) : p_le\*/q_ce/k_p/k_c/D_ef/ξ/γ_R;d1/C_e, R brut et R_d
   par terme, `fric[]` par couche, courbe charge—tassement, profils downdrag +
   tassement de tête, courbe de portance en profondeur, table des facteurs
   normatifs par pieu, σ/limites béton + formules.
3. **À acter formellement comme divergences assumées** (ne pas « corriger » en
   silence) : coefficients non éditables (sécurité du verdict/PV), PV scellé au lieu
   de l'impression, persistance projet serveur, recalcul serveur (DoD §8), gardes et
   aperçus ajoutés (CptPreview, fn-missing, garde section quelconque).
