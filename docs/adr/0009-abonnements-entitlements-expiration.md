# ADR 0009 — Abonnements, entitlements et expiration d'accès

- Statut : accepte
- Date : 2026-06-27

## Contexte
L'acces a la plateforme depend du **type d'abonnement** du client (packs : Routes /
Fondations / Plateforme complete — cf. devis). Un **admin plateforme** controle
l'abonnement de chaque organisation. L'acces **expire** selon DEUX dimensions : une
**duree** (fenetre de validite) ET un **quota d'usage** (consommation de calculs/PV).
Cette decision concretise F-05 de l'inventaire et capitalise la logique de licences de
GeoSuite (ADR 0003 — entitlements par module/pack, sans l'emballage desktop node-locked).

## Decision
- **Modele de donnees** : chaque Organisation porte un **Abonnement** = { pack, entitlements
  (modules/features debloques), dateDebut, dateFin, quota (ex. N calculs / N PV),
  consommation courante }. Ledger d'usage append-only pour la consommation.
- **Admin** = **super-admin plateforme** (le titulaire), UN seul niveau en P1. Le modele
  revendeur (STARFIRE gere ses BE) est HORS P1 (RBAC intermediaire = backlog).
- **Surface d'admin P1** = **provisionnement backoffice/manuel** (DB / back-office minimal).
  C'est **nous (super-admin plateforme) qui creons les comptes clients** : l'**organisation**
  (tenant), le ou les **comptes utilisateurs**, et l'**abonnement** (pack, validite, quota).
  **Aucune inscription publique** (comptes pre-provisionnes). La **console d'admin in-app**
  (creer/editer/renouveler/revoquer organisations, comptes, abonnements, packs, dates, quotas)
  est un **fast-follow** defini, pas P1.
  > Distinction : le provisionnement (org + comptes + abonnement) est **admin-only** ; en
  > revanche le client, une fois connecte, cree/gere ses **projets** en self-service (F-03)
  > et travaille dans la limite de son abonnement. Ouvrir la porte = nous ; travailler dedans = lui.
- **Expiration = duree ET quota, au PREMIER atteint** : l'acces se ferme quand `now > dateFin`
  OU quand `consommation >= quota`.
- **ENFORCEMENT COTE SERVEUR — non negociable (securite).** Un **guard d'abonnement**
  s'ajoute a la chaine apres `TenantGuard` : il bloque tout calcul/PV (et tout module non
  inclus) si module hors pack **OU** abonnement expire **OU** quota epuise → reponse 402/403
  explicite. Le **decompte de consommation est serveur**, **atomique** (eviter les courses),
  a l'usage effectif. La **source de temps est le serveur**, jamais le client.
- **UI = defense en profondeur, jamais la barriere** : moteurs verrouilles/grises selon le
  pack (bibliotheque, selecteur de moteur), bandeau « abonnement expire » (lecture seule),
  affichage/avertissement de quota (« N calculs restants »). Aucune protection ne repose sur
  l'UI seule.

## Consequences
- **Backend (dev-backend + ingenieur-securite — zone critique)** : modele + migration
  (abonnement / entitlements / ledger d'usage), guard d'abonnement, decompte atomique. Tests
  negatifs obligatoires : module hors pack / expire (date) / quota epuise → bloque ; isolation
  (un tenant ne consomme jamais le quota d'un autre).
- **UI (Lot 2/3)** : etats moteur verrouille, abonnement expire (lecture seule), quota
  restant/epuise. Le selecteur de moteur (C-01) et la bibliotheque (B-28) lisent les
  entitlements.
- **Console d'admin** = fast-follow (backlog defini) ; en P1 le provisionnement est manuel.
- Lien : ADR 0003 (capitalisation licences GeoSuite), inventaire F-05, chaine de garde
  existante (RecetteAccessGuard → Throttler → JwtAuthGuard → TenantGuard → **SubscriptionGuard** → RolesGuard).
