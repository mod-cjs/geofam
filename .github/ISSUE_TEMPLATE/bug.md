---
name: Bug
about: Signaler un defaut / comportement incorrect
title: "[BUG] "
labels: ["type:bug"]
assignees: []
---

## Resume
<!-- Une phrase : quel est le probleme ? -->

## Environnement
- Branche / version :
- Environnement : [ ] local  [ ] preprod  [ ] prod
- Tenant concerne (si pertinent) :

## Reproduction (Given / When / Then)
- **Given** <!-- etat initial -->
- **When** <!-- action -->
- **Then (attendu)** <!-- comportement correct -->
- **Mais (observe)** <!-- comportement reel -->

## Severite
- [ ] Bloquant (prod indisponible / fuite de donnees / calcul faux)
- [ ] Majeur (fonction cle KO, contournement lourd)
- [ ] Mineur (cosmetique / contournement simple)

> Un calcul faux ou une fuite inter-tenant est traite **bloquant** par defaut.

## Logs / captures
<!-- Coller traces, requete, ID de correlation Sentry, etc. -->

## Criteres de cloture
- [ ] Cause racine identifiee
- [ ] Test de non-regression ajoute (rouge avant correctif, vert apres)
- [ ] Correctif merge + CI verte
- [ ] Verifie en preprod
