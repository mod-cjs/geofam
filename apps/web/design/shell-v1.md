Tous les éléments nécessaires sont réunis. Je produis le document final avec les corrections intégrées.

---

# Shell ROADSEN — Référence d'architecture de navigation (document figé)

**Version :** 1.0 — post-revue adverse  
**Statut :** figé sous réserve du contrat slug↔X-Org-Id (C2, décision `ingenieur-securite` requise avant gel action #2)  
**Source de vérité :** ce document + `design/identite-v3.md` + `DESIGN-BRIEF-app-authentifiee.md` + ADR 0008  
**Périmètre git :** `05-Plateforme/apps/web/`

---

## (a) Modèle de navigation définitif

### Principes résolus (corrections revue adverse intégrées)

**C1 — Tokens, pas hex en dur.** Chaque valeur de couleur dans ce document est un token sémantique de `identite-v3.md`. Aucun hex inventé. Les tokens non encore posés dans `globals.css` (aujourd'hui boilerplate Next — `#ffffff/#171717`, `font-family: Arial`) constituent la dette absolue de l'action #1 : aucun composant de shell ne peut être écrit avant que `globals.css` soit aligné sur v3.

**C2 — Contrat slug↔X-Org-Id non encore figé.** Le shell impose `/app/[orgSlug]/...` mais l'API porte l'organisation via `X-Org-Id` (DESIGN-BRIEF §5, contrat déployé). La réconciliation slug→orgId n'est pas tranchée : d'où vient le mapping ? Le JWT porte-t-il un slug ou un UUID ? Le middleware résout-il via les claims JWT (seul acceptable) ou via un appel DB par requête (inacceptable) ? Cette décision remonte à `ingenieur-securite` avant le gel du schéma d'URL — un désalignement slug/en-tête est exactement l'erreur de contexte multi-tenant que la sidebar prétend prévenir. Le schéma de fichiers peut être créé ; il n'est pas « non refactorable » tant que ce point n'est pas tranché.

**C3 — Périmètre MVP.** Le DESIGN-BRIEF est explicite : membres/rôles, facturation, création de compte self-service, clés API sont hors périmètre Phase 1. Le shell Phase 1 ne contient pas ces routes — ni en actif, ni en placeholder.

**m4/m5 — Règle unifiée nav active.** Un seul système : état actif de navigation = pétrole (`--struct-petrole` / `--accent-action-on-nav` sur fond asphalte) ; action CTA = latérite (`--accent-action`). S'applique à la sidebar ET aux onglets projet. Pas d'underline latérite sur onglet actif.

**m4 — Tags de domaine.** Pastille couleur seule interdite (ADR 0008 : couleur seule insuffisante). Chaque calcul porte le préfixe texte `CH.` / `FD.` / `LB.` plus la pastille 6px en complément — jamais la pastille seule.

---

### Sidebar globale

**Largeur :** expanded 240px / collapsed 64px.  
**Fond :** `var(--surface-nav)` (#22262b en thème clair, #0e0d0c en thème sombre — les deux cas couverts par le token).  
**Bordure droite :** `box-shadow: 0 0 0 1px var(--border-subtle)` (zéro-offset, adaptatif thème).

**Phase 1 — 7 items, pas de placeholder visible :**

```
┌─────────────────────────────────────┐
│  LOGOTYPE                           │
│  [wordmark ROADSEN]  13px 500       │
│  [barre de strates]  3px / 2px / 1px │
│  (collapsed : strates visibles, wordmark sr-only)
├─────────────────────────────────────┤
│  ORG SWITCHER         sticky        │
│  [avatar] Nom du bureau d'études    │
│  Rôle dans l'org actuelle ▾         │
│  (dropdown : liste des orgs + rôle  │
│   par org + séparateur — PAS de     │
│   « Créer une organisation » en P1) │
├── séparateur var(--border-subtle) ─┤
│  ↳ Récent 1 — Nom projet tronqué   │  date relative droite, Geist Mono 12px
│  ↳ Récent 2 — Nom projet tronqué   │  épingle discrète au survol
├── séparateur ─────────────────────┤
│  ESPACE DE TRAVAIL    section-label │  11px uppercase letter-spacing 1.5px var(--text-secondary)
│  ⊞  Mes projets                     │  destination primaire P1
├── séparateur ─────────────────────┤
│  RESSOURCES           section-label │
│  ≡  Bibliothèque de moteurs         │  6 moteurs / 3 domaines, lecture seule
├─────────────────────────────────────┤
│  ⚙  Paramètres                      │  40px var(--text-secondary) — général org uniquement en P1
│  ?  Aide                            │
├─────────────────────────────────────┤
│  [avatar] Prénom — rôle             │  ouvre « Mon compte » (profil, mot de passe)
├─────────────────────────────────────┤
│  [◁ Réduire la navigation]          │  aria-label constant, aria-pressed
└─────────────────────────────────────┘
```

**État actif :** fond `var(--struct-petrole)` à 12% opacité + barre gauche 3px `var(--struct-petrole)` + label `var(--accent-action-on-nav)` (#d9954e — ratio 5,4:1 sur fond asphalte, passe AA).  
**Hover :** fond légèrement éclairé (token à créer dans v3 : `--surface-nav-hover`, valeur suggerée #2d3237 à valider stylelint avant usage).  
**Collapsed :** icônes 20px centrées, labels `sr-only` conservés dans le lien (nom accessible), tooltip `aria-describedby` en complément à 250ms au hover ET au focus.  
**Section labels :** `var(--text-xs)` 11px uppercase letter-spacing 1.5px `var(--text-secondary)`.

**OrgSwitcher dropdown :** liste des orgs avec checkmark + rôle par org (Admin / Membre) en `var(--text-muted)` 12px. Au switch : `queryClient.clear()` + redirect `/app/[nouveauSlug]/projets`. Source unique pour l'orgId : claims JWT uniquement, pas de résolution DB par requête.

---

### Topbar contextuelle

**Hauteur :** 48px fixe.  
**Fond :** `var(--surface-nav)`.  
**Bordure basse :** `box-shadow: 0 1px 0 0 var(--border-subtle)` (token `--elevation-sticky`).  
**Règle absolue :** aucun lien de navigation applicative dans la topbar.

**Disposition gauche → droite :**

```
[Breadcrumb cliquable]  ——————————  [Cmd+K]  [CTA contextuel]  [🔔]  [avatar]
```

**Breadcrumb :** ancré sur la ressource courante (projet / calcul). Format : `Mes projets / RN2-PK45 / Calcul Burmister #4`. Chaque segment sauf le dernier = lien. Troncature milieu en `…` au-delà de 4 niveaux. Couleur segments intermédiaires : `var(--text-secondary)` 13px ; dernier segment : `var(--text-on-nav)` 13px 500.

**Cmd+K :** bouton 180px fond `var(--surface-nav-hover)`, label `Rechercher… ⌘K` 13px `var(--text-secondary)`. Recents par tenant (5 projets/calculs), navigation, actions rapides (`Nouveau calcul`, `Émettre un PV`). Dès le socle Phase 1 — conforme DESIGN-BRIEF §3.

**CTA contextuel :** un seul bouton par page. Fond `var(--accent-action)` sur fond canvas — sur fond asphalte (topbar), utiliser `var(--accent-action-on-nav)` pour le texte ou revoir le traitement de fond. Hauteur 32px, radius `var(--radius-base)` 4px, label `var(--accent-fg)` blanc 500. « Nouveau calcul » dans un projet. « Émettre un PV » n'apparaît que lorsque le calcul sélectionné a le statut « Calculé » — absent (pas grisé) sinon.

**Notifications :** icône cloche, badge point `var(--accent-brand)` si non lus. Dropdown max 5 entrées.

**Avatar :** à droite, ouvre « Mon compte » — même store Zustand que le pied de sidebar, pas deux composants distincts.

---

### Navigation intra-projet

**Principe :** la sidebar globale ne change pas à l'ouverture d'un projet. L'item « Mes projets » reste actif. Le contexte projet est porté par le breadcrumb topbar + une bande projet unique.

**Bande projet fusionnée** (correction M2 — 136px → 92px de chrome) : une seule bande sous la topbar, hauteur 44px, fond `var(--surface-base)`, bordure basse `var(--border-subtle)` :

```
[Nom projet — RN2-PK45]  [badge statut]  [modifié il y a 2h]  ·  [Vue d'ensemble]  [Calculs]  [PV & Livrables]  [Informations]
```

Nom projet 14px 500 `var(--text-primary)` à gauche. Onglets à droite (ou séparés par un flex-grow). Onglet actif : underline 2px `var(--struct-petrole)` + texte `var(--text-primary)` 500 (pétrole, pas latérite — règle unifiée m5). Onglet inactif : `var(--text-secondary)`. Onglets rendus par `projets/[projetId]/layout.tsx`, état persisté pendant la navigation.

**Onglet « Calculs » — master-detail :**

- Colonne gauche 280px : fond `var(--surface-canvas)`, bordure droite `var(--border-subtle)`. Liste des calculs avec tag domaine (pastille 6px + préfixe texte `CH.`/`FD.`/`LB.` — ADR 0008), nom du calcul, badge statut outline, date relative Geist Mono 12px tabular-nums aligné droite. Bouton « Nouveau calcul » en tête (outline, `var(--accent-action)`).
- À « Nouveau calcul » : sélecteur modal groupé par domaine (ENGINE_DESCRIPTORS, client-safe). Groupes : Chaussées (Burmister LCPC) · Fondations (Terzaghi EC7 / Casagrande pieux / GEOPLAQUE radier) · Sol & Labo (Pressiomètre / FASTLAB-GTR).
- Colonne droite : formulaire ou résultats, fond `var(--surface-base)`, scroll vertical.
- Sous 1280px : drill-down (liste → détail, bouton Retour).

**Onglet « PV & Livrables » :**

- Liste des PV scellés : numéro, moteur source, date, hash HMAC tronqué 8 caractères Geist Mono 11px tabular-nums `var(--text-secondary)`, badge « Scellé » (fond `var(--surface-nav)` + cadenas Lucide 12px `aria-hidden="true"` + texte `var(--text-on-nav)`). Aucun badge vert — vert réservé aux verdicts de conformité (ADR 0008).
- Actions : « Télécharger PDF » + « Vérifier intégrité » (vérification en ligne serveur, jamais comparaison visuelle du tronqué — mémoire `roadsen-pv-seal-threat-model`). Jamais « Modifier ».

**Tableau de distinction calcul / PV (corrigé m5) :**

| | Calcul | PV |
|---|---|---|
| Badge | outline `var(--border-default)` « Recalculable » | fond `var(--surface-nav)` + cadenas « Scellé » |
| Action primaire | Recalculer / Modifier paramètres | Télécharger / Vérifier intégrité |
| Icône | `calculator` Lucide outline | `file-check-2` Lucide outline |
| URL | `/calculs/[calculId]` | `/pv/[pvId]` |
| Nav active underline | pétrole `var(--struct-petrole)` | pétrole `var(--struct-petrole)` |

---

## (b) Carte de routes App Router Next 16

**Avertissement préliminaire (AGENTS.md) :** Next 16 comporte des ruptures d'API par rapport aux versions antérieures. `dev-frontend` doit lire `node_modules/next/dist/docs/` avant d'écrire du code. Le schéma ci-dessous est le contrat d'intention ; la validation des conventions (route groups, layouts segment, redirects) est une pré-condition au gel « non refactorable ».

```
app/
├── layout.tsx                     # Root layout : providers, Geist self-hosted,
│                                  # globals.css (tokens v3 complets)
├── page.tsx                       # Redirect runtime middleware → /app/[orgSlug]/projets
│                                  # (pas de logique auth ici — tout dans middleware.ts)
│
└── app/
    └── [orgSlug]/
        ├── layout.tsx             # SHELL LAYOUT : sidebar + topbar + providers tenant
        │                          # → orgSlug résolu via claims JWT (pas DB par requête)
        │                          # → orgId injecté dans X-Org-Id côté client API
        │                          # → OrgSwitcherProvider, CommandPaletteProvider
        │                          # → queryClient.clear() au switch d'org
        │
        ├── projets/
        │   ├── page.tsx           # Liste des projets de l'org (destination primaire P1)
        │   │
        │   └── [projetId]/
        │       ├── layout.tsx     # PROJET LAYOUT : bande projet fusionnée (44px)
        │       │                  # + onglets (Vue d'ensemble / Calculs / PV / Informations)
        │       │                  # — persisté entre calculs
        │       ├── page.tsx       # Rendu direct de l'onglet Calculs (pas de redirect)
        │       │
        │       ├── calculs/
        │       │   ├── page.tsx   # Master-detail : liste + panneau vide (sélectionner)
        │       │   └── [calculId]/
        │       │       └── page.tsx  # Éditeur + résultats + CTA « Émettre un PV »
        │       │                      # (bouton absent si statut ≠ Calculé)
        │       │
        │       └── pv/
        │           ├── page.tsx      # Liste PV scellés du projet
        │           └── [pvId]/
        │               └── page.tsx  # Vue PV (lecture seule) + vérification HMAC en ligne
        │
        ├── bibliotheque/
        │   └── page.tsx           # Catalogue 6 moteurs / 3 domaines (lecture) — P1 léger
        │
        ├── parametres/
        │   └── general/page.tsx   # Nom org, logo — seule page paramètres active en P1
        │                          # (membres/facturation/sécurité/audit : non créés en P1)
        │
        └── compte/
            └── page.tsx           # Profil utilisateur, mot de passe — minimal P1
                                   # (clés API : hors périmètre P1)
```

**middleware.ts :** concentre TOUTES les redirections d'authentification et de résolution d'org. Valide que `[orgSlug]` correspond à une org dont le `sub` JWT est membre via les claims (sans appel DB). Si invalide : redirect `/login` ou `/app/[firstOrgSlug]/projets`. `app/page.tsx` et `projets/[projetId]/page.tsx` ne portent aucune logique auth.

**Convention de nommage :** `[orgSlug]` (slug lisible, dérivé des claims JWT), `[projetId]` (UUID/cuid2 — partageable, déterministe).

**Route groups** optionnels pour isoler le shell : `(shell)/[orgSlug]/layout.tsx` pour les pages authentifiées vs `(auth)/login/page.tsx` sans sidebar — à décider avec `dev-frontend` selon la structure Next 16 réelle.

---

## (c) Ce qui change vs le shell actuel

| Actuel | Nouveau | Raison |
|---|---|---|
| Topbar seule, pas de sidebar | Sidebar 240px `var(--surface-nav)` + topbar 48px | Architecture org-scope absente ; multi-tenant invisible = risque déontologique |
| Aucune navigation globale | Sidebar avec OrgSwitcher sticky (rôle par org visible au switch) | Prévenir l'erreur de contexte tenant |
| Onglets [Calcul] [PV] non ancrés | Bande projet fusionnée 44px (sub-header + onglets en une bande) + layout segment | État persisté, URL déterministe, -44px de chrome vs deux bandes |
| Pas de master-detail | Colonne 280px calculs / panneau détail | L'ingénieur navigue entre calculs d'une affaire sans repasser par la liste |
| Routes plates (`/`, `/recette`) | `/app/[orgSlug]/projets/[projetId]/calculs/[calculId]` | Multi-tenant sans slug = bogue contractuel |
| Aucune command palette | `cmdk` dès le socle Phase 1 | Standard attendu ; cadré explicitement dans DESIGN-BRIEF §3 |
| `globals.css` boilerplate Next (`#ffffff/#171717`, `font-family: Arial`) | Tokens v3 complets dans `globals.css` via `@theme` Tailwind v4 | Sans base CSS, aucun composant n'est conforme à l'identité figée |
| Pas de séparation calcul / PV | Badges typés, actions distinctes, « Émettre un PV » conditionnel | Confusion sur l'immuabilité du PV scellé = risque de chaîne de preuve |
| État actif nav : latérite | État actif nav : pétrole (`--struct-petrole`) — latérite réservée aux CTA | Règle unifiée sidebar + onglets ; évite la collision sémantique nav/action |
| Tags de domaine : pastille couleur seule | Préfixe texte `CH./FD./LB.` + pastille en complément | ADR 0008 : couleur seule interdite, fonds pastel indistinguables N&B |
| Aucune prise en compte du dark mode | Token `var(--surface-nav)` couvre light (#22262b) et dark (#0e0d0c) | Pas de hex en dur : le dark ne casse pas la nav au premier toggle |
| Membres / facturation / clés API présents | Supprimés du périmètre Phase 1 | DESIGN-BRIEF §1 explicite : comptes pré-provisionnés, hors périmètre |

---

## (d) Détails haut de gamme

**1 — Hash HMAC tronqué visible dans la liste PV, pas expliqué.** Les 8 premiers caractères du hash HMAC en Geist Mono 11px tabular-nums `var(--text-secondary)` sous le titre de chaque PV. Aucune légende. L'ingénieur senior reconnaît le motif. Cohérent avec la mémoire `roadsen-pv-seal-legal-wording` : ne jamais écrire « certifié » mais montrer le hash. Le bouton « Vérifier intégrité » pointe vers une vérification en ligne serveur — jamais une comparaison visuelle du tronqué (mémoire `roadsen-pv-seal-threat-model`).

**2 — Tag domaine : préfixe texte + pastille 6px.** Chaque calcul dans la colonne master-detail porte le préfixe `CH.` / `FD.` / `LB.` en `var(--text-sm)` 13px, suivi d'une pastille 6px (couleur de domaine en complément, jamais seule). L'ingénieur identifie le domaine au premier coup d'œil sans dépendre de la couleur — conforme ADR 0008 et robuste en N&B / CVD.

**3 — Barre de strates visible en collapsed.** En mode collapsed 64px, le wordmark disparaît (`sr-only`) mais la barre de strates (3px latérite `--rds-clay-500` / 2px pétrole `--rds-teal-700` / 1px asphalte `--rds-slate-900`) reste centrée. Le produit est identifiable sans texte. Le motif trois-strates n'est pas rendu en variante glyphe (< 32px) — à cette taille, la strate latérite seule sur fond asphalte s'applique (identite-v3.md §b).

**4 — Bouton « Émettre un PV » conditionnel, absent pas grisé.** Dans l'onglet Calculs, le CTA « Émettre un PV » n'apparaît que lorsque le calcul porte le statut « Calculé » (recalcul serveur conforme, cas-tests passés). En Brouillon ou En erreur : le bouton est absent. Une icône d'état avec tooltip explique pourquoi. Traduit la règle de scellement (DoD §5) côté UX sans exposer de logique interne.

**5 — Rôle par org dans le dropdown OrgSwitcher.** Chaque organisation listée affiche le rôle de l'utilisateur dans cette org (Admin / Membre) en `var(--text-muted)` 12px à droite du nom. L'utilisateur voit ses droits avant de changer d'org. Prévient les surprises RBAC (consultant Admin dans BE-A, Membre dans BE-B). Coût d'implémentation minimal sur un champ déjà présent dans le JWT.

**6 — Typographie numérique systématique.** Toute valeur numérique dans les résultats de calcul (portances, modules, contraintes, coefficients, ratios) : Geist Mono + `font-variant-numeric: tabular-nums` + alignement à droite. Unités dans le `<th>` une seule fois. Un tableau de 20 valeurs s'aligne à la décimale sans effort. C'est le signal de sérieux technique qu'un ingénieur senior capte en trois secondes.

---

## (e) Règles d'accessibilité et responsive

### Responsive

**>= 1280px :** sidebar expanded 240px + topbar 48px + bande projet fusionnée 44px + zone contenu. Master-detail side-by-side. Chrome total avec projet ouvert : 92px.

**1024–1279px :** sidebar collapsed 64px par défaut CSS (`@media` pur, pas de JS au mount — correction M3). Override utilisateur persisté `localStorage['sidebar-desktop-state']`, lu uniquement au mount avec garde SSR (`typeof window === 'undefined'` → collapsed = false, valeur serveur). Aucun flash de layout : le repli est CSS, la lecture du store est au client post-hydratation. Master-detail drill-down si largeur disponible insuffisante.

**768–1023px :** sidebar masquée. Hamburger dans la topbar (`aria-label="Ouvrir la navigation"`) — le hamburger est DANS le `<nav>`, pas orphelin dans la topbar. Drawer slide-over depuis la gauche (`transform: translateX(-100%)`), fond `var(--surface-nav)`, backdrop `rgba(17,18,16,0.6)`. Comportement modal : focus trap actif, `inert` sur `<main>`, ESC ferme et rend le focus au hamburger. OrgSwitcher en tête du drawer. Bande projet : onglets scrollables horizontalement.

**< 768px :** drawer identique + bottom tab bar persistante 56px (Projets, Récents, Cmd+K, Compte — 4 items max), icônes 24px + labels 11px. Topbar réduite à breadcrumb raccourci (nom projet seul) + hamburger + avatar. Master-detail drill-down pur.

**Persistance collapse :** deux clés localStorage distinctes `sidebar-desktop-state` / `sidebar-mobile-last-open`. Pas de règle de transition cross-breakpoint — le repli est géré par CSS media query indépendamment du store.

**Transitions :** `transform: translateX` sur le panneau de labels (pas `width` — évite le reflow), 220ms ease-in-out. `prefers-reduced-motion: reduce` → `transition: none`, changement instantané.

### Accessibilité

**Structure sémantique :** `<aside aria-label="Navigation principale">` contenant `<nav>` avec `<ul>/<li>`. Hamburger DANS le `<nav>`. `<main id="main" tabindex="-1">` comme cible du skip-link.

**Skip-link :** « Aller au contenu principal » en premier élément du DOM, visible au focus, `href="#main"`. Obligatoire avant tout composant.

**États ARIA :**
- Item actif sidebar : `aria-current="page"`.
- Bouton collapse desktop : `aria-pressed` (état d'apparence, pas de visibilité réelle).
- Hamburger mobile : `aria-expanded` sur le drawer (visibilité réelle). `aria-controls="sidebar-drawer"`.
- Bouton « Réduire la navigation » : `aria-label="Réduire la navigation"` constant indépendamment de l'état visuel (correction m1).

**Collapsed — noms accessibles :** le label de chaque item sidebar reste en `sr-only` DANS le lien (nom accessible du lien). Le tooltip `aria-describedby` est en complément informatif, jamais substitut de nom (correction m2).

**Icônes :** toutes décoratives → `aria-hidden="true"`. Les icônes Lucide en mode collapsed 64px (distinctions entre domaines à 20px) doivent être testées avec des utilisateurs réels avant de figer le jeu d'icônes.

**Focus ring :** 2px solid `var(--border-focus)` (#a05226 clair / #c97a3f sombre), offset 2px, visible partout — aucune règle `outline: none` sans substitut visible.

**Densité comfortable par défaut :** `--row-h: 40px / --row-px: 12px`. Passage en compact = toast opt-in après 5 sessions, jamais automatique.

**Verdicts :** triple redondance obligatoire — couleur + icône Lucide stroke 1,5 `aria-hidden` + libellé texte. Jamais de couleur seule. Aucun vert ni rouge en dehors des composants verdict (ADR 0008, instrumenté en lint + test négatif CI).

---

## Prérequis de lancement (ordre impératif)

1. **Poser les tokens v3 dans `globals.css`** via `@theme` Tailwind v4 avant tout composant — aujourd'hui le fichier est un boilerplate Next sans aucun token ROADSEN. C'est la condition bloquante absolue. Stylelint + règle `no-restricted-syntax` sur primitives `--rds-*` dans les composants à instrumenter dès la première PR.

2. **Figer le contrat slug↔X-Org-Id avec `ingenieur-securite`** — décision de zone critique isolation (DoD §3). Sans ça, le schéma d'URL est conditionnel. Le middleware doit résoudre depuis les claims JWT, jamais depuis un appel DB par requête.

3. **Créer la structure de fichiers App Router** (layouts vides) après validation des conventions Next 16 par `dev-frontend` (lecture `node_modules/next/dist/docs/`). Ce n'est pas « non refactorable » avant l'étape 2.

4. **Construire `[orgSlug]/layout.tsx`** (shell : sidebar + topbar + providers) avec OrgSwitcher, état collapse CSS-first, garde SSR.

5. **Câbler le middleware** de validation `orgSlug` + provision tenant (cohérent #41/#42 — `p_owner_user_id = sub JWT`).

6. **Intégrer `cmdk`** avec recents par tenant, navigation, actions rapides.

7. **Construire `projets/[projetId]/layout.tsx`** avec bande projet fusionnée + onglets + master-detail calculs/PV.

---

## Risques ouverts

**Prioritaire — zone critique isolation :** La purge de cache au switch d'org (`queryClient.clear()` + redirect) doit être testée par `ingenieur-securite` — c'est la barrière comportementale, les deux barrières structurelles étant slug-in-URL + RLS PostgreSQL. Le contrat slug↔X-Org-Id non figé est le seul risque bloquant du document.

**Icônes collapsed :** les distinctions Lucide entre les 6 moteurs à 20px en mode collapsed sont à valider avec des utilisateurs réels avant de figer le jeu — risque de charge cognitive documenté.

**Onglets in-app multi-calculs (Phase 2) :** la persistance par projet (« calcul restauré avec résultats » vs « calcul ouvert sans résultats ») doit être décidée explicitement avant implémentation — deux états distincts à ne pas confondre. Le schéma d'URL actuel (un calcul = une route) est additif sans refonte.

**Validation Next 16 :** les conventions App Router (route groups, layouts segment, redirects middleware) doivent être vérifiées contre les docs locales avant de les déclarer stables. Risque de retravail si une rupture d'API est découverte après gel.

---

**Fichiers de référence (chemins absolus) :**
- `/Users/macbook/Desktop/roadsen/05-Plateforme/apps/web/design/identite-v3.md`
- `/Users/macbook/Desktop/roadsen/05-Plateforme/apps/web/DESIGN-BRIEF-app-authentifiee.md`
- `/Users/macbook/Desktop/roadsen/05-Plateforme/docs/adr/0008-gouvernance-couleur-accent-statut.md`
- `/Users/macbook/Desktop/roadsen/05-Plateforme/apps/web/src/app/globals.css`
- `/Users/macbook/Desktop/roadsen/05-Plateforme/apps/web/AGENTS.md`