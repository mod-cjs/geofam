# ADR 0006 — Identite visuelle ROADSEN v3 et gouvernance des tokens

- Statut : accepte
- Date : 2026-06-27

## Contexte
L app authentifiee (login, projets, calcul, PV) doit etre construite. L identite de
fait (navy #1a4a7a + orange #bf6a04, presente sur le devis et le PV) n avait jamais ete
formalisee, et le titulaire a decide d evoluer vers une **vraie identite** distinctive et
moderne. Un panel d experts (4 recherches web + 5 critiques sous angles distincts + une
revue adverse) a co-construit une direction et l a durcie sur l accessibilite.

## Decision
- Adopter l identite **"marque chaude, interface froide"** : la marque porte la chaleur
  (asphalte / laterite / petrole, ancrage geotechnique ouest-africain), l interface de
  travail reste froide et dense ; la donnee prime.
- Deux **actifs proprietaires** seulement : la **barre de strates** du logotype (coupe de
  chaussee codifiee) et le **systeme chromatique terre**. Le reste de l UI est
  deliberement conventionnel (les conventions B2B 2026 servent la lisibilite).
- **Typographie** : Geist Sans + Geist Mono (self-hosted, OFL). Chiffres en Geist Mono,
  `tabular-nums`, alignes a droite, unites dans le `<th>`.
- **Separation primitives / semantiques** : les primitives `--rds-*` (ex. `--rds-clay-500`)
  ne sont JAMAIS consommees par un composant ; seuls les tokens semantiques le sont
  (`--accent-*`, `--surface-*`, `--struct-*`, `--status-*`, `--text-*`...). A instrumenter
  en `stylelint` (`no-restricted-syntax` sur `--rds-*` dans les composants).
- **Laterite scindee par contexte** : `#b86a2e` = marque/aplat/logotype uniquement (jamais
  texte) ; action = `#a05226` (AA 5,11:1 sur canvas) ; sur nav asphalte = `#d9954e` ; en
  dark = `#c97a3f`.
- **Source de verite** : `apps/web/design/identite-v3.md` (tokens complets light+dark,
  ratios WCAG figes) ; board de reference : `apps/web/design/identite-board-v3.html`.

## Consequences
- Livraison **light-first** ; les tokens dark mode sont definis mais leur QA est differe
  (point ouvert : bandeaux verdict en ilot clair, a valider en test utilisateur).
- Les regles couleur deviennent des regles techniques (lint + test negatif CI) a la 1re PR
  front, pas seulement de la prose.
- Details haut de gamme retenus en MVP : chiffres tabulaires, elevation zero-offset,
  tableaux a en-tete sticky + colonne identifiant gelee, skeletons fideles, etats vides
  rediges. Command palette Cmd+K = fast-follow (hors MVP).
- Voir ADR 0007 (convergence PV/UI) et ADR 0008 (gouvernance couleur).
