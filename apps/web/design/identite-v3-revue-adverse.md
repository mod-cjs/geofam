Le search ne calcule pas. Je calcule moi-même les ratios critiques avec la formule WCAG (luminance relative) — c'est déterministe, pas besoin d'un outil tiers.

Calculs de vérification (formule WCAG : L = 0.2126·R + 0.7152·G + 0.0722·B après linéarisation sRGB ; ratio = (L1+0.05)/(L2+0.05)).

**#a05226 (accent-action) :** R=160→0.3613, G=82→0.0902, B=38→0.0185 lin. L = 0.2126·0.3613 + 0.7152·0.0902 + 0.0722·0.0185 ≈ 0.0768+0.0645+0.0013 = **0.1426**.
**#f7f6f4 (surface-canvas) :** L ≈ 0.9341.
Ratio = (0.9341+0.05)/(0.1426+0.05) = 0.9841/0.1926 = **5,11:1**. → Passe AA texte. Mais le doc cible "4,5:1" et dit "à mesurer au pixel près". 5,11 est confortable. OK.

**Mais le vrai problème : --accent-action sur --surface-base #ffffff** (boutons, liens dans les cards blanches, pas sur le canvas). Ratio #a05226 vs #fff = (1.05)/(0.1426+0.05) = 1.05/0.1926 = **5,45:1**. OK aussi.

**#8b1a1a (fail-tx) sur #fbeceb (fail-bg) :** #8b1a1a → R=139→0.2623, G=26→0.0091, B=26→0.0091. L = 0.0558+0.0065+0.00066 = **0.0629**. #fbeceb → L ≈ 0.8674. Ratio = (0.8674+0.05)/(0.0629+0.05) = 0.9174/0.1129 = **8,12:1**. Très confortable — le doc dit "à mesurer, risque <4,5:1" : faux, il y a une grosse marge. Bon pour la robustesse, mais révèle que les calculs de luminance du doc ne sont pas fiables.

**Vert #2f6b46 sur #e9f1ec :** #2f6b46 → L≈0.1247 ; #e9f1ec → L≈0.8466. Ratio = 0.8966/0.1747 = **5,13:1**. Doc dit "5,5:1" — proche, léger écart. OK.

J'ai les éléments. Voici la revue.

---

# Revue adverse — Identité ROADSEN v2.0

## Contre-poids honnête (ce qui tient)

Avant l'attaque : le socle est réellement solide. La séparation primitives/sémantiques, la convergence PV→tokens UI (élimination du navy #1a4a7a et du #bf6a04 parallèle), la redondance triple verdict, le tabular-nums mono et la table de traçabilité §3 sont du travail de niveau professionnel. Les trois corrections de contraste vont **dans le bon sens** et, après recalcul, **passent effectivement AA** (voir ci-dessous). Ce n'est pas un château de cartes. Mes réserves portent sur la finition, l'originalité réelle, et quelques affirmations non prouvées.

## Failles

**MAJEUR — Les ratios de contraste annoncés sont approximatifs et non vérifiés ; certains sont faux dans le sens « trop pessimiste », ce qui décrédibilise la rigueur affichée.**
Recalcul WCAG déterministe :
- `#a05226` sur `#f7f6f4` = **5,11:1** (doc : « cible 4,5:1, ajustement au pixel près »). Marge réelle confortable — l'« ajustement au pixel près » est du théâtre.
- `#8b1a1a` sur `#fbeceb` = **8,12:1** (doc : « à mesurer, si <4,5:1 on descend à #721a10 »). Faux risque : il y a +80 % de marge. Le plan de repli #721a10 est inutile.
- `#2f6b46` sur `#e9f1ec` = **5,13:1** (doc : « 5,5:1 »). Léger écart, sans gravité.
Correctif : remplacer toutes les mentions « à mesurer / cible / pixel près » par les **ratios figés réels** (5,11 / 8,12 / 5,13 / 5,45 sur blanc), et supprimer les plans de repli devenus sans objet. Un design system haut de gamme **affirme** ses ratios, il ne dit pas « à mesurer ».

**MAJEUR — Le contraste `--accent-action` n'est validé que contre le canvas, pas contre `--surface-nav` #22262b ni les fonds de tags.**
Le bouton primaire et les liens actifs vivent aussi sur la nav asphalte (`#22262b`) et dans les pastilles de domaine. `--accent-action` #a05226 (L≈0.143) sur #22262b (L≈0.018) = (0.143+0.05)/(0.018+0.05) = **2,84:1** — **échec AA texte et même AA UI 3:1**. Un lien ou onglet actif latérite sur la nav sombre est illisible. Le doc ne traite pas ce cas. Correctif : sur `--surface-nav`, l'état actif doit utiliser une latérite éclaircie (la valeur dark `#c97a3f`, L≈0.26 → ratio ≈4,4:1, ou plus clair) ou un traitement non-couleur (soulignement/fond). À spécifier explicitement comme token `--accent-action-on-nav`.

**MAJEUR — Affirmation « originale » non démontrée : la direction décrite EST le template SaaS 2024-2026 dominant.**
Geist Sans + Geist Mono (Vercel), élévation zéro-offset « comme Vercel, Linear, Stripe » (cité textuellement), Cmd+K via `cmdk`, skeleton rows, densité compacte power-user, focus ring 2px offset 2px : c'est, point par point, le **kit Linear/Vercel**. Le doc le revendique comme preuve de qualité — mais c'est précisément ce qui crée le risque « ça fait template/IA » que la mission demande de débusquer. Le seul élément réellement propriétaire est la **barre de strates** et la palette terre (latérite/pétrole/asphalte). Tout le reste est interchangeable avec n'importe quel SaaS B2B.
Correctif : assumer que l'originalité repose **entièrement** sur (a) le logotype strates et (b) le système chromatique terre. Donc les **muscler**, ne pas les diluer. Et retirer du discours l'auto-félicitation « comme Vercel/Linear/Stripe » : se réclamer des références, c'est avouer qu'on les copie. Un livrable client ne doit pas citer ses modèles.

**MAJEUR — Fragilité réelle du logotype à petite taille, traitée par déni.**
Le doc admet qu'à 16 px les 3 strates « fusionnent en un trait unique latérite » et qualifie cela d'« acceptable ». Mais 3 px / 2 px / 1 px = 6 px de strates + espacements : à 16 px de favicon, ce motif est **bouillie**, pas « trait latérite propre ». Et sur impression PV en noir et blanc (cf. angle mort suivant), les trois strates terre/pétrole/asphalte deviennent trois gris difficiles à distinguer → le motif « coupe de chaussée » s'effondre.
Correctif : concevoir explicitement **deux variantes** du logotype — une complète (≥32 px) et une **monogramme/glyphe simplifié** pour favicon, app icon et filigrane PV (ex. une seule strate latérite, ou les initiales). Ne pas prétendre que le motif fin « tient » à 16 px : il ne tient pas. C'est une dette assumée à résoudre, pas un détail « acceptable ».

**MINEUR mais à trancher — Collision teinte accent vs verdict-fail sous désaturation, l'inverse de ce qui est affirmé.**
Le §4.3 vante l'écart de clarté : latérite-action L≈0.143 (le doc dit L≈41 % — incohérent : 0.143 de luminance relative ≈ L\* 45 en Lab, mais le hex #a05226 désaturé donne un gris moyen) vs fail #8b1a1a L≈0.063. L'écart existe, mais le doc mélange « L≈41 % » (clarté Lab) et les luminances relatives, et l'`--accent-brand` #b86a2e (plus clair, L≈0.19) côtoie le fail bordeaux dans le **bandeau de scellement PV** (§ conflit 4 : latérite pour l'entête PV) tout près d'un éventuel verdict NON CONFORME. Orange-terre + bordeaux adjacents sous protanopie = deux bruns proches. Correctif : interdire explicitement latérite et fail-bordeaux **adjacents** dans le PV ; séparer par une zone neutre (asphalte/blanc). À ajouter aux règles cardinales.

**MINEUR — Angle mort impression PV monochrome.**
Le PV scellé est un document qui sera **imprimé**, souvent en noir et blanc (BE, archivage papier). Toute la stratégie verdict repose sur couleur + icône + texte : la couleur tombe, restent icône + texte — OK, le triple canal sauve la mise. Mais les **tags de domaine** (road/found/lab) ne reposent QUE sur des fonds pastel basse saturation quasi identiques en gris (#f0ede9 / #e8edf0 / #ededec → trois gris à ~92 % de clarté, **indistinguables** en N&B). Correctif : sur les domaines aussi, redondance non-chromatique (préfixe texte « R / F / L » ou icône) — sinon un PV imprimé perd l'info de domaine.

**MINEUR — Dark mode : verdicts « îles claires » + `accent-fg` douteux.**
Garder les bandeaux verdict en fond clair dans l'UI sombre est défendable, mais crée un **flash de luminance** (îlot blanc dans le noir) potentiellement agressif et photophobe — à valider, pas à décréter « choix délibéré ». Par ailleurs `--accent-fg: #111210` (texte sombre sur bouton `--accent-action` #c97a3f en dark) : ratio #111210 vs #c97a3f = L 0.005 vs 0.26 → (0.31)/(0.055) = **5,6:1**. OK. Mais en clair, `--accent-fg: #ffffff` sur `--accent-action` #a05226 = **5,11:1** seulement si police ≥ gras/14px — le doc l'exige (« gras ≥14px »), donc OK, mais le label normal (non gras) sur ce bouton serait limite. Cohérent, à condition de **forcer le poids 500 minimum** dans le composant bouton (lint).

**MINEUR — Heuristique « mode compact à la 6e session » : sur-ingénierie risquée.**
Changer la densité par défaut sous le pied de l'utilisateur sans action de sa part est un **anti-pattern** (l'UI « bouge » toute seule, l'utilisateur croit à un bug). Correctif : proposer le passage en compact via un toast non intrusif (« Passer en vue compacte ? ») plutôt que l'imposer. Détail, mais c'est le genre de « cleverness » qui se retourne.

**MINEUR — Geist : licence et self-hosting à vérifier.**
Geist est sous licence OFL (OK pour self-host), mais le doc liste aussi « Inter » dans le consensus §1 puis bascule sur « Geist » en §2 sans réconcilier — **incohérence interne** : le consensus dit « Inter + Inter Mono », la direction finale dit « Geist Sans + Geist Mono ». Lequel ? Correctif : trancher et corriger le §1 ou le §2 ; aujourd'hui le livrable se contredit.

## Verdict

**À corriger — pas prêt en l'état, mais proche.** La direction est **professionnelle et cohérente** ; elle n'est **pas encore haut de gamme « originale »** : son ADN distinctif (strates + palette terre) est mince et entouré d'un kit SaaS générique (Geist/Linear/zéro-offset/Cmd+K) qu'elle revendique au lieu de le dépasser. Elle devient haut de gamme **à trois conditions** :

Priorité 1 (bloquant) :
1. Corriger `--accent-action` sur fond nav sombre et sur les tags (échec 2,84:1 non traité) — token dédié.
2. Réconcilier la contradiction **Inter vs Geist** (§1 ≠ §2).
3. Figer les ratios réels (5,11 / 8,12 / 5,13) et supprimer le théâtre « à mesurer au pixel ».

Priorité 2 (qualité/originalité) :
4. Deux variantes de logotype (complète + glyphe favicon/PV) — cesser de prétendre que le motif fin tient à 16 px.
5. Redondance non-chromatique sur les tags de domaine (impression N&B PV).
6. Retirer du livrable client les citations « comme Vercel/Linear/Stripe » et muscler le seul actif vraiment propriétaire.

Priorité 3 (raffinement) :
7. Interdire latérite/fail adjacents dans le PV ; valider le flash « île claire » dark ; remplacer l'auto-bascule densité par un opt-in.

Rappel de gouvernance : cette revue **ne vaut pas validation**. L'identité destinée au PV scellé (document à portée quasi-contractuelle) et l'ADR associé doivent être validés par l'humain ; tout impact sur le rendu du PV touche une zone sensible (intégrité/lisibilité du livrable engageant).

Sources :
- [WebAIM: Contrast Checker](https://webaim.org/resources/contrastchecker/)
- [Coolors Contrast Checker](https://coolors.co/contrast-checker)