# Brief de design — App ROADSEN authentifiée (login → projets → calcul → PV)

> Source de vérité du design ET du build. À fournir à **Claude Design** pour générer la
> maquette, puis à synchroniser via `/design-sync` et à implémenter en Next 16.
> Version 0.1 (cadrage orchestrateur) — à raffiner par `designer-ux` avant génération.

## 1. Objectif & périmètre (MVP authentifié)

Permettre à un bureau d'études (tenant) de **se connecter, lancer un calcul sur un projet,
émettre un PV scellé et télécharger le PDF** — au clic, dans le navigateur. C'est l'UI du
flux déjà prouvé en API (login → calc → PV → PDF).

**Dans le périmètre (MVP) :**
- Connexion (email + mot de passe → JWT).
- Liste des projets de l'organisation courante + sélecteur d'organisation (multi-tenant).
- Espace projet : choix du moteur (6), saisie du formulaire, lancement du calcul, résultats.
- Émission d'un PV scellé depuis un résultat + liste des PV du projet + téléchargement PDF.

**Hors périmètre (incréments suivants, à ne PAS dessiner pour l'instant) :** création de
compte/organisation en self-service, administration des membres/rôles, facturation,
édition de projet avancée. (Le démo STARFIRE part de comptes pré-provisionnés.)

## 2. Identité visuelle ROADSEN v3 (FIGÉE — source de vérité : `design/identite-v3.md`)

Identité co-construite par le panel d'experts (4 recherches web + 5 critiques + revue adverse).
Principe : **marque chaude, interface froide** — la couleur ne sert qu'à la marque et aux signaux
sémantiques. Original *et* pro, jamais marketing IA. Board : `design/identite-board-v3.html`.
Détail complet (primitives, dark mode, ratios WCAG) dans `design/identite-v3.md`. Cf. ADR 0006/0007/0008.

**Tokens sémantiques (light) :**
```
Marque (aplat/logotype, JAMAIS texte)   latérite   #b86a2e
Action (liens, onglet actif, bouton)    latérite-  #a05226   (AA 5,11:1 ; sur nav asphalte → #d9954e)
Structure (en-tête groupe, secondaire)  pétrole    #1f4e4a
Nav / wordmark                          asphalte   #22262b
Surfaces                                canvas #f7f6f4 · base #ffffff · alt #eef0f1
Texte                                   #1f2329 · sec #5c6168 · atténué #8b9097 (décor only)
Verdict CONFORME (réservé)              tx #2f6b46 / bg #e9f1ec
Verdict NON CONFORME (réservé)          tx #8b1a1a / bg #fbeceb
```

**Règles cardinales** (instrumentées en lint + test négatif CI dès la 1re PR front) :
- Rouge & vert = **verdicts uniquement**, jamais ailleurs.
- `--accent-brand` (#b86a2e) jamais en texte/interaction ; action = `#a05226` (contraste réel ≥ 4,5:1).
- Tout verdict = **triple redondance** couleur + icône + libellé.
- Latérite et bordeaux-verdict jamais adjacents sans séparateur neutre (collision sous protanopie).
- Séparation **primitives `--rds-*` / sémantiques** : les composants ne consomment que les tokens sémantiques.

- **Typo** : **Geist Sans + Geist Mono** (self-hosted, OFL). Poids 400/500/600. Chiffres = Geist Mono
  + `tabular-nums` + alignés à droite, unités dans le `<th>`. Tailwind v4 `@theme`.
- **Élévation** : zéro-offset (`box-shadow: 0 0 0 1px rgba(...)`) plutôt que `border` — pas de décalage au hover.
- **Logotype** : wordmark « ROADSEN » + **barre de strates** (latérite 3px / pétrole 2px / asphalte 1px) ;
  variante glyphe obligatoire < 32 px.
- **Rayon** : 3–8 px. **Dark mode** : tokens définis (cf. v3), **livraison light-first**.

## 3. Design system à produire (composants Claude Design)

Atomes/molécules réutilisables (ce qui sera synchronisé comme bibliothèque) :
`Button` (primaire/secondaire/ghost/danger, 3 tailles, états loading/disabled) ·
`Input`/`Select`/`Field` (label, aide, erreur) · `Badge` (statut : scellé, brouillon,
conforme, non conforme) · `Card` · `Table` (zébrée, en-tête `#f5f7fa`, chiffres tabulaires,
sous-titres de groupe `#f0f4f9`) · `Bandeau de verdict` (conforme/non conforme, reprend le
bloc du PV) · `AppShell` (en-tête : logo ROADSEN, sélecteur d'organisation, menu utilisateur ;
contenu) · `EmptyState` · `Toast/Alert` · `Skeleton/Loading` · `Modal/Dialog` (confirmation
d'émission de PV).

## 4. Écrans & flux

### E1 — Connexion
Centré, marque ROADSEN sobre. Champs email + mot de passe, bouton « Se connecter ».
États : erreur d'identifiants (message clair, pas de fuite), chargement, focus clavier.

### E2 — Liste des projets (accueil authentifié)
AppShell + sélecteur d'organisation (si plusieurs). Tableau/cartes des projets (nom,
date, nb de PV). Clic → E3. EmptyState si aucun projet.

### E3 — Espace projet
- **En-tête projet** : nom + fil d'ariane.
- **Onglet « Calcul »** : sélecteur de moteur (6), formulaire dynamique (champs issus des
  descripteurs), bouton « Lancer le calcul ». Résultats sous forme de tableau + bandeau de
  verdict. Action « Émettre le PV » (ouvre Modal de confirmation).
- **Onglet « PV »** : tableau des PV du projet (numéro, date, statut scellé, émetteur),
  action « Télécharger le PDF ». EmptyState si aucun PV.

### E4 — Confirmation d'émission de PV (Modal)
Récap (moteur, projet, verdict) + avertissement honnête (scellement HMAC ≠ signature
qualifiée — wording validé). Confirmer → PV créé → toast + apparition dans la liste.

> États transverses obligatoires sur chaque écran : **chargement, vide, erreur**.
> Responsive (desktop d'abord ; mobile lisible). Accessibilité : focus visible, labels,
> contraste AA, navigation clavier.

## 5. Contrat d'API (binding — déjà déployé)

| Action | Endpoint | En-têtes |
|---|---|---|
| Connexion | `POST /auth/login` | `X-Recette-Key` |
| Profil | `GET /auth/me` | `Authorization: Bearer` |
| Projets | `GET /projects` | `Bearer` + `X-Org-Id` |
| Calcul | `POST /projects/:id/calc/:engine` | `Bearer` + `X-Org-Id` |
| Émettre PV | `POST /projects/:id/calc-results/:cid/pv` | `Bearer` + `X-Org-Id` |
| Liste PV | `GET /projects/:id/pvs` | `Bearer` + `X-Org-Id` |
| PDF scellé | `GET /projects/:id/pvs/:pid/pdf` | `Bearer` + `X-Org-Id` |

L'**organisation** est portée par l'en-tête `X-Org-Id` (réappartenance revérifiée serveur).

## 6. Contraintes d'ingénierie (DoD)

- **Confidentialité (DoD §8)** : AUCUN calcul ni symbole de moteur côté navigateur. Le web
  ne fait QUE saisir/afficher ; tout calcul et tout scellement de PV = **serveur**. Pas
  d'import `@roadsen/engines` dans `apps/web` (garde-fou ESLint + contrôle de bundle CI).
- **Next 16** : lire `node_modules/next/dist/docs/` avant de coder (ruptures d'API). Server
  Components par défaut ; Client Components seulement où nécessaire (formulaires, état).
- **État/données** : un client API typé (fetch wrapper qui injecte `Bearer` + `X-Org-Id`),
  gestion du token (stockage + refresh), garde de route authentifiée.
- **Tests (DoD §9)** : Playwright e2e sur le flux réel (login → calc → PV → PDF) ;
  composants testés (états vide/erreur). Pas de faux-vert.
- **Tailwind v4** : tokens dans `@theme` (`globals.css`), pas de couleurs en dur dispersées.

## 7. Pipeline (process ingénieur)

1. **Cadrage** (ce document) → raffiné par `designer-ux`.
2. **Génération maquette** dans Claude Design à partir de ce brief (titulaire).
3. **Sync** via `/design-sync` (outil DesignSync) → bibliothèque de composants locale,
   versionnée, incrémentale (jamais un remplacement en bloc).
4. **Architecture front** (`architecte-technique`) : arbo App Router, client API, auth, garde.
5. **Build** (`dev-frontend`) : composer les écrans depuis les composants synchronisés,
   brancher l'API réelle.
6. **QA** (`qa-test` Playwright + `qa-challenger` revue adverse) → DoD → préprod.
