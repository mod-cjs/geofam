# ADR 0004 — Socle API : conventions transverses (incrément #44)

- Statut : accepte
- Date : 2026-06-22

## Contexte

L'incrément #44 livre le squelette opérationnel de `apps/api` : routes de santé,
middleware de corrélation, filtre d'erreur global, pipe de validation, versionnage
et exposition OpenAPI. Sept décisions transverses ont été arrêtées ; elles forment
les rails sur lesquels tout module ultérieur (auth, projets, calculs, PV) viendra
se brancher. Ce document les consigne une fois pour toutes.

---

## Décision 1 — Configuration applicative centralisée (`configureApp`)

**Contexte.** L'expérience courante en NestJS consiste à configurer l'application
dans `main.ts`. Cela empêche les tests e2e de bootstrapper l'application dans un
état identique à la production (risque de divergence pipe / filtre / versionnage
entre runtime et tests).

**Décision.** Une fonction `configureApp(app: INestApplication): void` exposée par
`apps/api/src/app.config.ts` concentre l'intégralité de la configuration globale
(pipe Zod, filtre d'erreur, versionnage, OpenAPI). `main.ts` l'appelle au runtime ;
les suites e2e l'appellent à l'identique. `main.ts` ne fait plus que `listen()`.

**Conséquences.**

- Positive : parité garantie entre l'application testée et la production — un bug de
  configuration ne peut pas se cacher derrière un test qui bootstrappe différemment.
- Positive : point de modification unique pour toute évolution des middlewares globaux.
- Négative / risque résiduel : `configureApp` est une fonction impure (effets de bord
  sur `app`). Si un test modifie l'état global après l'appel (ex. remplacement d'un
  guard global), la parité est rompue localement — à surveiller au cas par cas.

---

## Décision 2 — Validation = Zod via nestjs-zod v5 ; schémas dans `@roadsen/shared`

**Contexte.** NestJS propose par défaut `class-validator` + `class-transformer`.
Ces bibliothèques requièrent des décorateurs sur des classes, sont difficilement
partageables entre front et back, et ont un historique de vulnérabilités de
prototype-pollution. Le projet utilise déjà Zod pour les contrats `@roadsen/shared`.

**Décision.**

- La validation est portée par **nestjs-zod v5** (`ZodValidationPipe` global, DTO
  via `createZodDto`). `class-validator` et `class-transformer` sont absents.
- Les schémas Zod qui décrivent les contrats d'entrée-sortie vivent dans
  `packages/shared/src/index.ts` (`@roadsen/shared`), importables par `apps/api`
  ET `apps/web` sans exposer de logique de calcul.
- L'OpenAPI est post-traité par `cleanupOpenApiDoc` (nestjs-zod v5), qui remplace
  l'ancien `patchNestJsSwagger` supprimé dans cette version majeure.

**Conséquences.**

- Positive : source unique de vérité pour les types d'entrée-sortie ; le front peut
  valider les formulaires avec les mêmes schémas que l'API sans duplication.
- Positive : les schémas Zod sont des valeurs ordinaires — plus testables, plus
  composables que les classes décorées.
- Négative / risque résiduel : nestjs-zod v5 introduit `cleanupOpenApiDoc` mais le
  support des discriminated unions et des types complexes dans le document OpenAPI
  généré reste partiel — à vérifier à chaque nouveau DTO non trivial.
- Risque résiduel : les contrôleurs existants conservent leur `@UsePipes` explicite
  par route. Le pipe global et le pipe local coexistent sans double validation
  (nestjs-zod gère la déduplication), mais tout nouveau contrôleur sans pipe
  explicite bénéficiera du pipe global — comportement à documenter dans le guide de
  contribution.

---

## Décision 3 — Format d'erreur standard `ApiErrorBody` ; anti-fuite par construction

**Contexte.** Sans filtre global unifié, chaque couche (Nest, Zod, Prisma, code
applicatif) renvoie un format différent. Les erreurs non traitées peuvent fuiter des
stacktraces, des noms de colonnes SQL ou des valeurs d'entrée vers le client.

**Décision.** `AllExceptionsFilter` (`apps/api/src/common/http-exception.filter.ts`)
est la seule porte de sortie des erreurs. Il produit systématiquement :

```
{ statusCode, error, message, details?, traceId }
```

Trois familles :

1. Erreur de validation Zod (`ZodValidationException` / `ZodError`) → 400 ;
   `details` expose uniquement `{ path, code }` par issue — jamais la valeur reçue.
2. `HttpException` Nest → statut maîtrisé ; corps assaini via `messageFrom` /
   `detailsFrom` ; même normalisation `{ path, code }` pour les `issues` éventuelles.
3. Tout le reste → 500 générique ; cause loguée côté serveur (avec stack), jamais
   renvoyée au client.

Le libellé stable par statut (`STATUS_LABELS`) est découplé des messages internes
de Nest pour résister aux évolutions de version.

**Conséquences.**

- Positive : surface de fuite nulle par construction — la normalisation est faite
  dans le filtre, indépendamment de la qualité du code applicatif amont.
- Positive : format prédictible pour le front (une seule branche de gestion d'erreur).
- Négative / risque résiduel : les erreurs 500 sont délibérément opaques côté client.
  En l'absence d'observabilité centralisée (Sentry / équivalent), corréler un
  `traceId` client à une trace serveur suppose un accès aux logs bruts — à instrumenter
  (`devops-cloud`).

---

## Décision 4 — `traceId` (`x-trace-id`) : un UUID par requête, posé avant les gardes

**Contexte.** Corréler une réponse d'erreur côté client à une trace serveur sans
exposer de détail interne requiert un identifiant de corrélation neutre. Accepter
naïvement un en-tête amont ouvre à l'injection de log (CR/LF dans l'en-tête) ou à
un abus de taille.

**Décision.** `TraceIdMiddleware` (`apps/api/src/common/trace.ts`) est appliqué très
tôt dans la chaîne (avant les gardes) pour que même un 401/403 porte un `traceId`.
Il pose `req.traceId` et l'en-tête de réponse `x-trace-id`. Un `x-trace-id` amont
n'est respecté que s'il est conforme à `^[A-Za-z0-9._-]{1,128}$` ; tout autre
valeur est ignorée et remplacée par un UUID généré.

**Conséquences.**

- Positive : corrélation bout en bout possible avec un proxy amont (reverse-proxy,
  CDN) sans risque d'injection de log ni d'abus de taille d'en-tête.
- Positive : le `traceId` est disponible dans `AllExceptionsFilter` via `req.traceId`
  avec filet de sécurité (`?? 'unknown'`) si le middleware n'a pas été exécuté.
- Négative / risque résiduel : le middleware est déclaré dans `AppModule` ; si un
  module futur court-circuite la chaîne de middlewares (ex. route déclarée hors
  `AppModule`), le `traceId` sera `'unknown'` dans les erreurs — à surveiller.

---

## Décision 5 — Versionnage d'URI `/v1/...` ; routes non versionnées conservées

**Contexte.** La plateforme sera amenée à faire évoluer ses contrats API sans casser
les clients existants (front PWA, futurs partenaires). Le versionnage par en-tête
HTTP est peu lisible ; le versionnage d'URI est le plus explicite.

**Décision.** `enableVersioning({ type: VersioningType.URI })` est activé dans
`configureApp`. Seules les routes décorées avec `@Version('n')` reçoivent le préfixe
`/v1/...`. Les routes non versionnées (santé, auth, projets, docs) restent inchangées
pendant la Phase 1.

**Conséquences.**

- Positive : coexistence des routes versionnées et non versionnées sans migration
  forcée des routes existantes.
- Positive : les clients peuvent épingler une version explicite.
- Négative / risque résiduel : l'absence de versionnage par défaut sur les nouvelles
  routes est un écueil courant — tout nouveau contrôleur doit choisir délibérément
  entre `@Version('1')` et non versionné. À documenter dans le guide de contribution.

---

## Décision 6 — Exposition OpenAPI masquée en production ; activable via `ROADSEN_EXPOSE_DOCS=1`

**Contexte.** `/docs` et `/docs-json` offrent une surface de découverte d'API anonyme
(liste des routes, schémas de requête, modèles de réponse). Exposer cela en
production sans authentification est une fuite d'information.

**Décision.** `configureApp` n'appelle `SwaggerModule.setup('docs', ...)` que si
`NODE_ENV !== 'production'` **ou** `ROADSEN_EXPOSE_DOCS === '1'`. Hors production
(développement, préprod), la doc est toujours exposée.

**Conséquences.**

- Positive : réduction de la surface d'information exposée en production sans
  supprimer l'outil en développement.
- Négative / risque résiduel : la condition repose sur `NODE_ENV`. Si une image de
  production est déployée sans `NODE_ENV=production`, `/docs` sera exposé. À
  vérifier dans le `Dockerfile` et la configuration Render (`devops-cloud`).
- Risque résiduel : `ROADSEN_EXPOSE_DOCS=1` en production expose la doc sans
  authentification. Ce levier est utile en audit/démo client, mais doit rester
  temporaire et documenté comme tel.

---

## Décision 7 — ts-jest forcé en CommonJS pour les tests e2e ; divergence assumée avec le build prod

**Contexte.** `@roadsen/shared` est déclaré `"type": "module"` dans son
`package.json`. Le build de l'API cible `module: nodenext` / `moduleResolution:
nodenext` (`apps/api/tsconfig.json`). Jest (et ts-jest) ne supporte pas nativement
ESM avec la résolution `nodenext` dans la version actuellement déployée.

**Décision.** La configuration e2e (`apps/api/test/jest-e2e.json`) force ts-jest en
CommonJS :

```json
"tsconfig": {
  "module": "commonjs",
  "moduleResolution": "node",
  "resolvePackageJsonExports": false
}
```

Le `moduleNameMapper` résout `@roadsen/shared` directement vers son source TypeScript
(`packages/shared/src/index.ts`), court-circuitant la résolution par `package.json`
exports.

**Conséquences.**

- Positive : les tests e2e s'exécutent sans bloquer le cycle de développement.
- **Négative assumée** : la résolution de modules dans les tests (CJS, `node`) diffère
  de celle du build production (ESM, `nodenext`). Un bug de résolution de modules
  (ex. import conditionnel via `exports`, chemin d'import incorrect pour `nodenext`)
  passera invisible aux e2e. Ce qui relève de la résolution/ESM est couvert par
  `nest build` (TypeScript), pas par les tests e2e.
- Risque résiduel : si `@roadsen/shared` utilise des `exports` conditionnels à
  l'avenir (ex. `require` vs `import`), le `moduleNameMapper` pointant sur le source
  TypeScript ne le reflètera pas — à réévaluer à chaque évolution de `shared`.
- À surveiller : Jest 30 (en devDependencies) améliore le support ESM natif —
  vérifier si la contrainte CommonJS peut être levée à la prochaine montée de version
  de ts-jest.
