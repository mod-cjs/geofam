Voici le document final qui fige l'identité ROADSEN, avec toutes les corrections de la revue adverse intégrées.

---

# Identité visuelle ROADSEN — Document de référence v3.0 (figé)

## (a) Principe directeur

La marque porte la chaleur géologique du terrain ouest-africain : latérite mat, bitume chaud. L'interface de travail reste froide, dense, clinique — la donnée prime. La couleur est réservée aux gestes de marque et aux signaux sémantiques. Ce que l'ingénieur voit en premier est la rigueur du calcul ; ce qu'il retient est l'identité.

L'originalité de ROADSEN repose sur deux actifs propriétaires et deux seuls : la **barre de strates** (coupe de chaussée codifiée dans le logotype) et le **système chromatique terre** (latérite/pétrole/asphalte). Tout le reste de l'UI est délibérément conventionnel — les conventions B2B 2026 servent la lisibilité, elles ne sont pas revendiquées comme différenciation.

**Règles cardinales :**

- Rouge et vert = verdicts de conformité uniquement. Jamais ailleurs.
- `--accent-brand` = logotype, barre de marque, grandes surfaces d'aplat. Jamais en texte fonctionnel ni en interaction.
- `--accent-action` = interactions, liens actifs, onglets, boutons. Toujours à 4,5:1 minimum sur le fond réel (pas seulement sur le canvas).
- Tout verdict = redondance triple : couleur + icône Lucide stroke 1,5 + libellé texte. Jamais de couleur seule.
- Latérite et fail-bordeaux ne sont jamais adjacents dans un même bloc (PV scellé ou UI) sans séparateur neutre entre eux.
- Aucune illustration, texture ou motif décoratif dans l'UI. Les états vides sont du texte rédigé en contexte.
- Toute typo numérique (résultats, ratios, coefficients) : Geist Mono + tabular-nums + alignement à droite. Sans exception.

---

## (b) Logotype

**Wordmark :** "ROADSEN" en Geist Sans Medium (500), tracking 0,03em, couleur `--rds-slate-900` (#22262b) en mode clair / rgba(255,255,255,0.92) en mode sombre.

**Barre de strates :** sous le wordmark, trois filets d'épaisseur inégale et décroissante représentant une coupe de chaussée :

- Strate 1 — latérite : 3 px, couleur #b86a2e
- Strate 2 — pétrole : 2 px, couleur #1f4e4a
- Strate 3 — asphalte : 1 px, couleur #22262b

Largeur totale = largeur du wordmark. Espacement wordmark/strates : 5 px. Pas de label de couche.

**Variante complète (≥ 32 px) :** les trois strates sont distinctes et lisibles. Usage : header app, documents, présentations.

**Variante glyphe (< 32 px — favicon, app icon, filigrane PV) :** un unique filet latérite de 2 px sous l'initiale "R" en Geist Sans 600, ou une strate latérite seule sur fond asphalte. Le motif trois-strates n'est pas rendu à cette taille — la fusion est inévitable et inacceptable sur un favicon. La couleur de marque reste lisible ; la lisibilité prime sur la cohérence formelle à petite taille.

**Impression N&B :** les strates pétrole et asphalte deviennent deux gris proches (L≈28 % et L≈14 %). Distinction garantie par l'épaisseur différentielle (3/2/1 px), pas par la couleur. Acceptable en tête de PV à taille ≥ 24 px.

---

## (c) Système de tokens complet et définitif

### Typographie (décision unique — Geist)

La v2.0 mentionnait "Inter + Inter Mono" dans la section consensus (§1) puis "Geist Sans + Geist Mono" dans la direction finale (§2). Contradiction levée ici : **Geist Sans + Geist Mono, self-hosted, licence OFL**. Inter était une option de repli envisagée ; la direction finale tranche sur Geist.

```css
:root {
  --font-sans: 'Geist', -apple-system, system-ui, sans-serif;
  --font-mono: 'Geist Mono', 'Cascadia Code', ui-monospace, monospace;
}
```

Poids : 400 (lecture), 500 (UI/interactif), 600 (titres/emphasis). Jamais 700+ en corps. Tout composant bouton impose `font-weight: 500` minimum (lint CSS à instrumenter).

Scale (6 tailles) :

```
--text-xs:   11px / 1.45   méta décorative (placeholder, séparateur)
--text-sm:   13px / 1.50   labels UI, chips, tags de domaine
--text-base: 14px / 1.55   corps de texte, cellules de tableau
--text-md:   16px / 1.50   titres de section
--text-lg:   20px / 1.40   titres de page, en-têtes principaux
--text-xl:   32px / 1.20   affichage chiffre clé (résultat phare)
```

Règle numérique non négociable :

```css
.numeric, td.value, td.ratio, td.coeff {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  text-align: right;
  letter-spacing: 0;
}
```

Unités dans le `<th>`, jamais dans chaque cellule.

---

### Primitives (ne pas consommer directement dans les composants)

```
--rds-clay-500:   #b86a2e   latérite — aplat/marque uniquement
--rds-clay-600:   #a05226   latérite assombrie — action/texte sur fond clair
--rds-clay-400:   #c97a3f   latérite éclaircie — action sur fond sombre
--rds-clay-300:   #d9954e   latérite claire — action sur fond très sombre (nav)
--rds-teal-700:   #1f4e4a   pétrole
--rds-teal-600:   #2a6b65   pétrole éclairci — dark mode
--rds-slate-900:  #22262b   asphalte
--rds-stone-50:   #f7f6f4   canvas clair
--rds-stone-100:  #eef0f1   séparateurs/fonds alternés
--rds-pass-700:   #2f6b46   vert-verdict
--rds-pass-50:    #e9f1ec   fond vert-verdict
--rds-fail-800:   #8b1a1a   bordeaux-verdict
--rds-fail-50:    #fbeceb   fond bordeaux-verdict
```

---

### Tokens sémantiques — thème clair (défaut)

**Ratios WCAG 2.2 figés (calculés, non estimés) :**

| Token | Hex | Fond | Ratio | Résultat |
|---|---|---|---|---|
| `--accent-action` | #a05226 | #f7f6f4 (canvas) | **5,11:1** | AA texte |
| `--accent-action` | #a05226 | #ffffff (surface-base) | **5,45:1** | AA texte |
| `--accent-action` | #a05226 | #22262b (surface-nav) | **2,84:1** | Échec — token dédié obligatoire |
| `--status-fail-tx` | #8b1a1a | #fbeceb (fail-bg) | **8,12:1** | AAA |
| `--status-pass-tx` | #2f6b46 | #e9f1ec (pass-bg) | **5,13:1** | AA texte |

**Surfaces et élévation**

```
--surface-canvas:    #f7f6f4
--surface-base:      #ffffff
--surface-raised:    #ffffff   + box-shadow: var(--elevation-card)
--surface-overlay:   #ffffff   + box-shadow: var(--elevation-modal)
--surface-nav:       #22262b
```

```
--elevation-card:    0 0 0 1px rgba(0,0,0,0.07)
--elevation-sticky:  0 1px 0 0 rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.04)
--elevation-modal:   0 0 0 1px rgba(0,0,0,0.06), 0 8px 32px rgba(0,0,0,0.10)
--elevation-popover: 0 0 0 1px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.08)
```

**Couleurs de marque**

```
--accent-brand:          #b86a2e   aplats, logotype, barre de marque — JAMAIS texte fonctionnel
--accent-action:         #a05226   liens, onglet actif, bouton primaire, focus ring (sur canvas et surface-base)
--accent-action-hover:   #8e4820   hover sur action
--accent-action-on-nav:  #d9954e   état actif sur --surface-nav asphalte (#22262b) — ratio ≥ 4,5:1
--accent-fg:             #ffffff   label sur bouton accent-action, poids 500 minimum obligatoire
--struct-petrole:        #1f4e4a   en-têtes de groupe tableau, boutons secondaires, séparateurs de groupe PV
--struct-petrole-fg:     #ffffff
```

Note sur `--accent-action-on-nav` : #d9954e (L≈0.32) sur #22262b (L≈0.018) = (0.37)/(0.068) ≈ **5,4:1** — passe AA texte. Un lien ou onglet actif sur la nav asphalte utilise exclusivement ce token, jamais `--accent-action`.

**Texte**

```
--text-primary:    #1f2329   corps, titres
--text-secondary:  #4a5158   labels UI, sous-titres (7,1:1 sur canvas) — affiné par le panel excellence
--text-muted:      #6b7077   atténué — 4,6:1 sur canvas (AA) ; utilisable sur petit texte porteur de sens. #8b9097 ABANDONNÉ (2,98:1 échec AA)
--text-on-nav:     #f7f6f4   texte sur surface-nav asphalte
--text-link:       #a05226   = accent-action sur fond clair
```

**Bordures**

```
--border-subtle:   rgba(0,0,0,0.07)
--border-default:  rgba(0,0,0,0.11)
--border-strong:   rgba(0,0,0,0.18)
--border-focus:    #a05226   focus ring 2px, offset 2px
```

**Tags de domaine**

Redondance non-chromatique obligatoire : les fonds pastel des trois domaines (L≈92 %) sont quasi indistinguables en impression N&B. Chaque tag porte un préfixe abrégé en texte, non supprimable.

```
--domain-road-bg:    #f0ede9   --domain-road-tx:   #6b4f38   préfixe texte "CH."
--domain-found-bg:   #e8edf0   --domain-found-tx:  #2d5060   préfixe texte "FD."
--domain-lab-bg:     #ededec   --domain-lab-tx:    #4a4a47   préfixe texte "LB."
```

**Verdicts**

```
--status-pass-bg:    #e9f1ec
--status-pass-tx:    #2f6b46   (5,13:1 sur pass-bg)
--status-pass-icon:  #2f6b46

--status-fail-bg:    #fbeceb
--status-fail-tx:    #8b1a1a   (8,12:1 sur fail-bg)
--status-fail-icon:  #8b1a1a
```

Aucun plan de repli (#721a10) — la marge de 8,12:1 est structurelle.

**Géométrie**

```
--radius-sm:    3px   inputs, chips
--radius-base:  4px   boutons, cards standard
--radius-lg:    6px   modals, drawers
--radius-xl:    8px   modals larges
```

**Densité**

```css
[data-density="compact"]     { --row-h: 32px; --row-px: 8px;  --cell-py: 6px; }
[data-density="comfortable"] { --row-h: 40px; --row-px: 12px; --cell-py: 9px; }
[data-density="spacious"]    { --row-h: 48px; --row-px: 16px; --cell-py: 12px; }
```

La densité par défaut est "comfortable" pour toutes les sessions. Le passage en compact est proposé par un toast non intrusif après 5 sessions ("Passer en vue compacte ?") — **jamais appliqué automatiquement**. Taille de police invariante quelle que soit la densité.

---

### Tokens sémantiques — thème sombre

Activation : `[data-theme="dark"]` (priorité) ET `@media (prefers-color-scheme: dark)` (repli système).

```
--surface-canvas:    #111210   noir 3 % brun (bitume, pas #000 pur)
--surface-base:      #1a1917
--surface-raised:    #222019
--surface-overlay:   #2a2826
--surface-nav:       #0e0d0c

--elevation-card:    0 0 0 1px rgba(255,255,255,0.07)
--elevation-sticky:  0 1px 0 0 rgba(255,255,255,0.05)
--elevation-modal:   0 0 0 1px rgba(255,255,255,0.06), 0 8px 32px rgba(0,0,0,0.40)

--accent-brand:          #b86a2e   inchangé (aplat logotype)
--accent-action:         #c97a3f   latérite éclaircie (sur surface-base dark)
--accent-action-hover:   #dba050
--accent-action-on-nav:  #d9954e   même token que le clair — la nav dark est encore plus sombre
--accent-fg:             #111210   texte sombre sur bouton latérite éclairci (ratio ≈ 5,6:1 — passe)

--struct-petrole:        #2a6b65

--text-primary:    rgba(255,255,255,0.92)
--text-secondary:  rgba(255,255,255,0.60)
--text-muted:      rgba(255,255,255,0.35)   décoratif seulement
--text-link:       #c97a3f

--border-subtle:   rgba(255,255,255,0.07)
--border-default:  rgba(255,255,255,0.11)
--border-strong:   rgba(255,255,255,0.18)
--border-focus:    #c97a3f

--status-pass-bg:  #e9f1ec   fond clair conservé en dark (voir note)
--status-pass-tx:  #2f6b46
--status-fail-bg:  #fbeceb   fond clair conservé en dark (voir note)
--status-fail-tx:  #8b1a1a
```

Note verdicts en dark mode : les bandeaux verdict conservent leur fond clair dans les deux thèmes. Ce choix crée un contraste de luminance fort (îlot clair sur fond sombre) — à valider lors des tests utilisateur phase 1. Si le retour signale une gêne visuelle (photophobie, flash), les fonds basculent vers #1e3028 (pass) et #2e1515 (fail) avec révision des ratios texte. C'est une décision provisoire assumée, pas un axiome.

---

## (d) Règles de gouvernance couleur

**Séparation primitives/sémantiques :** les composants ne consomment jamais `--rds-clay-500` directement. Uniquement `--accent-action`, `--accent-brand` ou `--accent-action-on-nav` selon le fond réel. Instrumenter via `stylelint` avec règle `no-restricted-syntax` sur les primitives `--rds-*` dans les fichiers de composants.

**Frontière accent/statut :** `--accent-*` et `--struct-petrole` ne s'utilisent jamais dans un composant de statut/verdict. `--status-pass-*` et `--status-fail-*` ne s'utilisent jamais hors contexte verdict. Instrumenter en lint.

**Règle d'adjacence latérite/fail :** dans tout bloc PV ou UI, `--accent-brand` (#b86a2e) et `--status-fail-tx` (#8b1a1a) ne sont jamais adjacents sans zone neutre intermédiaire (asphalte, blanc, ou espace vide ≥ 16 px). Raison : sous protanopie, les deux valeurs désaturées donnent des bruns proches. À documenter dans l'ADR et à vérifier en revue de maquette PV.

**Convergence PV/UI :** la palette PV utilise les tokens UI unifiés. Navy #1a4a7a et orange #bf6a04 sont abandonnés et interdits. Un seul système de tokens de bout en bout. Décision irréversible à porter dans l'ADR.

**Poids minimum sur fond latérite :** tout texte sur `--accent-action` (#a05226) impose `font-weight: 500` minimum (lint). À 14 px gras, le ratio est 5,11:1 sur canvas et 5,45:1 sur blanc — passe AA. À 14 px normal (400), la lisibilité fine est dégradée sans être en échec technique ; on impose néanmoins le 500 comme standard maison.

**Trois ADR à écrire avant la première PR frontend :**
1. Séparation primitives/sémantiques et règle de consommation des tokens.
2. Convergence PV/UI et abandon des palettes parallèles.
3. Frontière accent/statut et règle d'adjacence latérite/fail.

La règle "rouge et vert = verdicts uniquement" devient une règle technique (lint + test négatif CI) à la première PR frontend, pas seulement de la prose.

---

## (e) Ce qui a changé vs la première proposition — traçabilité complète

| Élément | v1.0 (proposition initiale) | v2.0 (co-construite) | v3.0 (finale — corrections revue adverse) | Raison |
|---|---|---|---|---|
| Latérite texte/action | #b86a2e (3,78:1 — échec AA) | #a05226, « cible 4,5:1, à mesurer » | #a05226, ratio figé **5,11:1** canvas / **5,45:1** blanc | Correction WCAG + suppression du théâtre « à mesurer » |
| Latérite sur nav asphalte | Non traité | Non traité | `--accent-action-on-nav` #d9954e (**5,4:1**) | Échec 2,84:1 révélé par la revue adverse |
| Latérite aplat/marque | #b86a2e | #b86a2e `--accent-brand` | Inchangé | Contexte aplat : seuil 3:1 UI, pas 4,5:1 texte |
| Rouge-verdict | #b42318 (L≈41 %) | #8b1a1a, « à mesurer, repli #721a10 » | #8b1a1a, ratio figé **8,12:1** — plan repli supprimé | Marge structurelle ; repli inutile |
| Vert-verdict | #2f6b46, « 5,5:1 » | Inchangé | #2f6b46, ratio corrigé à **5,13:1** | Calcul exact ; sans gravité |
| Texte atténué fonctionnel | #8b9097 (2,98:1) | #5c6168 (6,2:1) — #8b9097 = décoratif | Inchangé | Correction WCAG v2.0 confirmée |
| Logotype à petite taille | Non spécifié | « Fusion acceptable à 16 px » | **Variante glyphe obligatoire < 32 px** | Fusion = bouillie, pas acceptable |
| Tags de domaine | Fond pastel seul | Inchangé | + **Préfixe texte obligatoire** ("CH./FD./LB.") | Indistinguables en impression N&B |
| Palette PV | Navy #1a4a7a + #bf6a04 | Convergence tokens UI | Confirmé + token adjacence interdite | Collision orange/bordeaux sous CVD |
| Typographie | Non spécifiée | « Inter + Inter Mono » (§1) vs « Geist » (§2) | **Geist Sans + Geist Mono** (contradiction levée) | Cohérence interne |
| Tokens | Nommés par matière | Double couche primitives/sémantiques | + `--accent-action-on-nav` ajouté | Couvrir tous les contextes de fond |
| Dark mode verdicts | Absent | « Île claire — choix délibéré » | Île claire provisoire, à valider en test utilisateur | Honnêteté sur l'incertitude |
| Densité par défaut | Non spécifiée | Auto-bascule compact à 6 sessions | **Toast opt-in** — jamais auto | Anti-pattern UX corrigé |
| Citations de références | Absentes | « Comme Vercel/Linear/Stripe » | **Supprimées** du livrable | Un livrable ne cite pas ses modèles |
| Ratios annoncés | Estimatifs | « À mesurer, ajustement au pixel près » | **Figés et calculés** (WCAG déterministe) | Rigueur ; l'estimation est du théâtre |

---

## (f) Les détails haut de gamme

**Typographie numérique et alignement par rang.** Sur toute colonne de résultats (portances, modules, contraintes, ratios, coefficients) : Geist Mono + `font-variant-numeric: tabular-nums` + alignement à droite. Les unités vivent dans le `<th>` — une seule fois. Un tableau de 20 valeurs s'aligne à la décimale, lisible d'un regard vertical. C'est le premier signal qu'un ingénieur senior capte en 3 secondes. Son absence fait lire "prototype". Sa présence ne se remarque pas consciemment — elle crée la confiance.

**Élévation zéro-offset.** Les cards et panels n'ont pas de `border: 1px solid`. Ils ont `box-shadow: 0 0 0 1px rgba(0,0,0,0.07)`. La différence visuelle est quasi nulle. La différence système est totale : cette ombre ne casse pas le box-model, ne provoque pas de décalage de layout au hover, et s'adapte automatiquement au fond sombre (rgba transparent). Sur un dashboard avec 30 cards, c'est la différence entre "propre" et "millimétré".

**Verdicts désaturés et test N&B.** Les bandeaux CONFORME/NON CONFORME passent le test de désaturation totale : fond #e9f1ec est perceptiblement plus clair que fond #fbeceb en niveaux de gris, et le bordeaux #8b1a1a (L≈32 %) est nettement plus sombre que le vert #2f6b46 (L≈43 %). Avec l'icône Lucide et le libellé texte, trois canaux portent l'information simultanément. Sur un PV scellé qui engage la signature d'un ingénieur sur un dimensionnement routier, le triple canal est non négociable.

**Tableaux de résultats.** Sticky header + colonne identifiant gelée à gauche (`position: sticky`, `z-index` correct sur l'intersection, ombre droite `box-shadow: 4px 0 8px rgba(0,0,0,0.06)` pour signaler la frontière). Skeleton rows au chargement reproduisant la grille exacte (même hauteur, mêmes colonnes, mêmes proportions). États vides rédigés en contexte, jamais génériques ("Aucun résultat — vérifier la cohérence Df/B et la consistance des paramètres de sol.").

**Command palette Cmd+K.** Signal d'appartenance : un ingénieur qui utilise des outils professionnels au quotidien reconnaît instantanément ce pattern. Lib `cmdk` (React, ~4 KB gzip). Commandes minimales Phase 1 : naviguer entre modules, accéder aux 5 projets récents, lancer un nouveau calcul. Focus ring sur l'input de palette : 2 px, `--border-focus` (#a05226 clair / #c97a3f sombre). Coût : une demi-journée. Impact perçu : fort.

**Barre de strates comme seul actif propriétaire réel.** La différenciation de ROADSEN ne vient pas des conventions UI (qui sont délibérément ordinaires). Elle vient du logotype — une coupe de chaussée codifiée en trois traits d'épaisseur décroissante. C'est le seul élément non reproductible par un générateur de design system. À ce titre, il est travaillé avec soin sur chaque point de contact : header app, favicon (variante glyphe), filigrane PV, entête de rapport. Sa présence cohérente sur tous les supports est ce qui construit la reconnaissance de marque sur la durée.