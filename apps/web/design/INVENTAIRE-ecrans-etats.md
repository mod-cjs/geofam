# Inventaire design ROADSEN — Référence unique (v2, post-critique adverse)

**Date de gel :** 2026-06-27  
**Statut :** source de vérité unique — supersède toute version précédente  
**Sources figées :** `identite-v3.md` · `shell-v1.md` · `excellence-v1.md`  
**Périmètre git :** `05-Plateforme/apps/web/`

**Légende Source :** CD = gabarit Claude Design · Code = dérivé en code depuis descripteurs/données · CD+Code = gabarit CD + peuplement Code  
**Légende Priorité :** P1 = MVP Phase 1 · BL = backlog conditionnel

**Règle combinatoire (non négociable) :** les 218 champs de formulaire (6 moteurs × ENGINE_DESCRIPTORS), les colonnes OutputTable par moteur, et tout step-indicator dont le contenu dépend d'un descripteur ou d'une réponse serveur sont toujours Code. Ne jamais faire dessiner le combinatoire dans Claude Design.

---

## A. Design system — Composants × variantes / états

| # | Composant | États couverts | Source | Priorité | Notes critiques |
|---|---|---|---|---|---|
| A-01 | **Button** | défaut · hover · focus-visible · loading (`aria-busy`) · disabled · icon-left · icon-only · absent (conditionnel) | CD | P1 | 4 variantes : action (latérite) / secondaire / ghost / danger. Tailles sm/md/lg. `font-weight: 500` minimum obligatoire. Sur fond asphalte : `--accent-action-on-nav` (#d9954e). Bouton conditionnel = absent, jamais grisé (ex. "Émettre PV" si statut ≠ Calculé). |
| A-02 | **Field — Input texte** | défaut · focus · rempli valide · validé on-blur (Check 16px) · erreur bloquante rouge · avertissement orange hors plage · disabled · avec unité · avec aide contextuelle · placeholder | CD | P1 | Validation uniquement on-blur — jamais pendant la frappe. 218 champs = Code depuis descripteurs. Plages orange = livrables science client (STARFIRE) — non implémentables sans bornes livrées, à flaguer. |
| A-03 | **Field — Select** | défaut · focus · ouvert (dropdown) · option hover · option sélectionnée · disabled · erreur | CD | P1 | Focus trap dropdown. ESC ferme + retour focus. ChevronDown `aria-hidden`. |
| A-04 | **Field — Textarea** | défaut · focus · resize vertical only · disabled · erreur inline | CD | P1 | Description projet, notes calcul. Validation on-blur identique à Input. |
| A-05 | **Field — Checkbox / Radio / Switch** | défaut · hover · focus-visible · coché/sélectionné · indeterminate (checkbox) · disabled · erreur inline | CD | P1 | Les 218 champs moteurs incluent des booléens — sans gabarit, le combinatoire B-16 n'a pas de référence. Switch = optimistic autorisé (excellence-v1). |
| A-06 | **Badge statut** | Conforme/PASS · Non conforme/FAIL · En attente/Neutre · Recalculable · Scellé · En cours · Erreur | CD | P1 | Triple redondance couleur+icône+libellé obligatoire. Vert/rouge = verdicts uniquement. Badge Scellé = fond `--surface-nav` (asphalte), jamais vert. |
| A-07 | **Domain tag** | CH. · FD. · LB. (inline liste + standalone bibliothèque) | CD | P1 | Pastille 6px seule INTERDITE (ADR 0008). Préfixe texte non supprimable (impression N&B, daltonisme). |
| A-08 | **Verdict banner** | CONFORME · NON CONFORME (compact résultats / étendu PV) | CD | P1 | Triple redondance. Latérite et bordeaux-verdict jamais adjacents sans séparateur ≥16px. Dark mode : fond clair conservé (île claire) — à valider en test utilisateur. |
| A-09 | **Table résultats de calcul (OutputTable)** | en-tête sticky · colonne id gelée · ligne groupe · ligne données · hover · sélectionnée · chargement skeleton · vide · erreur inline · entrée CALC_SUCCESS | CD+Code | P1 | Geist Mono tabular-nums text-align right. Sticky via IntersectionObserver sentinelle (jamais listener scroll). z-index soigné sur intersection sticky/gelée. Helper `fmt()` : `Intl.NumberFormat fr-FR` + espace fine U+202F. Colonnes effectives par moteur = Code (combinatoire). |
| A-10 | **Metric** | valeur isolée (32px 600) · valeur en tableau (14px 600 + unité muted) · indisponible ('—') · hors plage (`--status-fail-tx`) · NaN/Infinity → '—' | CD | P1 | Composant `<Metric />` unique. Jamais 'NaN' ou 'Infinity' brut affiché. |
| A-11 | **Card / Panel** | Card projet · Card bibliothèque moteur · Panel formulaire · Panel repliable · hover cliquable · disabled | CD | P1 | Jamais élévation + bordure + background coloré simultanément. `box-shadow 0 0 0 1px` préféré à `border`. |
| A-12 | **Modal / Dialog** | taille sm/md/lg · header+body+footer · backdrop · ouverture (opacity+scale) · fermeture · focus trap · erreur inline · loading interne | CD | P1 | Focus sur premier élément à l'ouverture. ESC ferme + retour focus déclencheur. `inert` sur `<main>`. `aria-modal="true"`. Modale PV lg = unique confirmation explicite (pas un "Êtes-vous sûr ?"). |
| A-13 | **Dropdown / Menu d'actions** | ouverture · item défaut · hover · focus · avec icône · danger · séparateur · item désactivé · OrgSwitcher · menu avatar | CD | P1 | Focus trap. Click hors zone ferme (mousedown capture). Largeur 160–280px. |
| A-14 | **Toast / Notification** | succès (4s) · erreur (6s persistante) · warning · info · sortie · stack max 3 · avec action inline (bouton "Réessayer") | CD | P1 | `aria-live="polite"` (succès/info) / `aria-live="assertive"` (erreur critique). `aria-atomic="true"`. bottom-right ≥768px / top-center <768px. Distinguer : toast sans action (info/succès) vs toast avec action (erreur réseau → Réessayer). |
| A-15 | **Skeleton** | text · row · badge · card projet · liste calculs 280px · résultats calcul (OutputTable) | CD | P1 | Visible uniquement si délai >400ms (setTimeout 400ms, clearTimeout dans finally). Disparition opacity dur-fast. Sous reduced-motion : visible, immobile. Dimensions strictement identiques à l'état chargé (CLS=0). |
| A-16 | **EmptyState** | premier usage vide absolu · filtre sans résultat · zone résultat pré-calcul · erreur réseau · liste PV vide · 0 moteur dans la souscription | CD | P1 | Composants distincts (vide absolu ≠ filtre sans résultat). Textes métier rédigés en contexte, jamais génériques. Pas d'emojis. Pas d'illustration sauf schéma sobre pétrole (bibliothèque uniquement). |
| A-17 | **Focus ring (token global)** | défaut (aucun) · focus-visible (outline 2px `--border-focus` + box-shadow double anneau) · sur fond asphalte · sur fond modal | CD | P1 | `--surface-current` déclaré localement par conteneur. Jamais `outline: none` sans substitut. |
| A-18 | **Logotype ROADSEN** | variante complète ≥32px · variante glyphe <32px · sidebar collapsed · impression N&B · dark mode | CD | P1 | Barre de strates = unique actif propriétaire. Motif 3-strates interdit <32px. |
| A-19 | **Tooltip** | hover (250ms) · focus (250ms) · riche (kbd) · icônes sidebar collapsed · valeur numérique tronquée · reduced-motion | CD | P1 | Complément informatif uniquement, jamais nom accessible primaire. |
| A-20 | **Command palette (Cmd+K)** | fermée · ouverte vide (récents) · saisie/filtrage · résultats (navigation + actions) · aucun résultat · focus trap · récents vides (org neuve) · hors contexte projet (actions contextuelles absentes) | CD+Code | P1 | Apparition <100ms (règle Raycast), opacity uniquement, jamais spring. Lib `cmdk`. Récents par tenant — jamais cross-org après switch. Raccourcis N/D/Ctrl+Entrée/E affichés en `<kbd>`. Hors d'un projet : "Nouveau calcul" et "Émettre un PV" absents de la palette. |
| A-21 | **Tabs (onglets de navigation projet)** | onglet défaut · hover · actif (underline pétrole) · focus-visible · scrollables + snap <768px · indicateur de débordement | CD | P1 | `role="tablist"`, navigation flèches clavier (←/→, Home, End). Underline 2px `--struct-petrole` animé seul à la sélection (excellence-v1 §B). Latérite INTERDIT sur underline actif (règle unifiée m5 shell-v1). |
| A-22 | **Breadcrumb** | segment unique (racine) · multi-niveaux · troncature milieu >4 niveaux (…) · hover/focus segment · dernier segment non cliquable | CD | P1 | Segments intermédiaires = liens `--text-secondary` 13px. Dernier = `--text-on-nav` 13px 500. Séparateurs `/` `aria-hidden`. `aria-label="Fil d'Ariane"` sur `<nav>`. |
| A-23 | **Avatar / Monogramme** | image · fallback initiales · couleur dérivée du nom · taille sm/md/lg · chargement (skeleton) | CD | P1 | Même composant consommé par : pied de sidebar, topbar (même store Zustand — pas deux composants distincts), OrgSwitcher, onglet Informations. |
| A-24 | **Kbd (raccourci clavier)** | raccourci simple · chord (Ctrl+Entrée) · dans tooltip · dans Cmd+K · dans page Aide | CD | P1 | Balise sémantique `<kbd>`. Fond subtil, border-radius 3px, Geist Mono 11px. Transverse à Cmd+K / Aide / tooltips — sans composant unique : 3 implémentations divergentes. |
| A-25 | **Logotype + tokens v3 (globals.css)** | thème clair · thème sombre (`data-theme`) | CD | P1 | **Pré-condition bloquante** : globals.css = boilerplate Next aujourd'hui (`#ffffff/#171717`, `font-family: Arial`). À aligner avant tout composant de shell. Tokens motion, typographie, couleur, radius, ombres — source unique. |

---

## B. Écrans / sous-pages / layouts

| # | Surface | Route | États requis | Source | Priorité | Notes critiques |
|---|---|---|---|---|---|---|
| B-01 | **Login** | `/(auth)/login` | défaut · saisie (on-blur) · chargement (bouton pending) · erreur identifiants (inline, anti-énumération) · compte verrouillé/org non provisionnée · erreur réseau (Réessayer) · déjà authentifié (redirect silencieux) · succès (redirect middleware) | CD | P1 | Hors shell. Focus initial sur email. Submit Entrée. Pas de "créer un compte" ni "mot de passe oublié" (P1, comptes pré-provisionnés). Bouton repasse de pending à actif sur erreur 401. Utilisateur déjà connecté → redirect `/[orgSlug]/projets` sans afficher le formulaire. |
| B-02 | **Session expirée (variante login)** | `/(auth)/login` (variante) | session expirée (message contextuel + refocus) · redirect avec `returnTo` | CD | P1 | GET /auth/me 401 → redirect. Toast "Session expirée, reconnectez-vous". |
| B-03 | **Premier login / mot de passe temporaire** | `/(auth)/login` → `/(auth)/changer-mdp` | flag `must_change_password` (redirect forcé) · formulaire changement MDP · erreur (trop faible / confirmation différente) · succès (redirect projets) | Code | P1 | Comptes pré-provisionnés → mot de passe initial temporaire. À confirmer avec dev-backend : flag côté serveur ou claim JWT ? Flux distinct ou modal post-login ? Non dessinable en CD pur (données serveur conditionnent le flux). |
| B-04 | **Shell layout authentifié** | `/(shell)/[orgSlug]/layout.tsx` | défaut (sidebar 240px + topbar 48px) · chargement GET /auth/me (skeleton sidebar) · erreur tenant (redirect) · responsive 4 breakpoints | CD | P1 | Chrome global réutilisé. Contient OrgSwitcherProvider + CommandPaletteProvider. Skip-link "Aller au contenu principal" premier élément DOM. |
| B-05 | **Sidebar globale** | `/(shell)/[orgSlug]/layout.tsx` | expanded 240px · collapsed 64px · item actif · hover item · drawer mobile · focus clavier | CD | P1 | 7 items P1. Collapse CSS-first + localStorage + garde SSR. `<aside aria-label="Navigation principale">`. `aria-current="page"` sur item actif. |
| B-06 | **Topbar contextuelle** | `/(shell)/[orgSlug]/layout.tsx` | défaut · breadcrumb tronqué >4 niveaux · CTA contextuel présent/absent · notifications lues/non lues · hamburger <1024px · focus | CD | P1 | Règle absolue : aucun lien de navigation dans la topbar. Un seul CTA par page. Avatar = même store Zustand que pied de sidebar. |
| B-07 | **Liste des projets** | `/(shell)/[orgSlug]/projets/page.tsx` | défaut (liste) · chargement (skeleton >400ms, CLS=0) · vide premier usage · filtre sans résultat · erreur 5xx (pleine zone + Réessayer) · focus clavier · responsive | CD+Code | P1 | GET /projects (scopé X-Org-Id). Pas de bouton "Nouveau projet" en P1 (pré-provisionnés). Gabarit ligne = CD ; lignes peuplées = Code. |
| B-08 | **État vide projets (provisionnement)** | `/(shell)/[orgSlug]/projets/page.tsx` (état) | vide rédigé en contexte P1 | CD | P1 | "Aucun projet ne vous est encore attribué. Contactez votre administrateur." SANS CTA mort. |
| B-09 | **0 org rattachée à l'utilisateur** | `/(shell)/` (état dégénéré) | vide dégénéré · erreur provisionnement | Code | P1 | Shell suppose ≥1 org. Si 0 org : écran neutre "Aucune organisation ne vous est attribuée" + lien support + Déconnexion. Pas un crash, pas une sidebar cassée. |
| B-10 | **Layout espace projet (bande + onglets)** | `/(shell)/[orgSlug]/projets/[projetId]/layout.tsx` | défaut · chargement (skeleton bande) · erreur 404 tenant-safe · onglet actif (underline pétrole) · onglets scrollables <768px | CD | P1 | Bande 44px. Onglets : Vue d'ensemble / Calculs / PV & Livrables / Informations. Onglet actif = pétrole uniquement. Bande ne s'affiche pas avec nom vide. |
| B-11 | **Projet 404 (lien périmé / autre org)** | `/(shell)/[orgSlug]/projets/[projetId]` | erreur 404 tenant-safe | CD | P1 | Anti-énumération : ne pas distinguer "n'existe pas" et "pas le vôtre". Retour "Mes projets". |
| B-12 | **Onglet Vue d'ensemble** | `/(shell)/[orgSlug]/projets/[projetId]/` | défaut (synthèse : derniers calculs, derniers PV, compteurs) · chargement · vide (CTA Nouveau calcul) · erreur partielle (un bloc échoue, les autres s'affichent) · erreur globale · responsive | CD+Code | P1 | Erreur partielle : chaque widget indépendant avec son propre état d'erreur — pas une erreur globale si une seule source échoue. Gabarit CD ; données Code. Arbitrage F-02 requis : page.tsx = Vue d'ensemble OU Calculs par défaut. |
| B-13 | **Onglet Calculs — master-detail** | `/(shell)/[orgSlug]/projets/[projetId]/calculs/page.tsx` | défaut (liste 280px + panneau) · chargement skeleton liste · liste vide (CTA Nouveau calcul) · erreur liste · panneau vide (rien sélectionné) · drill-down <1280px | CD+Code | P1 | Liste : tag CH./FD./LB. + pastille 6px + nom + badge statut + date Geist Mono. Sous 1280px : drill-down liste→détail + bouton Retour. |
| B-14 | **Onglet Calculs — colonne gauche vide** | `/(shell)/[orgSlug]/projets/[projetId]/calculs` | vide (aucun calcul) | CD | P1 | Deux zones vides distinctes : colonne gauche ("Aucun calcul" + "Nouveau calcul") + panneau droit (invite neutre). |
| B-15 | **Panneau droit vide (rien sélectionné)** | `/(shell)/[orgSlug]/projets/[projetId]/calculs` | invite neutre | CD | P1 | "Sélectionnez ou créez un calcul." Espace pré-réservé min-height (CLS=0). |
| B-16 | **Éditeur de calcul — formulaire** | `/(shell)/[orgSlug]/projets/[projetId]/calculs/[calculId]/page.tsx` | défaut (champs groupés par section) · validation on-blur rouge bloquant · avertissement orange · Ctrl+Entrée=calculer | Code | P1 | **COMBINATOIRE — ne pas faire dessiner par CD.** 6 formulaires = 218 champs depuis ENGINE_DESCRIPTORS. Gabarit d'un champ type = CD (A-02/A-03/A-05) ; instanciation des 218 = Code. |
| B-17 | **Résultats de calcul (succès)** | `/(shell)/[orgSlug]/projets/[projetId]/calculs/[calculId]` | succès CALC_SUCCESS (opacity 0→1 + translateY, focus programmatique, `aria-live`) · tableau OutputTable | CD+Code | P1 | CTA "Émettre un PV" présent SEULEMENT si statut "Calculé". Gabarit OutputTable = CD (A-09) ; colonnes par moteur = Code (combinatoire). |
| B-18 | **Calcul en cours — feedback par seuil** | `/(shell)/[orgSlug]/projets/[projetId]/calculs/[calculId]` | <400ms (aucun indicateur) · 400ms–3s (bouton pending + skeleton réel) · >3s (bandeau d'avancement honnête) | CD | P1 | clearTimeout dans finally pour éviter flash 380–420ms. Contenu du bandeau >3s (libellés d'étape) dépend du moteur = Code. Gabarit du conteneur = CD (bandeau générique). `aria-live="polite"` "Calcul en cours". |
| B-19 | **Calcul en erreur — moteur** | `/(shell)/[orgSlug]/projets/[projetId]/calculs/[calculId]` | (a) validation serveur → champ concerné · (b) non-convergence → message honnête, statut Erreur · (c) divergence cas-test → statut "En erreur", CTA absent + icône+tooltip métier | CD | P1 | Aucun résultat partiel affiché. CTA "Émettre PV" ABSENT (pas grisé). Distinct de l'erreur réseau (B-20). |
| B-20 | **Calcul en erreur — réseau** | `/(shell)/[orgSlug]/projets/[projetId]/calculs/[calculId]` | timeout/5xx/perte réseau · inline AlertCircle · Réessayer · saisie conservée | CD | P1 | Calcul idempotent (moteurs déterministes, DoD §4) → relancer est sûr. Skeleton infini INTERDIT. |
| B-21 | **Résultat dégradé / warnings moteur** | `/(shell)/[orgSlug]/projets/[projetId]/calculs/[calculId]` | succès-dégradé avec warnings | Code | P1 | Warnings moteur peuvent fuir la méthode (mémoires `redaction-failclosed`, `whitelist ple*/qce`). Whitelist fail-closed obligatoire. Non scellable en PV par défaut si verdict non net — décision F-08 : expert-genie-civil + ingenieur-securite. |
| B-22 | **Retour sur calcul ancien (recalculable)** | `/(shell)/[orgSlug]/projets/[projetId]/calculs/[calculId]` | défaut (badge "Recalculable" · entrées + dernier résultat · date) · recalcul · lien PV émis | CD+Code | P1 | Si PV déjà émis : modifier+recalculer ne modifie PAS le PV scellé (instantané). Raccourci D=dupliquer. |
| B-23 | **PV déjà émis — tentative re-émission** | `/(shell)/[orgSlug]/projets/[projetId]/calculs/[calculId]` | permission/défaut | Code | P1 | Décision F-04 requise : un calcul peut-il avoir N PV ? Si non : "Émettre PV" → "Voir le PV n°…". Idempotence à cadrer avec dev-backend. |
| B-24 | **Onglet PV & Livrables — liste** | `/(shell)/[orgSlug]/projets/[projetId]/pv/page.tsx` | défaut (liste PV) · chargement · vide · erreur | CD+Code | P1 | Badge "Scellé" asphalte+cadenas, jamais vert. Actions : Télécharger PDF + Vérifier intégrité. Jamais Modifier. |
| B-25 | **Onglet PV — vide (aucun PV émis)** | `/(shell)/[orgSlug]/projets/[projetId]/pv/page.tsx` | vide | CD | P1 | "Aucun PV émis. Les PV apparaissent ici une fois un calcul scellé." SANS CTA direct (l'émission part d'un calcul). |
| B-26 | **Vue d'un PV (lecture seule)** | `/(shell)/[orgSlug]/projets/[projetId]/pv/[pvId]/page.tsx` | défaut · chargement · erreur 404 tenant-safe | CD+Code | P1 | Identité émetteur + horodatage + numéro + hash HMAC + params + résultats scellés. Actions : PDF + Vérifier. Jamais Modifier. |
| B-27 | **PV 404 (lien périmé / autre org)** | `/(shell)/[orgSlug]/projets/[projetId]/pv/[pvId]` | erreur 404 tenant-safe | Code | P1 | Anti-énumération : ne pas distinguer inexistant/interdit. Page 404 PV dédiée. |
| B-28 | **Bibliothèque de moteurs** | `/(shell)/[orgSlug]/bibliotheque/page.tsx` | défaut (catalogue 6 moteurs / 3 domaines) · chargement · erreur · 0 moteur actif dans la souscription | CD+Code | P1 | Lecture seule. Aucun symbole/formule exposé (confidentialité). Entitlements par pack : moteurs hors souscription = masqués ou "non inclus" (décision F-05 requise). État "0 moteur actif" = mauvais provisionnement (gabarit EmptyState A-16). |
| B-29 | **Fiche moteur (détail catalogue)** | `/(shell)/[orgSlug]/bibliotheque/[engineId]/page.tsx` | défaut · chargement · introuvable | CD+Code | BL | Optionnel P1. Pas de bouton "Lancer" hors contexte projet. |
| B-30 | **Paramètres — Général org** | `/(shell)/[orgSlug]/parametres/general/page.tsx` | défaut · chargement · édition Admin (optimistic) · lecture seule Membre (champs disabled + note) · succès toast · erreur rollback | CD | P1 | RBAC Admin/Membre conditionne l'affichage (F-10). En P1 : champs disabled + "Réservé aux administrateurs" pour Membre — à trancher titulaire. |
| B-31 | **Mon compte (profil + mot de passe)** | `/(shell)/[orgSlug]/compte/page.tsx` | défaut · chargement (GET /auth/me) · édition profil · changement MDP (MDP actuel incorrect / nouveau trop faible / confirmation différente / succès) · invalidation session post-changement MDP | CD | P1 | Clés API hors périmètre. Ouvert depuis pied sidebar ET avatar topbar (même store Zustand). Post-changement MDP : à confirmer avec dev-backend si la session est invalidée côté serveur (redirect /login ou maintien). |
| B-32 | **Aide** | `/(shell)/[orgSlug]/aide/page.tsx` | défaut · responsive | CD | P1 | Raccourcis N/D/Ctrl+Entrée/E + lien support + version/build affichée (ancre du skew client/serveur D-17). Statique P1. |
| B-33 | **Erreur tenant / accès refusé (403/404 scopé org)** | `/(shell)/[orgSlug]/` — not-found.tsx + error.tsx | 404 ressource · 403 rôle insuffisant | CD | P1 | Messages tenant-safe. Jamais révéler l'existence d'une ressource d'un autre tenant. Retour "Mes projets" de l'org. |
| B-34 | **Erreur globale applicative** | `app/error.tsx` / `app/global-error.tsx` | erreur inattendue · perte réseau globale | CD | P1 | Pas de stack technique exposée. Gabarit sobre + "Recharger". |
| B-35 | **Onglet Informations projet** | `/(shell)/[orgSlug]/projets/[projetId]/` (onglet Informations) | défaut · chargement · édition légère (renommage, optimistic) · lecture seule · erreur · succès | CD+Code | P1 | Renommage = seul write léger P1. Pas de gestion membres/accès (hors P1). Afficher les métadonnées en lecture (créé le, par qui). Si 0 membres listés en P1 → ne pas afficher la section membres. |

---

## C. Modales / overlays

| # | Surface | Contexte | États requis | Source | Priorité | Notes critiques |
|---|---|---|---|---|---|---|
| C-01 | **Sélecteur de moteur (Nouveau calcul)** | `/projets/[projetId]/calculs` | ouvert (groupes CH./FD./LB.) · hover/sélection · chargement descripteurs · erreur descripteurs indisponibles · entitlements (moteurs grisés/absents selon pack) | CD+Code | P1 | Décision F-05 requise. Raccourci N. Focus trap + ESC. opacity+translateY à l'ouverture. |
| C-02 | **Émission / scellement PV (récapitulatif)** | `/calculs/[calculId]` | ouvert (récap params + résultats recalculés + identité + horodatage) · chargement scellement · divergence recalcul ≠ affiché (blocage + message) · erreur serveur (modale reste ouverte) · succès (toast + redirect /pv/[pvId]) | CD+Code | P1 | Optimistic UI INTERDIT (DoD §4/§8). Idempotence double-émission à cadrer avec dev-backend. Divergence → blocage + "Les paramètres ont changé depuis le dernier calcul, relancez avant d'émettre". POST /projects/:id/calc-results/:cid/pv. |
| C-03 | **Vérification intégrité PV (en ligne)** | `/pv/[pvId]` | défaut · chargement (vérif serveur) · intègre (verdict PASS, triple canal) · altéré (verdict FAIL, wording prudent) · erreur réseau | CD+Code | P1 | Vérif = appel serveur, jamais comparaison visuelle du hash tronqué (mémoire `roadsen-pv-seal-threat-model`). Wording FAIL : "Le sceau ne correspond pas — ce document a pu être altéré." JAMAIS "certifié"/"fait foi"/"opposable" (mémoire `roadsen-pv-seal-legal-wording`). Wording validé fiscal-juridique (F-09). |
| C-04 | **OrgSwitcher dropdown** | Sidebar | fermé · ouvert (liste orgs + checkmark + rôle Admin/Membre) · chargement (depuis JWT) · 1 seule org · switch | CD+Code | P1 | `queryClient.clear()` + redirect à la RACINE `/projets` de la nouvelle org (jamais conserver projetId/calculId). Pas "Créer une organisation" en P1. |
| C-05 | **Centre de notifications dropdown** | Topbar | fermé · ouvert vide · ouvert avec entrées (max 5) · non lues (badge) · chargement | CD+Code | P1 | Décision F-06 requise : si notifications non alimentées en P1 → supprimer la cloche entièrement. Si alimentées : Source = CD+Code (gabarit CD, données serveur Code). NE PAS afficher la cloche avec une liste toujours vide. |
| C-06 | **Palette Cmd+K** | Global `/(shell)/[orgSlug]/` | fermée · ouverte vide (récents) · saisie/filtrage · résultats · aucun résultat · focus trap · récents vides (org neuve) · hors contexte projet (actions contextuelles absentes) | CD+Code | P1 | Récents par tenant — jamais cross-org après switch. Lib `cmdk`. Hors projet : "Nouveau calcul" et "Émettre un PV" retirés de la liste d'actions. |
| C-07 | **Modale "quitter sans enregistrer"** | Formulaire calcul en cours de saisie | déclenchée si navigation/back pendant saisie non calculée · confirmation (quitter) · annulation (rester) | CD | P1 | Déclencher sur : navigation sidebar, OrgSwitcher, back navigateur, fermeture onglet (beforeunload). Saisie conservée si annulation. Décision F-12 : beforeunload systématique ou uniquement si formulaire dirty ? |
| C-08 | **Confirmation destructive générique** | Déconnexion (si confirmation requise) | ouvert · confirmation · annulation | CD | P1 | Décision F-11 : déconnexion directe (pas de modale) ou confirmée (C-08). Réutilise A-12 sm. Si directe → cette modale reste disponible pour d'autres usages futurs mais n'est pas instanciée en P1. |

---

## D. Flux / parcours

| # | Flux | Route(s) | États requis | Source | Priorité | Notes critiques |
|---|---|---|---|---|---|---|
| D-01 | **Résolution d'organisation au démarrage (middleware)** | `/ → /[orgSlug]/projets` | chargement · 1 org → redirect direct · slug invalide/non-membre → redirect login · JWT expiré → redirect login avec `returnTo` | Code | P1 | JWT uniquement (jamais DB par requête). Contrat slug↔X-Org-Id à figer avec ingenieur-securite (C2 shell-v1, F-01). |
| D-02 | **Session expirée / 401 global en cours d'usage** | `/(shell)/[orgSlug]/*` | JWT expiré → tout appel peut renvoyer 401 | Code | P1 | Intercepteur 401 unique → purge queryClient → redirect /login + `returnTo` + toast. Skeleton infini INTERDIT sans intercepteur. Formulaire calcul en cours → C-07 si formulaire dirty. |
| D-03 | **orgSlug URL n'appartient pas à l'utilisateur** | `/(shell)/[orgSlug]/projets` | isolation | Code | P1 | Middleware valide via claims JWT. Si non-membre → 404/redirect SILENCIEUX (anti-énumération). À prouver par test (ingenieur-securite + qa-test). |
| D-04 | **Switch d'org pendant ressource ouverte** | `/[orgSlug]/projets/[projetId]/calculs/[calculId]` | isolation inter-tenant | Code | P1 | Switch → `queryClient.clear()` + redirect RACINE projets nouvelle org. Jamais conserver projetId/calculId. Test négatif : forger `/[orgB]/projets/[projetId-orgA]` → 404. |
| D-05 | **Déconnexion** | Pied sidebar ou menu avatar | purge → redirect login | Code | P1 | Invalidation token côté serveur + `queryClient.clear()` + purge localStorage tenant + redirect /login. Si confirmation activée (F-11) → C-08. Si formulaire calcul ouvert → C-07 d'abord. Bouton localisé : pied sidebar libellé "Se déconnecter" ET/OU menu avatar (décision F-11). |
| D-06 | **Parcours complet calcul → PV (nominal P1)** | `/calculs/[calculId]` → C-02 → `/pv/[pvId]` | sélection moteur · saisie+validation · calcul serveur → Calculé · récap+scellement · PV lecture seule+vérif | Code | P1 | Moteur → Résultat de calcul → PV scellé. Optimistic interdit sur calcul et PV. |
| D-07 | **Calcul — erreur serveur / moteur rejette params** | `/calculs/[calculId]` | erreur moteur distincte erreur réseau | Code | P1 | Bouton revient actif. Message distinct (params incompatibles vs erreur serveur). Aucun résultat partiel. Statut reste Brouillon/Erreur → CTA absent. |
| D-08 | **Réseau coupé PENDANT calcul en vol** | `/calculs/[calculId]` | timeout client · état erreur · relance sûre | Code | P1 | Calcul idempotent (moteurs déterministes, DoD §4) → relancer est sûr. Confirmer idempotence avec dev-backend. Skeleton infini INTERDIT. |
| D-09 | **Calcul long >3s / risque timeout infrastructure** | `/calculs/[calculId]` | bandeau d'avancement honnête | Code | P1 | Libellés d'étape dépendent du moteur (Code) — gabarit du bandeau = CD (B-18). Vérifier timeout Cloudflare/Render (~100s) avec devops-cloud : un moteur lent peut déclencher 504 sans raison métier. |
| D-10 | **Émission PV — recalcul diverge des chiffres affichés** | `/calculs/[calculId]` → C-02 | erreur blocage | Code | P1 | Détection d'écart → blocage + message dans la modale (C-02). Équivalence client↔serveur dans tolérance signée (DoD §4). À prouver par qa-test. |
| D-11 | **Émission PV bloquée — statut ≠ Calculé** | `/calculs/[calculId]` | CTA absent | CD | P1 | CTA absent (pas grisé). Icône d'état + tooltip métier : brouillon / erreur / divergence. Jamais logique interne exposée. |
| D-12 | **Flux changement d'organisation (isolation)** | OrgSwitcher → `/[nouveauSlug]/projets` | switch · purge cache · redirect | Code | P1 | `queryClient.clear()` + redirect racine. Zone critique isolation (DoD §3). Test négatif obligatoire. |
| D-13 | **Sauvegarde paramètres / renommage — rollback optimistic** | `/parametres/general` · onglet Informations | erreur après optimistic UI | Code | P1 | Rollback doux 150ms + toast erreur. Jamais optimistic sur calcul/PV. |
| D-14 | **Téléchargement PDF PV — lent / échoué** | `/pv/[pvId]` | chargement · erreur · succès | Code | P1 | Bouton pending pendant génération. Erreur explicite + Réessayer. Jamais onglet blanc ou PDF partiel silencieux. GET /projects/:id/pvs/:pid/pdf. |
| D-15 | **Vérification intégrité — sceau invalide (FAIL)** | `/pv/[pvId]` | verdict FAIL | Code | P1 | État FAIL = risque le plus grave. Wording (C-03) validé par fiscal-juridique avant mise en prod (F-09). |
| D-16 | **PWA hors-ligne global (bannière persistante)** | `/(shell)/[orgSlug]/*` | offline | CD+Code | P1 | `navigator.onLine=false` → bannière persistante non bloquante + suspension calcul/PV. SW ne doit PAS servir calcul/PV en cache périmé. À cadrer avec dev-frontend + devops-cloud. |
| D-17 | **PWA — nouvelle version déployée (skew client/serveur)** | `/(shell)/[orgSlug]/*` | build-id mismatch | Code | BL | Invite "Une nouvelle version est disponible, rechargez". Critique car descripteurs moteurs = source des 218 champs. |
| D-18 | **Error boundary — crash JS isolé** | `/(shell)/[orgSlug]/*` | crash JS composant | CD | P1 | error.tsx par segment Next App Router. Un crash panneau calcul ne tue pas le shell. "Une erreur est survenue dans cette section" + recharger. |
| D-19 | **Back/Forward navigateur pendant modale ou calcul en vol** | `/(shell)/[orgSlug]/*` | back pendant modale ouverte · back pendant calcul en vol | Code | P1 | Modale ouverte + back = ferme la modale (History API pushState ou intercepteur). Calcul en vol + back = C-07 si formulaire dirty. Annulation de requête fetch en vol. Décision F-12 requise. |
| D-20 | **Concurrence — calcul modifié par autre membre** | `/calculs/[calculId]` | conflit version | Code | BL | Minimal P1 si implémenté : "Ce calcul a été modifié entre-temps, rechargez". Pas de collaboration temps réel. |
| D-21 | **Accès direct route profonde (deep-link à froid)** | `/projets/[projetId]/calculs/[calculId]` | chargement parallèle projet+calcul | Code | P1 | Skeleton cohérent bande+master-detail. Pas de flash page vide. Gérer incohérence (calcul existe, projet non). |
| D-22 | **Root layout (providers + tokens)** | `app/layout.tsx` | thème clair · thème sombre · reduced-motion global | CD+Code | P1 | **Pré-condition bloquante** : globals.css à aligner avant tout composant. React Query providers, Geist self-hosted, tokens v3 `@theme` Tailwind v4, `lang="fr"`, `data-theme`. |
| D-23 | **Redirect racine** | `app/page.tsx → /[orgSlug]/projets` | redirection | Code | P1 | Aucune logique auth ici (tout dans middleware.ts). |

---

## E. Responsive — matrice par breakpoint

### Comportements par surface et breakpoint

| Surface | <768px | 768–1023px | 1024–1279px | ≥1280px |
|---|---|---|---|---|
| **Sidebar** | Bottom tab bar 56px (4 items : Projets / Récents / Cmd+K / Compte) + drawer slide-over | Drawer + hamburger | Collapsed 64px (icônes + tooltips) | Expanded 240px |
| **Topbar** | Breadcrumb = nom projet seul + hamburger | Complet | Complet | Complet |
| **Master-detail calculs** | Drill-down liste→détail (bouton Retour) | Drill-down | Drill-down | Split (liste 280px + panneau) |
| **Onglets projet** | Scrollables horizontalement + snap + indicateur de débordement | Scrollables | Complet | Complet |
| **Toasts** | top-center | top-center | bottom-right | bottom-right |
| **Modales (sm/md/lg)** | Plein écran (ou quasi-plein) — footer fixe en bas, corps scrollable | Centrée 90% largeur max | Centrée taille fixe | Centrée taille fixe |
| **OutputTable** | Scroll horizontal + colonne id gelée (sticky) — pas de cartes empilées | Scroll horizontal | Complet | Complet |
| **Cmd+K** | Plein écran (champ de recherche visible + tactile) | Centrée | Centrée | Centrée |

### Règles transversales responsive

- CLS=0 sur tous les breakpoints (skeletons aux dimensions réelles).
- Focus trap actif sur drawer mobile (`inert` sur `<main>`). ESC ferme le drawer.
- Bottom tab bar <768px : 4 items uniquement — pas de gestion membres/facturation (hors P1).
- OutputTable <768px : scroll horizontal obligatoire (pas de cartes empilées — perte de comparabilité des lignes).
- Modale <768px : footer (boutons) fixe en bas ; corps scrollable indépendamment (pas de scroll sur toute la modale).
- Cmd+K <768px : plein écran + champ de recherche en premier focus (pas de palette "au clavier" sans clavier physique).

---

## F. Décisions ouvertes bloquantes

| # | Décision | Bloque | Responsable |
|---|---|---|---|
| F-01 | Contrat slug↔X-Org-Id : JWT claims ou résolution DB ? | D-01, D-03, D-04, C-04 | `ingenieur-securite` (C2 shell-v1) |
| F-02 | ✅ **TRANCHÉ (27/06) : Calculs par défaut.** `page.tsx` `/projets/[projetId]` rend l'onglet Calculs directement. | B-12 | Titulaire ✓ |
| F-03 | ✅ **TRANCHÉ (27/06) : OUI — création de projet self-service en P1.** → ajoute un écran/modale « Nouveau projet » + endpoint **POST /projects** (dev-backend) ; l'état vide B-08 reçoit un CTA « Nouveau projet ». **Élargit le périmètre Phase 1.** | B-08 (CTA), nouvel écran, +backend | Titulaire ✓ + dev-backend |
| F-04 | Un calcul peut-il avoir N PV ? Et le PV fige-t-il un snapshot complet (params+résultats) ou une référence au calcul ? La décision inclut la chaîne de preuve : une référence orpheline si le calcul est modifié n'est pas acceptable. | B-23, C-02, chaîne de preuve | Expert + dev-backend + ingenieur-securite |
| F-05 | ✅ **TRANCHÉ (27/06) → ADR 0009.** Abonnement par organisation : entitlements par pack + expiration **durée ET quota** (au premier atteint), contrôlée par **super-admin plateforme** (backoffice P1, console fast-follow). **Enforcement SERVEUR** (guard d'abonnement) ; l'UI gate en défense de profondeur. Nouveaux états : moteur verrouillé, abonnement expiré (lecture seule), quota restant/épuisé. | C-01, B-28, +backend, +états UI | Titulaire ✓ → ADR 0009 |
| F-06 | ✅ **TRANCHÉ (27/06) : NON → la cloche est RETIRÉE de la topbar en P1** (pas d'icône toujours vide). C-05 non instancié en P1. | C-05 retiré, B-06 sans cloche | Titulaire ✓ |
| F-07 | Plages physiques pour avertissement orange (A-02) — livrables science client | A-02, B-16 | STARFIRE (split contractuel) |
| F-08 | ✅ **TRANCHÉ (27/06) → ADR 0012.** Émission d'un PV sur verdict **NON CONFORME = AUTORISÉE, durcie** (reco `expert-genie-civil`) : verdict scellé de 1er niveau (dans le HMAC), marquage NON CONFORME inratable, mention de portée du sceau, double confirmation à l'émission, vérification en ligne portée par le verdict. Dénomination **« PV » conservée**. Wording NON CONFORME → à valider `fiscal-juridique` + `qa-challenger` avant figement. (Le cas warnings/résultat dégradé B-21 reste lié à la whitelist de redaction — concern distinct.) | B-21, C-02, D-10, pipeline PV | Titulaire ✓ → ADR 0012 |
| F-09 | Wording verdict "sceau invalide" validé par fiscal-juridique avant mise en prod | D-15, C-03 | `fiscal-juridique` |
| F-10 | Membre vs Admin sur /parametres/general : champs disabled ou route inaccessible ? | B-30 | Titulaire |
| F-11 | Déconnexion : directe ou confirmation modale ? Où vit le bouton (pied sidebar seul / menu avatar / les deux) ? | D-05, C-08 | Titulaire |
| F-12 | Modale C-07 "quitter sans enregistrer" : déclenchée sur `beforeunload` (fermeture onglet) ou uniquement sur navigation interne ? | C-07, D-19 | Titulaire + dev-frontend |
| F-13 | Langue unique FR — pas d'i18n en P1. | Toutes surfaces | **Acté ici.** Pas d'action supplémentaire requise. |

---

## G. Stratégie de génération par lots

L'ordre est une contrainte, pas une recommandation. Chaque lot est pré-condition du suivant.

### Lot 0 — Pré-condition bloquante (build, pas Claude Design)

Avant tout prompt Claude Design : aligner `globals.css` sur les tokens v3 (`identite-v3.md` §c). Tant que `globals.css` contient les valeurs boilerplate Next (`#ffffff/#171717`, `font-family: Arial`), tout gabarit CD produit référence des variables inexistantes dans le code.

Livrables Lot 0 : tokens couleur (clair + sombre `data-theme`), typographie Geist self-hosted, motion, radius, ombres, tokens de statut — tous en variables CSS `:root`. Résoudre `--surface-nav-hover` (valeur proposée shell-v1 : #2d3237 — à valider via stylelint avant usage).

### Lot 1 — Design system (Claude Design)

Gabarits atomiques et moléculaires. Ordre de dépendance :

1. A-25 Tokens/globals (validation visuelle — le code est le Lot 0)
2. A-18 Logotype ROADSEN (tous états)
3. A-17 Focus ring
4. A-24 Kbd · A-23 Avatar
5. A-01 Button (4 variantes × états)
6. A-02 Input · A-03 Select · A-04 Textarea · A-05 Checkbox/Radio/Switch
7. A-06 Badge statut · A-07 Domain tag · A-08 Verdict banner
8. A-10 Metric
9. A-11 Card/Panel · A-12 Modal · A-13 Dropdown · A-14 Toast · A-15 Skeleton · A-16 EmptyState
10. A-19 Tooltip
11. A-22 Breadcrumb · A-21 Tabs
12. A-09 OutputTable (gabarit : structure + colonnes vides — colonnes peuplées = Lot 3)

Règle Lot 1 : chaque composant est livré avec tous ses états dans un même artboard. Pas de happy path seul. Les données affichées sont fictives réalistes.

### Lot 2 — Shell + écrans clés (Claude Design)

Chrome global et écrans à fort enjeu de décision de design. Ordre chemin utilisateur :

1. B-04 Shell layout (sidebar expanded + collapsed + topbar + skip-link)
2. B-05 Sidebar globale (tous états)
3. B-06 Topbar contextuelle (tous états)
4. B-01/B-02 Login (tous états — hors combinatoire)
5. B-07/B-08 Liste projets + état vide
6. B-10 Layout espace projet (bande + onglets, tous états)
7. B-13/B-14/B-15 Onglet Calculs master-detail (structure — sans données moteur)
8. B-17/B-18/B-19/B-20 Résultats + états calcul (gabarits — colonnes vides)
9. B-24/B-25/B-26 PV & Livrables (liste + vue)
10. C-01 Sélecteur moteur · C-02 Modale émission PV · C-03 Vérification intégrité
11. C-04 OrgSwitcher · C-06 Cmd+K · C-07 Quitter sans enregistrer
12. B-30 Paramètres général · B-31 Mon compte · B-32 Aide
13. B-33/B-34 Erreurs globales · B-11/B-27 404 tenant-safe · B-09 0 org

Règle Lot 2 : tous les états transverses (défaut / chargement / vide / erreur / succès) dessinés pour chaque surface. Les colonnes spécifiques aux moteurs restent vides ou génériques dans les gabarits ("Paramètre 1 / Résultat 1"). Les données fictives sont réalistes (ex. "RN2-PK45", valeurs numériques plausibles).

### Lot 3 — Dérivation Code (build — pas Claude Design)

Tout ce qui est combinatoire ou dérivé de données réelles :

| Surface | Gabarit source | Dérivation |
|---|---|---|
| B-16 — 6 formulaires × 218 champs | A-02/A-03/A-05 (Lot 1) | Code depuis ENGINE_DESCRIPTORS |
| A-09 / B-17 — colonnes OutputTable par moteur | A-09 gabarit (Lot 1) | Code depuis descripteurs/réponse moteur |
| B-18 — libellés d'étape bandeau >3s | B-18 gabarit (Lot 2) | Code depuis réponse moteur |
| B-28/B-29 — fiche moteur | A-11 Card (Lot 1) | Code depuis bibliothèque de descripteurs |
| B-07 — lignes peuplées liste projets | B-07 gabarit (Lot 2) | Code depuis GET /projects |
| C-05 — entrées notifications (si F-06=oui) | C-05 gabarit (Lot 2) | Code depuis serveur |
| B-03 — flux premier login / MDP forcé | Aucun gabarit CD | Code depuis flag serveur (à confirmer dev-backend) |

Règle Lot 3 : aucun prompt Claude Design. Le gabarit Lot 1 ou Lot 2 suffit comme contrat visuel. Un écart entre le gabarit et le combinatoire réel se résout en code, pas par retour au gabarit.

---

## Récapitulatif des totaux (v2)

| Section | Nombre | Delta vs v1 |
|---|---|---|
| A — Composants design system | 25 | +5 (A-05 Checkbox/Radio/Switch, A-21 Tabs, A-22 Breadcrumb, A-23 Avatar, A-24 Kbd) |
| B — Écrans / layouts | 35 | +1 (B-03 Premier login/MDP forcé) |
| C — Modales / overlays | 8 | +2 (C-07 Quitter sans enregistrer, C-08 Confirmation destructive) |
| D — Flux / parcours | 23 | +2 (D-05 Déconnexion, D-19 Back/Forward navigateur) |
| E — Breakpoints | 4 | 0 (matrice enrichie : modales + OutputTable) |
| F — Décisions ouvertes | 13 | +3 (F-11 Déconnexion, F-12 Beforeunload, F-13 FR only — acté) |
| G — Stratégie de génération | 4 lots | Nouveau |

**Corrections de cohérence de source appliquées :**
- C-05 Notifications : `CD` → `CD+Code` (données serveur conditionnent le contenu)
- D-09 Calcul long (bandeau >3s) : `CD+Code` → `Code` pour le contenu des étapes ; gabarit du conteneur reste CD (B-18)
