# ADR 0013 — Source scellée du moteur burmister = référence définitive (retrait du mode historique)

- Statut : accepté (sous réserve de confirmation formelle de STARFIRE sur le retrait du mode historique)
- Date : 2026-07-13
- Décideur : titulaire (mandat donné en session)

## Contexte

Le registre des moteurs (`packages/engines/src/registry/registry.ts`) scelle, pour
`chaussee-burmister`, le SHA-256 du HTML client « moderne »
(`roadsens_burmister_LCPC_VF_moderne.html`, `259a58a8…`), version de module `1.0.0`. Ce hash
est estampillé sur chaque sortie (`meta.engineSourceHash`) et scellé dans les PV : c'est ce
qui permet de re-vérifier un PV contre la version source exacte qui l'a produit (cf. ADR 0005 §6).

Le client a depuis livré une nouvelle référence, dite « la définitive »
(`roadsens_burmister_definitive.html`, `sha256 42bb46aa5da085cd5605664ce125e361392c77fbc717f9abc4b8d5910f1546f2`,
versionnée dans `packages/engines/reference/`, vérifiée byte-identique au fichier final transmis).
La science de cette référence a été signée par STARFIRE le 03/07 (cf. mémoire
`roadsen-science-signed-decision`).

Le rebase de juillet (commits `71d10f7`→`b2e35f2`) a intégré la définitive **en opt-in**
(`load.materialsRev='definitive'` : `s6` GLc2 0,37→0,3705, BQc 0,30→0,304, ajout BC5g ;

- GNT auto, condition d'interface, risque personnalisé, NE direct, overrides fatigue). Le front
  envoie systématiquement ces flags : **100 % des calculs de production tournent en mode
  définitive**, mais sont scellés sous le hash du moderne — qui ne peut pas les reproduire.
  La traçabilité affichée par le registre est donc fausse pour tout calcul de production émis
  depuis le rebase.

Aggravant découvert à l'audit sécurité du 13/07 : `uRisk` du module est la version définitive
NON gatée (vrai quantile `invNorm`), alors que le moderne replie tout risque hors
{5, 10, 15, 25, 50} sur `u = 1,282`. Le « mode historique » du module, tel qu'il existe
aujourd'hui, n'est donc reproductible par **aucun** des deux HTML (comportement hybride,
non fourni par le client). Le golden-master ne le voyait pas : ses fixtures sont toutes en
risque auto/10.

Les PV déjà scellés restent cryptographiquement vérifiables quoi qu'il arrive : le sceau est
auto-porteur (`verifySeal` recalcule sur l'`input_canonical` stocké dans le PV, sans
ré-exécution du moteur ni consultation du registre).

## Décision

**La définitive devient la source unique de vérité du moteur `chaussee-burmister`.**

1. **Bascule du registre.** L'entrée `chaussee-burmister` référence désormais la définitive :
   `sha256 42bb46aa5da085cd5605664ce125e361392c77fbc717f9abc4b8d5910f1546f2`,
   `cheminSource packages/engines/reference/roadsens_burmister_definitive.html` (fichier
   versionné dans le dépôt → le test de cohérence hash mord partout, y compris en CI),
   `version 2.0.0` du module (majeur : recalage de science GLc2/BQc + ajout BC5g, pas
   compatible avec la sortie 1.0.0 à l'identique).
2. **Retrait du mode matériaux historique.** Le moteur calcule toujours selon la table
   définitive. Le paramètre `materialsRev` reste accepté en entrée (compatibilité de
   contrat) mais n'a plus d'effet : il n'existe plus qu'une seule table de matériaux.
3. **Golden-master reciblé.** Le golden-master navigateur
   (`tests/e2e/equivalence-burmister-golden.spec.ts`, vrai Chromium en `file://`) est rejoué
   contre le HTML `définitive` — de même que les suites d'équivalence jsdom du package
   `engines` —, avec des fixtures qui mordent réellement sur les écarts identifiés : risque
   non standard (u hors table gatée), GLc2/BQc, BC5g, `gntAuto` on/off, NE direct,
   overrides fatigue.
4. **Traitement des PV déjà émis.** Les PV scellés sous le hash `moderne` pour des calculs
   exécutés en mode définitive sont remplacés après bascule par la séquence **re-calcul puis
   émission** : on relance le calcul (nouvelle ligne `calc_results` portant la meta courante
   42bb/2.0.0), puis on émet le PV depuis cette nouvelle ligne. Une « ré-émission » depuis
   l'ancienne ligne re-scellerait l'ancien hash (la meta scellée est celle de la ligne
   stockée) — elle est donc **refusée techniquement** : une garde d'émission fail-closed
   compare la meta de source stockée à celle du recalcul courant et refuse (409, « relancez
   le calcul ») toute émission dont la source a changé depuis le calcul, **même à sortie
   numériquement identique** (revue adverse, CRITIQUE-1). Les PV déjà émis ne sont **jamais
   réécrits** : ils restent archivés, valides au sens du sceau (intégrité et origine du
   contenu scellé, cf. ADR 0012), mais leur `engineSourceHash` reste celui du moderne — un
   correctif de traçabilité, pas une falsification.

## Alternatives écartées

**Conserver le hash moderne et documenter l'écart en note.** Rejeté : cela pérennise un
registre qui ne peut reproduire aucun calcul de production réellement exécuté ; la
traçabilité promise par ADR 0005 §6 serait vidée de son sens pour ce moteur.

**Réparer le mode historique pour qu'il redevienne reproductible par un des deux HTML.**
Rejeté à ce stade : le mode historique n'est demandé par aucun besoin métier actuel (100 %
du trafic est en définitive) ; corriger un mode mort ajouterait de la surface de test sans
valeur, et retarderait la mise en cohérence urgente du registre.

## Conséquences

- **Positive** : le hash scellé dans le registre reproduit à nouveau tout calcul possible en
  production ; la promesse de traçabilité de l'ADR 0005 (§6) redevient vraie pour ce moteur.
- **Positive** : `resolveMeta` reste pure (aucune dépendance à l'entrée de registre au-delà de
  la lecture de `sha256`/`version`) ; le changement se limite au contenu du registre et au
  corps du moteur.
- **Contrainte** : gate de cohérence hash actif en CI pour `chaussee-burmister` (le fichier
  `reference/roadsens_burmister_definitive.html` versionné doit matcher le `sha256` déclaré).
- **Formalité en attente** : le retrait du mode matériaux historique est une décision produit
  qui touche la science exposée au client ; à confirmer formellement auprès de STARFIRE avant
  de considérer ce point clos (au-delà du mandat donné en session).
- **Renvois** : ADR 0002 (calcul serveur uniquement), ADR 0005 (patron d'extraction, en
  particulier §5 équivalence-portage et §6 registre/empreinte).
