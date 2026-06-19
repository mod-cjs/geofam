# ADR 0001 — Consigner les decisions d architecture (ADR)

- Statut : accepte
- Date : 2026-06-18

## Contexte
ROADSEN est porte en solo, sur un cycle long, avec un client qui doit pouvoir
auditer les choix. Les decisions structurantes (stack, isolation, scellement,
confidentialite des moteurs) doivent etre tracables et opposables.

## Decision
Toute decision structurante fait l objet d un ADR court dans `docs/adr/`,
numerote, immuable une fois accepte (on cree un nouvel ADR pour revenir dessus).
Format : Contexte / Decision / Consequences / Statut.

## Consequences
- Tracabilite des choix pour le client et pour le futur mainteneur.
- Faible cout d ecriture, fort gain de memoire projet.
- Les ADR figes ne se modifient pas : on les remplace (statut "remplace par ADR n").

## Modele a copier
```
# ADR XXXX — Titre
- Statut : propose | accepte | remplace par ADR YYYY
- Date : AAAA-MM-JJ
## Contexte
## Decision
## Consequences
```
