# ADR 0012 — Émission d'un PV sur verdict NON CONFORME

- Statut : accepte (sous reserve validation wording fiscal-juridique + revue qa-challenger)
- Date : 2026-06-27

## Contexte

Un calcul peut conclure CONFORME ou NON CONFORME (la structure projetee ne satisfait pas les
criteres de dimensionnement). Question (F-08) : un PV scelle peut-il/doit-il etre emis sur un
verdict NON CONFORME ? La revue adverse du frontend a aussi releve que la demo mock ne produisait
jamais de NON CONFORME (#1). Reco `expert-genie-civil` : autoriser, durci.

## Decision

**Autoriser l'emission d'un PV portant NON CONFORME (option b durcie), pas la bloquer.** Un PV /
note de calcul documente un RESULTAT (y compris un echec de verification : il justifie un
redimensionnement, trace une iteration). Le sceau atteste l'integrite et l'origine du calcul, PAS
la conformite de l'ouvrage. Bloquer serait contre-productif (perte de trace, equivalence trompeuse
« PV scelle = valide », contournements). Dupliquer en deux types de documents (option c) ajoute du
risque. **Denomination « PV » conservee** (decision titulaire).

**Garde-fous (conditions non negociables de l'autorisation) :**

1. **Verdict = champ de premier niveau, dans le perimetre du sceau HMAC.** On ne peut pas alterer
   le statut sans casser le sceau. **Aucun PV sans verdict explicite (fail-closed).**
2. **Marquage NON CONFORME inratable** : bandeau + filigrane par page, survit au N&B / PDF.
3. **Mention de la portee du sceau** : « atteste l'integrite et l'origine du calcul ; ne vaut ni
   validation de l'ouvrage ni conformite reglementaire ». Sur NON CONFORME : « resultat de
   verification NEGATIF, ne peut etre presente comme une validation ».
4. **Wording deja banni conserve** (« fait foi / opposable / certifie ») + bannir tout terme
   positif residuel sur NON CONFORME (« valide », « bon pour execution »).
5. **Double confirmation a l'emission** (case explicite), pas un blocage.
6. **Verification en ligne portee par le verdict** (Phase 2) : un tiers voit « authentique —
   verdict : NON CONFORME ». Rempart principal contre le detournement.

## Consequences

- **Pipeline PV (dev-backend + integrateur-moteurs + ingenieur-securite)** : le verdict entre dans
  la serialisation canonique scellee (HMAC) ; chemin fail-closed (pas d'emission sans verdict).
- **UI (modale d'emission C-02)** : bouton « Emettre un PV » reste actif sur FAIL + case de double
  confirmation ; le PV affiche le marquage NON CONFORME.
- **PV PDF** : bandeau + filigrane NON CONFORME, mention de portee.
- **A valider avant figement** : wording NON CONFORME par `fiscal-juridique` ; revue `qa-challenger` ;
  confirmation `ingenieur-securite`/`integrateur-moteurs` que le verdict est bien dans le HMAC.
- Lien : memoires `roadsen-pv-seal-legal-wording`, `roadsen-pv-seal-threat-model` ; inventaire F-08 ;
  revue frontend #1 (atteignabilite du FAIL).
