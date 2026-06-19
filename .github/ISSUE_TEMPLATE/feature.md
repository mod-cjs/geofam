---
name: Fonctionnalite
about: Decrire une fonctionnalite / un increment a livrer
title: "[FEAT] "
labels: ["type:feature"]
assignees: []
---

## Contexte / Objectif
<!-- Pourquoi cette fonctionnalite ? Quel besoin client/produit ? -->

## Description
<!-- Ce qui doit etre fait, du point de vue utilisateur. -->

## Criteres d acceptation (BDD - Given / When / Then)
<!-- Decrire des scenarios verifiables. Exemple : -->
- [ ] **Given** un utilisateur du tenant A authentifie
      **When** il demande la liste des projets
      **Then** il ne voit que les projets du tenant A

## Definition of Ready (DoR) — avant de demarrer
- [ ] Objectif et valeur clairs
- [ ] Criteres d acceptation rediges et testables
- [ ] Dependances identifiees (moteurs, schema, autre issue)
- [ ] Impact confidentialite/securite evalue (moteurs cote serveur ? donnees tenant ?)
- [ ] Estimation grossiere posee (S / M / L)
- [ ] Maquette/contrat d API disponible si necessaire

## Definition of Done (DoD) — rappel (cf. CLAUDE.md)
- [ ] Code merge dans le style du depot
- [ ] Tests verts en CI (unit + integration + e2e pertinents)
- [ ] Isolation multi-tenant prouvee (le cas echeant)
- [ ] Cas-tests STARFIRE dans la tolerance / equivalence moteurs verifiee (si calcul)
- [ ] Livrables scelles regenerables (si PV/note)
- [ ] Revue qa-challenger passee
- [ ] Deployable en preprod (rollback possible)

## Notes / Liens
<!-- ADR, issues liees, references normatives. -->
