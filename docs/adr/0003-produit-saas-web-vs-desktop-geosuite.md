# ADR 0003 — Produit ROADSEN : SaaS web (et non desktop licencie GeoSuite)

- Statut : accepte
- Date : 2026-06-18

## Contexte
Le client a livre GeoSuite : un produit **desktop** (Electron) avec **serveur de
licences node-locked** (1 cle = 1 poste). En parallele, l exigence client est que
les **calculs restent confidentiels**. Or un modele desktop fait tourner le calcul
**sur le poste du client** -> les formules sont extractibles -> contradiction directe
avec la confidentialite (cf. ADR 0002). Le client a ete convaincu (echange telephonique)
de retenir le modele web.

## Decision
- **ROADSEN = plateforme SaaS web** ; calcul **cote serveur** (ADR 0002).
- Le modele **desktop + licences node-locked** de GeoSuite **n est PAS** le produit retenu.
- On **capitalise** de GeoSuite : les **6 moteurs** (executes cote serveur) et la
  **logique d entitlements** par module/pack (re-implementee dans l auth de la plateforme).
- On **ne reprend pas** : l emballage Electron, le serveur de licences node-locked,
  le generateur de licences desktop.
- « Licences par poste » -> remplacees par **comptes / sieges par client** (le node-lock
  materiel est incompatible avec le calcul serveur confidentiel).

## Consequences
- Les dossiers `GeoSuite/desktop` et `GeoSuite/serveur` (licences) restent une **reference**,
  pas un livrable a maintenir.
- Vente **par module/pack des la Phase 1** via cles d acces (entitlements) ;
  facturation **manuelle en P1**, **PayDunya en P2** (`payment-integration`).
- **Pas de mode terrain hors-ligne** (le calcul serveur est requis) — hors perimetre.
- L arbitrage produit, jadis ouvert, est **clos** : les agents `dev-*` et
  `integrateur-moteurs` construisent sur cette fondation, sans hypothese.
