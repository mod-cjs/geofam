J'ai tous les documents. Je produis maintenant les trois prompts.

---

**Lot 1 — Design system atomique**

```
You are producing a design system reference for ROADSEN, a professional multi-tenant SaaS for geotechnical and road engineering calculations. Users are structural engineers (BET) in West Africa. The UI language is French. The aesthetic is deliberately conventional and dense — credibility over decoration. No emojis, no illustration, no AI-slop gradients.

## Design tokens (encode exactly — never invent hex values)

### Surfaces
--surface-canvas: #f7f6f4
--surface-base: #ffffff
--surface-raised: #ffffff (+ box-shadow: 0 0 0 1px rgba(0,0,0,0.07))
--surface-overlay: #ffffff (+ box-shadow: 0 0 0 1px rgba(0,0,0,0.06), 0 8px 32px rgba(0,0,0,0.10))
--surface-nav: #22262b (asphalte)
--surface-nav-hover: #2d3237

### Action / Brand
--accent-brand: #b86a2e (logo, brand stripe, large fills — NEVER functional text)
--accent-action: #a05226 (CTA buttons, active links, focus ring — on canvas/white only)
--accent-action-hover: #8e4820
--accent-action-on-nav: #d9954e (active state on --surface-nav, ratio 5.4:1 AA)
--accent-fg: #ffffff (label on accent-action button, weight 500 min)
--struct-petrole: #1f4e4a (table group headers, secondary buttons, active nav underline)
--struct-petrole-fg: #ffffff

### Text
--text-primary: #1f2329
--text-secondary: #4a5158 (7.1:1 on canvas)
--text-muted: #6b7077 (4.6:1 on canvas — AA; decorative only if below this)
--text-on-nav: #f7f6f4
--text-link: #a05226

### Borders / Elevation
--border-subtle: rgba(0,0,0,0.07)
--border-default: rgba(0,0,0,0.11)
--border-strong: rgba(0,0,0,0.18)
--border-focus: #a05226 (focus ring 2px offset 2px)
--elevation-card: 0 0 0 1px rgba(0,0,0,0.07) (zero-offset — never border + elevation on same element)
--elevation-sticky: 0 1px 0 0 rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.04)
--elevation-modal: 0 0 0 1px rgba(0,0,0,0.06), 0 8px 32px rgba(0,0,0,0.10)
--elevation-popover: 0 0 0 1px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.08)

### Verdict tokens (RED/GREEN — ONLY for pass/fail verdicts, nowhere else)
--status-pass-bg: #e9f1ec
--status-pass-tx: #2f6b46 (5.13:1 on pass-bg)
--status-pass-icon: #2f6b46
--status-fail-bg: #fbeceb
--status-fail-tx: #8b1a1a (8.12:1 on fail-bg)
--status-fail-icon: #8b1a1a

### Domain tags
--domain-road-bg: #f0ede9 / --domain-road-tx: #6b4f38 (prefix "CH.")
--domain-found-bg: #e8edf0 / --domain-found-tx: #2d5060 (prefix "FD.")
--domain-lab-bg: #ededec / --domain-lab-tx: #4a4a47 (prefix "LB.")

### Geometry
--radius-sm: 3px (inputs, chips)
--radius-base: 4px (buttons, standard cards)
--radius-lg: 6px (modals, drawers)
--radius-xl: 8px (large modals)

### Typography
Font: Geist Sans (sans) + Geist Mono (numeric values, hashes, code)
Weights used: 400 (body), 500 (UI/interactive — minimum on buttons), 600 (headings)
Never 700+ in body.
Scale:
  11px / 1.45 — decorative meta, section labels (uppercase + 0.06em tracking, 500)
  13px / 1.50 — UI labels, chips, domain tags
  14px / 1.55 — body text, table cells (default)
  16px / 1.50 — section headings
  20px / 1.40 — page headings
  32px / 1.20 — key metric display (max — never exceed for a calculation result)
ALL numeric values (results, ratios, coefficients): Geist Mono + font-variant-numeric: tabular-nums + text-align: right. Units in <th> only, never repeated in each cell.

### Density (comfortable — P1 default)
--row-h: 40px / --row-px: 12px / --cell-py: 9px

### Motion tokens
--dur-instant: 100ms / --dur-fast: 150ms / --dur-base: 200ms
--ease-entrance: cubic-bezier(0.165,0.84,0.44,1)
--ease-exit: cubic-bezier(0.55,0,1,0.45)
--ease-state: cubic-bezier(0.455,0.03,0.515,0.955)
Only animate: opacity, transform. Never: width, height, padding, box-shadow in animation.
High-frequency actions (form fields, tabs, Cmd+K): zero animation — instant.
Focus ring: transition: none always.

## LOGOTYPE (A-18) — draw in all variants

The ROADSEN logotype has two parts:
1. Wordmark: "ROADSEN" in Geist Sans 500, tracking 0.03em, color --text-primary (#1f2329)
2. Strata bar (the sole proprietary asset): three horizontal rules of unequal decreasing thickness directly below the wordmark, separated by 5px:
   - Stratum 1 / latérite: 3px, #b86a2e
   - Stratum 2 / pétrole: 2px, #1f4e4a
   - Stratum 3 / asphalte: 1px, #22262b
   Total width = wordmark width. No layer labels.

Variants to show (all in one artboard):
- Full ≥32px: wordmark + three distinct strata (sidebar header, documents)
- Glyph <32px: single 2px latérite stripe below "R" in Geist Sans 600, or latérite stripe on asphalte background (favicon, PV watermark) — the three-strata pattern is FORBIDDEN at this size (merging is unacceptable)
- Collapsed sidebar (64px wide): strata visible, wordmark sr-only (show visually hidden label annotation)
- Dark mode: wordmark rgba(255,255,255,0.92), strata unchanged
- N&B print: pétrole and asphalte strata become L≈28% and L≈14% grey — readable via thickness differential (3/2/1px)

## COMPONENTS TO PRODUCE — one artboard per component, all states side by side

### A-25 — Tokens visual reference
Single artboard showing the token palette: all surface swatches labeled, all text colors on their backgrounds with ratio annotations, verdict colors isolated in their verdict-only zone (labeled "VERDICTS UNIQUEMENT"), domain tags with prefixes, brand and action tokens labeled. This is for design system documentation, not a UI screen.

### A-17 — Focus ring
Isolated examples on: canvas background, white surface, asphalte/nav background (--surface-current override). Show: 2px outline --border-focus (#a05226), offset 2px, outer box-shadow double ring. Annotate: "transition: none — instantané".

### A-24 — Kbd (keyboard shortcut)
States: single key (ex. "N"), chord (ex. "Ctrl+Entrée"), in tooltip context, in Cmd+K list, standalone. Style: subtle background, border-radius 3px (--radius-sm), Geist Mono 11px, border-subtle. Semantic tag: <kbd>.

### A-23 — Avatar / Monogram
Sizes: sm (24px), md (32px), lg (40px).
States: with image (circular, no border), fallback initials (2 letters, color derived from name — use pétrole #1f4e4a as example fill, white text), loading skeleton. Show in: sidebar footer, topbar, OrgSwitcher context (annotate "même composant, même store").

### A-01 — Button
4 variants: action (latérite fill), secondary (--struct-petrole outline), ghost (transparent), danger (--status-fail-tx outline or fill).
3 sizes: sm (28px), md (32px), lg (40px).
States for each: défaut · hover · focus-visible (focus ring) · loading (Loader2 icon spinning + "En cours…" label + aria-busy="true", opacity 0.65) · disabled (opacity 0.65) · icon-left · icon-only.
Special case on asphalte background: action button uses --accent-action-on-nav (#d9954e) for label or bg treatment — show an example.
Rule: font-weight 500 minimum. border-radius --radius-base (4px). Conditional button = ABSENT not greyed (annotate: "bouton conditionnel = absent, jamais grisé").

### A-02 — Input field (text)
States: défaut · focus (--border-focus 2px) · filled-valid · validated on-blur (Check 16px icon, --status-pass-tx) · error-blocking (AlertCircle 16px, --status-fail-tx, inline message) · warning-orange (out-of-range, button stays active) · disabled · with-unit (unit label right-aligned inside or adjacent) · with-help (question icon + tooltip) · placeholder.
Show: "Validation uniquement on-blur — jamais pendant la frappe" annotated.
Show unit field example: "E (MPa)" with label above, unit suffix inside field.

### A-03 — Select
States: défaut · focus · open-dropdown (with option-hover and option-selected) · disabled · error.
Dropdown: ChevronDown icon aria-hidden, border-radius --radius-base, --elevation-popover shadow. ESC closes, focus returns to trigger.

### A-04 — Textarea
States: défaut · focus · resize-vertical-only · disabled · error-inline.
Annotation: "Validation on-blur identique à Input".

### A-05 — Checkbox / Radio / Switch
Checkbox states: défaut · hover · focus-visible · checked · indeterminate · disabled · erreur-inline (message below fieldset).
Radio states: défaut · hover · focus-visible · selected · disabled.
Switch states: défaut · hover · focus-visible · on (pétrole fill) · off · disabled.
Show in a fieldset group (label + helper text pattern). Note: "Switch = optimistic UI autorisé".

### A-06 — Badge statut
All variants (one row each with icon + text — triple redundancy: color + Lucide icon 14px + label):
- Conforme / PASS: --status-pass-bg / --status-pass-tx, Check icon
- Non conforme / FAIL: --status-fail-bg / --status-fail-tx, X icon
- En attente / Neutre: --border-default bg, --text-secondary, Clock icon
- Recalculable: outline --border-default, --text-secondary, RefreshCw icon
- Scellé: --surface-nav bg (#22262b), --text-on-nav, Lock icon (NEVER green — asphalte badge only)
- En cours: neutral bg, --text-secondary, Loader2 icon
- Erreur: --status-fail-bg, --status-fail-tx, AlertCircle icon
border-radius: 2px (not pill — too playful). Annotate: "Vert/rouge = verdicts uniquement".

### A-07 — Domain tag
3 variants in two contexts (inline in list + standalone in library):
- "CH. Chaussées": --domain-road-bg / --domain-road-tx + 6px circle fill #6b4f38
- "FD. Fondations": --domain-found-bg / --domain-found-tx + 6px circle fill #2d5060
- "LB. Sol & Labo": --domain-lab-bg / --domain-lab-tx + 6px circle fill #4a4a47
Rule: text prefix NON-SUPPRESSIBLE (N&B print, color-vision deficiency). Show "INTERDIT: pastille seule" as a crossed-out example.

### A-08 — Verdict banner
2 forms: compact (résultats inline) + extended (PV, full width).
CONFORME: --status-pass-bg fill, left border 4px --status-pass-tx, Check icon 20px, "CONFORME" label, optional sub-text.
NON CONFORME: --status-fail-bg fill, left border 4px --status-fail-tx, X icon 20px, "NON CONFORME" label, optional sub-text.
Rule: latérite and bordeaux-verdict NEVER adjacent without ≥16px neutral separator (annotate this).
Dark mode note: fond clair conservé (island on dark bg) — annotate as provisional, to validate in user testing.

### A-10 — Metric component
Variants:
- Isolated value (32px 600 Geist Mono, tabular-nums, right-aligned, value + unit in separate spans: "1 243" weight 600 + " kPa" --text-muted weight 400)
- Table value (14px 600 Geist Mono, tabular-nums, right-aligned)
- Unavailable ("—" em dash, --text-muted)
- Out-of-range value (--status-fail-tx, AlertTriangle icon 14px)
- NaN/Infinity → "—" (annotate: "jamais 'NaN' ou 'Infinity' brut")
Helper annotation: fmt() using Intl.NumberFormat 'fr-FR' — produces "1 243,50" with narrow no-break space U+202F and comma decimal.

### A-11 — Card / Panel
Card projet: 240px wide, --elevation-card shadow (zero-offset 1px), radius --radius-base, hover state (shadow slightly elevated — still zero-offset), clickable (cursor pointer, subtle bg shift). Contains: project name 14px 500, metadata --text-secondary 13px.
Card bibliothèque moteur: domain tag top-left, engine name 16px 500, description 13px --text-secondary, no launch button (library = read-only).
Panel formulaire: full-width, --surface-base, --elevation-card border.
Panel repliable: header row with ChevronRight icon, collapsed + expanded states.
Rule: NEVER elevation + border + colored background on same element simultaneously.

### A-12 — Modal / Dialog
Sizes: sm (480px), md (600px), lg (760px).
States: défaut (header + body + footer) · backdrop (rgba(0,0,0,0.5)) · ouverture (opacity 0→1 + scale 0.98→1, --dur-base --ease-entrance) · fermeture (opacity 1→0, --dur-fast) · erreur-inline (in body) · loading-interne (spinner in footer button).
Focus: first focusable element on open. ESC closes, focus returns to trigger. inert on <main>. aria-modal="true".
Large modal note: "Modale lg = écran de récapitulatif que l'ingénieur relit — pas un 'Êtes-vous sûr ?'".
<768px behavior: annotate "plein écran, footer fixe en bas, corps scrollable".

### A-13 — Dropdown / Action menu
States: ouverture (opacity 0→1 + translateY -4px→0, --dur-base) · item défaut · hover · focus · avec icône gauche · danger (--status-fail-tx, Trash2 icon) · séparateur (1px --border-subtle) · item désactivé (opacity 0.5, cursor not-allowed).
Specific instances to show: OrgSwitcher dropdown (org name + checkmark + role label "Admin"/"Membre" in --text-muted 12px right), avatar menu.
Width: 160–280px. Click outside closes.

### A-14 — Toast / Notification
Types: succès (PV généré → "PV n°2025-001 émis", green Check icon — IN VERDICT CONTEXT) · erreur (réseau → "Erreur réseau — réessayer", AlertCircle, with inline "Réessayer" button) · warning · info.
Entry: slide-up 8px + opacity, --dur-base. Exit: opacity 1→0, --dur-fast.
Position: bottom-right ≥768px / top-center <768px (annotate).
Stack: max 3 visible. aria-live="polite" (success/info) / aria-live="assertive" (error critique).
Auto-dismiss: success 4s, error persistent (dismiss requires action).

### A-15 — Skeleton
Show skeleton variants for: text block (1 line, 2 lines, 3 lines) · badge · card projet · liste calculs 280px (3 rows, each with tag + name + date) · OutputTable (4 rows × 5 columns with sticky header visible).
Animation: shimmer pulse 1400ms ease-in-out, opacity 0.45↔0.85. Color: --surface-raised tinted (#eef0f1).
Rule: visible ONLY if delay >400ms (annotate "setTimeout 400ms, clearTimeout dans finally"). Dimensions IDENTICAL to loaded state (CLS=0). Under reduced-motion: visible, static (no pulse).

### A-16 — EmptyState
6 distinct variants (separate artboards, same component shell):
1. Premier usage / liste vide absolue: headline "Aucun projet pour le moment", body "Vos projets apparaîtront ici une fois attribués par votre administrateur.", NO dead-end CTA (pre-provisioned).
2. Filtre sans résultat: headline "Aucun résultat", body "Aucun calcul ne correspond à ce filtre.", CTA ghost "Effacer les filtres".
3. Zone résultat pré-calcul: inline panel, "Le résultat apparaîtra ici après calcul.", --text-muted, min-height matching loaded state (CLS=0).
4. Erreur réseau: AlertCircle 24px --status-fail-tx, "Impossible de charger les données.", CTA action "Réessayer".
5. Liste PV vide: "Aucun PV émis. Les PV apparaissent ici une fois un calcul scellé.", no direct CTA (emission starts from calcul).
6. 0 moteur actif dans la souscription: "Aucun module actif dans votre abonnement.", contact link, no empty list.
Rule: NO emojis, NO illustrations (except subtle pétrole line diagram in case 1 if genuinely clarifying), texts always context-specific.

### A-19 — Tooltip
Variants: hover-standard (250ms delay, dark bg --surface-nav, --text-on-nav, max 200px) · focus (same) · rich with kbd shortcut (contains <kbd> component) · sidebar collapsed icons (on icon hover/focus) · truncated numeric value (shows full precision) · under reduced-motion (show immediately, no delay).
Rule: "Complément informatif uniquement — jamais nom accessible primaire" (annotated).

### A-21 — Tabs (projet navigation)
States: tab défaut · hover (--text-primary) · actif (underline 2px --struct-petrole pétrole, text --text-primary 500) · focus-visible · scrollables horizontaux + snap <768px · indicateur de débordement droite (shadow fade).
Tab bar shows: "Vue d'ensemble" · "Calculs" · "PV & Livrables" · "Informations"
role="tablist", arrow key navigation (← →, Home, End) annotated.
Rule: underline color = --struct-petrole (pétrole) ONLY. "--accent-action (latérite) INTERDIT sur underline actif" annotated.
Animation: indicator only animates, content swaps INSTANTLY (0ms — high frequency action).

### A-22 — Breadcrumb
Variants: segment unique (root) · 4 niveaux ("Mes projets / RN2-PK45 / Calculs / Burmister #4") · troncature milieu >4 niveaux (middle segments collapse to "…") · hover/focus on segment · last segment non-cliquable.
Intermediate segments: --text-secondary 13px, link hover --text-primary. Last segment: --text-on-nav 13px 500 (on asphalte topbar background).
Separators "/": --text-muted, aria-hidden. <nav aria-label="Fil d'Ariane"> wrapper.

### A-09 — OutputTable (gabarit structure)
This is a TEMPLATE only — populated columns are Code (combinatoire). Show:
- Sticky header row (--struct-petrole bg, --struct-petrole-fg text, 14px 500)
- Frozen left column (parameter/row identifier, sticky with right box-shadow 4px 0 8px rgba(0,0,0,0.06))
- 4 generic data columns ("Valeur 1 / Résultat 1 / Coefficient / Ratio")
- Row: 40px height, separator 1px --surface-canvas, hover --row-hover-bg rgba(31,78,74,0.04)
- Loading state (skeleton rows, same height)
- Empty state (3 skeleton-height rows replaced by EmptyState A-16 variant 3)
- Error inline row
- CALC_SUCCESS entry animation: opacity 0→1 + translateY 4px→0, --dur-base --ease-entrance
- Numeric columns: Geist Mono tabular-nums right-aligned. Unit in <th> only.
- Sticky header on scroll: box-shadow 0 1px 0 --color-border via IntersectionObserver (annotate).
- <768px behavior: horizontal scroll, id column sticky (annotate "pas de cartes empilées — comparabilité des lignes").

## Delivery rules
- One artboard per component. All states visible side by side in one frame.
- Labels in French (UI copy) — annotations in clear design-system English.
- Data must be realistic fiction (use "Bureau d'études SETCHIM", "RN2-PK45", "E = 1 243 MPa", "qs = 85 kPa" etc.).
- No emojis. No decorative illustrations. No flashy icons. Lucide icons only (stroke 1.5px).
- Do NOT reinvent the shell or the navigation — this lot is atomic components only.
- Execute the craft within this structure. No AI marketing aesthetics.
```

---

**Lot 2 — Shell + écrans clés**

```
You are producing high-fidelity screen designs for ROADSEN, a professional multi-tenant SaaS for geotechnical and road engineering calculations. Users are structural engineers (BET) in West Africa. UI language: French. Aesthetic: dense, conventional, credible — no decoration, no AI-style gradients, no emojis.

## Design system reference (strictly enforced — zero hex values invented)

### Token summary
Surfaces: --surface-canvas #f7f6f4 · --surface-base #fff · --surface-nav #22262b (asphalte) · --surface-nav-hover #2d3237 · --surface-overlay #fff (+modal shadow)
Action: --accent-action #a05226 (CTA, links, focus — on canvas/white) · --accent-action-on-nav #d9954e (on asphalte, ratio 5.4:1) · --accent-brand #b86a2e (logo/brand fills only) · --accent-fg #fff · --struct-petrole #1f4e4a (nav active, underlines, group headers)
Text: --text-primary #1f2329 · --text-secondary #4a5158 · --text-muted #6b7077 · --text-on-nav #f7f6f4 · --text-link #a05226
Borders: --border-subtle rgba(0,0,0,0.07) · --border-default rgba(0,0,0,0.11) · --border-focus #a05226
Elevation: --elevation-card: 0 0 0 1px rgba(0,0,0,0.07) · --elevation-modal: 0 0 0 1px rgba(0,0,0,0.06), 0 8px 32px rgba(0,0,0,0.10)
Verdicts (ONLY for pass/fail): --status-pass-bg #e9f1ec / --status-pass-tx #2f6b46 · --status-fail-bg #fbeceb / --status-fail-tx #8b1a1a
Domain tags: CH. #f0ede9/#6b4f38 · FD. #e8edf0/#2d5060 · LB. #ededec/#4a4a47
Geometry: --radius-base 4px · --radius-lg 6px · --radius-xl 8px
Typography: Geist Sans 400/500/600, Geist Mono (all numeric values + hashes + code)
Numeric rule: ALL result values → Geist Mono tabular-nums text-align right. Units in column headers only.
Row height: 40px (comfortable density). Spacing: 4pt grid (4/8/12/16/20/24/32px).
Lucide icons: stroke 1.5px. 14px in badges, 16px in fields/tables, 20px in buttons, 24px standalone.

## LOGOTYPE reminder
Wordmark "ROADSEN" Geist Sans 500, 0.03em tracking + strata bar 5px below:
- 3px #b86a2e / 2px #1f4e4a / 1px #22262b, width = wordmark width.
Collapsed sidebar: strata visible, wordmark sr-only.

## SCREENS TO PRODUCE

### B-04 — Shell layout authentifié (frame complet)
Show the complete authenticated shell at 1440×900px (≥1280px breakpoint):
- Left: sidebar expanded 240px, --surface-nav background
- Top: topbar 48px, --surface-nav background, --elevation-sticky bottom border
- Content area: --surface-canvas background, scrollable
- Show ALL states in separate frames:
  a) Défaut — sidebar expanded, projet ouvert (bande projet visible)
  b) Sidebar collapsed 64px (icons only, strata visible, labels sr-only)
  c) Chargement GET /auth/me — skeleton sidebar (avatar placeholder, nav items as skeletons)
  d) Skip-link "Aller au contenu principal" — show it in focused state (first DOM element, visible only on focus)

### B-05 — Sidebar globale (tous états)
Draw the sidebar at 240px expanded:
Content top to bottom:
1. Logo zone (24px padding): ROADSEN wordmark + strata bar
2. OrgSwitcher (sticky): avatar 32px + "Bureau d'études SETCHIM" 14px 500 --text-on-nav + "Admin ▾" 12px --text-muted
3. Recents (separator above): 2 items "↳ RN2-PK45" --text-secondary 13px + date "il y a 2h" Geist Mono 12px right-aligned, pin icon appears on hover
4. Section label "ESPACE DE TRAVAIL" 11px uppercase tracking 1.5px --text-secondary
5. Nav item "Mes projets" (icon Grid 20px + label) — show in ACTIVE state: bg rgba(31,78,74,0.08), left bar 3px --struct-petrole, label --accent-action-on-nav
6. Section label "RESSOURCES"
7. Nav item "Bibliothèque de moteurs" (icon BookOpen) — inactive
8. Bottom zone (separator): "Paramètres" (Settings icon) + "Aide" (HelpCircle icon) — --text-secondary
9. Footer: avatar 32px + "M. Diallo" + "Admin" + (leave space for logout in menu)
10. Collapse button: "◁ Réduire la navigation" aria-label

States (separate frames):
a) Expanded 240px — "Mes projets" active as above
b) Collapsed 64px — icons 20px centered, strata visible, no wordmark, tooltip shown on one icon
c) Hover state on inactive item (bg rgba(31,78,74,0.04))
d) Mobile drawer <768px (full-height overlay on --surface-nav, backdrop behind, same content)
e) OrgSwitcher hover state

Accessibility annotations: <aside aria-label="Navigation principale">, <nav>, <ul><li>, aria-current="page" on active, aria-pressed on collapse button, sr-only labels in collapsed mode.

### B-06 — Topbar contextuelle (tous états)
Height 48px, --surface-nav bg, --elevation-sticky bottom border. Left to right:
- Breadcrumb (cliquable segments): "Mes projets" link --text-secondary 13px / "RN2-PK45" link --text-secondary 13px / "Calculs" --text-on-nav 13px 500 (last segment, non-clickable). Separator "/" aria-hidden.
- Flex grow spacer
- Cmd+K button: 180px, --surface-nav-hover bg, "Rechercher… ⌘K" --text-secondary 13px, Search icon 16px
- CTA: "Nouveau calcul" button action variant 32px
- Notification bell (Bell icon 20px, badge point --accent-brand if unread)
- Avatar 32px

States (separate frames):
a) Défaut — as above, CTA "Nouveau calcul"
b) CTA "Émettre un PV" (appears ONLY when calcul status = "Calculé")
c) CTA ABSENT — no button in topbar (any state where no single CTA is relevant)
d) Breadcrumb truncated >4 levels — middle collapse to "…" link
e) Notifications badge (unread dot)
f) Hamburger ≤1024px (Menu icon 24px replaces sidebar)

Rule annotation: "Aucun lien de navigation applicative dans la topbar. Un seul CTA par page."

### B-01 / B-02 — Login + session expirée
Full page, no sidebar. Centered card 400px on --surface-canvas.
Card content (--surface-base, --elevation-card, --radius-lg 6px, 40px padding):
- ROADSEN logotype (wordmark + strata) centered top
- Heading "Connexion" 20px 500
- Form: label "Adresse e-mail" + Input (A-02) + label "Mot de passe" + Input type=password (with show/hide toggle)
- Button action full-width "Se connecter"
- No "Créer un compte" link, no "Mot de passe oublié" (annotate: "comptes pré-provisionnés, hors périmètre P1")

States (separate frames):
a) Défaut — empty form, focus on email field
b) Saisie — email filled, password being typed
c) Chargement — button pending state (Loader2 + "Connexion en cours…", disabled)
d) Erreur identifiants (401) — inline error below password: AlertCircle 16px + "Identifiants incorrects." (anti-enumeration: never specify which field) — button returns to active
e) Compte verrouillé / org non provisionnée — different inline message: "Votre compte n'est pas encore actif. Contactez votre administrateur."
f) Erreur réseau — inline AlertCircle below button + "Réessayer" ghost button
g) Session expirée (B-02) — same layout with yellow info banner top of card: InfoIcon + "Session expirée — veuillez vous reconnecter." + returnTo annotation

### B-07 / B-08 — Liste des projets + état vide
Full shell: sidebar (Mes projets active) + topbar (breadcrumb "Mes projets", no CTA).
Content area: heading "Mes projets" 20px 600 --text-primary, subheading count "3 projets" --text-secondary.
Project list (card grid or list rows — show LIST ROW variant):
Each row: project name 14px 500 + last modified date "il y a 2h" Geist Mono 12px + badge statut (Recalculable/En cours) + ChevronRight icon.
Row: 48px height, --elevation-card, --radius-base, hover shifts bg slightly.

States (separate frames):
a) Défaut liste — 3 projects, one selected (slight highlight), no "Nouveau projet" button (pré-provisionnés)
b) Chargement — skeleton rows (3 rows × same height, CLS=0)
c) Vide premier usage (B-08) — EmptyState: "Aucun projet ne vous est encore attribué." + body "Vos projets apparaîtront ici une fois assignés par votre administrateur." NO dead-end CTA (annotate)
d) Erreur 5xx — full zone: AlertCircle 24px + "Impossible de charger les projets." + CTA "Réessayer"
e) Responsive <768px — annotate behavior (list full-width, breadcrumb reduced)

### B-10 — Layout espace projet (bande + onglets)
Show INSIDE the full shell (sidebar + topbar) the project sub-layout at 1440px.
Under the topbar: project band 44px full-width, --surface-base bg, --border-subtle bottom:
Left: "RN2-PK45" 14px 500 --text-primary + badge status (Ex: "En cours") + "modifié il y a 2h" --text-muted 13px
Right (or flex-grow): tabs "Vue d'ensemble" · "Calculs" · "PV & Livrables" · "Informations"
Tab active "Calculs": underline 2px --struct-petrole, --text-primary 500.
Tab inactive: --text-secondary.

States (separate frames):
a) Défaut — "Calculs" tab active
b) Chargement — skeleton bande (project name placeholder + tab placeholders)
c) Error 404 (B-11): full content zone, tenant-safe: "Ce projet est introuvable." + link "Retour à Mes projets" (NO info about whether project exists in another org)
d) Onglets scrollables <768px — horizontal scroll with snap + fade indicator on right edge

### B-13 / B-14 / B-15 — Onglet Calculs master-detail
Inside shell + project band. Two-column layout at ≥1280px:

LEFT column 280px (--surface-canvas bg, --border-subtle right):
Header: "Calculs" 13px 500 --text-secondary label + "Nouveau calcul" button (outline --accent-action, full width, Plus icon)
List items (40px each): domain tag "CH." (#f0ede9/#6b4f38 + 6px circle) + calcul name "Burmister #4" 14px + badge "Recalculable" outline + date "14 juin" Geist Mono 12px right. Selected item: bg rgba(31,78,74,0.08) + 3px inset left --struct-petrole.

RIGHT panel (--surface-base bg, flex-grow):
When item selected: show calcul header (name 16px 500 + domain tag + badge + date)

States (separate frames):
a) Défaut — 3 calculs in list, "Burmister #4" selected (right panel shows calcul form/result placeholder)
b) Chargement liste — skeleton 3 rows in left column
c) Liste vide (B-14) — left column EmptyState: "Aucun calcul" + "Nouveau calcul" button. Right panel: neutral invite (B-15): "Sélectionnez ou créez un calcul." min-height reserved.
d) Erreur liste — AlertCircle + "Réessayer" in left column
e) Drill-down <1280px — full-width list → user taps item → full-width detail panel + "Retour" button top-left

### B-17 / B-18 / B-19 / B-20 — Résultats de calcul + états
Show the RIGHT panel of master-detail in these states (left column remains visible at ≥1280px):

a) B-17 Succès CALC_SUCCESS: calcul header + CTA "Émettre un PV" (action button, appears ONLY here) + OutputTable gabarit (A-09 structure, 4 generic columns "Paramètre / Valeur / Unité / Verdict", numeric values Geist Mono right-aligned: "1 243" 600 + " kPa" muted). Annotate: "opacity 0→1 + translateY 4px→0 on entry, focus programmatique sur tableau".

b) B-18 Calcul en cours (400ms–3s): button pending state "Calcul en cours" + skeleton OutputTable rows + aria-live="polite" annotation. Second sub-state >3s: honest progress banner "Étape 2 / 4 — Résolution itérative en cours" (generic step text, real steps = Code) + Loader2 icon. Annotate: "clearTimeout dans finally pour éviter flash à 380–420ms".

c) B-19 Erreur moteur: NO result displayed. Badge "En erreur". Alert zone (no --status-fail-bg banner — inline only): (a) validation serveur: "Paramètre E hors plage physique." with field reference; (b) non-convergence: "Le calcul n'a pas convergé. Vérifiez la cohérence Df/B et la consistance des paramètres." CTA "Émettre PV" = ABSENT (not greyed). Annotate "distinct de l'erreur réseau".

d) B-20 Erreur réseau: AlertCircle inline + "Délai dépassé — la connexion a été interrompue." + CTA "Réessayer" (calcul = idempotent, relancer est sûr). Annotation: "Skeleton infini INTERDIT".

### B-24 / B-25 / B-26 — PV & Livrables
B-24 — Onglet "PV & Livrables" actif in project band:
List of sealed PVs. Each row: PV number "PV-2025-001" 14px 500 + engine domain tag "CH." + date "18 juin 2025" + hash 8 chars "a4f7e9c2" Geist Mono 11px --text-muted + badge "Scellé" (--surface-nav bg + Lock icon 12px + --text-on-nav) + actions "Télécharger PDF" (ghost) + "Vérifier intégrité" (ghost).
Rule: badge "Scellé" = asphalte+cadenas ONLY. NEVER green. Action "Modifier" NEVER appears.

B-25 — Vide: no PV emitted. "Aucun PV émis." + "Les PV apparaissent ici une fois un calcul scellé depuis l'onglet Calculs." No direct CTA.

B-26 — Vue d'un PV (read-only full panel): PV header (logo ROADSEN + "Procès-verbal de calcul" title + "PV-2025-001" + org name + date + hash full Geist Mono 13px). Body: sections "Paramètres de calcul" (table read-only) + "Résultats" (OutputTable read-only) + "Verdict" (A-08 banner CONFORME or NON CONFORME with triple redundancy). Footer: "Télécharger PDF" action + "Vérifier l'intégrité" secondary + "Chargement PDF" pending state. Annotation: "jamais 'certifié'/'fait foi'/'opposable' dans le wording".

States (separate frames): B-24 défaut + B-24 chargement (skeleton rows) + B-25 vide + B-26 read-only + B-26 erreur 404 tenant-safe.

### C-01 — Sélecteur de moteur (modal)
Opens from "Nouveau calcul". Modal md 600px. Header "Choisir un type de calcul". Body: 3 groups with section dividers:
- "Chaussées" (--struct-petrole section label + line): item "Burmister LCPC" — domain tag CH. + description 13px "Dimensionnement de structure de chaussée (méthode LCPC/AGEROUTE 2015)"
- "Fondations" (FD.): 3 items: "Terzaghi EC7" / "Casagrande (pieux)" / "GEOPLAQUE (radier)"
- "Sol & Labo" (LB.): 2 items: "Pressiomètre" / "FASTLAB-GTR"
Each item: card-like row, hover bg, radio-style selection (selected item bg rgba(31,78,74,0.08) + checkmark icon right). Footer: "Annuler" ghost + "Créer le calcul" action (enabled once selection made).
States: défaut (no selection) · selection (one item highlighted) · loading descripteurs · erreur (AlertCircle inline + "Impossible de charger les modules") · entitlement disabled item (--text-muted + "Non inclus" chip — decision F-05 pending, show greyed variant).

### C-02 — Modale émission PV (récapitulatif)
Modal lg 760px. Header: "Émettre le procès-verbal — Burmister #4". Body (two sections):
1. "Récapitulatif des paramètres" — compact read-only table (key / value pairs from calcul)
2. "Résultats recalculés" — compact OutputTable (server recalc, same values as display — verified match)
3. "Identité et horodatage" — "Émetteur : M. Diallo (Bureau SETCHIM) · Date : 27 juin 2025 14:32 UTC" --text-secondary
4. Action zone: Verdict banner compact (CONFORME) + confirm button "Émettre et sceller le PV n° 2025-002"

States (separate frames):
a) Défaut — all fields shown, confirm button enabled
b) Chargement scellement — confirm button pending, modal stays open ("Scellement en cours…")
c) Divergence recalcul ≠ affiché — ERROR state inline (AlertCircle + "Les paramètres ont changé depuis le dernier calcul. Relancez le calcul avant d'émettre.") + confirm button disabled
d) Erreur serveur — inline error in footer, modal stays open, "Réessayer"
Annotation: "Optimistic UI INTERDIT. Pas un 'Êtes-vous sûr ?'."

### C-03 — Vérification intégrité PV
Modal sm 480px. Header: "Vérifier l'intégrité du PV-2025-001".
States:
a) Chargement — Loader2 + "Vérification en cours…"
b) Intègre (PASS): verdict banner CONFORME (A-08 triple redundancy: color + Check icon + "Le sceau est valide.") + hash displayed Geist Mono + date of sealing
c) Altéré (FAIL): verdict banner NON CONFORME (--status-fail-bg, X icon + "Le sceau ne correspond pas — ce document a pu être altéré.") — NEVER "certifié"/"opposable"
d) Erreur réseau: AlertCircle + "Impossible de joindre le serveur de vérification." + Réessayer
Annotation: "Vérification = appel serveur. Jamais comparaison visuelle du hash tronqué."

### C-04 — OrgSwitcher dropdown
Triggered from sidebar. Dropdown 240px anchored to OrgSwitcher row.
Content: list of orgs user belongs to:
- "Bureau SETCHIM" (checkmark selected, active) + "Admin" tag right --text-muted 12px
- "LBTG Conseil" (no checkmark) + "Membre" tag right
Separator line.
No "Créer une organisation" item (P1).
Switch action annotation: "queryClient.clear() + redirect /[nouveauSlug]/projets — jamais conserver projetId/calculId".
States: ouvert (défaut) · switch en cours (brief loading state on item clicked).

### C-06 — Palette Cmd+K
Full modal overlay (280px input centered, dropdown below). Always-on top (elevation-modal).
States (separate frames):
a) Ouverte vide — "Rechercher ou accéder…" placeholder, section "Récents" below with 3 recent items (icon + name + domain tag + date Geist Mono)
b) Saisie "bur" — filtered: "Burmister #4" result highlighted, keyboard shortcut annotations right
c) Aucun résultat — "Aucune correspondance pour 'xyz'"
d) Récents vides (org neuve) — "Aucun récent — commencez par ouvrir un calcul."
e) Hors contexte projet — actions "Nouveau calcul" et "Émettre un PV" ABSENT from action list. Only navigation actions shown.
Keyboard shortcuts shown inline: "N — Nouveau calcul" with <kbd>N</kbd>, "Ctrl+Entrée — Lancer le calcul".
Annotation: "<100ms apparition — opacity only, jamais spring. Récents par tenant uniquement."

### C-07 — Modale "Quitter sans enregistrer"
Modal sm 480px. Triggered on: sidebar navigation, OrgSwitcher switch, back button, browser tab close — IF form has unsaved data.
Content: "Quitter sans enregistrer ?" heading. "Vos paramètres de calcul en cours seront perdus." body. Footer: "Rester" (action, default focus) + "Quitter" (ghost/secondary).
"Saisie conservée si annulation" annotation.
Decision F-12 annotation: "beforeunload : à trancher titulaire — navigation interne interceptée via router, fermeture onglet = decision F-12".

### B-30 — Paramètres — Général org
Full shell (sidebar "Paramètres" active). Content area heading "Paramètres de l'organisation" 20px 600.
Sections: "Informations générales" — Nom org (Input with current value "Bureau d'études SETCHIM") + Logo upload zone (dashed border, "Cliquer ou déposer un fichier PNG/SVG" 13px --text-muted).
Save button "Enregistrer les modifications" action.
States:
a) Admin — form éditable
b) Membre (lecture seule) — all fields disabled, note: "Ces paramètres sont réservés aux administrateurs de l'organisation." --text-secondary italic 13px. Decision F-10 annotation.
c) Succès — toast "Paramètres enregistrés" (success toast A-14)
d) Rollback erreur optimistic — field reverts, toast erreur "Erreur lors de l'enregistrement. Réessayer."

### B-31 — Mon compte
Full shell (sidebar footer active). Heading "Mon compte" 20px 600. Sections:
"Profil" — Prénom / Nom / Email (read-only) fields. Avatar 64px with upload option.
"Changer le mot de passe" — current MDP + new MDP + confirm new MDP. Validation: new too weak (force meter 3 bars), confirm mismatch (inline error), current incorrect (inline error after submit).
Save button.
States:
a) Défaut (chargement GET /auth/me briefly)
b) MDP actuel incorrect (inline error on current field after blur)
c) Nouveau MDP trop faible (inline strength indicator)
d) Confirmation différente (inline error)
e) Succès + "Votre mot de passe a été modifié." toast — annotate: "confirmer avec dev-backend si session invalidée post-changement"

### B-32 — Aide
Static page, full shell. Heading "Aide" 20px 600.
Section "Raccourcis clavier" — table: <kbd>N</kbd> Nouveau calcul / <kbd>D</kbd> Dupliquer comme gabarit / <kbd>Ctrl</kbd>+<kbd>Entrée</kbd> Lancer le calcul / <kbd>E</kbd> Exporter / <kbd>⌘K</kbd> Recherche rapide.
Section "Contacter le support" — email link or support form placeholder.
Section "Version" — "Version 1.0.0 (build 20250627)" 12px Geist Mono --text-muted. Annotation: "ancre du skew client/serveur — version affichée ici".

### B-33 / B-34 — Erreurs globales
B-33 — 404 tenant-safe (dans shell):
"Ce projet est introuvable." (NOT "accès refusé" — anti-enumeration). Retour "Mes projets" link. Same for PV 404 variant.
403 rôle: "Vous n'avez pas accès à cette ressource." Retour.
Rule: "Jamais révéler l'existence d'une ressource d'un autre tenant."

B-34 — Erreur globale applicative (error.tsx / global-error.tsx):
Centered, no sidebar if global-error.tsx. "Une erreur inattendue est survenue." + "Recharger la page" action. NO stack trace. NO technical message.
Error boundary partiel (error.tsx in shell): "Une erreur est survenue dans cette section." + "Recharger" limited to that segment — shell remains usable.

### B-09 — 0 org rattachée
Degenerate state. No sidebar (or simplified sidebar). Neutral screen: "Aucune organisation ne vous est attribuée." + "Contactez votre administrateur pour obtenir un accès." + "Se déconnecter" ghost button. No crash, no broken sidebar.

## Delivery rules
- Canvas background: --surface-canvas #f7f6f4.
- All frames at 1440×900px for desktop states, plus 390×844px mobile variants where explicitly listed.
- Show realistic fictional data: "Bureau d'études SETCHIM", "RN2-PK45", "Burmister #4", "E = 1 243 MPa", "PV-2025-001", "M. Diallo", "Admin".
- Every surface must show ALL required states in separate labeled frames. No single happy-path frame.
- Annotations in English (design system) + UI copy in French.
- Components from Lot 1 are reused exactly: Button A-01, Badge A-06, EmptyState A-16, etc. — do not redesign them.
- DO NOT reinvent the shell structure — execute the craft within the architecture described.
- No emojis. No decorative backgrounds. Lucide icons only, stroke 1.5px.
- Zero AI-marketing aesthetics: no glows, no gradients, no glassmorphism.
```

---

**Lot 3 — Écrans secondaires + états transverses restants**

```
You are producing the remaining screens and states for the ROADSEN design system. This is Lot 3 of a sequential design process. Lots 1 (component library) and 2 (shell + key screens) are already complete. You MUST reuse all components and shell structure from those lots — do not redesign atoms, the sidebar, topbar, or project band.

UI language: French. Aesthetic: dense, conventional, credible. No emojis, no decorative illustration, no AI-style gradients.

## Design system recap (strictly enforced — never invent hex values)

Tokens (same as Lot 2):
--surface-canvas #f7f6f4 · --surface-base #fff · --surface-nav #22262b · --surface-nav-hover #2d3237
--accent-action #a05226 · --accent-action-on-nav #d9954e · --accent-brand #b86a2e · --struct-petrole #1f4e4a
--text-primary #1f2329 · --text-secondary #4a5158 · --text-muted #6b7077 · --text-on-nav #f7f6f4
Verdicts ONLY: --status-pass-bg #e9f1ec / --status-pass-tx #2f6b46 · --status-fail-bg #fbeceb / --status-fail-tx #8b1a1a
Domain: CH. #f0ede9/#6b4f38 · FD. #e8edf0/#2d5060 · LB. #ededec/#4a4a47
--elevation-card: 0 0 0 1px rgba(0,0,0,0.07) · --elevation-modal: 0 0 0 1px rgba(0,0,0,0.06), 0 8px 32px rgba(0,0,0,0.10)
All numeric values: Geist Mono tabular-nums text-align right. Row height: 40px.
Lucide icons stroke 1.5px.

## SCREENS AND STATES TO PRODUCE

### B-26 — Vue PV — états complémentaires
(The main B-26 read-only view was done in Lot 2 — produce these additional states only)

a) Chargement PV: skeleton de la vue PV (header placeholder + table placeholder rows)
b) PV 404 tenant-safe (B-27): "Ce procès-verbal est introuvable." + "Retour à PV & Livrables" link. Anti-enumeration: no distinction inexistant/interdit.

### B-28 — Bibliothèque de moteurs
Full shell (sidebar "Bibliothèque de moteurs" active, no project band — top-level page).
Heading: "Bibliothèque de moteurs" 20px 600.
3 domain groups with section headers (--struct-petrole bg label 11px uppercase or section divider):

"Chaussées"
- Card: domain tag "CH." + engine name "Burmister LCPC" 16px 500 + description 13px "Dimensionnement de structure de chaussée flexible selon la méthode LCPC/AGEROUTE 2015" --text-secondary + "Ouvrir dans un projet ▸" ghost link (no standalone launch button — library = read-only context)

"Fondations"
- "Terzaghi EC7" — FD. — "Capacité portante des fondations superficielles selon Eurocode 7"
- "Casagrande (pieux)" — FD. — "Portance de pieux forés et battus par méthode pressiométrique"
- "GEOPLAQUE (radier)" — FD. — "Dimensionnement de radiers et plaques sur sol élastique"

"Sol & Labo"
- "Pressiomètre" — LB. — "Interprétation d'essais pressiométriques Ménard (module EM, pression limite)"
- "FASTLAB-GTR" — LB. — "Analyse de laboratoire sol — classification GTR, Proctor, CBR, œdomètre"

States (separate frames):
a) Défaut — all 6 engines visible
b) Chargement — skeleton cards (3 per group placeholder)
c) Erreur — AlertCircle + "Impossible de charger la bibliothèque." + "Réessayer"
d) 0 moteur actif dans la souscription — EmptyState A-16 variant 6: "Aucun module actif dans votre abonnement. Contactez votre administrateur." NO module cards shown. Annotation: "mauvais provisionnement — pas une erreur UI".

Rule: "Aucun symbole, formule ou paramètre interne exposé. Descriptions métier uniquement (confidentialité)."

### B-29 — Fiche moteur (optionnel Lot 3)
(Backlog P1 — draw as a lean single frame, no full state coverage)
Full shell, breadcrumb "Bibliothèque / Burmister LCPC".
Domain tag + heading "Burmister LCPC" 20px 600. Description paragraph. Section "Domaine d'application" (bullet list: "Chaussées flexibles, granulats naturels latéritiques, normes AGEROUTE 2015..."). Section "Paramètres requis" (generic list: "Trafic, modules de couches, épaisseurs cibles" — NO internal formulas). CTA: "Utiliser dans un projet" action button — context menu or redirect to project selection. Annotation: "Pas de bouton 'Lancer' hors contexte projet".

### B-22 — Retour sur calcul ancien (recalculable)
Right panel of master-detail. Calcul "Burmister #3" selected in left column. Badge "Recalculable" (RefreshCw outline).
Panel shows: calcul header + original params recap (read-only, dimmed slightly) + last results (OutputTable generic columns, --text-muted on header "Résultats du 12 juin 2025") + date of last calculation Geist Mono. If PV was emitted: link "Voir PV-2025-001" (icon file-check-2 16px + text).
Actions available: "Recalculer avec ces paramètres" (secondary) + shortcut "D — Dupliquer comme gabarit" tooltip visible.
Rule: "modifier+recalculer ne modifie PAS le PV scellé existant. Le PV est immuable."

### B-35 — Onglet Informations projet
Inside shell + project band (tab "Informations" active). Right panel (full width or same panel as Calculs):
Sections:
1. "Identification": "Nom du projet" editable Input (optimistic, current: "RN2-PK45") + save inline button / auto-save.
2. "Métadonnées" (read-only): "Créé le 10 juin 2025 par M. Diallo" · "Dernière modification il y a 2h" · "Organisation : Bureau SETCHIM". Values: Geist Mono 13px --text-muted for dates, --text-primary for names.
3. (P1 rule) Section "Membres" = ABSENT in P1 (annotate: "gestion membres hors périmètre Phase 1 — ne pas afficher section vide").

States:
a) Défaut — read-only with edit-in-place on name
b) Édition active (name field focused)
c) Succès (optimistic: name updates instantly) + toast "Projet renommé"
d) Erreur + rollback (name reverts) + toast erreur

### D-16 — PWA hors-ligne (bannière persistante)
Show inside the authenticated shell (any page). A persistent non-blocking banner:
Top of content area (below topbar + project band): full-width strip, bg rgba(0,0,0,0.06) --surface-canvas tinted, 44px, WifiOff icon 16px --text-secondary + "Connexion interrompue — les calculs et PV sont suspendus." --text-secondary 13px. X close button right (but if offline, it can be dismissed as visual noise — annotation: "non bloquant, suspend uniquement calcul/PV").
Variant online-restored: same strip with WifiIcon green — but note: "vert ici = statut réseau, pas un verdict géotech — justifié par le contexte réseau".

### D-18 — Error boundary (crash JS isolé)
Show the PARTIAL error boundary (a sub-section crashes, shell remains intact):
Full shell visible (sidebar + topbar functional). In the right panel (calcul area):
Contained error zone: AlertTriangle 24px --text-secondary + "Une erreur est survenue dans cette section." 14px --text-primary + "Recharger la section" action button.
Annotation: "error.tsx par segment Next App Router — un crash panneau calcul ne tue pas le shell".

### C-05 — Centre de notifications dropdown (état conditionnel)
(Decision F-06 pending: only produce IF notifications are confirmed for P1 — draw both cases)

Case A — Cloche supprimée (F-06 = non): Show topbar WITHOUT the bell icon, annotated "Si notifications non alimentées en P1 → supprimer l'icône entièrement — jamais cloche avec liste toujours vide."

Case B — Cloche active (F-06 = oui): Dropdown 320px anchored to bell icon in topbar. States:
- Ouvert vide: "Aucune notification."
- Ouvert avec entrées (max 5): each notification = icon 16px + title 14px 500 + description 13px --text-secondary + time Geist Mono 12px right. Unread dot on left.
- Badge non lues: red point on bell icon (--accent-brand, NOT --status-fail-tx — this is a brand indicator, not a verdict).

### C-08 — Confirmation destructive générique
(Only instantiated in P1 if F-11 = confirmation requise for logout — draw the generic modal)
Modal sm 480px. Reuses A-12 sm.
Example instance: "Déconnexion" heading. "Vous allez être déconnecté. Tous les onglets de l'application seront fermés." body. Footer: "Annuler" ghost + "Se déconnecter" danger button (A-01 danger variant).
Annotation: "Décision F-11 : direct ou confirmé ? Ce gabarit couvre d'autres usages destructifs futurs (Phase 2+)."

## RESPONSIVE VARIANTS — produce for all screens above
For each screen in this lot, produce these responsive frames in addition to the ≥1280px desktop:
- 768–1023px: sidebar hidden (hamburger in topbar), content full-width, master-detail drill-down.
- <768px: bottom tab bar 56px (4 items: Projets / Récents / ⌘K / Compte), breadcrumb reduced to project name only, modals full-screen.

Modal <768px rule: footer (action buttons) fixed at bottom of screen, body scrollable independently. Show this explicitly for C-02 (PV emission) as it has the most content.

## STATES TRANSVERSES — verify coverage for all screens in this lot

Every surface must explicitly show these states. If a state was drawn in Lot 2 for that surface, annotate "voir Lot 2" instead of redrawing.
- Défaut
- Chargement (skeleton >400ms, CLS=0)
- Vide (rédigé en contexte métier — jamais générique)
- Erreur (inline AlertCircle + Réessayer / ou full zone selon la surface)
- Succès (toast ou état UI stabilisé)
- Focus clavier (tab order annotated, focus ring 2px --border-focus visible)

## OutputTable — état vide rédigé (rappel contextuel)
For each engine domain, show one empty state message (these are placeholders for Code-populated tables in Lot 3 build):
- Chaussées: "Aucun résultat — vérifiez la cohérence des modules de couches et du trafic cible."
- Fondations: "Aucun résultat — vérifiez la cohérence Df/B et la consistance des paramètres de sol."
- Sol & Labo: "Aucun résultat — vérifiez les paramètres d'essai pressiométrique."
These replace the generic "Aucun résultat" and are drawn inside the A-09 OutputTable component template.

## Delivery rules
- Canvas: --surface-canvas #f7f6f4. Desktop frames: 1440×900px. Mobile: 390×844px.
- Realistic fictional data: "Bureau SETCHIM", "RN2-PK45", "M. Diallo", "PV-2025-001", numeric values in Geist Mono ("1 243 kPa", "85 kN/m²").
- All states in separate labeled frames within each screen artboard.
- Annotations in English, UI copy in French.
- Components from Lot 1, shell from Lot 2 — reuse exactly, do not redesign.
- No emojis. No decorative illustration. Lucide icons stroke 1.5px only.
- Do not introduce new tokens, colors, or components not defined in the design system.
- Lot 3 contains NO combinatoire (forms with 218 fields, OutputTable columns per engine) — those are Code only. If a frame requires a form, show ONE generic field of each type (Input/Select/Checkbox) with realistic label and leave a placeholder zone for the rest annotated "218 champs — dérivés en code depuis ENGINE_DESCRIPTORS".
```

---

Les trois fichiers sources qui fondent ces prompts :

- `/Users/macbook/Desktop/roadsen/05-Plateforme/apps/web/design/identite-v3.md`
- `/Users/macbook/Desktop/roadsen/05-Plateforme/apps/web/design/shell-v1.md`
- `/Users/macbook/Desktop/roadsen/05-Plateforme/apps/web/design/excellence-v1.md`
- `/Users/macbook/Desktop/roadsen/05-Plateforme/apps/web/design/INVENTAIRE-ecrans-etats.md`

**Ce qui a guidé les choix de structuration :**

Lot 1 suit strictement l'ordre de dépendance §G de l'inventaire : tokens visuels → logotype → focus ring → composants primitifs → molécules → tableaux. Chaque composant liste explicitement ses états (la règle "tous les états dans un seul artboard" est encodée dans l'instruction de livraison). Le combinatoire (218 champs, colonnes OutputTable par moteur) est nommément exclu des trois prompts avec renvoi explicite à Code.

Lot 2 suit le chemin utilisateur de §G : shell → login → projets → espace projet → calcul → PV → modales critiques → paramètres → erreurs. Les écrans "secondaires" de l'inventaire (B-22, B-28, B-29, B-35) ont été délibérément basculés en Lot 3 pour ne pas surcharger le prompt décisionnel (shell + calcul + PV sont les surfaces à plus fort enjeu de décision).

Lot 3 complète les états transverses restants, les surfaces read-only (bibliothèque, informations, ancien calcul), les variantes responsive manquantes, et les overlays conditionnels (C-05, C-08). La règle "voir Lot 2" pour les états déjà dessinés évite la redondance sans perdre la couverture.