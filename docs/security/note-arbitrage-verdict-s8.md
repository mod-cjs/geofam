# Note d'arbitrage — sécurité verdict & §8 (à valider STARFIRE + expert-génie-civil)

> Issue de la **revue adverse qa-challenger** (05/07/2026) sur tout le projet GEOFAM.
> Les correctifs de sécurité ci-dessous ont été **implémentés** (fail-closed, défendable),
> mais certains **touchent la science / la sémantique d'un verdict** signé par le client.
> Conformément au split contractuel (**client = science, nous = software**), ces points
> demandent une **validation formelle STARFIRE + expert** (avenant / signature).

## Contexte
L'audit a montré que plusieurs moteurs acceptaient des **paramètres client** qui
pilotent un **verdict scellé dans un PV** sans contrôle suffisant → risque de **faux
PASS falsifié**. Les correctifs bornent/rejettent ces entrées. Les **plages exactes** et
la **sémantique** restent à trancher par le titulaire de la science.

---

## A. Coefficients partiels EC7 — pieux (CASAGRANDE)

- **Constat** : `coeffs` (γ_G, γ_Q, ξ, cr_*) étaient client-fournis, bornes larges
  (`k_gG` min 0). Exploit confirmé : coeffs favorables dans les bornes → pieu à 674 %
  de charge devient CONFORME.
- **Correctif implémenté** : le schéma d'entrée **REJETTE (400)** tout `coeffs` non
  strictement égal aux valeurs normatives (`PIEUX_DEFAULT_COEFFS`, NF P94-262 NA DA2).
  Conséquence : l'input scellé ne peut plus différer de celui qui a calculé.
- **⚠️ À trancher** : le HTML d'origine (validé STARFIRE) **utilise des coeffs éditables**.
  L'override serveur fait **diverger** le module du HTML pour toute entrée à coeffs non
  défaut ; l'équivalence-portage ne teste que les coeffs par défaut, donc **la divergence
  est invisible aux tests**. **Décision demandée** :
  - (a) « coeffs par projet = **gouvernés** » (le moteur les utilise + **disclosure au
    PV** des facteurs employés), OU
  - (b) « coeffs par projet = **interdits** » (posture actuelle : rejet 400).
  → dans les 2 cas, **documenter que l'équivalence est bornée aux coeffs par défaut**.

## B. Coefficients de fatigue imposables — burmister (ROADSENS)

- **Constat** : `r` (risque %), `sh` (Sh, cm), `ks` (discontinuité) imposables sans
  borne → `ks=1000` gonflait l'admissible ×1000 (faux PASS).
- **Correctif implémenté** (plages **physiques prudentes**, à confirmer) :
  - `ks ∈ [0,1 ; 1,0]` — facteur de **réduction** (`ksLCPC` ne renvoie jamais > 1).
  - `sh ∈ [0,5 ; 20]` cm — plancher pour ne pas annuler la dispersion de construction.
  - `r ∈ [0,001 ; 50]` % — au-delà non physique.
- **⚠️ À confirmer** : les **plages exactes LCPC/AGEROUTE** (notamment plancher `sh`,
  borne haute `r`, éventuel plafond `kc`). Décision **expert**.

## C. Autres pilotes du verdict — pieux

- **Constat** : `o_nprofil` (jusqu'à 10 000), `o_surf`, `o_redis`, `essais='oui'`
  pilotent les facteurs de corrélation ξ qui **divisent** la résistance (plus de profils
  déclarés → résistance max → taux min). Non gouvernés par le correctif coeffs.
- **⚠️ Décision demandée** : soit **tracer au PV** ces choix (disclosure : « N profils
  déclarés = X, essais = oui »), soit **borner** `o_nprofil` à une valeur physique, soit
  exiger une **pièce justificative**. Décision **expert + titulaire**.

## D. Périmètre §8 — extraction de modèle (model-extraction)

- **Constat** : deux surfaces permettent, par **requêtes répétées**, d'inférer des
  éléments protégés :
  1. **burmister** : l'admissible de fatigue exposé (`epsilonT_adm`) + le trafic NE
     librement saisi → régression log-log ⇒ **pente `b` et `ε₆`** (coefficients de calage
     que §8 déclare confidentiels).
  2. **radier** : la cartographie (heatmap) — atténué (lissage/masque désormais
     **invariants au maillage**), mais le champ 48×48 reste dérivé du calcul EF.
- **⚠️ Décision de périmètre §8 (à signer)** : accepte-t-on cette exposition (les
  intermédiaires publics sont un **choix produit** « détails transparents » validé
  antérieurement) ? Si non : arrondir/quantifier l'admissible, et/ou **brider le débit
  de calcul par tenant** (anti model-extraction). Décision **expert + titulaire**.

## E. Redaction des warnings (dette connue)

- burmister / terzaghi / pressiometre restent en **blacklist fail-open** (vs allowlist
  fail-closed sur pieux/radier). Un warning porteur d'une valeur confidentielle non
  prévue survivrait et serait **scellé** (non rendu au navigateur, mais persisté).
- **Action** (software, en cours) : backport du patron allowlist. Pas de décision science.

---

## Récapitulatif — ce qui attend une signature
| # | Point | Qui décide | Statut correctif |
|---|---|---|---|
| A | Coeffs pieux : gouvernés (disclosure) vs interdits | STARFIRE + expert | rejet 400 (posture prudente) |
| B | Plages exactes r/sh/ks burmister | expert | bornes physiques prudentes posées |
| C | Pilotes verdict pieux (o_nprofil…) | expert + titulaire | non borné (à décider) |
| D | Périmètre §8 model-extraction | expert + titulaire | atténué (heatmap invariante) |
| E | Redaction fail-closed 3 moteurs | software (nous) | en cours (pas de décision science) |

> Tant que A–D ne sont pas signés, les correctifs **prudents fail-closed** restent en
> place (ils ne dégradent aucun résultat normatif légitime ; ils bloquent la falsification).

---

## Passe de VÉRIFICATION adverse (05/07) — résidus & décisions restantes

Une 2ᵉ passe qa-challenger a **vérifié** les correctifs. Elle a confirmé pieux-sceau et
les portes CI, et **trouvé 2 nouvelles failles HAUTE** (corrigées + testées : burmister
**faux PASS via trafic nul NE=0** ; radier **heatmap encore inférable au maillage**), plus
le test manquant du re-exec PV (ajouté). Restent ces points **non bloquants** :

- **F. Canal warnings — fail-closed de CANAL (MOYENNE, §8).** `burmister` écarte tout
  warning non reconnu (drop total) ; `terzaghi`/`pressiometre`/`pieux` font *redact-and-pass*
  (ils masquent `label = nombre` mais laissent passer le reste du texte). Une valeur
  confidentielle formulée **sans `=`** (« q_ce vaut 1,23 ») traverserait. Atténué (moteurs
  figés, format `=` connu). **Décision :** aligner les 3 sur le drop-total type burmister,
  OU acter le *redact-and-pass* comme résidu tracé. → titulaire (zone §8).
- **G. Disclosure ks/sh au PV (MOYENNE, auditabilité vs §8).** Un `ks`/`sh` **imposé**
  borné-mais-agressif (ks=1, sh=0,5, r=50) maximise l'admissible sans laisser de trace au
  PV. Disclosure souhaitable, MAIS le `ks` **auto-calculé** est un calage confidentiel :
  ne divulguer que la **valeur imposée** (choix ingénieur) + le **mode** (auto/manuel),
  jamais la valeur auto. → confirmer que la valeur imposée n'est pas §8-sensible (expert).
- **H. Re-exec PV — résidu de portée (FAIBLE).** La re-exécution ferme la falsification
  de l'**output seul**. Un attaquant avec `UPDATE` sur `calc_results` peut réécrire
  **input + output de façon cohérente** (moteur exécuté hors-ligne) : le re-exec passe.
  Fermeture durable = sceller au calcul, ou rendre `calc_results.output` append-only. Porté
  par `ingenieur-securite`.
- **I. `r` (risque) — borne continue vs table discrète (FAIBLE).** Le schéma accepte
  r ∈ [0,001 ; 50] mais le moteur ne lit que {5,10,15,25,50} (retombe sur 10 % sinon).
  Fidèle au HTML signé. **Décision expert :** restreindre l'enum à ces 5 valeurs ?
- **Mineurs** (software, sans décision science) : test de non-collision de normalisation
  des labels bénins (esprit-mutation) ; couvrir subpaths/relatifs dans le test négatif
  ESLint ; `record FAIL` si le guardcheck ESLint n'a pas pu être écrit (pas de skip
  silencieux) ; `pressiopro` γ par défaut 19 fabriqué silencieusement (retirer) ; warning
  terzaghi « iβ = 1 » sur-rédigé (reformuler sans `= nombre`).
