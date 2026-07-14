# ADR 0014 — Whitelist des détails burmister alignée sur l'outil client (zéro écart d'affichage)

- Statut : accepté (sous réserve de confirmation formelle de STARFIRE, même formalité que l'ADR 0013)
- Date : 2026-07-13
- Décideur : titulaire (mandat donné en session)

## Contexte

L'onglet « Détails de calcul » de ROADSENS masquait, au titre du DoD §8
(« non exposé côté client »), plusieurs valeurs issues de la formule LCPC VI.4.2 du moteur
`chaussee-burmister` :

- les coefficients kθ, SN, Sh, δ, kr, kc, ks ;
- l'admissible à risque 50 % ;
- les contraintes σ_z / σ_r au sommet PSC ;
- les coefficients du matériau dimensionnant (1/b, kc, SN, kθ).

Le motif invoqué était « coefficients de calage propriétaires ». Constat du 13/07 (captures
du titulaire, comparaison directe) : le HTML client de référence — la définitive, source
scellée `v2.0.0` du moteur (cf. ADR 0013) — **affiche ces mêmes valeurs à ses utilisateurs
finaux**, dans son propre rapport de calcul. Ce ne sont donc pas des secrets d'utilisateur
final : ce qui est confidentiel, au sens du modèle de calcul serveur (ADR 0002), c'est le
**code** du moteur (implémentation, tables de matériaux, algorithme de résolution), pas ces
valeurs de sortie que l'outil client lui-même communique.

Le masquage créait un écart d'affichage entre ROADSENS et l'outil client de référence, ce qui
contrevient à la règle de fidélité d'interface du titulaire (reproduire à l'identique les
interfaces et rapports moteurs du client, rien d'omis).

## Décision

1. **Élargissement de la whitelist de sortie** du moteur `chaussee-burmister` aux champs
   suivants, émis comme intermédiaires nommés, en régime **fail-closed** (tout champ non
   listé explicitement reste bloqué) : `kθ`, `SN`, `Sh`, `δ`, `kr`, `kc`, `ks`, `1/b`,
   l'admissible à risque 50 %, `σ_z` et `σ_r` au sommet PSC.
2. **Affichage à l'identique** : l'onglet Détails de calcul de ROADSENS présente ces valeurs
   dans le même ordre, avec les mêmes libellés et commentaires que le rapport de la
   définitive.
3. **Le principe DoD §8 ne change pas** : le calcul reste exécuté exclusivement côté serveur
   (ADR 0002), aucune ligne de code moteur n'est livrée au navigateur, et la whitelist reste
   nominative et fail-closed — tout champ non explicitement autorisé demeure interdit, les
   tests de redaction (positifs et négatifs) sont maintenus et étendus aux nouveaux champs.
4. **Comportement d'interface** : la sélection d'un cas de validation déclenche le calcul et
   bascule automatiquement sur l'onglet Résultats, comme le fait l'outil client.

## Alternatives écartées

**Reprendre le HTML client directement dans le front.** Rejeté : cela livrerait le moteur
complet (code, tables, algorithme) au navigateur et détruirait le modèle de confidentialité
qui fonde le SaaS (ADR 0002). Élargir une whitelist de valeurs de sortie n'est pas équivalent
à exposer le moteur : la whitelist ne transporte que des nombres calculés côté serveur, jamais
la logique qui les produit.

**Garder le masquage et documenter l'écart au client.** Rejeté : l'écart n'apporte aucune
protection réelle (les valeurs sont déjà publiques dans le rapport de l'outil client) ; il ne
fait que dégrader la fidélité d'interface sans bénéfice de confidentialité correspondant.

## Conséquences

- **Positive** : fidélité d'affichage complète avec l'outil client de référence (zéro écart
  constaté sur l'onglet Détails de calcul).
- **Positive** : la frontière de confidentialité devient nette et documentable au client — « le
  code du moteur reste chez nous, l'affichage des résultats est identique au vôtre » — sans
  ambiguïté sur ce qui est réellement protégé.
- **Contrainte** : les suites d'équivalence (module ↔ définitive, cf. ADR 0005 §5) et les tests
  de redaction sont étendus pour couvrir les nouveaux champs whitelistés, en positif (le champ
  sort) et en négatif (aucun champ hors liste ne fuite).
- **Formalité en attente** : comme pour l'ADR 0013, cet élargissement touche la science exposée
  au client ; à confirmer formellement auprès de STARFIRE avant de considérer ce point clos
  (au-delà du mandat donné en session).
- **Renvois** : ADR 0002 (calcul serveur uniquement — principe inchangé), ADR 0013 (source
  scellée burmister définitive — c'est son rapport qui sert de référence de fidélité).
