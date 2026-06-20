# Conventions de test ROADSEN

Filet de securite automatise. Trois couches, trois outils, des frontieres nettes.

## Outils et perimetre

| Couche                  | Outil         | Ou                                    | Job CI        |
| ----------------------- | ------------- | ------------------------------------- | ------------- |
| Unitaire / golden       | Vitest        | `packages/shared`, `packages/engines` | `unit`        |
| Integration + isolation | Jest (NestJS) | `apps/api`                            | `integration` |
| E2E (smoke)             | Playwright    | racine (`tests/e2e`)                  | `e2e` (main)  |

> `apps/api` reste sur Jest (defaut NestJS) ; il n est PAS dans le workspace
> Vitest. Ne pas melanger les runners dans un meme package.

## Lancer les suites

```bash
# Unitaires (turbo, par package) + couverture
pnpm test            # = turbo run test
pnpm test -- --coverage

# Depuis la racine, tout Vitest d un coup (confort local)
pnpm exec vitest run

# Un seul package
pnpm --filter @roadsen/shared test

# E2E smoke (s auto-skippe sans E2E_BASE_URL)
pnpm test:e2e
E2E_BASE_URL=https://preprod.example pnpm test:e2e
```

## Regles non negociables

1. **Un test echoue pour la bonne raison.** Pas de test vert qui ne verifie
   rien. Un `it.skip` est VISIBLE dans le rapport ; un `it` sans assertion est
   un faux-vert et un defaut.
2. **Anti auto-reference.** Le comparateur golden REFUSE de comparer un objet a
   lui-meme (`compareGolden(x, x)` jette). La reference golden doit etre figee,
   independante de la sortie calculee.
3. **Tolerances documentees.** Un ecart numerique se compare a une tolerance
   EXPLICITE (`abs` et/ou `rel`), par champ si besoin. Defaut = egalite stricte.
   Un ecart hors tolerance est un DEFAUT, pas un arrondi a ignorer.
4. **Determinisme moteurs.** Les moteurs sont purs et deterministes. Le temoin
   (`packages/shared/tests/determinism.witness.test.ts`) scanne le code source
   de `@roadsen/engines` et echoue sur `Date.now()`, `Math.random()`,
   `new Date()` sans argument, `process.env`, `hrtime`, `randomUUID/randomBytes`.
   Echappement conscient : commentaire `determinism-allow: <raison>` sur la ligne.
5. **Confidentialite (DoD 8).** Aucun symbole/calcul moteur cote navigateur.
   Le temoin scanne par FILESYSTEM (aucun import de `@roadsen/engines`). Les
   utilitaires de test sont server-only.

## Boite a outils (packages/shared/src/testing)

- `golden.ts` — `compareGolden(expected, actual, opts)` : comparaison champ a
  champ, tolerance parametrable, anti auto-reference. Pur (sans framework).
- `golden.assert.ts` — `expectGolden(actual, expected, opts)` : pont Vitest.
- `determinism-scan.ts` — `scanForNonDeterminism(dir, opts)` : scanner reutilisable.

## Couverture inclus Phase 1 vs differe (pas de cap silencieux)

**Inclus (socle) :**

- Harnais Vitest + Playwright operationnel, branche sur CI.
- Comparateur golden generique + ses propres tests.
- Temoin de determinisme + ses propres tests.

**Differe / en `.skip` visible :**

- Equivalence module<->HTML : bloque sur extraction moteur (integrateur-moteurs)
  - valeurs de reference HTML + matrice cas-tests STARFIRE.
- Equivalence client<->serveur : meme dependance.
- Isolation multi-tenant (lecture/ecriture/post-migration/RBAC) : bloque sur le
  schema DB + couche d acces (apps/api) ; vrais tests dans le job `integration`
  avec `ingenieur-securite`.
- E2E de parcours (auth, PV, multi-tenant) : avec les features correspondantes.
- Accessibilite de base des ecrans cles (clavier, contrastes, labels) : avec le
  front.
