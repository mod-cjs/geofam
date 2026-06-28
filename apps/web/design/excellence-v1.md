Voici la SPEC D'EXCELLENCE ROADSEN v2 — post-revue adverse intégrée. Les corrections de la revue sont absorbées structurellement, pas en section séparée : le document guide directement le build et le prompt Claude Design.

---

# SPEC D'EXCELLENCE ROADSEN — Haute Facture · v2 (post-revue adverse)

## Préambule factuel (non négociable)

Le shell v1 n'existe pas dans le dépôt. `globals.css` est le boilerplate Next.js nu. La seule surface réelle est `/recette`. Tout ce qui suit est une **spécification-cible** à construire, pas un correctif d'existant.

**Périmètre de build validé :** P0 + P1 constituent l'engagement Phase 1 (½ à 2 jours). P2 et P3 sont du **backlog conditionnel** — déclenchés uniquement quand les écrans portent de la donnée réelle câblée. Framer Motion n'est pas introduit en Phase 1 (drawer mobile gestuel hors scope). CSS transitions suffisent.

Ce document est la source de vérité de build pour `dev-frontend`. Gelé sur décision du titulaire après lecture de ce préambule.

---

## A. Langage de mouvement (tokens)

### Tokens de motion — source unique dans `globals.css` `:root`

```css
/* Durées */
--dur-instant:   100ms;
--dur-fast:      150ms;
--dur-base:      200ms;
--dur-moderate:  250ms;
--dur-slow:      300ms;

/* Courbes — nommées par intent */
--ease-entrance: cubic-bezier(0.165, 0.84, 0.44, 1);     /* ease-out-quart */
--ease-exit:     cubic-bezier(0.55, 0, 1, 0.45);          /* ease-in-quart  */
--ease-state:    cubic-bezier(0.455, 0.03, 0.515, 0.955); /* ease-in-out    */
```

### Règles d'application (non négociables)

| Règle | Valeur |
|---|---|
| Durée max UI | 300 ms — jamais dépassée |
| Sortie vs entrée | Sortie 20 % plus courte que l'entrée |
| Propriétés animables | `opacity`, `transform` uniquement |
| Propriétés interdites en animation | `width`, `height`, `padding`, `margin`, `top`, `left` ; `box-shadow` en animation (hover : transition CSS statique acceptable) |
| `transition: all` | Interdit. Règle stylelint à poser |
| `linear` | Réservé aux mouvements mécaniques (spinner `Loader2`, barre déterministe) |
| Actions haute fréquence | Zéro animation — champs de saisie, bouton Calculer déclenché clavier, navigation Cmd+K, onglets projet |
| Spring | Uniquement drawer mobile gestuel (hors Phase 1) |
| Animations simultanées max | 2 à 3 par écran |

### `prefers-reduced-motion` — source de vérité CSS unique

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration:        0.01ms !important;
    animation-iteration-count: 1      !important;
    transition-duration:       0.01ms !important;
  }
}
```

**Point critique :** ce bloc CSS ne couvre pas `scrollIntoView`. Tout appel à `scrollIntoView({ behavior: 'smooth' })` doit lire le media query en JS :

```ts
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
element.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'nearest' });
```

Cette ligne est obligatoire dans le helper de focus post-calcul. Le bloc CSS seul crée une incohérence silencieuse.

Affinement par composant : sous reduced-motion, le skeleton reste visible (structure) mais cesse de pulser. Le swap résultat/skeleton se fait par `display` direct, pas par transition.

---

## B. Inventaire de micro-interactions par composant

### Sidebar globale (240 px / 64 px collapsed)

| Déclencheur | Effet | Durée / Courbe |
|---|---|---|
| Hover `nav-item`, `recent-item` | `background-color` → `rgba(var(--color-petrole-rgb), 0.08)` | `var(--dur-fast) var(--ease-state)` |
| Item actif | Barre 2 px pétrole gauche + `background-color` token `--state-selected-bg` | Instantané (changement de route) |
| Collapse (clic) | `transform: translateX` du panneau ; media query CSS au mount, override JS en `var(--dur-base) var(--ease-state)` | Jamais `width` animée |
| Logotype collapsed | Wordmark `sr-only`, strates visibles — aucune animation | — |

### Onglets nav projet (Vue d'ensemble / Calculs / PV / Informations)

Actions répétées → règle Raycast appliquée. **Swap de contenu instantané** (0 ms) — le cross-dissolve 200 ms d'une version antérieure est coupé : il contredit la règle haute fréquence et crée un double-render transitoire potentiellement coûteux sur des vues à tableau lourd. L'indicateur actif (underline ou bord) anime seul.

| Déclencheur | Effet | Durée / Courbe |
|---|---|---|
| Clic onglet | Indicateur actif : `color + box-shadow` | `var(--dur-fast) var(--ease-state)` |
| Contenu de vue | Swap instantané | 0 ms |
| Slide horizontal entre modules | Interdit — modules pairs structurels | — |

### Bouton "Calculer" / "Émettre PV"

| Déclencheur | Effet | Durée / Courbe |
|---|---|---|
| Hover (souris) | `background-color` latérite → `--color-action-hover` (valeur résolue, cf. §C) | `var(--dur-fast) var(--ease-state)` |
| Focus visible | Double-anneau, `transition: none` | Instantané |
| Clic / Ctrl+Entrée | Libellé "Calcul en cours", `disabled`, `aria-busy="true"`, `opacity 1→0.65` | `var(--dur-instant)` |
| Loading > 400 ms | Icône `Loader2` rotation `spin 1s linear infinite` — seule exception `linear` (mouvement mécanique) | 1 s boucle |
| Disabled | `opacity 0.65` | `var(--dur-instant) var(--ease-state)` |

Aucun `scale`, aucun `translate` sur ce bouton.

### Tableau de résultats (OutputTable)

| Déclencheur | Effet | Durée / Courbe |
|---|---|---|
| Hover ligne (souris fine) | `background-color` → `var(--row-hover-bg)` | `var(--dur-fast) var(--ease-state)` |
| Entrée du bloc résultat (CALC_SUCCESS) | `opacity 0→1` + `translateY(4px)→0` | `var(--dur-base) var(--ease-entrance)` |
| Focus programmatique post-CALC_SUCCESS | `tabIndex={-1}` + `.focus()` + `scrollIntoView` JS-aware | Cf. helper §A |
| Lignes de tableau | Pas de stagger — apparaissent d'un bloc | — |
| Sticky header scroll | `box-shadow: 0 1px 0 var(--color-border)` via IntersectionObserver sentinelle | `var(--dur-fast)` en CSS |

### Skeleton (état loading calcul)

Visible seulement si calcul > 400 ms. Monté via `setTimeout(400)` — **timer annulé dans le `finally` du calcul** (`clearTimeout`) pour éviter le flash inverse si la réponse arrive à 380–420 ms.

Dimensions identiques à l'état chargé (mêmes hauteurs de lignes, colonnes proportionnelles). CLS = 0 garanti.

```css
@keyframes roadsen-shimmer {
  0%, 100% { opacity: 0.45; }
  50%       { opacity: 0.85; }
}
```

Animation : `1400ms ease-in-out infinite`. Composite-only (`opacity`), pas de layout thrash. Coupée sous `prefers-reduced-motion` (skeleton visible, immobile). Le timer `clearTimeout` garantit qu'elle ne tourne jamais sur un calcul rapide.

Disparition : `opacity 1→0` en `var(--dur-fast) var(--ease-exit)` dès CALC_SUCCESS, puis swap vers le tableau réel.

### Sélection d'un calcul (master-detail, liste 280 px)

Actions répétées → instantanées.

| Déclencheur | Effet | Durée |
|---|---|---|
| Clic / Entrée sur item | Détail s'affiche instantanément | 0 ms |
| Marqueur sélection | Bord inset 3 px pétrole + `--state-selected-bg` | `var(--dur-fast) var(--ease-state)` |

### OrgSwitcher / dropdowns / menus d'actions

| Déclencheur | Effet | Durée / Courbe |
|---|---|---|
| Ouverture | `opacity 0→1` + `translateY(-4px)→0` | `var(--dur-base) var(--ease-entrance)` |
| Fermeture | `opacity 1→0` | `var(--dur-fast) var(--ease-exit)` |
| Focus trap | Actif à l'ouverture, retour déclencheur à la fermeture | — |
| Hover item | `background-color` | `var(--dur-fast) var(--ease-state)` |

### Cmd+K (palette de commandes)

Ouverte/fermée des centaines de fois par jour → règle Raycast stricte.

Apparition instantanée (< 100 ms). Si une transition est conservée : `opacity 0→1` uniquement en `var(--dur-instant)`. Jamais de spring.

### Modale émission PV

Pas un "Êtes-vous sûr ?" — un écran de récapitulatif que l'ingénieur relit. Unique confirmation explicite du produit.

| Déclencheur | Effet | Durée / Courbe |
|---|---|---|
| Ouverture | `opacity 0→1` + `scale(0.98)→scale(1)` | `var(--dur-base) var(--ease-entrance)` |
| Fermeture | `opacity 1→0` | `var(--dur-fast) var(--ease-exit)` |
| Focus trap | Premier élément focusable du récap, retour déclencheur si annulé | — |
| Contenu | Paramètres + résultats recalculés serveur + identité + horodatage | — |
| Bouton confirm | "Émettre et sceller le PV n° …" — libellé contextualisé | — |

### Toasts / notifications

| Type | Entrée | Sortie |
|---|---|---|
| Succès (PV généré, sauvegarde) | `slide-up 8px + opacity`, `var(--dur-base) var(--ease-entrance)` | `opacity 1→0`, `var(--dur-fast) var(--ease-exit)` |
| Erreur | Identique, `var(--dur-fast) var(--ease-entrance)` — plus vif | `var(--dur-instant) var(--ease-exit)` |

`aria-live` annonce le message.

### Validation de champ (on-blur)

| Déclencheur | Effet | Durée / Courbe |
|---|---|---|
| Blur — valide + non vide | Icône `Check` 16 px, `--color-verdict-pass-fg`, `opacity 0→1` | `var(--dur-fast) var(--ease-entrance)` |
| Blur — erreur bloquante | Message inline + icône `AlertCircle` 16 px, `opacity 0→1` | `var(--dur-fast) var(--ease-entrance)` |
| Disparition message erreur | `opacity 1→0` | `var(--dur-instant) var(--ease-exit)` |
| Pendant la frappe | Zéro animation | — |

### Focus ring (tous les éléments interactifs)

`transition: none` sans exception — apparition instantanée.

```css
:focus-visible {
  outline:        2px solid var(--color-petrole);
  outline-offset: 2px;
  /*
    Anneau intermédiaire = couleur de la surface locale via --surface-current,
    pas --color-canvas (qui serait invisible sur fond clair, insuffisant sur asphalte).
    Chaque composant posé sur un fond sombre déclare :
      --surface-current: var(--color-nav); /* asphalte */
    La valeur par défaut couvre le canvas clair.
  */
  box-shadow:     0 0 0 4px var(--surface-current, var(--color-canvas)),
                  0 0 0 6px var(--color-petrole);
  transition:     none;
}
```

`--surface-current` est déclaré localement sur tout conteneur posé sur un fond non-canvas (sidebar asphalte, header, modale sombre). Cette approche est préférable à un `outline-offset` seul car elle garantit la lisibilité du ring sur fond variable sans compter sur un seul fallback couleur.

---

## C. Raffinements visuels

### Tokens couleur — avec ratios de contraste calculés

```css
:root {
  /* Surfaces */
  --color-canvas:        #f7f6f4;
  --color-base:          #ffffff;
  --color-alt:           #eef0f1;

  /* Navigation / structure */
  --color-nav:           #22262b;   /* asphalte */
  --color-structure:     #1f4e4a;   /* pétrole */
  --color-petrole:       #1f4e4a;
  --color-petrole-rgb:   31, 78, 74;

  /* Action / marque */
  --color-action:        #a05226;   /* latérite CTA — ratio sur canvas : 4.6:1 ✓ AA */
  --color-action-hover:  #8a4520;   /* valeur résolue pour hover, évite color-mix() */
  --color-action-dark:   #d9954e;   /* latérite sur sombre */
  --color-brand:         #b86a2e;

  /* Texte */
  --color-text:          #1f2329;   /* ratio sur canvas : ~13:1 ✓ AAA */
  --color-text-sec:      #4a5158;   /* ratio sur canvas :  7.1:1 ✓ AA */
  /*
    ⚠️ --color-text-muted à #8b9097 = ~2.9:1 sur canvas = ÉCHEC WCAG AA.
    Valeur corrigée : #6b7077 = ~4.6:1 ✓ AA.
    Interdit sur tout texte porteur de sens < 16 px — réservé aux éléments
    purement décoratifs ou aux icônes complétées par un label visible.
  */
  --color-text-muted:    #6b7077;   /* ratio sur canvas : 4.6:1 ✓ AA — valeur corrigée */

  /* Verdicts — rouge/vert strictement réservés aux états pass/fail */
  --color-verdict-pass-bg: #e9f1ec;
  --color-verdict-pass-fg: #2f6b46;   /* ratio sur pass-bg : 4.8:1 ✓ AA */
  --color-verdict-fail-bg: #fbeceb;
  --color-verdict-fail-fg: #8b1a1a;   /* ratio sur fail-bg : 5.2:1 ✓ AA */

  /* Bordure / élévation */
  --color-border:         rgba(0, 0, 0, 0.08);
  --elevation-static:     0 0 0 1px var(--color-border);
  --elevation-float:      0 2px 4px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.08);

  /* États */
  --state-selected-bg:   rgba(31, 78, 74, 0.08);
  --row-hover-bg:        rgba(31, 78, 74, 0.04);

  /* Focus — surface locale (défaut canvas clair) */
  --surface-current:     var(--color-canvas);

  /* Canvas RGB pour composites si nécessaire */
  --color-canvas-rgb:    247, 246, 244;
}

[data-theme="dark"] {
  --color-canvas: #111210;
  /* … autres tokens dark — définis ici, pas via @media prefers-color-scheme */
}
```

Supprimer `@media (prefers-color-scheme: dark)` du boilerplate. Supprimer `font-family: Arial`. Corriger `lang="en"` → `lang="fr"` sur `<html>`.

**Table de contraste obligatoire.** Toute paire texte/fond ajoutée ultérieurement doit porter son ratio en commentaire. Outil de référence : [APCA Checker](https://www.myndex.com/APCA/) ou `chrome-devtools > Accessibilité`. Cette table est une condition de gel du spec — pas une option.

### Échelle typographique — ratio 1.25 (Major Third), base 14 px

| Token | px | Usage |
|---|---|---|
| `text-2xs` | 11 | Labels `.label-caps` uniquement — interdit sur texte porteur de sens |
| `text-xs` | 12 | Texte de support, chips |
| `text-sm` | 14 | Corps dense (défaut tool) |
| `text-base` | 16 | Corps confort |
| `text-lg` | 20 | Titre de section |
| `text-xl` | 24 | Titre de page |
| `text-2xl` | 32 | Valeur de synthèse principale (plafond résultat calcul) |

`text-3xl` 40 px supprimé. Un résultat de calcul géotechnique n'est pas une métrique marketing. Le signal de crédibilité ingénieur est l'alignement tabulaire et l'unité, pas la taille. La valeur de synthèse plafonne à 32 px, et seulement s'il y a une valeur principale isolée — sinon corps dense.

**Tracking :**
- `≥ 32 px` → `letter-spacing: -0.02em`
- `14–24 px` → `letter-spacing: 0`
- Labels uppercase `11–12 px` uniquement → `letter-spacing: +0.06em`
- Sentence case partout — ALL CAPS interdit sauf micro-labels `.label-caps`

**Line-height :**
- Corps 14–16 px → `1.5`
- Titres ≤ 20 px → `1.3`
- ≥ 24 px → `1.2`
- Métriques → `1.1`

```css
.label-caps {
  font-size:      11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-weight:    500;
  color:          var(--color-text-muted); /* 4.6:1 sur canvas ✓ */
}
```

### Grille d'espacement — 4 pt stricte

Séquence : `4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64 px`. Toute valeur hors séquence est une anomalie. Gap icône/label : `6 px` ou `8 px` — constant.

### Élévation — 3 niveaux, un seul véhicule par niveau

| Niveau | Surface | Véhicule |
|---|---|---|
| 0 | Canvas `#f7f6f4` | Rien |
| 1 | Cards, panels, tables | `var(--elevation-static)` — hairline 1 px |
| 2 | Overlays flottants (dropdown, tooltip, Cmd+K, modale) | `var(--elevation-float)` — 2 couches |

Jamais élévation + bordure + background coloré sur le même composant.

### Iconographie — Lucide, bibliothèque unique

| Contexte | Taille | Stroke |
|---|---|---|
| Badges / chips | 14 px | 1.5 px |
| Champs, tableaux | 16 px | 1.5 px |
| Boutons | 20 px | 1.5 px |
| Icône standalone | 24 px | 1.5 px |

`aria-hidden="true"` sur toutes les icônes décoratives. Dans les tableaux denses : icône de statut seule + tooltip, jamais icône + texte redondant. Aucun glyphe Unicode.

### Tableaux denses (cœur métier)

- **Row height** : 44 px compact (seule valeur Phase 1 — densité 56 px relaxed en backlog, pas de préférence persistée Phase 1)
- **Colonnes numériques** : `font-variant-numeric: tabular-nums`, `font-family: var(--font-geist-mono)`, `text-align: right`
- **Colonne clé** : largeur fixe 160 px, `.label-caps`, `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` + tooltip `title`
- **Séparateur de ligne** : `1px solid var(--color-alt)` — quasi-invisible
- **Zébrures** : interdites (conflit avec hover/disabled)
- **Sticky header** : `box-shadow: 0 1px 0 var(--color-border)` via IntersectionObserver sentinelle, jamais de listener scroll
- **Valeur + unité** : `1 243` en `font-weight: 600` + `kPa` en `color: var(--color-text-muted) font-weight: 400`, deux spans distincts

```ts
// Helper formatage — défini une fois, jamais répliqué inline
const fmt = (n: number, decimals = 4) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: decimals }).format(n);
// Produit : 1 243,5 avec espace fine U+202F et virgule décimale
```

### Badges de verdict

```css
.badge-pass {
  background:    var(--color-verdict-pass-bg);
  color:         var(--color-verdict-pass-fg);
  border-radius: 2px; /* pas rounded-full — le pill est trop ludique */
}
.badge-fail {
  background:    var(--color-verdict-fail-bg);
  color:         var(--color-verdict-fail-fg);
  border-radius: 2px;
}
```

Icône Lucide `Check` ou `X` 14 px à gauche. Rouge/vert **interdits** sur tout autre composant (booléens de sortie moteur actuels à nettoyer).

### États vides / erreur — zéro dead-end

**État vide "premier usage"** : titre factuel court + sous-titre 1 ligne + 1 CTA latérite. Pas d'illustration sauf schéma sobre monochrome pétrole si elle clarifie.

**État "filtre sans résultat"** : message distinct + "Effacer les filtres". Pas le même composant que l'état vide.

**Erreur réseau** : message inline, icône `AlertCircle` 16 px, `--color-verdict-fail-fg`, 1 action "Réessayer".

**Zone résultat avant premier calcul** : espace pré-réservé (`min-height` identique à l'état chargé), "Le résultat apparaîtra ici après calcul." en `text-muted`, centré. Élimine le CLS, signal de maîtrise structurelle.

---

## D. Performance perçue et feedback

### Politique de feedback par seuil (non négociable)

| Durée calcul | Indicateur | Interdit |
|---|---|---|
| < 400 ms | Rien — résultat arrive directement | Spinner, skeleton |
| 400 ms – 3 s | Bouton pending + skeleton aux dimensions réelles | Barre de progression |
| > 3 s | Step-based honnête ("Étape 2/4") ou compteur d'itérations | Fausse barre qui saute à 100 % |

La barre de progression sur un calcul 1–3 s est incompatible avec l'honnêteté maison : elle ne peut être alimentée honnêtement.

### Focus management post-calcul (complet)

```ts
// Après CALC_SUCCESS
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
resultRef.current?.focus();
resultRef.current?.scrollIntoView({
  behavior: prefersReduced ? 'auto' : 'smooth',
  block: 'nearest'
});
```

```html
<div aria-live="polite" aria-atomic="true" className="sr-only">
  {status === 'loading' ? 'Calcul en cours' : status === 'success' ? 'Résultat prêt' : ''}
</div>
```

### Optimistic UI — frontières non négociables

**Autorisé :** renommer un projet, toggle, note — mise à jour locale 0 ms, réconciliation serveur, rollback doux 150 ms ease-in-out sur erreur.

**Interdit :** tout moteur de calcul géotech, émission de PV — résultat uniquement après réponse serveur authoritative. Aucun chiffre affiché avant. Non négociable (DoD §4/§8).

### Validation on-blur — deux niveaux distincts

- **Rouge (bloquant)** : désactive "Calculer" / "Émettre". Erreur inline : icône `AlertCircle` + texte constructif ("Attendu : module en MPa, ex. 50–15 000") + saisie conservée.
- **Orange (avertissement)** : hors plage physique plausible → bouton reste actif, ingénieur outrepasse consciemment. Unité explicite à côté de chaque champ.
- **Vert (succès)** : coche `Check` 16 px sur champs critiques validés.

Jamais de validation pendant la frappe.

### Raccourcis experts

| Raccourci | Action |
|---|---|
| `N` | Nouveau calcul |
| `D` | Dupliquer comme gabarit (retour quotidien le plus fort) |
| `Ctrl+Entrée` | Lancer le calcul |
| `E` | Exporter |

Documentés en tooltip in-context.

---

## E. Priorisation effort / impact

### P0 — Bloquant, multiplicateur systémique (½ journée) — **Engagement Phase 1**

1. `globals.css` : tokens couleur identité v3 (avec ratios contraste) + tokens motion + tokens focus + `prefers-reduced-motion` + correction `font-family` + toggle `data-theme`
2. `layout.tsx` : `lang="fr"`, variables Geist appliquées au `html`
3. Règle stylelint : interdire `transition: all`, `color: #hex` hors tokens, `outline: none` sans remplacement
4. Rouge/vert retirés des booléens de sortie moteur, réservés aux tokens verdict

Sans ce socle, tout le reste est incohérent à l'échelle.

### P1 — Impact immédiat, effort faible (1–2 jours) — **Engagement Phase 1**

5. Lucide React : remplacer tous les glyphes Unicode — gain visuel maximal par unité d'effort
6. Focus ring : `:focus-visible` avec `--surface-current`, `transition: none`, test axe-core CI
7. Feedback calcul : bouton pending + skeleton aux dimensions réelles + `clearTimeout` + timer 400 ms + `aria-live` + helper focus JS-aware `prefers-reduced-motion`
8. Tabular-nums + helper `fmt` : composant `<Metric>` unique, alignement droite, virgule + espace fine U+202F
9. Badges verdict : tokens pass/fail, `border-radius: 2px`, icône Lucide

### P2 — Craft systémique (2–3 jours) — **Backlog conditionnel post-câblage données**

10. Échelle typo : tokens 7 niveaux (pas 8 — `text-3xl` supprimé), tracking, line-height, `.label-caps`
11. Grille espacement : audit et correction des valeurs hors 4 pt
12. Élévation : `--elevation-static` sur cards, `--elevation-float` sur overlays uniquement
13. États vides : empty state premier usage + filtre sans résultat + zone résultat pré-réservée (CLS = 0)
14. Validation on-blur : deux niveaux, progressive enabling, messages inline

### P3 — Micro-finitions premium (1 jour) — **Backlog conditionnel post-câblage données**

15. Tableaux : sticky header IntersectionObserver, troncature + tooltip
16. Raccourcis experts + dupliquer-comme-gabarit
17. Modale PV : écran récap complet, libellé contextualisé
18. Endpoint card : Geist Mono 11 px, fond asphalte `#22262b`, texte `--color-action-dark`

---

## F. Ce qui a été écarté — gadget et pourquoi

### Supprimé définitivement

**Spring sur composants fonctionnels.** Spring = prolonge la vitesse d'un geste physique. Sur un bouton cliqué, une ligne de tableau, un onglet : il n'y a pas de geste à prolonger. L'effet est décoratif et ralentit le retour au calme. Toléré uniquement sur le drawer mobile gestuel (Phase 2 si retenu).

**Gradient purple-cyan et glow.** Signal "AI slop 2026" le plus identifiable. Contraire à la crédibilité ingénieur.

**Glassmorphism sur panneaux porteurs de données.** Réduit la lisibilité des valeurs numériques — l'exact opposé du besoin.

**Animations scroll-reveal dans les formulaires ou tableaux.** Péage répété à chaque ouverture. Pénalise les utilisateurs experts.

**Stagger sur lignes de tableau de résultats.** Les lignes apparaissent d'un bloc ; le stagger ralentit la lecture sans ajouter d'information.

**`transition: all`.** Anime des propriétés non prévues (y compris des propriétés provoquant des reflows), impossible à auditer, interdit.

**Slide horizontal entre modules (chaussées / fondations / labo).** Les trois domaines sont des pairs structurels, pas des étapes d'un flux. Le slide implique une hiérarchie qui n'existe pas.

**Barre de progression sur calcul 1–3 s.** Inaliméntable honnêtement — toute implémentation serait une fausse barre. Contraire à la culture maison "ne surcote pas".

**`@media (prefers-color-scheme: dark)` dans `globals.css`.** Contredit le toggle `data-theme` explicite. Dark auto = perte de contrôle de la surface au moment du rendu.

**`color-mix()` à la volée pour les hover.** Support large en 2026 mais parc de terminaux ancien probable en AOF (3G fréquent). Remplacé par `--color-action-hover` en valeur résolue dans les tokens.

**`text-3xl` 40 px "hero number".** Tic de dashboard SaaS grand public. Un résultat géotech n'est pas une métrique marketing. Plafonné à `text-2xl` 32 px.

**Stagger d'entrée initiale de vue (#19 version antérieure).** Contredit l'esprit "le calme vient de l'absence de bruit". Péage répété dès la 3e ouverture de session. Écarté.

**Densité "relaxed" 56 px persistée en Phase 1.** Préférence persistée = stockage + hydratation + test = coût réel pour un gain faible. 44 px compact seul en Phase 1, option en backlog.

**Framer Motion en Phase 1.** Dépendance injustifiée si le drawer mobile gestuel est hors scope (confirmé). CSS transitions suffisent pour tous les cas retenus.

**View Transitions cross-document.** +70 ms LCP mobile, timeout dur 4 s sur réseau 3G (fréquent en AOF). Ne pas activer en Phase 1. Réévaluer après mesure LCP réel en Phase 2.

**Cross-dissolve 200 ms sur onglets projet.** Contredit la règle "haute fréquence = instantané" et peut créer un double-render transitoire sur des vues à tableau lourd. Swap instantané retenu.

---

## Points ouverts résiduels (à trancher par le titulaire avant gel définitif)

1. **Table de contraste complète.** Les ratios des paires primaires sont inscrits dans les tokens ci-dessus. Toute paire ajoutée en cours de build doit porter son ratio en commentaire. Condition de gel.
2. **Test axe-core CI.** Le focus ring et les contrastes doivent être couverts par un test automatisé (`jest-axe` ou équivalent) en gate CI. À instrumenter en P1.
3. **Drawer mobile gestuel.** Si retenu en Phase 2 : Framer Motion introduit à ce moment uniquement, spring `stiffness=220, damping=28, mass=1`.
4. **Step-based honnête > 3 s.** Le format exact ("Étape 2/4" vs compteur d'itérations) dépend des données du moteur. À préciser lors du câblage du premier moteur long.