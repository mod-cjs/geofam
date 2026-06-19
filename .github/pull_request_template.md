<!--
PR ROADSEN. Titre au format commit conventionnel :
  feat(api): recalcul serveur Burmister
Lier l issue :  Closes #123
-->

## Objet
<!-- Que fait cette PR, en 2-3 lignes. -->

Closes #

## Type
- [ ] feat  [ ] fix  [ ] refactor  [ ] perf  [ ] test  [ ] docs  [ ] ci  [ ] chore

## Comment tester
<!-- Etapes pour valider manuellement / scenarios e2e couverts. -->

---

## Checklist Definition of Done
- [ ] **Code merge-able** : style du depot respecte, pas de TODO bloquant
- [ ] **Tests verts en CI** : unit + integration + e2e pertinents (gating actif)
- [ ] **Couverture** maintenue/augmentee sur engines & code metier
- [ ] **Isolation multi-tenant** prouvee si la PR touche aux donnees (test inclus)
- [ ] **Calculs conformes** : cas-tests STARFIRE dans la tolerance ; equivalence module<->origine et client<->serveur verifiee (si calcul)
- [ ] **Livrables scelles** : PV/notes recalcules serveur, scelles, numerotes, regenerables (si concerne)
- [ ] **Confidentialite moteurs** : aucun import de `@roadsen/engines` cote `apps/web` (lint vert le garantit)
- [ ] **Secrets** : aucun secret commite ; `.env.example` mis a jour si nouvelle variable
- [ ] **Docs** : ADR ajoute si decision structurante ; OpenAPI a jour si l API change
- [ ] **Revue qa-challenger** demandee/passee avant tout passage client
- [ ] **Deployable preprod** : rollback possible

## Notes / impacts
<!-- Migrations de schema ? Variables d env a ajouter cote Render ? Risques ? -->
