# Contribuer à ROADSEN — workflow

Méthode **agile / trunk-based léger**. Tout passe par des **tickets**, des **branches courtes** et des **Pull Requests**.

## Cycle d'une tâche (ticket → branche → PR → merge)

1. **Ticket** : prendre une _user story_ dans le board (colonne **Ready**), la passer **In progress**. Vérifier la **Definition of Ready** (critères d'acceptation clairs, dépendances levées, cas-tests dispo si calcul).
2. **Branche** courte depuis `main` :
   ```
   git switch -c feat/<n°ticket>-slug      # ex. feat/11-extraire-terzaghi
   ```
   Préfixes : `feat/`, `fix/`, `chore/`, `docs/`, `test/`.
3. **Commits conventionnels** : `feat: …`, `fix: …`, `chore: …` (commitlint actif).
4. **Pull Request** vers `main`, avec **`Closes #<n°ticket>`** dans la description (lie le ticket, le ferme au merge). La **CI** doit passer (lint, typecheck, tests, build, contrôle de bundle confidentialité).
5. **Revue** : `qa-challenger` sur les zones critiques (moteurs, isolation, PV, paiement). Passer la PR en **Review**.
6. **Merge en squash**, branche supprimée. Vérifier la **Definition of Done** (CLAUDE.md). Ticket → **Done**.

## Règles

- **Pas de push direct sur `main`** (hook `pre-push` ; bypass ponctuel : `git push --no-verify`).
- **`main` toujours déployable** (préprod auto au merge).
- **Calcul confidentiel** : le package `@roadsen/engines` ne s'importe que dans `apps/api`, jamais dans `apps/web` (garde-fou ESLint + contrôle de bundle CI).
- **Moteurs fournis** : on n'optimise jamais la science ; tout écart se tranche au test d'équivalence (cf. `integrateur-moteurs`).

## Environnements

- **dev** : local (`pnpm db:up` = Postgres Docker) → **preprod** (Render, auto au merge `main`) → **prod** (Render, promotion manuelle sur release/tag).

## Définitions

- **DoR / DoD** : voir `CADRE-INGENIERIE.md` et `CLAUDE.md` (DoD avec marquage **[T]** toujours / **[C]** selon criticité).

## Note (plan GitHub)

La **protection serveur de `main`** (PR obligatoire, CI requise) nécessite **GitHub Pro** sur dépôt privé. En attendant, l'enforcement est **local** (hook `pre-push`) + discipline. Passer en Pro (~4 $/mois) active la protection côté serveur.
