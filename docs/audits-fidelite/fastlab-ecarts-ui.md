# FASTLAB — rapport d'écarts de fidélité d'interface (client ↔ plateforme)

> **Objet** : baseline « avant » et checklist de recette des écarts d'**interface**, de
> **fonctionnement** et d'**affichage** entre l'outil FASTLAB fourni par le client et
> notre portage web (exigence client : **zéro écart**, cf. ADR 0014 et règle titulaire
> « fidélité interfaces client »).
> **Ce rapport ne corrige rien** — la correction sera un lot séparé sur cette base.
> Un élément oublié ici serait un écart livré au client : la matrice vise l'exhaustivité.

## Références comparées

| Côté                         | Cible                                                                                                                                   | Mode d'accès                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Client** (référence, gelé) | `03-Moteurs-client/GeoSuite/source/tools/FASTLAB7.html` (1 658 lignes, ~133 inputs, 8 canvas)                                           | Lecture intégrale du source, LECTURE seule |
| **Nous — code local**        | `apps/web/src/app/app/[orgSlug]/logiciels/fastlab/page.tsx` (2 193 lignes) + `apps/web/src/lib/api/adapters.ts` (`buildLaboRows`)       | Lecture du source                          |
| **Contrat serveur**          | `packages/engines/src/labo/contract.ts` (`LaboInputSchema` / `LaboOutputSchema`) + `packages/engines/src/labo/index.ts` (`shapeOutput`) | Lecture du source                          |

**Inventaire client (machine-lisible)** : `docs/audits-fidelite/fastlab-inventaire-client.json`.

> **Portée honnête** : l'équivalence NUMÉRIQUE du portage moteur est traitée par les
> tests d'équivalence du paquet `labo` (`engine.equivalence.test.ts`) — hors périmètre
> ici. Le présent rapport porte sur la **fidélité d'INTERFACE et d'AFFICHAGE**.
> **Doctrine (ADR 0014, « zéro écart »)** : tout ce que l'outil client AFFICHE est
> exposable ; un masquage §8 d'une valeur affichée par le client est **lui-même un
> écart à corriger**. Pour ce moteur, le module `labo` déclare d'ailleurs explicitement
> que « les résultats de labo + la classe GTR sont le LIVRABLE, tout est client-safe »
> (`index.ts`) : les statuts MASQUÉ-§8 ci-dessous sont donc des trous de whitelist à
> combler, pas des choix de confidentialité défendables.

---

## Synthèse : verdict global

**Le squelette de saisie est largement présent, mais l'expérience « feuille de labo
vivante » du client n'est pas reproduite.** Nos 20 onglets couvrent la quasi-totalité
des champs de MESURE (~85 % des inputs), et l'onglet « Classe GTR » restitue
fidèlement le verdict (badge, description, chemin de décision, points à vérifier,
assistant famille R, fiche de synthèse ~35 lignes).

En revanche :

1. **Aucun calcul live** : chez le client, chaque frappe recalcule TOUTES les colonnes
   dérivées (w %, passant cumulé, ρd, CBR, σ′v/τ, e…), les chips de résultats par
   feuille, les alertes de conformité normative et les 8 graphiques. Chez nous, rien
   ne s'affiche avant le clic « Classer → » (serveur), et même après, **aucune valeur
   par ligne** n'est restituée (la whitelist ne porte que des agrégats).
2. **Les 8 graphiques** (courbe granulométrique, droite de liquidité, diagramme de
   plasticité ligne A, courbe Proctor, poinçonnement CBR, droite CBR/compacité,
   courbe œdométrique, droites de Coulomb) sont **tous absents**.
3. **3 onglets entiers manquent** : Seuils (paramétrage GTR — le contrat accepte
   pourtant `cfg`), Échantillons enregistrés (save/ouvrir/export/import JSON), et les
   actions d'en-tête (Nouvel essai, Exemple fictif, Enregistrer).
4. **Des libellés FAUX** induisent le laborantin en erreur (VBS « Fraction 0/2 » au
   lieu de « Fraction 0/5 dans 0/D » ; LA « Passant initial (%) » au lieu de « Tamis
   intermédiaire (mm) » ; variantes LA/MDE « Roches dures » au lieu de
   « Ballast 31,5/50 — LARB »…).
5. **Le CBR est amputé** : 2 enfoncements de poinçonnement sur 10, pas de w après
   immersion, pas de pied CBR 2,5/5/maxi/compacité, pas de ρd du CBR.

---

## 1. Inventaire structurel de l'outil client

Détail complet dans `fastlab-inventaire-client.json`. Résumé :

- **Navigation** : sidebar verticale, **4 groupes** (IDENTIFICATION · SOLS ·
  GRANULATS · SYNTHÈSE), **24 entrées**, pastille verte « done » par essai renseigné.
- **En-tête** : logo FASTLAB + sous-titre « Traitement des essais & classification
  GTR · NF P 11-300 » + 4 boutons : `＋ Nouvel essai` · `🧪 Exemple fictif` ·
  `💾 Enregistrer` · `🖨 PV`. Bandeau info « Saisie 100 % numérique ».
- **24 feuilles** : Identification (14 champs dont Observations et famille R) ;
  14 essais SOLS (teneur en eau, granulo 18 tamis, Atterberg 5+2 points, VBS 2 essais,
  ρs pycnomètre 3 dét., ρ apparente 3 méthodes, Proctor 7 points, CBR/IPI 3 moules,
  cisaillement direct boîte/annulaire 4 épr., œdomètre 12 paliers, UCS, triaxial UU,
  triaxial CU/CD, perméabilité 2 modes) ; 6 essais GRANULATS (ES, LA 3 variantes,
  SZ, MDE norme/CAFEC, ρ & absorption, sulfates) ; SYNTHÈSE (Classification GTR +
  fiche de synthèse 33 lignes, Seuils paramétrables 13+1, Échantillons enregistrés).
- **Colonnes calculées live** dans chaque table (w %, refus/passant cumulés, ρd,
  CBR 2,5/5/maxi, compacité, σ′v/τ, H_f/ε_v/e, coefficient MDE, pertes CAFEC…).
- **Readout chips** par feuille (2 à 7 grandeurs) + **alertes de conformité
  normative live** (validité Casagrande §6.1, V≤10 VBS, concordance ρs ≤ 0,03,
  énergie Proctor ±8 %, conformité granulaire LA/MDE, notes « min. N éprouvettes »).
- **8 canvas** : `gcurve`, `llcurve`, `plastchart`, `pcurve`, `cb_pen`, `cb_var`,
  `ocurve`, `cicurve`.
- **Workflows** : recalcul live à chaque frappe ; newSample/loadDemo/saveSample ;
  DB persistée avec Ouvrir/Suppr ; export/import `.json` ; `printPV()` qui n'imprime
  QUE les feuilles renseignées avec en-tête labo + bloc visa par feuille ; seuils GTR
  ajustables avec reset ; toasts ; pastilles de progression ; footer disclaimer.

## 2. Inventaire de notre page React

`page.tsx` (shell GEOFAM, sélecteur de projet, gate d'abonnement) :

- **Bandeau** : « FASTLAB — Classification des sols · GTR / NF P11-300 » +
  ProjectPicker + bouton `Classer →` (calcul serveur `runCalc(engineId:'labo')`).
- **20 onglets horizontaux** (row de tabs, sans groupes ni pastilles) :
  Identification · Eau & granulométrie (fusion w+gran) · Limites d'Atterberg ·
  Bleu (VBS) · Proctor (+ pills état hydrique) · CBR / IPI · Cisaillement ·
  Œdomètre · Triaxial UU · Triaxial CU · Équiv. sable · Los Angeles · Micro-Deval ·
  Fragmentation · Sulfates · Perméabilité · Compression · Densités (fusion ρs+ρ
  apparente) · Absorption · **Classe GTR** (résultats).
- **Saisie** : champs contrôlés React, payload pur `buildFastlabPayload` (ids moteur
  exacts), formulaires **vides par défaut** (décision revue adverse — pas de démo).
- **Résultats** (onglet Classe GTR, après calcul serveur) : badge classe + description,
  « Cheminement de classement » (ol), encarts « Points à vérifier » et « Assistant
  famille R », table « Paramètres d'identification » (~35 lignes agrégées via
  `buildLaboRows`), bouton « Émettre le PV scellé » (PV serveur HMAC numéroté).
- **Aucun canvas, aucune colonne calculée, aucun chip par feuille, aucune alerte de
  conformité normative, aucun onglet Seuils/Enregistrés, aucun import/export.**

## 3. Matrice de complétude

Statuts : **PRÉSENT** (fidèle ou équivalent direct) · **PARTIEL** (présent mais
incomplet/divergent) · **ABSENT** (rien chez nous) · **MASQUÉ-§8** (valeur affichée
par le client, non restituable car non whitelistée dans `LaboOutputSchema` /
non alimentée par `shapeOutput` — **écart à corriger** au titre d'ADR 0014).

### 3.a Navigation & chrome (10 éléments)

| Élément client                                                                                        | Chez nous                                                                          | Statut  | Détail                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar 4 groupes (IDENTIFICATION/SOLS/GRANULATS/SYNTHÈSE)                                            | Row d'onglets horizontale sans groupes                                             | ABSENT  | Structure de navigation ≠                                                                                                                                             |
| 24 entrées de navigation                                                                              | 20 onglets                                                                         | PARTIEL | w+gran fusionnés (« Eau & granulométrie »), ρs+ρ apparente fusionnés (« Densités ») ; Seuils et Enregistrés absents ; class → « Classe GTR »                          |
| Pastilles « done » par essai renseigné (updateDots)                                                   | —                                                                                  | ABSENT  | Aucun indicateur de progression                                                                                                                                       |
| Ordre client (w→gran→att→vbs→ρs→dens→proctor→cbr→cisail→œdo→ucs→uu→cu→perm ; es→la→sz→mde→ρ&abs→sulf) | ident→eau→att→vbs→proctor→cbr→cisail→œdo→uu→cu→es→la→mde→sz→sulf→perm→ucs→dens→abs | PARTIEL | ρs/dens/ucs/perm déplacés ; sz/mde inversés ; sulfates avant perméabilité                                                                                             |
| En-tête logo + sous-titre « Traitement des essais & classification GTR · NF P 11-300 »                | « FASTLAB / Classification des sols · GTR / NF P11-300 »                           | PARTIEL | « Traitement des essais » disparu du sous-titre                                                                                                                       |
| Bouton `＋ Nouvel essai`                                                                              | « Nouveau calcul » uniquement après émission d'un PV                               | ABSENT  | Pas de remise à zéro à tout moment                                                                                                                                    |
| Bouton `🧪 Exemple fictif` (loadDemo, échantillon A2 complet)                                         | —                                                                                  | ABSENT  | Retiré délibérément (formulaires vides, revue adverse) — reste un écart visible                                                                                       |
| Bouton `💾 Enregistrer` (saveSample)                                                                  | —                                                                                  | ABSENT  | Cf. onglet Enregistrés (3.z)                                                                                                                                          |
| Bouton `🖨 PV` (rapport imprimable, feuilles renseignées + en-tête labo + visa)                       | « Émettre le PV scellé » (PV serveur numéroté)                                     | PARTIEL | Mécanique ≠ (divergence positive scellement) ; le périmètre « uniquement les feuilles renseignées + en-tête labo + bloc visa par feuille » à vérifier côté PV serveur |
| Bandeau info « Saisie 100 % numérique »                                                               | —                                                                                  | ABSENT  |                                                                                                                                                                       |

### 3.b Identification (4)

| Élément client                                                                                | Chez nous                                                 | Statut  | Détail                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 12 champs texte d'identification                                                              | 12 champs                                                 | PARTIEL | Libellés raccourcis (« Client » vs « Client / Maître d'ouvrage », « Opérateur » vs « Technicien », « Ingénieur » vs « Ingénieur chargé de l'étude (visa) », « Nature du sol » vs « Nature présumée », « Dossier » vs « N° de dossier ») ; dates en texte libre vs `type=date` ; placeholders d'exemple absents |
| Famille géologique (m_geo, 6 options R1–R6)                                                   | Select identique + hint                                   | PRÉSENT | Libellés d'options identiques                                                                                                                                                                                                                                                                                  |
| Observations (m_obs, textarea)                                                                | —                                                         | ABSENT  | Le contrat accepte `m_obs` ; aucun champ front                                                                                                                                                                                                                                                                 |
| Tag de norme par carte (« EN-TÊTE PV », « NF EN ISO 17892-1 »…) + phrase de formule `p.norme` | Norme dans le titre pour les sections « extra » seulement | PARTIEL | Eau/granulo/Atterberg sans norme affichée ; formules normatives d'en-tête absentes                                                                                                                                                                                                                             |

### 3.c Teneur en eau (4)

| Élément client                                         | Chez nous                               | Statut    | Détail                                                                                |
| ------------------------------------------------------ | --------------------------------------- | --------- | ------------------------------------------------------------------------------------- |
| Table 3 prises (Tare/Humide+tare/Sec+tare)             | Table identique                         | PRÉSENT   |                                                                                       |
| Colonne « w (%) » calculée live par prise              | —                                       | MASQUÉ-§8 | Valeurs par prise non whitelistées (seul l'agrégat `wn` sort) ; le client les affiche |
| Readout « w moyenne » + « Nb prises »                  | `wn` dans les rows après calcul serveur | PARTIEL   | Pas sur la feuille, pas live ; « Nb prises » absent                                   |
| Hint « la teneur en eau moyenne sert d'état hydrique » | —                                       | ABSENT    |                                                                                       |

### 3.d Granulométrie (7)

| Élément client                                                             | Chez nous                                                                                             | Statut    | Détail                                                                                  |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------- |
| Masse sèche totale M (gr_M)                                                | Champ présent                                                                                         | PRÉSENT   |                                                                                         |
| Refus en fond de colonne (gr_fond, info)                                   | —                                                                                                     | ABSENT    | Contrat l'accepte ; aucun champ front                                                   |
| Table 18 tamis, refus partiel saisi                                        | Grille de 18 champs (mêmes tamis)                                                                     | PARTIEL   | Grille de cartes au lieu d'une table ordonnée à 4 colonnes                              |
| Colonnes « Refus cumulé » + « Passant cumulé » calculées                   | —                                                                                                     | MASQUÉ-§8 | Par-tamis non whitelisté (seuls `dmax/p80/p2/Cu/Cc/mf` sortent) ; affiché par le client |
| Readouts Dmax / P80µm / P2mm / Cu / Cc / Module de finesse (+qualificatif) | Rows « Dmax », « Passant à 80 µm », « Passant à 2 mm », « Cu », « Cc », « Module de finesse (qual.) » | PRÉSENT   | Après calcul serveur uniquement                                                         |
| Canvas `gcurve` (courbe granulométrique log, repères 80 µm / 2 mm)         | —                                                                                                     | ABSENT    |                                                                                         |
| Note module de finesse (règle sables, seuils 2,2/2,8)                      | —                                                                                                     | ABSENT    |                                                                                         |

### 3.e Atterberg (11)

| Élément client                                                    | Chez nous                                 | Statut    | Détail                                                                                                       |
| ----------------------------------------------------------------- | ----------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| Specbox LLSPEC (méthode Casagrande, règles §6.1)                  | —                                         | ABSENT    |                                                                                                              |
| Table w_L **5 points** (N/Tare/Humide/Sec)                        | Table **4 points**                        | PARTIEL   | 1 ligne de moins que l'outil client ; pas de colonne « Point » ; contrat accepte ll\_\*5                     |
| Colonne « w (%) » calculée par point                              | —                                         | MASQUÉ-§8 | Non whitelisté ; affiché par le client                                                                       |
| Hint contrôles N (encadrer 25, 15–35, écart ≤ 10, ±3 %)           | —                                         | ABSENT    |                                                                                                              |
| Readout LL : wL, Points, **Pente droite**, **Validité ✓/✗**       | `wl` seul (rows)                          | PARTIEL   | Pente de régression et verdict de validité non exposés ni affichés                                           |
| Canvas `llcurve` (droite lg N – w, repère 25 chocs)               | —                                         | ABSENT    |                                                                                                              |
| Table w_P 2 déterminations                                        | Table identique                           | PRÉSENT   |                                                                                                              |
| Checkbox « Sol non plastique » (pl_np)                            | Checkbox identique                        | PRÉSENT   |                                                                                                              |
| Readout wL/wP/Ip/Ic/**Nature** (ligne A)                          | Rows `wl/wp/ip/ic` + « Nature (ligne A) » | PRÉSENT   | `natureLigneA` whitelisté et affiché                                                                         |
| Alerte « Contrôles NF P 94-051 » (liste live des non-conformités) | —                                         | MASQUÉ-§8 | `shapeOutput` fixe `warnings: []` en dur — aucun contrôle normatif ne remonte jamais ; le client les affiche |
| Canvas `plastchart` (diagramme de plasticité, ligne A)            | —                                         | ABSENT    |                                                                                                              |

### 3.f VBS (6)

| Élément client                                                             | Chez nous                                              | Statut    | Détail                                                                                                                |
| -------------------------------------------------------------------------- | ------------------------------------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------- |
| Concentration C (g/L, **défaut 10 pré-rempli**)                            | Champ vide                                             | PARTIEL   | Défaut non pré-rempli (le moteur retombe sur 10)                                                                      |
| Table transposée 2 essais : prise, **« Fraction 0/5 dans 0/D (%) »**, w, V | Table 2 lignes : prise, **« Fraction 0/2 (%) »**, w, V | PARTIEL   | **Libellé FAUX** : la norme et le client disent fraction **0/5 mm** ; l'orientation (essais en colonnes) est inversée |
| Lignes calculées M₁ / M_b / VBS 0/5 / VBS du sol (par essai)               | —                                                      | MASQUÉ-§8 | Non whitelistées ; affichées par le client                                                                            |
| Saisie directe VBS (v_manual, prioritaire)                                 | —                                                      | ABSENT    | Contrat l'accepte ; aucun champ front                                                                                 |
| Readout VBS moyenne / VBS retenue / Essais                                 | Row « Valeur au bleu VBS » unique                      | PARTIEL   | Moyenne vs retenue non distinguées                                                                                    |
| Alerte « V ≤ 10 cm³ → recommencer » (art. 7)                               | —                                                      | MASQUÉ-§8 | warnings jamais alimentés                                                                                             |

### 3.g Masse volumique des grains ρs (6) — fusionné chez nous dans « Densités »

| Élément client                                                                          | Chez nous                                | Statut    | Détail                                                                                            |
| --------------------------------------------------------------------------------------- | ---------------------------------------- | --------- | ------------------------------------------------------------------------------------------------- |
| Pills méthode A (étuve) / B (humide)                                                    | Select « Méthode ρ_s »                   | PRÉSENT   |                                                                                                   |
| Liquide (eau/autre) + T (°C, défaut 20) + ρL                                            | Select + 2 champs                        | PRÉSENT   | Défaut T=20 non pré-rempli (moteur ok)                                                            |
| ρw(T) calculée (readonly)                                                               | —                                        | ABSENT    | Champ calculé live absent                                                                         |
| Table pesées **3 déterminations** (m₀/m₁/mₓ/m₃ + m_d, ρs calc ; entête dynamique m₂↔m₄) | Table **2 lignes**, 4 colonnes de saisie | PARTIEL   | 1 détermination de moins (contrat accepte 3) ; colonnes calculées et entête dynamique A/B absents |
| Readout écart / « Concordance ✓ ≤ 0,03 / ✗ répéter »                                    | —                                        | MASQUÉ-§8 | Écart et verdict de concordance non exposés ; affichés par le client                              |
| Readout ρs moyenne                                                                      | Row « ρ_s »                              | PRÉSENT   |                                                                                                   |

### 3.h Proctor (9)

| Élément client                                                                            | Chez nous                                                       | Statut    | Détail                                                                                  |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------- |
| Pills type (normal 2,5 kg / modifié 4,5 kg / modifié 15 kg)                               | Boutons identiques                                              | PRÉSENT   |                                                                                         |
| Select moule A/B/C (mêmes libellés dimensionnels)                                         | Select identique                                                | PRÉSENT   |                                                                                         |
| Ø moule (cm) + Hauteur (cm) éditables (pr_d/pr_hh)                                        | —                                                               | ABSENT    | Dimensions personnalisées impossibles (le moteur dérive du moule) ; contrat les accepte |
| Volume V calculé (readonly)                                                               | —                                                               | ABSENT    |                                                                                         |
| Specbox : mode opératoire Tableau 5 (dame/chute/couches/coups) + **énergie calculée ✓/⚠** | —                                                               | ABSENT    | Contrôle d'énergie normatif invisible                                                   |
| Table **7 points** de compactage                                                          | 5 lignes par défaut, extensible à 7 (« + Point », borné moteur) | PARTIEL   | Nombre par défaut ≠ ; bouton d'ajout = divergence de forme                              |
| Colonnes « w (%) » et « ρd (t/m³) » calculées par point                                   | —                                                               | MASQUÉ-§8 | Non whitelistées ; affichées par le client                                              |
| Readout wOPN / ρd max (+ Points, Volume)                                                  | Rows « w_OPN », « ρ_d;max »                                     | PRÉSENT   |                                                                                         |
| Canvas `pcurve` (courbe Proctor + parabole + optimum)                                     | —                                                               | ABSENT    |                                                                                         |

### 3.i CBR / IPI (11)

| Élément client                                                                       | Chez nous                                                              | Statut    | Détail                                                                                                                      |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| Pills « CBR — après immersion (4 j) » / « IPI — portance immédiate »                 | Boutons (« IPI — indice portant immédiat »)                            | PRÉSENT   | Libellé IPI légèrement ≠                                                                                                    |
| Réf. OPM : ydmax, wopt, cible (95), s25 (13,35), s5 (20), K (1)                      | 6 champs présents                                                      | PARTIEL   | Défauts non pré-remplis ; placeholders « auto Proctor » absents                                                             |
| ρd du CBR calculé (cb_ydcbr, readonly)                                               | —                                                                      | MASQUÉ-§8 | Affiché par le client (chip + champ) ; non whitelisté                                                                       |
| Hint cb_opmsrc (OPM repris du Proctor)                                               | —                                                                      | ABSENT    |                                                                                                                             |
| Table mise en place 3 moules (9 colonnes dont poids net/ρh/ρd/compacité calc)        | Table 3 moules : masses, volume, w                                     | PARTIEL   | Saisies présentes ; colonne « Poids net » et calculs absents                                                                |
| Colonnes calculées moules (net, ρh, ρd, compacité)                                   | —                                                                      | MASQUÉ-§8 | Non whitelistées ; affichées par le client                                                                                  |
| Table imbibition : H₀, ΔH, **gonflement % calc**, **w après immersion (cb_wimm)**    | H₀ + Gonfl. (mm) intégrés à la table principale                        | PARTIEL   | **cb_wimm ABSENT du front** (contrat l'accepte) ; % de gonflement par moule non restitué ; bloc non conditionné au mode CBR |
| Table poinçonnement **10 enfoncements** (0,25→5 mm) × 3 moules                       | **2 colonnes** (« Force 2,5 mm », « Force 5 mm »)                      | PARTIEL   | 8 enfoncements sur 10 non saisissables (contrat accepte les 30 champs) ; la courbe de poinçonnement devient impossible      |
| Pied de table : CBR 2,5 / CBR 5,0 / CBR maxi / Compacité (%) par moule               | —                                                                      | MASQUÉ-§8 | Non whitelistés ; affichés par le client                                                                                    |
| Readout I.CBR (ou IPI) à X % + gonflement maxi                                       | Rows « Indice CBR »/« IPI (Indice Portant Immédiat) » + « Gonflement » | PRÉSENT   |                                                                                                                             |
| Canvas `cb_pen` + `cb_var` (poinçonnement ; droite CBR/compacité avec interpolation) | —                                                                      | ABSENT    |                                                                                                                             |

### 3.j Cisaillement direct (12)

| Élément client                                                             | Chez nous                                | Statut    | Détail                                                                       |
| -------------------------------------------------------------------------- | ---------------------------------------- | --------- | ---------------------------------------------------------------------------- |
| Pills dispositif Boîte / Annulaire                                         | Boutons identiques                       | PRÉSENT   |                                                                              |
| Géométrie boîte : forme (carrée/circulaire), côté/Ø, **aire A calculée**   | Select + champ ; aire absente            | PARTIEL   | Champ calculé absent                                                         |
| Géométrie annulaire : Ra, Ri, **aire annulaire calculée**                  | 2 champs ; aire absente                  | PARTIEL   | Idem                                                                         |
| Specbox (formules 9-11, vitesses maximales)                                | —                                        | ABSENT    |                                                                              |
| Table 4 éprouvettes N/P/R (entêtes dynamiques force↔couple)                | Table 4 lignes, entêtes dynamiques ✓     | PARTIEL   | Fusionnée avec la table d'identification (1 table au lieu de 2)              |
| Colonnes σ′v / τ_pic / τ_R calculées                                       | —                                        | MASQUÉ-§8 | Non whitelistées ; affichées par le client                                   |
| ρs grains (ci_rs)                                                          | Champ présent                            | PRÉSENT   |                                                                              |
| Table identification : ρ, **ρd calc**, W, **e calc**, **S_R calc**, Nature | ρ, w, nature saisis dans la table unique | PARTIEL   | ρd/e/S_R calculés absents (non whitelistés)                                  |
| Readout c′ / φ′ / φ′R                                                      | Rows « c′ », « φ′ », « φ′\_R »           | PRÉSENT   |                                                                              |
| Readout **R²** + **c′R**                                                   | —                                        | MASQUÉ-§8 | Affichés par le client (chips + annotation canvas) ; absents de la whitelist |
| Canvas `cicurve` (droites de Coulomb pic/résiduel, équation, R²)           | —                                        | ABSENT    |                                                                              |
| Resbox « Résultats : C′ (kPa) / φ′ (°) »                                   | Équivalent dans les rows                 | PRÉSENT   |                                                                              |

### 3.k Masse volumique apparente (8) — fusionné chez nous dans « Densités »

| Élément client                                                                      | Chez nous                                                 | Statut    | Détail                                 |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------- | --------- | -------------------------------------- |
| Pills méthode : linéaire / immersion / déplacement                                  | Select 3 options                                          | PRÉSENT   |                                        |
| Specbox formules par méthode                                                        | Note générique                                            | ABSENT    |                                        |
| Pills forme : prisme / cylindre                                                     | Select conditionnel                                       | PRÉSENT   |                                        |
| Champs des 3 méthodes (prisme LWH+m ; cylindre d,L,m ; immersion 6 ; déplacement 7) | Tous présents, mêmes libellés, défauts ρ_fl/ρ_p appliqués | PRÉSENT   |                                        |
| Teneur en eau w (vide = w moyen)                                                    | Champ + note identiques                                   | PRÉSENT   |                                        |
| Readout ρ apparente / ρd sèche / w utilisée                                         | Rows « ρ », « ρ_d »                                       | PRÉSENT   | « w utilisée » non affiché             |
| Readout « Volume V (cm³) »                                                          | —                                                         | MASQUÉ-§8 | Affiché par le client ; non whitelisté |
| Note « V < 50 cm³ — moins représentatif »                                           | —                                                         | ABSENT    | warnings jamais alimentés              |

### 3.l Œdomètre (7)

| Élément client                                | Chez nous                                | Statut    | Détail                                                                         |
| --------------------------------------------- | ---------------------------------------- | --------- | ------------------------------------------------------------------------------ |
| Champs H₀ / D / m_d / ρs                      | 4 champs identiques                      | PRÉSENT   |                                                                                |
| Champs calculés A / ρd initiale / Hs          | —                                        | MASQUÉ-§8 | ρd et Hs affichés par le client (chips) ; non whitelistés                      |
| e₀ saisie directe (oe_e0)                     | —                                        | ABSENT    | Contrat l'accepte ; la voie « e₀ direct sans pesées » est impossible chez nous |
| Table **12 paliers** (σ′/ΔH + H_f/ε_v/e calc) | Table **9 lignes**, 2 colonnes de saisie | PARTIEL   | 3 paliers de moins (contrat accepte 12) ; colonnes calculées absentes          |
| Colonnes H_f / ε_v / e calculées              | —                                        | MASQUÉ-§8 | Non whitelistées ; affichées par le client                                     |
| Readout e₀ / Cc / Cs (+ paliers, note min. 7) | Rows « e₀ », « Cc (œdo) », « Cs »        | PRÉSENT   | Note normative absente                                                         |
| Canvas `ocurve` (e vs σ′ log)                 | —                                        | ABSENT    |                                                                                |

### 3.m UCS (3) · 3.n Triaxial UU (3) · 3.o Triaxial CU (3) · 3.p Perméabilité (3)

| Élément client                                  | Chez nous                                 | Statut    | Détail                                                                          |
| ----------------------------------------------- | ----------------------------------------- | --------- | ------------------------------------------------------------------------------- |
| UCS : 4 champs (d₀/h₀/F/ΔL)                     | Identiques                                | PRÉSENT   |                                                                                 |
| UCS : readout q_u                               | Row « q_u »                               | PRÉSENT   |                                                                                 |
| UCS : readout **c_u = q_u/2 (kPa)**             | —                                         | MASQUÉ-§8 | Affiché par le client ; non whitelisté (dérivable)                              |
| UU : table 3 éprouvettes σ₃/déviateur           | Identique                                 | PRÉSENT   |                                                                                 |
| UU : colonnes σ₁ / c_u calculées par éprouvette | —                                         | MASQUÉ-§8 | Non whitelistées ; chip « φu ≈ 0 » aussi absent                                 |
| UU : readout c_u moyen                          | Row « c_u (UU) »                          | PRÉSENT   |                                                                                 |
| CU : table 3 éprouvettes σ′₃/σ′₁                | Identique                                 | PRÉSENT   |                                                                                 |
| CU : colonnes s′ / t calculées                  | —                                         | MASQUÉ-§8 | Non whitelistées ; affichées par le client                                      |
| CU : readout c′ / φ′                            | Rows « c′ (triaxial) », « φ′ (triaxial) » | PRÉSENT   |                                                                                 |
| Perm : pills constante/variable                 | Select                                    | PRÉSENT   |                                                                                 |
| Perm : champs des 2 modes                       | Identiques (affichage conditionnel ✓)     | PRÉSENT   |                                                                                 |
| Perm : readout k (cm/s) **et k (m/s)**          | Row « k (cm/s) » seul                     | PRÉSENT   | k en m/s (affiché par le client) manquant — à ajouter (simple ÷100 d'affichage) |

### 3.q Équivalent de sable (3)

| Élément client                                   | Chez nous                                         | Statut    | Détail                                                                            |
| ------------------------------------------------ | ------------------------------------------------- | --------- | --------------------------------------------------------------------------------- |
| Table 2 essais « h₁ total (mm) / h₂ sable (mm) » | Table « h₁ — floculat (mm) / h₂ — sédiment (mm) » | PARTIEL   | **Libellés ≠** de l'outil client (h₁ = niveau total, h₂ = niveau sable au piston) |
| Colonne SE (%) calculée par essai                | —                                                 | MASQUÉ-§8 | Non whitelistée ; affichée par le client                                          |
| Readout SE moyen                                 | Row « ES »                                        | PRÉSENT   |                                                                                   |

### 3.r Los Angeles (7)

| Élément client                                                                                                                    | Chez nous                                                                             | Statut  | Détail                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| Pills variante : « Standard 10/14 (5000 g) » / « **Ballast 31,5/50 — LARB** » / « **Autre fraction (Annexe B)** »                 | Select : « Standard » / « **Roches dures** » / « **Alternative** »                    | PARTIEL | **Libellés FAUX** (rb = ballast, pas « roches dures ») ; auto-remplissage M/boulets/tamis absent |
| Specbox LASPEC par variante                                                                                                       | —                                                                                     | ABSENT  |                                                                                                  |
| Masse initiale M + refus m                                                                                                        | 2 champs présents                                                                     | PRÉSENT |                                                                                                  |
| Nombre de boulets (la_nb)                                                                                                         | —                                                                                     | ABSENT  | Contrat l'accepte                                                                                |
| Masse charge boulets (la_charge)                                                                                                  | —                                                                                     | ABSENT  | Contrat l'accepte                                                                                |
| Details « Conformité granulaire » : **Tamis intermédiaire (mm)** (la_ti, défaut 12,5) + **% passant mesuré** (la_pi) + alerte ✓/✗ | Champs présents mais libellés « **Passant initial (%)** » / « **Passant après (%)** » | PARTIEL | **Libellés FAUX** (la_ti est un Ø de tamis en mm, pas un passant) ; alerte de conformité absente |
| Readout LA / LARB (arrondi entier)                                                                                                | Row « Los Angeles LA »                                                                | PRÉSENT | Libellé LARB dynamique non repris                                                                |

### 3.s Fragmentation SZ (3)

| Élément client                                          | Chez nous                        | Statut    | Détail                                     |
| ------------------------------------------------------- | -------------------------------- | --------- | ------------------------------------------ |
| M + table 5 tamis (masse refus)                         | 6 champs (M + 5 refus) en grille | PRÉSENT   | Grille au lieu de table                    |
| Colonnes % refus / % passant calculées + chip Σ passant | —                                | MASQUÉ-§8 | Non whitelistées ; affichées par le client |
| Readout SZ (%)                                          | Row « SZ »                       | PRÉSENT   |                                            |

### 3.t Micro-Deval (14)

| Élément client                                                                                                   | Chez nous                                             | Statut    | Détail                                                            |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------- | ----------------------------------------------------------------- |
| Pills présentation : Norme / **Campagne CAFEC**                                                                  | Select Mode identique                                 | PRÉSENT   |                                                                   |
| Pills variante : « Standard 10/14 (500 g) » / « **Ballast 31,5/50 — MDE_RB** » / « **Autre classe (Annexe C)** » | Select : « Standard » / « **Roches** » / « **Alt.** » | PARTIEL   | **Libellés FAUX/tronqués**                                        |
| Pills condition : « Humide (MDE) » / « Sec (MDS) »                                                               | Select identique (conditionné au mode norme ✓)        | PRÉSENT   |                                                                   |
| Select classe granulaire Annexe C (mde_class : 4/6,3 … 11,2/16)                                                  | —                                                     | ABSENT    | Contrat l'accepte ; la variante « alt » est inutilisable sans lui |
| Specbox (charge, eau, tours, condition, formule)                                                                 | —                                                     | ABSENT    |                                                                   |
| Table norme 2 éprouvettes M / m                                                                                  | Table identique                                       | PRÉSENT   |                                                                   |
| Colonne « Coefficient » calculée par éprouvette                                                                  | —                                                     | MASQUÉ-§8 | Non whitelistée ; affichée par le client                          |
| Champs charge billes / volume d'eau / nombre de tours (auto-remplis par classe)                                  | —                                                     | ABSENT    | Contrat les accepte                                               |
| Details « Conformité granulaire » (mde_ti readonly + mde_pi + alerte ✓/✗)                                        | —                                                     | ABSENT    | Contrat accepte mde_pi/mde_ti                                     |
| Details « Tableau C.1 — classes granulaires alternatives » (table statique 6 lignes)                             | —                                                     | ABSENT    | Contenu informatif normatif                                       |
| Resbox MDE / readout (MDE, MDS ou MDE_RB, arrondi entier)                                                        | Row « Micro-Deval MDE »                               | PRÉSENT   | Libellé dynamique MDS/MDE_RB non repris                           |
| Table CAFEC 4 essais (classe/charge/rotations/A/B)                                                               | Table identique (ids 0-3, affichage 1-4)              | PRÉSENT   | Orientation lignes/colonnes inversée                              |
| Ligne « Perte (A−B)/A ×100 » calculée par essai                                                                  | —                                                     | MASQUÉ-§8 | Non whitelistée ; affichée par le client                          |
| Resbox CAFEC : **CMDS / CMDE / CMD**                                                                             | Seule CMDE ressort (= `mde`)                          | MASQUÉ-§8 | CMDS et CMD affichés par le client ; absents de la whitelist      |

### 3.u Masse volumique & absorption (3)

| Élément client                       | Chez nous                    | Statut    | Détail                                                       |
| ------------------------------------ | ---------------------------- | --------- | ------------------------------------------------------------ |
| 5 champs M₁–M₄ + ρw (défaut 0,998)   | Identiques (défaut appliqué) | PRÉSENT   |                                                              |
| Readout WA24                         | Row « WA24 »                 | PRÉSENT   |                                                              |
| Readouts **ρa / ρrd / ρssd** (Mg/m³) | —                            | MASQUÉ-§8 | Affichés par le client ; absents de la whitelist (`wa` seul) |

### 3.v Sulfates (4)

| Élément client                                                                             | Chez nous                          | Statut    | Détail                                 |
| ------------------------------------------------------------------------------------------ | ---------------------------------- | --------- | -------------------------------------- |
| Champs BaSO₄ / prise / facteur (défaut 0,343)                                              | Identiques                         | PRÉSENT   |                                        |
| Select type : « Solubles acide (AS) » **en 1re position (défaut)** / « Solubles eau (SS) » | Options inversées, **défaut = SS** | PARTIEL   | Défaut divergent du client             |
| Readout SO₃                                                                                | Row « SO₃ »                        | PRÉSENT   |                                        |
| Readout **SO₄ (= SO₃ × 1,2)**                                                              | —                                  | MASQUÉ-§8 | Affiché par le client ; non whitelisté |

### 3.w Classification GTR (7)

| Élément client                                                                  | Chez nous                                                                                              | Statut  | Détail                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pills état hydrique (Auto/ts/s/m/h/th) **dans l'onglet Classification**         | Boutons identiques **dans l'onglet Proctor**                                                           | PARTIEL | Fonctionnel ✓, emplacement ≠                                                                                                                                               |
| Verdict : classbadge (ex. « A2 h ») + « Famille X — code » + description + état | Badge + description                                                                                    | PRÉSENT | Style ≠ (badge noir/jaune client) ; « Famille X — code » et ligne « État hydrique : x » non détaillés                                                                      |
| Description normative de sous-classe                                            | Row « Description » (allowlist statique des 15 libellés NF P 11-300)                                   | PRÉSENT |                                                                                                                                                                            |
| Pathbox « Chemin de décision »                                                  | « Cheminement de classement » (ol)                                                                     | PRÉSENT | Garde-fou : `safeLaboPath` (adapters.ts) écarte tout libellé hors gabarit — OK aujourd'hui (tous les gabarits client couverts), à re-vérifier à chaque évolution du moteur |
| Alerte warn « Points à vérifier »                                               | Encart « Points à vérifier » (verbatim, y compris C1/C2)                                               | PRÉSENT | Décision « zéro écart » 14/07 appliquée                                                                                                                                    |
| Alerte info « Assistant famille R (rocheux) »                                   | Encart identique                                                                                       | PRÉSENT | Sous-note « Classement R complet… à finaliser » à vérifier                                                                                                                 |
| Fiche de synthèse (recap 33 lignes)                                             | Table « Paramètres d'identification » (~35 lignes, mêmes grandeurs + Cu/Cc/ρd app./φ′R/Nature ligne A) | PRÉSENT | Ordre proche de l'outil ; « I.CBR à 95 % OPM » libellé « Indice CBR » sans la cible                                                                                        |

### 3.x Seuils (2) · 3.z Échantillons enregistrés (3) · Workflows (4)

| Élément client                                                                                                           | Chez nous                                                                      | Statut  | Détail                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Onglet « Seuils » : 13 seuils GTR éditables + reset                                                                      | —                                                                              | ABSENT  | Le contrat accepte `cfg` (tous les seuils) ; aucune UI — un BE ne peut pas caler ses seuils GTR                                                                                        |
| Checkbox « Router insensibles vers famille D » (routeD)                                                                  | —                                                                              | ABSENT  |                                                                                                                                                                                        |
| Onglet « Enregistrés » : liste échantillons (badge classe, réf, chantier, date) + Ouvrir/Suppr                           | —                                                                              | ABSENT  | La persistance projet/PV ne remplace pas la bibliothèque d'échantillons rechargeables                                                                                                  |
| Export `.json` (DB + seuils)                                                                                             | —                                                                              | ABSENT  |                                                                                                                                                                                        |
| Import `.json`                                                                                                           | —                                                                              | ABSENT  |                                                                                                                                                                                        |
| **Recalcul LIVE à chaque saisie** (colonnes, chips, alertes, canvas)                                                     | Calcul serveur sur clic « Classer → » ; résultat invalidé à toute modification | ABSENT  | Écart de paradigme n° 1 ; noter que TOUTES les valeurs concernées sont client-safe (module labo) — un affichage live côté client ou un renvoi par ligne côté serveur est §8-compatible |
| printPV : feuilles renseignées seules + en-tête labo (nom labo / banner / norme / client / méta) + bloc visa par feuille | PV scellé serveur                                                              | PARTIEL | Divergence positive (scellement) ; la composition du PV (périmètre, en-têtes par feuille, visa) est à auditer côté `pv-pdf.ts` — hors périmètre front ici                              |
| Toasts de confirmation                                                                                                   | —                                                                              | ABSENT  |                                                                                                                                                                                        |
| Footer disclaimer « à valider par un géotechnicien »                                                                     | —                                                                              | ABSENT  |                                                                                                                                                                                        |

## 4. Synthèse chiffrée et classement

### 4.a Comptage (157 éléments client inventoriés)

| Statut                                                                          | Nombre | Part     |
| ------------------------------------------------------------------------------- | ------ | -------- |
| **PRÉSENT**                                                                     | 55     | **35 %** |
| **PARTIEL**                                                                     | 31     | **20 %** |
| **MASQUÉ-§8** (valeur affichée par le client, non whitelistée → écart ADR 0014) | 26     | **17 %** |
| **ABSENT**                                                                      | 45     | **29 %** |

Lecture honnête : **35 % de l'interface client est fidèlement restituée** ; 20 % existe
mais diverge (lignes manquantes, libellés faux, défauts absents) ; **46 % manque
totalement à l'écran** (ABSENT + MASQUÉ-§8). Aucune exception « radier 48×48 » ne
s'applique ici : le module labo est intégralement client-safe, donc **tous** les
MASQUÉ-§8 sont des trous de whitelist/`shapeOutput` à combler, pas des choix défendables.

### 4.b Classement des écarts

**MAJEURS (paradigme / données perdues / information fausse)**

1. **Aucun recalcul live ni valeur par ligne** : toutes les colonnes calculées
   (w %, passant cumulé, ρd, CBR/compacité, σ′v/τ, H_f/ε_v/e, coefficients, pertes),
   tous les chips par feuille et toutes les alertes de conformité normative
   (Casagrande §6.1, V≤10, concordance ρs, énergie Proctor, conformité granulaire
   LA/MDE) n'existent nulle part — `shapeOutput` fige de surcroît `warnings: []`.
2. **8 graphiques sur 8 absents** (granulo, liquidité, plasticité/ligne A, Proctor,
   poinçonnement CBR, CBR/compacité, œdomètre, Coulomb).
3. **CBR amputé** : 2 enfoncements sur 10, `cb_wimm` absent, pied CBR 2,5/5/maxi/
   compacité absent, ρd du CBR absent — la feuille CBR du client n'est pas
   reproductible.
4. **Onglets Seuils et Enregistrés absents** + boutons d'en-tête (Nouvel essai /
   Exemple / Enregistrer / import-export JSON) — le paramétrage GTR (`cfg`, pourtant
   accepté par le contrat) et la bibliothèque d'échantillons sont inaccessibles.
5. **Libellés factuellement FAUX** : VBS « Fraction 0/2 » (≠ 0/5 dans 0/D),
   LA « Passant initial (%) »/« Passant après (%) » (≠ Tamis intermédiaire mm / %
   passant mesuré), variantes LA/MDE « Roches dures »/« Roches »/« Alt. »
   (≠ Ballast 31,5/50 — LARB/MDE_RB, Annexe B/C).

**MOYENS (champs et capacités manquants, structure)** 6. Champs de saisie absents (tous acceptés par le contrat) : `gr_fond`, `v_manual`,
`oe_e0`, `pr_d`/`pr_hh`, `la_nb`, `la_charge`, `mde_class`, `mde_charge`,
`mde_eau`, `mde_tours`, `mde_ti`/`mde_pi`, `m_obs`, `cb_wimm`. 7. Lignes de tables manquantes : LL 4/5 points, Proctor 5 (ext. 7)/7, œdo 9/12,
ρs 2/3 déterminations. 8. Valeurs affichées par le client hors whitelist (à ajouter à `LaboOutputSchema` +
`shapeOutput` + `buildLaboRows`) : c′R, R², SO₄, ρa/ρrd/ρssd, CMDS/CMD, c_u (UCS),
ρd/Hs (œdo), ρd du CBR, k (m/s), pente/validité w_L. 9. Navigation : fusions (eau+granulo, ρs+ρ apparente), ordre modifié, groupes et
pastilles de progression absents ; état hydrique déplacé dans Proctor. 10. Specbox normatifs (LL, Proctor+énergie, LA, MDE, cisaillement, ρ apparente) et
details (Tableau C.1, conformités granulaires) absents ; défauts non pré-remplis
(C=10, réf. 13,35/20, cible 95, K=1, T=20) ; défaut sulfates inversé (SS vs AS).

**FAIBLES (cosmétique / micro-libellés)** 11. Libellés d'identification raccourcis, dates en texte libre, placeholders absents,
tags de norme partiels, ES « floculat/sédiment » vs « total/sable », toasts,
footer disclaimer, sous-titre d'en-tête, style du badge de classe.

### 4.c Les 5 écarts les plus visibles pour un utilisateur du client

1. **Il saisit et… rien ne se passe** : pas de recalcul live — aucune colonne w/ρd/
   CBR/e ne se remplit, aucun chip, aucune alerte de norme ; il faut cliquer
   « Classer → » et changer d'onglet pour voir des agrégats.
2. **Plus aucun graphique** : courbe granulométrique, courbe Proctor, diagramme de
   plasticité, poinçonnement CBR, courbe œdométrique, droites de Coulomb — tout a
   disparu (8/8).
3. **Sa feuille CBR ne rentre pas** : 10 enfoncements chez lui, 2 chez nous ; pas de
   w après immersion ; pas de CBR par moule ni de compacité en pied de table.
4. **Ses outils de travail quotidiens manquent** : Exemple fictif, Enregistrer /
   rouvrir un échantillon, export/import JSON, seuils GTR ajustables — plus les
   valeurs de contrôle (validité Atterberg, concordance ρs, conformité granulaire).
5. **Des libellés qui contredisent sa pratique** : « Fraction 0/2 » en VBS,
   « Passant initial (%) » pour un diamètre de tamis en LA, « Roches dures » pour la
   variante ballast — un laborantin saisit faux ou ne s'y retrouve pas.

## Recommandation

Le gros de la **saisie** existe : l'effort de correction est concentré sur
(1) restituer les **valeurs par ligne + contrôles normatifs** (élargir
`LaboOutputSchema`/`shapeOutput` — tout est déjà client-safe — ou assumer un calcul
d'affichage côté client pour les colonnes arithmétiques simples, décision titulaire),
(2) les **8 graphiques**, (3) compléter **CBR** et les champs manquants, (4) les
onglets **Seuils/Enregistrés**, (5) corriger les **libellés faux** (quick win,
< 1 h). Les points 3-5 sont réalisables sans toucher au moteur ; le point 1 exige un
avenant de contrat de sortie (aucun enjeu de confidentialité d'après l'en-tête du
module labo lui-même).
