# Runbook de démonstration ROADSEN

**Durée cible :** 15-20 minutes  
**Prérequis :** avoir lu `fiche-acces.md` ; navigateur ouvert en fenêtre privée/propre ;
connexion Internet stable.

---

## Préparation (avant la séance — 5 min)

1. Ouvrir https://roadsen.vercel.app dans un onglet vierge (fenêtre privée recommandée
   pour éviter les sessions résiduelles).
2. Vérifier que la page de connexion s'affiche sans erreur.
3. Avoir sous la main `fiche-acces.md` pour les identifiants.
4. Désactiver les extensions de blocage sur `roadsen.vercel.app`.
5. **Ne pas ouvrir le PDF du PV à l'avance** (voir incohérence de verdict, étape 6).

---

## Séquence de démonstration

### Étape 1 — Connexion (1 min)

**URL :** https://roadsen.vercel.app

**Actions :**

- Saisir `demo@starfire.test` et `RoadsenDemo2026!`, valider.
- L'application redirige vers le tableau de bord de l'organisation « Demo Starfire ».

**Ce qu'on montre / ce que ça prouve :**
La plateforme dispose d'une authentification JWT (identité vérifiée côté serveur).
L'accès est lié à une organisation — toute la navigation qui suit opère dans le
périmètre de cet unique tenant. Un utilisateur d'une autre organisation ne verrait
rien de cet espace.

**Plan B :** Si la page de connexion ne répond pas (Render cold start, ~15 s), patienter
et recharger. Si le cold start dépasse 30 s, passer à la diapositive de contexte et
reprendre l'étape en arrière-plan.

---

### Étape 2 — Tableau de bord et sélecteur d'organisation (1 min)

**Actions :**

- Observer le nom d'organisation affiché en haut (« Demo Starfire »).
- Ouvrir le sélecteur d'organisation (menu utilisateur ou widget dédié).

**Ce qu'on montre / ce que ça prouve :**
La notion de tenant est visible dans l'interface. Un même utilisateur pourrait appartenir
à plusieurs organisations (cas d'un bureau d'études avec plusieurs entités) — la donnée
de chaque organisation reste strictement cloisonnée côté serveur (Postgres RLS).

**Plan B :** Si le sélecteur ne s'affiche pas, poursuivre — ce n'est pas un écran bloquant
pour la suite.

---

### Étape 3 — Liste des projets (1 min)

**Actions :**

- Naviguer vers la liste des projets (menu latéral ou lien du tableau de bord).
- Constater la présence du projet « Projet Demo - Chaussee RN1 ».
- Ouvrir la modale de création de projet (bouton « Nouveau projet » ou équivalent),
  montrer les champs, **sans créer** (pour ne pas perturber la démo).

**Ce qu'on montre / ce que ça prouve :**
La gestion de projets est fonctionnelle en self-service pour le client. Un bureau
d'études crée et organise ses projets de manière autonome, dans les limites de son
abonnement.

**Plan B :** Si la liste est vide (session corrompue), se déconnecter/reconnecter.
Si la modale ne s'ouvre pas, noter l'anomalie et passer à l'étape suivante.

---

### Étape 4 — Détail d'un calcul et résultats (4 min)

**Actions :**

- Ouvrir « Projet Demo - Chaussee RN1 ».
- Aller sur l'onglet « Calculs ».
- Ouvrir le calcul de chaussée existant.
- Parcourir : verdict (NON CONFORME — échec en fatigue), tableau de résultats
  (trafic cumulé NE, épaisseurs de couches, déformations sollicitantes vs admissibles
  selon critère AGEROUTE/LCPC).

**Ce qu'on montre / ce que ça prouve :**

- Le moteur Burmister/AGEROUTE s'exécute **côté serveur** — les formules ne transitent
  jamais vers le navigateur. Ce point est architectural et non négociable (ADR 0002,
  DEV-RDS-001) : la confidentialité du moteur est garantie par conception, pas par
  obfuscation.
- Le verdict est réel, pas une simulation : il reflète les paramètres saisis et les
  critères de l'AGEROUTE 2015 intégrés dans le moteur fourni par STARFIRE.
- STARFIRE est le validateur de la science ; le prestataire livre l'intégration.

**Phrase-clé à prononcer :**
« Le calcul que vous voyez ici a été effectué sur nos serveurs Render. Le navigateur
n'a reçu que les résultats mis en forme — jamais le code de calcul. »

**Plan B :** Si l'onglet Calculs est vide, vérifier que l'on est bien dans « Projet Demo -
Chaussee RN1 ». Si le détail du calcul ne charge pas, montrer la liste des calculs et
décrire verbalement les résultats depuis la `fiche-acces.md`.

---

### Étape 5 — PV scellé (4 min)

**Actions :**

- Depuis le même projet, aller sur l'onglet « PV & Livrables ».
- Montrer le PV cohérent : numéro `PV-RDS-demo-starfire-2026-000002` (verdict NON CONFORME).
  Ne PAS ouvrir le PV `…-000001` (reliquat à verdict périmé, à purger — cf. limites §3).
- Télécharger le PDF (bouton de téléchargement) du `…-000002`.
- Utiliser la fonction « Vérifier l'intégrité » et montrer le résultat (sceau HMAC
  vérifié côté serveur, horodatage confirmé).

**Ce qu'on montre / ce que ça prouve :**

- Chaque PV est **scellé au moment de son émission** : identité de l'auteur,
  horodatage serveur et empreinte d'intégrité (HMAC) sont gravés. Une modification
  ultérieure du document invalide le sceau.
- La vérification d'intégrité est réalisée **en ligne**, ce qui rend le sceau
  opposable à toute contestation du contenu.
- Les PV sont numérotés séquentiellement et régénérables (un recalcul produit
  le même résultat sur les mêmes données).

**Limite à mentionner explicitement :**
« Ce sceau garantit l'intégrité du document. Il ne constitue pas une signature
électronique qualifiée au sens de la loi sénégalaise 2008-08. Le vocabulaire juste
est "scellé", pas "certifié" ni "ayant force probante". La signature qualifiée et
l'opposabilité renforcée sont prévues en Phase 2. »

**Attention — incohérence de verdict du PV de démo :**
Le PV actuel a été scellé avant la validation complète du moteur. Son libellé interne
peut indiquer « non applicable » alors que le détail du calcul affiche « NON CONFORME ».
Deux options :

- (a) Ne pas ouvrir le PDF et expliquer oralement : « Ce PV sera régénéré pour refléter
  le verdict correct avant la livraison. »
- (b) Ouvrir le PDF et expliquer directement : « Vous voyez un écart de libellé ; c'est
  un artefact du PV de démo scellé avant la validation du moteur. Le mécanisme de
  scellement lui-même est correct — la régénération produira un PV cohérent. »

**Plan B :** Si le téléchargement échoue, montrer la liste des PV et la fonction de
vérification d'intégrité à l'écran sans télécharger. Si la vérification d'intégrité
échoue, noter l'anomalie — c'est un point de recette à traiter, pas à dissimuler.

---

### Étape 6 — Bibliothèque de moteurs (2 min)

**Actions :**

- Naviguer vers la bibliothèque de moteurs (menu latéral ou lien dédié).
- Montrer les 6 moteurs listés (Chaussées, Radier/plaque, Fondation superficielle,
  Pressiomètre Ménard, Pieux, Essais labo/GTR).
- Observer les états : moteur Chaussées = accessible (inclus dans le pack actif) ;
  autres moteurs = grisés / verrouillés (hors pack actuel ou affichage en cours
  d'activation).

**Ce qu'on montre / ce que ça prouve :**

- La plateforme reconnaît les 6 moteurs de la suite GeoSuite fournie par STARFIRE.
- L'accès est contrôlé par pack d'abonnement (logique d'entitlements) : un bureau
  d'études ne peut pas utiliser un moteur qu'il n'a pas souscrit. Le blocage est
  serveur (pas seulement UI) — un appel API direct sur un moteur hors pack reçoit
  un 403.
- Les packs disponibles sont : Pack Routes (chaussées + pressiomètre), Pack Fondations
  (superficielle + profonde + labo), Plateforme complète (les 6 moteurs).

**Limite à mentionner :**
« Les moteurs fondations et labo effectuent bien leurs calculs côté serveur. En revanche,
l'affichage des résultats pour ces moteurs n'est pas encore activé — par mesure de
précaution (politique fail-closed : on préfère ne rien afficher plutôt que de risquer
d'exposer une information confidentielle). L'activation se fait module par module,
après validation. C'est l'objet des prochaines livraisons. »

**Plan B :** Si la bibliothèque ne charge pas, décrire verbalement la logique de packs
et montrer un screenshot préparé si disponible.

---

### Étape 7 — Sécurité et isolation multi-tenant (2 min)

**Actions :**

- Rester dans l'interface de l'organisation « Demo Starfire ».
- Expliquer (pas besoin d'action UI complexe) comment l'isolation fonctionne.

**Ce qu'on montre / ce que ça prouve :**

- Chaque organisation est un tenant isolé en base (Postgres Row-Level Security actif).
  Un utilisateur connecté dans l'organisation A ne peut jamais lire ni écrire les
  données de l'organisation B, même en contournant l'interface.
- Le contrôle est côté serveur : l'isolation ne repose pas sur l'interface utilisateur.
- Le devis (DEV-RDS-001) prévoit une « séparation fonctionnelle » en Phase 1 ; la
  Phase 2 apporte l'isolation durcie avec tests d'isolation automatisés exhaustifs
  et audit complet.

**Plan B :** Si la question porte sur des preuves techniques, diriger vers
`docs/security/isolation-users-orgs.md` et le threat model disponibles dans le dépôt.

---

### Étape 8 — Mon compte et aide (1 min)

**Actions :**

- Naviguer vers « Mon compte » (menu utilisateur).
- Naviguer vers la page « Aide ».
- Montrer la palette de commandes (Cmd+K sur macOS, Ctrl+K sur Windows/Linux).

**Ce qu'on montre / ce que ça prouve :**
L'ergonomie de la plateforme est complète : gestion du compte, accès contextuel à
l'aide, palette de commandes pour les utilisateurs avancés. Ce sont des fonctions
livrées et testées en Phase 1.

**Plan B :** Si la palette de commandes ne s'ouvre pas, passer sans insister — ce
n'est pas un point critique de la démo.

---

### Étape 9 — Entitlements et contrôle d'abonnement (2 min)

**Actions :**

- Depuis le sélecteur d'organisation ou la page Mon compte, montrer les informations
  d'abonnement (pack actif, modules inclus, quota et expiration si visibles).
- Tenter d'accéder à un module hors pack depuis la bibliothèque et montrer le message
  de restriction.

**Ce qu'on montre / ce que ça prouve :**

- Le contrôle d'accès par abonnement est opérationnel. Un bureau d'études ne peut
  pas utiliser un module qu'il n'a pas acheté.
- L'enforcement est serveur : même un appel API direct sans passer par l'interface
  reçoit un refus explicite (403 module hors pack, ou 402 abonnement expiré/quota
  atteint).
- STARFIRE peut proposer ses clients selon différents packs (Routes, Fondations,
  Plateforme complète) et le contrôle est automatique.

**Plan B :** Si les informations d'abonnement ne s'affichent pas, expliquer oralement
le mécanisme et renvoyer à l'ADR 0009/0011 disponibles dans le dépôt.

---

### Clôture — questions et suite (2 min)

**Points à aborder si ce n'est pas fait :**

- Les moteurs fondations/labo : intégrés, en cours d'activation de l'affichage.
- La CI GitHub est actuellement suspendue (raison administrative de facturation du
  compte, pas un défaut produit) ; un gate de qualité local est en place.
- Phase 2 : paiement PayDunya, affichage fondations/labo activé, opposabilité PV
  renforcée.

**Ne pas promettre :**

- Une date ferme pour les affichages fondations/labo sans avoir revu le planning.
- Que le PV actuel est « officiellement certifié » ou « opposable ».
- Que la CI est « opérationnelle » (elle est bloquée, même si c'est administratif).

---

## Durée récapitulative

| Étape          | Contenu                        | Durée estimée        |
| -------------- | ------------------------------ | -------------------- |
| Préparation    | Vérif environnement            | 5 min (avant séance) |
| 1              | Connexion                      | 1 min                |
| 2              | Tableau de bord / organisation | 1 min                |
| 3              | Liste des projets              | 1 min                |
| 4              | Détail calcul + résultats      | 4 min                |
| 5              | PV scellé                      | 4 min                |
| 6              | Bibliothèque de moteurs        | 2 min                |
| 7              | Sécurité / isolation           | 2 min                |
| 8              | Mon compte / Aide / palette    | 1 min                |
| 9              | Entitlements / abonnement      | 2 min                |
| Clôture        | Questions + suite              | 2 min                |
| **Total démo** |                                | **~20 min**          |
