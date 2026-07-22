# RESP-001 — Responsivité : master-détail (Calculs / PV) inutilisable sous ~1140px

**Type** : bug UI (responsive) · **Priorité** : moyenne · **Découvert** : tests de démo, 28-30/06/2026

## Symptôme

Sur un écran/zoom de largeur inférieure à ~1140px, la mise en page **master-détail** des onglets **Calculs** et **PV & Livrables** ne se réorganise pas : la **colonne de gauche** (liste + en-tête contenant le bouton **« + Nouveau calcul »**) s'affiche mal ou sort du cadre. Conséquence : le bouton d'ajout de calcul n'est plus visible → impression de page cassée (alors que les données et le rendu sont corrects).

## Cause probable

Layout master-détail à **colonnes fixes** (gauche ~280px + panneau droit) sans breakpoint ni stacking/`overflow` responsive.

- Fichiers : `apps/web/src/app/app/[orgSlug]/projets/[projetId]/calculs/CalculsClient.tsx` (et `…/pv/PvListClient.tsx` si même schéma).

## Comportement attendu

- Sous un breakpoint (ex. `< 1024px`) : **empiler** les colonnes (liste au-dessus du détail) ou rendre la liste **repliable** ; le bouton « + Nouveau calcul » doit rester **toujours visible/accessible**.
- Vérifier aussi le shell (sidebar) à ces largeurs.

## Repro

Ouvrir un projet → onglet **Calculs** dans une fenêtre de largeur < ~1140px.

## Notes

- Le contenu serveur est correct (vérifié : 5 calculs, bouton présent, plus de #418). C'est **purement de la mise en page responsive**.
- À traiter par `dev-frontend` / `designer-ux`.
