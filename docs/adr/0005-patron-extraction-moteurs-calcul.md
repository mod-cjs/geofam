# ADR 0005 — Patron d'extraction des moteurs de calcul

- Statut : accepte
- Date : 2026-06-24

## Contexte

Les moteurs de calcul (chaussees, fondations superficielles, pieux, pressiometre...)
sont fournis par le client (STARFIRE) sous forme de fichiers HTML mono-fichier. Chaque
fichier melange l'interface utilisateur (DOM, formulaires, affichage) et la logique de
calcul pure. Le portage vers la plateforme SaaS requiert d'extraire et d'isoler la
logique de calcul, sans la modifier, et de l'executer exclusivement cote serveur
(cf. ADR 0002 et 0003).

La question est : quel patron d'extraction adopter, quelles contraintes imposer, et
comment en prouver la conformite ?

## Decision

### 1. Extraction HTML mono-fichier vers module TS pur et deterministe

Le bloc de calcul est extrait du HTML source (lignes marquees `ENGINE` dans les
fichiers d'origine) et transcrit fidelement en TypeScript dans un module autonome.

**Regles de portage :**

- Transcription **fidele** : aucune reformulation de la science, aucune reorganisation
  des sommations (ordre des couches, moyennes geometriques/harmoniques, tris) — le
  comportement numerique est preserve bit a bit.
- **Suppression du couplage DOM** uniquement : les references a `document`, `window`,
  `fetch`, a l'horloge (`Date`, `performance.now`) et au hasard (`Math.random`) sont
  retirees. Rien d'autre n'est touche.
- **Zéro DOM, zéro Date, zéro random** : le module ne peut pas avoir d'effet de bord
  externe. Un `grep` et un test de determinisme le verifient.
- **`for..in` interdit** sur les tableaux : boucle `for` indexee conservee telle
  qu'elle est dans l'original.
- Le typage strict (Input/Output, pas d'`any`) vit a la **frontiere** (`contract.ts`
  et `index.ts`). Le corps du moteur conserve `/* eslint-disable */ // @ts-nocheck`
  pour ne pas moderniser involontairement la science.

### 2. Calcul confidentiel cote serveur uniquement (DoD §8)

Le module n'est importe que par `apps/api`. Il ne transite jamais dans le bundle
navigateur. Deux barrieres independantes le garantissent :

- **Barriere 1** : regle ESLint `no-restricted-imports` dans `apps/web/eslint.config.mjs`
  (flat config ESLint 9) ; echec CI si un import `@roadsen/engines` ou un import direct
  de fichier moteur est detecte dans le front. Un test negatif CI valide que la regle
  est active et qu'un import moteur la declenche.
- **Barriere 2** : controle de bundle CI grep-pant le specifier `@roadsen/engines` ET la
  chaine litterale `__ROADSEN_ENGINE_CONFIDENTIAL_DO_NOT_SHIP__` dans
  `apps/web/.next/static/`. Ce marqueur est embarque comme constante dans chaque module
  moteur (`ENGINE_BUNDLE_MARKER`) ; un nom de symbole est minifie, pas une chaine
  litterale — le marqueur resiste au bundler.

### 3. Sortie en whitelist stricte — aucun intermediaire confidentiel

Le moteur produit, en interne, un objet riche portant des intermediaires confidentiels
(coefficients de calage, facteurs de portance partiels, contraintes brutes par couche,
courbes corrigees, etc.). Exposer cet objet reviendrait a publier la methode par ses
intermediaires.

La sortie client est construite champ par champ dans `index.ts` (`shapeOutput`), en
ne reprenant que les **grandeurs de resultat** destinees a l'affichage et au PV :
taux de travail, verifications par cas de charge, resistances caracteristiques, etc.

Cette construction manuelle est suivie d'un **double strip** :

1. `shapeOutput` construit l'objet propre (selection explicite des champs).
2. `projectEngineOutput(OutputSchema, shaped)` re-parse l'objet a travers le schema
   Zod declare et **strippe** tout champ qui aurait survecu — defense en profondeur.

Le garde-fou `assertWhitelistSafe` (execute a la definition du contrat) rejette tout
schema contenant un conteneur ouvert (`z.record`, `z.any`, `.passthrough()`,
`.catchall()` non `ZodNever`) : fail-closed, leve a la definition, jamais en production.

### 4. Redaction des canaux texte libre (warnings)

La whitelist protege les cles structurees. Mais les `warnings[]` sont du texte libre :
le moteur peut y interpoler des valeurs d'intermediaires confidentiels (ex. valeur de
`ple*`, `qce`). La fonction `redactConfidentialWarnings` (dans `index.ts`) remplace
systematiquement les occurrences `<etiquette_confidentielle> = <valeur>` par
`<etiquette> (valeur confidentielle masquee)`, avant toute exposition. Le sens normatif
du warning (etiquette, seuil constant NF, citation) est preserve.

### 5. Equivalence-portage prouvee (module vs HTML d'origine)

L'equivalence numerique est verifiee par un harnais jsdom (`engine.equivalence.test.ts`)
qui execute le HTML d'origine dans un environnement DOM simule et compare sa sortie
a celle du module, cas par cas, avec une tolerance relative de 1e-9.

Aucun cas-test ne constitue une donnee de validation scientifique : ils prouvent
uniquement que le portage TS reproduit fidelement le HTML. La **justesse scientifique**
(conformite aux normes : NF P 94-261, NF P 94-262, AGEROUTE 2015, etc.) reste **non
validee** tant que le kit cas-tests STARFIRE (#36) n'est pas fourni et rejoue.
Les sorties sont taguees `@science-unsigned`. **MJ-6 : pas de mise en production
sans conformite cas-tests.**

### 6. Registre de versions et empreinte sha256

Chaque module est reference dans `packages/engines/src/registry/` avec sa version
(semver) et l'empreinte SHA-256 du fichier HTML source fige dont il est extrait.
Cette empreinte est incluse dans les metadonnees de chaque reponse API
(`EngineResultMeta.engineSourceHash`), ce qui permet de re-verifier un PV ulterieur
contre la version source exacte ayant produit le calcul, meme si le moteur a
depuis evolue.

### Structure type d'un module extrait

```
packages/engines/src/<moteur>/
  contract.ts          — schemas Zod bornes (input + output whitelist) + defineEngineContract
  engine.ts            — transcription fidele du bloc ENGINE (eslint-disable / @ts-nocheck)
  index.ts             — shapeOutput + redaction + projectEngineOutput + runXxx()
  test-fixtures.ts     — jeux d'entrees canoniques (pas de sorties figees)
  contract.test.ts     — anti-passthrough : assertWhitelistSafe passe, schemas fermes
  engine.determinism.test.ts — deux appels meme entree => sortie identique
  engine.equivalence.test.ts — module == HTML jsdom, tolerance rel 1e-9
  equivalence-harness.ts     — utilitaire de chargement du HTML d'origine
  warnings-leak.test.ts      — test negatif : aucune valeur de ple*/qce dans warnings[]
```

## Alternatives ecartees

**Execution du HTML d'origine via jsdom en production** : simple techniquement, mais
le HTML embarque le rendu DOM et des dependances navigateur ; l'execution en Node
via jsdom est fragile, difficile a tester et introduit un couplage fort a la structure
HTML d'origine. Ecarte.

**Recrire le moteur en TypeScript propre** : risque de divergence scientifique. La
plateforme n'a pas mandat de refaire la science. Ecarte.

**Transcompiler le HTML via un outil automatique** : les outils de conversion
automatique introduisent des refactorisations silencieuses (renommages, restructurations
de boucles) qui peuvent alterer le comportement numerique. Ecarte.

## Consequences

- **Positive** : confidentialite garantie par double barriere technique testee (ESLint
  - bundle CI) — independante de la vigilance des developpeurs.
- **Positive** : determinisme prouve ; le recalcul serveur d'un PV est reproductible
  a l'identique.
- **Positive** : le portage fideле preserves la science validee par l'expert client
  (STARFIRE) sans risque de divergence.
- **Negative** : le corps du moteur en `@ts-nocheck` est opaque au compilateur ;
  les erreurs de science ne seraient pas detectees par TypeScript. La frontiere
  typee (`contract.ts` / `index.ts`) et les tests d'equivalence compensent partiellement.
- **Risque residuel** : la redaction des warnings par expressions regulieres textuelles
  est robuste aux formes connues mais ne couvre pas une formulation future inconnue.
  Toute evolution de moteur doit inclure un audit des nouveaux warnings (test
  `warnings-leak.test.ts`).
- **Contrainte** : la justesse scientifique n'est **pas** prouvee par ce patron ; elle
  l'est par le kit cas-tests STARFIRE (#36), pre-requis de mise en production (MJ-6).
