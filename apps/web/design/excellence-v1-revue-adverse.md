Revue adverse menée. Verdict synthétique en tête, détails ciblés ensuite.

---

## Verdict

Ce spec **élève réellement** au niveau haute facture **sans nuire à l'efficacité de l'expert**, à condition de couper trois excès et de corriger quatre incohérences techniques. Sa colonne vertébrale — tokens systémiques, sobriété cinétique sur les actions à haute fréquence, tabular-nums, focus instantané, honnêteté du feedback — est juste et bien hiérarchisée. La discipline « ce qui n'élève pas » est rare et précieuse : le document s'auto-censure mieux que la plupart des specs design.

**Mais** : il y a plus de spec que de Phase 1 finançable, et quelques détails techniques sont faux (pas seulement discutables). À corriger avant de le déclarer source de vérité de build.

---

## Failles techniques (faux, pas seulement discutable)

**MAJEUR — `prefers-reduced-motion` global tue le focus management.** Le bloc « source de vérité unique » force `transition-duration: 0.01ms !important` sur `*`. Or §5 prescrit `scrollIntoView({ behavior: 'smooth' })` post-calcul. Sous reduced-motion, `smooth` doit devenir `auto` — et ce n'est pas du CSS, c'est du JS. Le `!important` global ne le couvre pas ; pire, un `scroll-behavior: smooth` posé en CSS serait écrasé silencieusement et l'incohérence passerait inaperçue. **Correctif** : lire `window.matchMedia('(prefers-reduced-motion: reduce)').matches` dans le helper de focus et passer `behavior: prefersReduced ? 'auto' : 'smooth'`. Le spec ne le dit nulle part — c'est un trou, pas un détail.

**MAJEUR — le double-anneau focus est faux sur fond variable.** Le `box-shadow: 0 0 0 4px rgba(var(--color-canvas-rgb), 1)` pose un anneau **couleur canvas** (clair) autour de l'élément. Sur la sidebar asphalte `#22262b` (fond sombre), cet anneau clair est correct par contraste — mais le commentaire dit « double-anneau sur fonds variables (sidebar asphalte) » alors que la variable utilisée est `--color-canvas-rgb`, soit le fond **clair** du contenu, pas l'asphalte. Le ring sera donc visuellement juste sur la sidebar mais **incohérent/invisible sur un fond clair** (anneau clair sur canvas clair → seule la couche pétrole 6px subsiste, ce qui est OK) — l'intention est confuse et le token mal nommé. **Correctif** : le premier anneau doit être la couleur **du fond local** (offset visuel), pas une constante canvas. Soit utiliser `outline-offset` seul + un `box-shadow` de contraste calculé par contexte, soit documenter explicitement que l'anneau intermédiaire = couleur de surface locale via une variable héritée `--surface-current`, pas `--color-canvas`. En l'état, c'est une promesse d'accessibilité non tenue sur la moitié des surfaces.

**MAJEUR — contraste des tokens non prouvé.** Le spec invoque « ≥ 3:1 » pour le focus et réserve rouge/vert aux verdicts, mais **aucun ratio n'est calculé**. `--color-text-muted: #8b9097` sur `--color-canvas: #f7f6f4` est à ~2.9:1 — **sous le seuil 4.5:1** pour du texte normal, et c'est précisément la couleur des `.label-caps` (11 px) et du message « Le résultat apparaîtra ici ». Texte petit + contraste faible = échec WCAG AA réel. **Correctif** : calculer et inscrire le ratio de chaque paire texte/fond dans le token (commentaire), remonter `--color-text-muted` à ≥ 4.5:1 sur canvas (vise `#6b7077` ≈ 4.6:1), et bannir `text-muted` sous 14 px pour tout texte porteur de sens. Sans cette table de contraste, le « ≥ 3:1 » est une affirmation non prouvée — exactement ce que la maison interdit.

**MINEUR — `color-mix` sans fallback.** Le hover « latérite → latérite foncée (`color-mix`) » et le `border-radius` n'évoquent aucun fallback. `color-mix()` est large en 2026 mais le spec cible « 3G fréquent en AOF » donc parc de terminaux ancien probable. **Correctif** : définir `--color-action-dark` en valeur résolue (déjà présent : `#d9954e` côté sombre — en ajouter un pour le hover light) plutôt que `color-mix` à la volée, ou poser un fallback `@supports not (color-mix(...))`.

**MINEUR — skeleton `setTimeout` 400 ms vs calcul < 200 ms : race au unmount.** Si le calcul répond à 380 ms, le `setTimeout(400)` peut monter le skeleton **après** l'arrivée du résultat (flash inverse). **Correctif** : annuler le timer dans le `then`/`finally` du calcul (`clearTimeout`) — trivial mais à écrire dans le spec, sinon `dev-frontend` livrera le flash que le timer prétend éviter.

---

## Sur-ingénierie / faux premium (à couper ou rétrograder)

**MAJEUR (périmètre) — le spec dépasse une Phase 1 finançable.** L'addition P0→P3 = **6 à 8 jours** de front pur, hors intégration données, hors états réels d'API, hors tests. Sur un devis socle 650k et une Phase 1 « socle ferme, moteurs best-effort » (cf. cadrage), 8 jours de polish UI **avant** que les écrans portent de la donnée réelle est un mauvais ordre d'investissement. **Correctif** : geler P0 + P1 comme engagement Phase 1 (le multiplicateur systémique + le gain visuel par unité d'effort), **basculer P2-P3 en backlog conditionnel** déclenché quand les écrans sont câblés sur données réelles. Le spec le pressent (points ouverts 1 et 3) mais ne tranche pas le coût global — il faut le trancher.

**MINEUR (gadget résiduel) — stagger d'entrée de vue (P3 #19).** « 30–40 ms/item, max 8 items, à l'entrée initiale de vue » : c'est le seul reliquat d'animation décorative du document, et il contredit l'esprit « le calme vient de l'absence de bruit ». Sur un outil expert ouvert des dizaines de fois/jour, un stagger même court devient un péage perçu dès la 3e ouverture. **Correctif** : supprimer, ou le restreindre à la **toute première** entrée de session (jamais re-déclenché à la navigation onglet). En l'état c'est de la décoration, pas du craft.

**MINEUR — `text-3xl` 40 px « hero number résultat ».** Un résultat de calcul géotech n'est pas une métrique marketing ; un « hero number » à 40 px sur un tableau dense est un tic de dashboard SaaS grand public. Le vrai signal de crédibilité ingénieur, c'est l'**alignement tabulaire** et l'**unité**, pas la taille. **Correctif** : plafonner le résultat principal à `text-2xl` (32) au maximum, et seulement s'il y a **une** valeur de synthèse ; sinon rester en corps dense. Le 40 px sent la démo.

**MINEUR — densité « relaxed » 56 px persistée (point ouvert 3).** Préférence utilisateur persistée = stockage + hydratation + test = coût réel pour un gain faible en Phase 1. **Correctif** : confirmer la coupe — 44 px compact seul en Phase 1, comme le spec le suggère déjà. À acter, pas à laisser ouvert.

---

## Coût perf réel (vérifié, pas supposé)

Le spec est globalement **sain** sur la perf : `opacity`/`transform` only, interdiction de `width`/`box-shadow` animés, sticky header via IntersectionObserver (pas de listener scroll), collapse sidebar en `transform` non `width`. Ce sont les bons choix — pas de layout thrash structurel.

Deux réserves :
- **`@keyframes roadsen-shimmer` sur `opacity` en boucle infinie** : composite-only donc peu coûteux, mais une boucle infinie maintient le compositor actif → léger coût batterie sur mobile AOF. Acceptable car borné à l'état loading (> 400 ms) et coupé sous reduced-motion. RAS si on garantit le `clearTimeout` (cf. ci-dessus) pour qu'il ne tourne jamais sur un calcul rapide.
- **Cross-dissolve `opacity` sur changement d'onglet** : si les deux vues sont montées simultanément pendant la dissolve, double-render transitoire. Sur des vues lourdes (tableau de résultats), pic mémoire/CPU. **Correctif** : dissolve uniquement out→in séquentiel (l'ancienne démonte avant montage complet de la nouvelle), ou accepter un simple swap instantané sur les onglets (cohérent avec « actions répétées → instantané » — le cross-dissolve `--dur-base` contredit d'ailleurs cette règle pour les onglets projet, qui sont haute fréquence).

**Incohérence interne notable** : §1 et §3 classent les onglets projet en « actions répétées → instantané », mais le tableau §3 leur prescrit un cross-dissolve `var(--dur-base)` (200 ms) sur le contenu. C'est contradictoire. **Trancher** : onglets = swap instantané (règle Raycast appliquée), le cross-dissolve réservé aux changements de contexte rares.

---

## Contre-poids honnête (ce qui tient et qu'il ne faut pas surcorriger)

- La hiérarchie P0 (tokens d'abord) est exacte : c'est le seul vrai multiplicateur, et le déclarer bloquant avant tout composant est le bon ordre.
- Le refus du gradient/glow/glassmorphism, du spring généralisé, de la fausse barre de progression, du stagger sur lignes de tableau : c'est précisément la liste anti-« AI slop » correcte. Ne pas l'attendrir.
- L'honnêteté du feedback par seuil (rien < 400 ms, pas de fausse barre 1–3 s, step-based honnête > 3 s) est alignée sur la culture maison « ne survends pas » — c'est le meilleur passage du document.
- Focus instantané (`transition: none`), tabular-nums + Geist Mono + alignement droite, séparateur espace fine U+202F, `lang="fr"` : quick wins réels, fort ROI, à garder tels quels.
- L'interdiction d'optimistic UI sur calcul/PV est correcte et alignée DoD §4/§8 — non négociable, bien tranchée.

---

## Quick wins réels vs sur-ingénierie (tri net)

**Quick wins (faire) :** `lang="fr"`, tokens couleur/motion/focus en `:root`, focus `transition: none`, tabular-nums + helper `fmt` unique, badges verdict en tokens, Lucide en remplacement des glyphes Unicode, skeleton aux dimensions réelles + `clearTimeout`, `aria-live` post-calcul, zone résultat pré-réservée (CLS = 0). Tout P0 + P1.

**Sur-ingénierie (couper ou différer) :** stagger d'entrée de vue (#19), hero number 40 px, densité relaxed persistée, cross-dissolve onglets, View Transitions cross-document (déjà recommandé off — confirmer). Framer Motion : à n'introduire **que** si le drawer mobile gestuel est en scope Phase 1 — sinon dépendance injustifiée (le spec le dit ; trancher = drawer hors Phase 1 → pas de Framer Motion).

---

## À corriger avant de geler ce spec comme source de vérité (priorisé)

1. **CRITIQUE de méthode** : ce spec touche l'accessibilité (focus, contraste, reduced-motion) — zones où une affirmation non prouvée est interdite maison. **Ajouter une table de contraste calculée** (chaque paire texte/fond avec son ratio) et un **test axe-core CI** comme condition de gel. Sans preuve, le « ≥ 3:1 / AA » reste supposé.
2. **MAJEUR** : corriger le contraste `--color-text-muted` (≥ 4.5:1) et bannir text-muted < 14 px porteur de sens.
3. **MAJEUR** : focus management JS-aware `prefers-reduced-motion` (`scrollIntoView` `auto` vs `smooth`).
4. **MAJEUR** : clarifier/renommer le token du double-anneau (couleur surface locale, pas `--color-canvas`).
5. **MAJEUR (périmètre)** : geler P0+P1 en Phase 1, basculer P2-P3 en backlog conditionnel post-câblage données — décision de coût à acter, pas à laisser ouverte.
6. **MINEUR** : `clearTimeout` skeleton ; fallback `color-mix` ; couper stagger #19 et hero 40 px ; trancher onglets = instantané ; acter densité 44 px seule.

**Statut** : à corriger (liste ci-dessus), puis prêt pour P0+P1. Cette revue ne vaut pas validation humaine — le gel de ce spec comme source de vérité de build, et tout arbitrage de périmètre Phase 1, remontent au titulaire.