# ADR 0002 — Moteurs de calcul cote serveur uniquement

- Statut : accepte
- Date : 2026-06-18

## Contexte
Les 6 moteurs de calcul (chaussees, fondations superficielles/profondes, etc.)
constituent la propriete intellectuelle confidentielle du produit. Toute
execution cote navigateur (meme obfusquee) exposerait la logique de calcul :
l obfuscation est insuffisante face a un acteur motive.

## Decision
- Les moteurs vivent dans `packages/engines`, importe **exclusivement** par `apps/api`.
- Le front (`apps/web`) n envoie que des **entrees** et recoit des **resultats**.
- Garde-fou (1re barriere) : regle ESLint `no-restricted-imports` interdisant a
  `apps/web` (et `packages/shared`) d importer `@roadsen/engines` ; echec CI sinon.
- **Preuve** (le lint ne prouve rien a lui seul) : un **controle de bundle** en CI
  verifie qu aucun symbole moteur (`@roadsen/engines`, sentinelle `ROADSEN_ENGINE`)
  n apparait dans `apps/web/.next/static`. C est cette etape qui atteste la confidentialite.
- Le recalcul de reference (source de verite des PV) est fait cote serveur.

## Consequences
- Pas de chemin rapide "tout client" : le calcul transite par l API.
- Surface de confidentialite reduite a l infrastructure serveur (a durcir avec
  `ingenieur-securite`).
- Les types/contrats d entree-sortie vivent dans `packages/shared` (Zod),
  partageables sans exposer la logique.
