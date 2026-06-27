J'ai les éléments factuels nécessaires. Le contraste entre le shell proposé et la source de vérité (identité v3, DESIGN-BRIEF, contrat API) fait apparaître plusieurs failles. Je conclus.

---

# Revue adverse — Shell SaaS ROADSEN

Revue confrontée aux sources de vérité du dépôt : `05-Plateforme/apps/web/design/identite-v3.md` (figé), `05-Plateforme/apps/web/DESIGN-BRIEF-app-authentifiee.md`, `05-Plateforme/docs/adr/0008-...md`, `05-Plateforme/apps/web/src/app/globals.css`, `05-Plateforme/apps/web/AGENTS.md`. Verdict global d'abord : **bon squelette, mais PAS livrable en l'état** — quatre incohérences dures avec l'identité v3 figée et le contrat API, plus un périmètre Phase 1 gonflé. Détail priorisé ci-dessous.

## CRITIQUE

**C1 — Le fond sidebar #22262b contredit le token `--surface-nav`, qui vaut #0e0d0c en dark.**
Le shell tranche « fond asphalte #22262b » en s'appuyant sur l'identité v3, mais v3 distingue **`--accent-brand`/wordmark = #22262b** (asphalte de marque) de **`--surface-nav`** qui est un token de surface : #22262b en clair, **mais #0e0d0c en dark** (identite-v3.md l.222). Le shell code la nav en #22262b « partout » sans jamais mentionner le dark mode. Le DESIGN-BRIEF impose une **livraison light-first** mais avec tokens dark définis : un shell qui hardcode #22262b casse le thème sombre dès qu'il s'active via `prefers-color-scheme`. Plus grave : tout le shell est truffé de hex en dur (#2d3237, #1a1917, #1d2025, #5c6168, #8b9097…) dont **aucun n'existe dans la palette v3**. #2d3237 (hover), #1d2025, #1a1917 (déjà pris comme `--surface-base` *light*… non, c'est `--surface-base` *dark*) sont inventés. La règle de gouvernance v3 est explicite : « les composants ne consomment que les tokens sémantiques », instrumentée en stylelint.
*Correctif* : remplacer chaque hex par un token sémantique. Là où le token manque (hover nav, colonne master-detail), **créer le token dans v3 via avenant** — pas l'inventer dans le shell. Action #1 du plan (« aligner globals.css ») doit précéder *et conditionner* le shell, or `globals.css` est encore le boilerplate Next par défaut (#ffffff/#171717, `font-family: Arial`). Aucun token v3 n'est posé. Le shell décrit une UI qui n'a aucune base CSS existante.

**C2 — Contradiction frontale avec le contrat API : l'org est portée par `X-Org-Id`, pas par un slug d'URL.**
Le DESIGN-BRIEF §5 (API « déjà déployée ») : « L'organisation est portée par l'en-tête `X-Org-Id` (réappartenance revérifiée serveur) ». Le shell impose `/app/[orgSlug]/...` partout et un middleware qui valide le slug. Personne n'a tranché la **réconciliation slug↔X-Org-Id** : d'où vient le mapping slug→orgId ? Le JWT porte-t-il un slug ou un UUID (`sub`, cf. mémoire #42 `p_owner_user_id = sub JWT`) ? Le middleware fait-il un appel API pour résoudre le slug avant chaque rendu (coût + cache) ? Le risque multi-tenant est réel : si le client choisit l'org par slug d'URL mais que l'API tranche par en-tête, une **désynchronisation slug/en-tête = calcul affiché pour la mauvaise org**. C'est exactement l'erreur de contexte que le shell prétend prévenir.
*Correctif* : figer le contrat slug→orgId **avant** de geler le schéma d'URL (action #2). Le middleware doit résoudre slug→orgId depuis les claims JWT (jamais un appel DB par requête), et le client API doit injecter le `X-Org-Id` **dérivé du même slug** — source unique. Faire trancher par `ingenieur-securite`, pas en revue de maquette.

**C3 — Périmètre Phase 1 massivement gonflé vs le MVP figé.** Le DESIGN-BRIEF est explicite : **hors périmètre** = création de compte/org self-service, **administration membres/rôles, facturation**, édition avancée ; « le démo STARFIRE part de comptes pré-provisionnés ». Le shell réintroduit en dur : OrgSwitcher avec « Créer une organisation », sous-arbre `/parametres/{membres,facturation,securite,audit}`, `/compte` avec « clés API », indicateur de rôle par org, notifications (invitations membre). Même en « placeholder Phase 2 », chaque route vide est du code à écrire, tester (DoD §2 tests verts), garder RBAC (`/parametres` layout Admin-only = logique d'autorisation réelle à prouver, DoD §3). C'est de la cérémonie disproportionnée que la DoD elle-même proscrit (« évite la cérémonie disproportionnée… on n'applique que les [T] »).
*Correctif* : Phase 1 = `[orgSlug]/projets`, `[projetId]/{calculs,pv}`, `bibliotheque` (léger), `compte` minimal, `parametres/general`. Supprimer membres/facturation/securite/audit du shell P1 — un seul item « Paramètres » suffit. OrgSwitcher sans « Créer une organisation » (comptes pré-provisionnés). Le schéma d'URL peut rester *extensible* sans créer les fichiers vides maintenant.

## MAJEUR

**M1 — Sidebar fourre-tout : 4 zones + ~12 items en Phase 1.** Logotype, OrgSwitcher, Récents, Espace de travail (Tableau de bord placeholder + Mes projets), Ressources (Bibliothèque + Résultats&PV Phase 2 vide), zone basse (4 items), pied utilisateur, bouton réduire. Pour un MVP dont la destination primaire est *une* liste de projets, c'est lourd. « Tableau de bord » placeholder, « Résultats & PV » vide, « Membres », « Abonnement » : la moitié des items mènent à du vide en Phase 1 — charge cognitive et impression de coquille.
*Correctif* : en P1, sidebar = OrgSwitcher · Récents · Mes projets · Bibliothèque · (bas) Paramètres · Aide · compte. Pas de placeholders visibles ; on ajoute quand la page existe.

**M2 — Trois barres horizontales empilées dans le projet = vol d'espace vertical.** topbar 48 + sub-header projet 44 + onglets 44 = **136px de chrome** avant le contenu, sur des écrans BE souvent 768–900px de haut. Le master-detail (liste 280px + détail) sous 136px de bandeaux laisse peu de hauteur utile pour un formulaire de calcul long. Le conflit 3 a été tranché « onglets horizontaux » contre la sous-sidebar, mais on a gardé EN PLUS un sub-header dédié.
*Correctif* : fusionner sub-header et barre d'onglets en **une seule bande** (nom projet + badge à gauche, onglets à droite, 44px). Économie de 44px, zéro perte fonctionnelle.

**M3 — Persistance/SSR : le collapse auto à 1024–1279px contredit la garde SSR « défaut déplié ».** Le shell dit « garde SSR → déplié (valeur serveur) » ET « 1024–1279px : sidebar auto-collapsed par défaut ». Le serveur ne connaît pas la largeur viewport : il rendra déplié, puis le client repliera au mount selon la largeur → **flash de layout (déplié→replié) à chaque chargement** sur la tranche 1024–1279, justement les écrans laptop les plus courants. Plus : deux clés localStorage (`sidebar-desktop-state` / `sidebar-mobile-last-open`) sans règle de transition quand on franchit un breakpoint en redimensionnant.
*Correctif* : ne pas auto-replier par CSS-in-JS au mount ; utiliser un breakpoint CSS pur (la largeur replie via media query sans état JS) et ne persister QUE l'override explicite utilisateur. Le défaut SSR déplié n'introduit alors aucun flash car le repli est purement CSS.

**M4 — Routing App Router : `page.tsx` racine « Redirect → /app/[orgSlug]/... » sans orgSlug connu au build.** La racine ne connaît pas l'org de l'utilisateur (dépend du JWT, runtime). Une redirection statique est impossible ; il faut un redirect **runtime** côté serveur après lecture du token — ce qui n'est pas dit, et place de la logique d'auth dans `app/page.tsx` au lieu du middleware. De même `[projetId]/page.tsx` « Redirect → /calculs » : redirect systématique = round-trip inutile ; préférer rendre l'onglet Calculs par défaut. Et `AGENTS.md` du dossier web avertit en gras : **« This is NOT the Next.js you know »**, lire `node_modules/next/dist/docs/` avant de coder. Le shell suppose des conventions App Router (route groups `(shell)`, layouts segment) sans avoir vérifié qu'elles tiennent en Next 16 — risque de retravail.
*Correctif* : centraliser TOUTES les redirections d'auth/org dans `middleware.ts` (déjà prévu pour valider orgSlug). `app/page.tsx` ne fait rien d'autre que déléguer. Faire valider l'arbo par `dev-frontend` après lecture des docs Next 16 locales, avant de « figer le schéma comme contrat non refactorable » (action #2 — geler avant vérification est prématuré).

## MINEUR

**m1 — A11y `aria-pressed` vs `aria-expanded` : choix correct mais incomplet.** Le shell distingue bien `aria-pressed` (collapse apparence) / `aria-expanded` (drawer visibilité) — bon point. Mais le bouton collapse « en bas » avec label « ◁ Réduire » n'a pas de nom accessible stable en collapsed (l'icône seule). Préciser `aria-label` constant (« Réduire/Déplier la navigation ») indépendant de l'état visuel.

**m2 — Tooltips collapsed via `aria-describedby` à 250ms : `describedby` n'est pas un substitut de nom.** En collapsed, le label devient `sr-only` et le tooltip porte le texte. Si le lien n'a qu'une icône + un tooltip `describedby`, le **nom accessible** du lien peut être vide. Garder le label en `sr-only` DANS le lien (nom) et le tooltip en complément — le shell le dit pour la sidebar mais pas explicitement pour chaque item.

**m3 — Hash HMAC tronqué 8 car. comme « signal de sérieux » : cohérent avec la mémoire, mais attention au double discours.** La mémoire `roadsen-pv-seal-legal-wording` bannit « certifié/fait foi ». Montrer 8 car. de hash est OK, mais ne doit jamais être présenté comme preuve d'intégrité *hors ligne* (mémoire `roadsen-pv-seal-threat-model` : hash imprimé recalculable par un faussaire). S'assurer que « Vérifier intégrité » pointe vers une vérif **serveur/en ligne**, pas une comparaison visuelle du tronqué.

**m4 — Pastille domaine 6px : sous le seuil de perception fiable + redondance non-chromatique non reprise.** v3 impose pour les tags domaine un **préfixe texte CH./FD./LB.** (indistinguables en N&B / CVD, ADR 0008). Le shell remplace par une **pastille couleur 6px seule** — exactement ce que l'ADR interdit (couleur seule). Une pastille 6px latérite vs pétrole est en plus quasi indiscernable à cette taille.
*Correctif* : conserver le préfixe texte CH./FD./LB. à côté de la pastille, ou supprimer la pastille.

**m5 — Collision sémantique résiduelle non vue : underline d'onglet actif en latérite #a05226.** Le conflit 5 a justement écarté la latérite de l'état actif sidebar (réservée au CTA) au profit du pétrole. Mais l'onglet projet actif utilise « underline 2px latérite #a05226 » ET le CTA « Émettre un PV » est latérite. Même collision sémantique (nav active = action) que celle qu'on a corrigée pour la sidebar, réintroduite pour les onglets.
*Correctif* : trancher une règle unique « état actif de nav = pétrole, action = latérite » et l'appliquer aux DEUX niveaux (sidebar + onglets), sinon c'est incohérent.

## Contre-poids honnête (ce qui tient)

- **Séparation sidebar org-scope / topbar page-scope** : solide, juste, et la topbar sans nav applicative est une bonne décision.
- **OrgSwitcher en [0,0] sticky jamais réduit à une icône + rôle par org au switch** : excellent garde-fou anti-erreur de contexte, aligné avec l'enjeu déontologique multi-tenant. Le `queryClient.clear()` + redirect au switch est la bonne barrière comportementale.
- **Distinction calcul (vivant) / PV (scellé)** : badges typés, aucune action « Modifier » sur un PV, « Émettre un PV » conditionné au statut « Calculé » — parfaitement aligné sur la chaîne de preuve et la DoD §5. Bon réflexe.
- **`prefers-reduced-motion`, focus ring 2px, skip-link, `inert` sur `<main>`, focus trap drawer** : socle a11y au-dessus de la moyenne.
- **Command palette dès le socle** : conforme au DESIGN-BRIEF (Cmd+K listé en P1, ~4KB) — pas un sur-engineering, c'est explicitement cadré.

## Verdict

**NON digne en l'état d'un SaaS pro/scalable — l'ossature est bonne mais le shell n'est ni cohérent avec l'identité figée ni aligné sur le contrat API.** Il le devient **à ces conditions, dans l'ordre** :

1. **(CRITIQUE C2)** Figer le contrat **slug↔X-Org-Id** avec `ingenieur-securite` AVANT de geler le schéma d'URL. Sans ça, le slug-in-URL est un risque multi-tenant, pas une protection.
2. **(CRITIQUE C1)** Poser réellement les tokens v3 dans `globals.css` (aujourd'hui boilerplate Next) et **bannir tout hex en dur** du shell ; tout token manquant → avenant v3, pas invention locale ; traiter le dark mode (`--surface-nav` #0e0d0c) ou assumer explicitement light-only.
3. **(CRITIQUE C3 + M1)** Dégonfler au MVP figé : retirer membres/facturation/sécurité/audit/clés-API/« créer une org » du shell Phase 1.
4. **(MAJEUR M2/M3/M4)** Fusionner sub-header+onglets (136→92px de chrome) ; supprimer le flash de collapse (repli CSS, pas JS au mount) ; centraliser les redirects dans le middleware et **faire valider l'arbo Next 16 par `dev-frontend` après lecture des docs locales** avant de la déclarer « non refactorable ».
5. **(MINEUR m4/m5)** Réintroduire le préfixe texte domaine (ADR 0008) ; unifier la règle « nav active = pétrole / action = latérite » sur sidebar ET onglets.

Rappel de portée : **cette revue ne vaut pas validation.** Le gel du schéma d'URL et le contrat multi-tenant sont des décisions à enjeu (zone critique isolation) — elles remontent à l'humain et à `ingenieur-securite`, pas à une validation d'agent.

Fichiers de référence : `/Users/macbook/Desktop/roadsen/05-Plateforme/apps/web/design/identite-v3.md`, `/Users/macbook/Desktop/roadsen/05-Plateforme/apps/web/DESIGN-BRIEF-app-authentifiee.md`, `/Users/macbook/Desktop/roadsen/05-Plateforme/docs/adr/0008-gouvernance-couleur-accent-statut.md`, `/Users/macbook/Desktop/roadsen/05-Plateforme/apps/web/src/app/globals.css`, `/Users/macbook/Desktop/roadsen/05-Plateforme/apps/web/AGENTS.md`.