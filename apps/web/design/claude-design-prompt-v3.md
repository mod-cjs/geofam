# Prompt Claude Design — App ROADSEN (identité v3)

> À coller dans Claude Design. Objectif : générer la maquette de l'app authentifiée ROADSEN
> **dans la structure déjà définie** (ne PAS réinventer l'IA ni la topbar) — Claude Design
> exécute le *craft* visuel à l'intérieur de nos garde-fous. Tokens = identité v3 figée.
> UI en français. Référence visuelle : `design/identite-board-v3.html`.

---

```
Design the authenticated web app for ROADSEN — a geotechnical & road engineering calculation
SaaS for West African engineering firms. Engineering-grade: sober, dense, data-first. NO emoji,
NO flashy gradients, minimal shadows. French UI text throughout, professional tone.

IMPORTANT — DO NOT redesign the information architecture or the top bar. The structure below is
fixed (already engineered). Your job is to execute high-quality visual craft (spacing, type,
states, micro-treatment) WITHIN this structure and these tokens. Keep the top bar, the strata
logotype, the screen set and the component roles exactly as specified.

=== BRAND IDENTITY (v3 — fixed tokens, do not alter) ===
Principle: "warm brand, cold interface" — color is used only for brand and semantic signals.
Light theme (default):
- Brand fill / logotype (NEVER functional text): laterite #b86a2e
- Action (links, active tab, primary button, focus ring): laterite-dark #a05226 ; on dark nav: #d9954e
- Structure (table group headers, secondary buttons): petrol #1f4e4a
- Nav bar / wordmark: asphalt #22262b
- Surfaces: canvas #f7f6f4 / base #ffffff / alt #eef0f1
- Text: primary #1f2329 / secondary #5c6168 / muted #8b9097 (decorative only)
- Borders: rgba(0,0,0,0.07 / 0.11 / 0.18)
- Verdict PASS (RESERVED): text #2f6b46 on #e9f1ec ; Verdict FAIL (RESERVED): text #8b1a1a on #fbeceb
CARDINAL RULES: red & green = verdicts ONLY (never elsewhere). #b86a2e never as text. Every verdict
uses TRIPLE redundancy: color + icon (Lucide, stroke 1.5) + text label. Laterite and verdict-red
never adjacent without a neutral gap.
Typography: Geist Sans + Geist Mono. Weights 400/500/600 (never 700+ in body). All numeric data
(results, ratios, coefficients): Geist Mono + tabular-nums + right-aligned; units live in the column header.
Elevation: zero-offset (box-shadow 0 0 0 1px rgba) instead of border. Radius 3–8px.

=== LOGOTYPE (fixed) ===
"ROADSEN" wordmark (Geist Sans 500, tracking 0.03em) above a STRATA BAR of three stacked rules of
decreasing thickness — laterite 3px, petrol 2px, asphalt 1px — width = wordmark width. This strata bar
is the brand's proprietary asset; render it consistently. Sub-32px: glyph variant (single laterite rule
under "R"); never render the 3 strata that small.

=== TOP BAR (fixed — keep this exact structure) ===
Sticky header, height 48–56px, background asphalt #22262b. Left: the ROADSEN strata logotype (light
variant, white wordmark) + current organization name "STARFIRE TECHNOLOGY SAS" (muted white, separated
by a thin divider). If multiple orgs: an organization switcher dropdown next to the name. Right: user
initials in a circle (laterite fill) with a dropdown (full name, "Se déconnecter"). The active nav/tab
state on this dark bar uses #d9954e (never #a05226).

=== SCREENS (fixed set — design each, with default/loading/empty/error states) ===
E1 Login — centered card (max 400px) on canvas. Strata logotype (dark variant). Fields "Adresse e-mail",
"Mot de passe". Primary button "Se connecter". Footer "Accès réservé aux membres de votre organisation."
Error alert (left-border #8b1a1a): "Identifiants incorrects. Vérifiez votre adresse e-mail et votre mot de passe."
E2 Projects list — top bar + page title "Projets". Data TABLE: columns Projet | Domaine | PV | Dernière activité.
Domain tag = text prefix + 6px low-saturation dot (CH. Chaussées / FD. Fondations / LB. Sol & labo), never
the verdict colors. Project name is an action-colored link. Empty + loading-skeleton states.
E3 Project workspace — breadcrumb "Projets › <nom>", project title + domain tag. Tabs [Calcul] [PV (n)]
(active tab underline in action color). Tab Calcul: engine selector (6 engines), dynamic 2-col form
(Field = label + unit + input + hint + error), primary button "Lancer le calcul". Results: verdict banner
(show BOTH a CONFORME and a NON CONFORME), results table with a petrol group-subtitle row, tabular numbers,
status badges. Action "Émettre un PV scellé" (laterite — the strong gesture) + secondary "Recalculer" (petrol).
Tab PV: table NUMÉRO | DATE | MOTEUR | VERDICT | PDF, "Scellé" badge, ghost "Télécharger". Empty state.
E4 PV confirmation modal — 540px. Summary (Projet/Moteur/Verdict/Émetteur/Organisation). Integrity notice
box (left-border laterite): "Ce PV est scellé par un code d'intégrité (HMAC-SHA256). Il n'a pas valeur de
signature électronique qualifiée au sens de la loi 2008-08." Footer: ghost "Annuler" + primary "Confirmer
l'émission". Loading state disables both buttons (no double emission).

=== COMPONENT LIBRARY (render a panel of variants) ===
Button (primary-laterite / primary-asphalt / secondary-petrol / ghost / danger; sm/md/lg; default/hover/
loading/disabled). Field (default/focus/error/disabled). Badge (conforme/non-conforme/scellé/neutre).
Verdict banner (pass + fail, with icon). Domain tag (3 domains, with text prefix). Table (sticky header,
frozen first column, tabular numbers, petrol group row). Toast (success/error/warning/info, left-border).
Skeleton rows ×3. EmptyState (text only, no illustration). Modal.

CONSTRAINTS: French, no emoji, no illustrations, icons only Lucide (geometric, stroke 1.5). All interactive
states visible (focus ring 2px action color, offset 2px). Accessibility AA, no color-only information.
Desktop-first 1280px. Optionally show a dark-mode preview of E3 (dark tokens: canvas #111210, base #1a1917,
action #c97a3f, text rgba(255,255,255,0.92)) — but light is the primary deliverable.
```

---

## Après génération
1. Authentifier l'accès design : `/design-login` (ou `/login` → compte avec abonnement).
2. `/design-sync` pour rapatrier les composants en bibliothèque locale versionnée (incrémental).
3. Architecture front (`architecte-technique`) → build (`dev-frontend`) → QA (`qa-test` + `qa-challenger`).
