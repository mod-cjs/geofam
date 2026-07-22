# Fiche d'accès — Démo ROADSEN / STARFIRE

---

## URLs

| Service         | URL                          | Remarque                             |
| --------------- | ---------------------------- | ------------------------------------ |
| Application web | https://roadsen.vercel.app   | Vercel — accès public                |
| API REST        | https://roadsen.onrender.com | Render (Frankfurt) — back-end NestJS |

---

## Compte de démonstration

| Champ               | Valeur                                   |
| ------------------- | ---------------------------------------- |
| Identifiant (email) | `demo@starfire.test`                     |
| Mot de passe        | `RoadsenDemo2026!`                       |
| Organisation        | Demo Starfire                            |
| Rôle                | OWNER                                    |
| Pack actif          | Pack Routes (moteur Chaussées Burmister) |

> Ce compte est pré-provisionné pour la démo. Ne pas modifier l'organisation,
> le mot de passe ni les données pendant la séance — la démo repose sur un état
> connu et stable.

---

## Données présentes dans l'espace démo

- **1 projet** : « Projet Demo - Chaussee RN1 »
- **1 calcul chaussée** : moteur Burmister/AGEROUTE, verdict NON CONFORME (échec en
  fatigue), résultats complets (trafic cumulé NE, épaisseurs, déformations sollicitantes
  vs admissibles).
- **PV scellé à montrer** : `PV-RDS-demo-starfire-2026-000002` (verdict NON CONFORME,
  cohérent) — PDF téléchargeable, sceau HMAC + horodatage, vérification d'intégrité serveur.
  (Un reliquat `…-000001` à verdict périmé reste à purger de la base — cf. limites §3 ;
  ne pas l'ouvrir en démo.)

> **Attention — incohérence de verdict connue sur le PV de démo** : le PV a été scellé
> avant la validation complète du moteur ; son libellé de verdict interne peut afficher
> « non applicable » alors que le détail du calcul affiche « non conforme ». Ce point
> est tracé (cf. `limites-et-perimetre.md`). Ne pas ouvrir le PDF du PV en démo tant
> que ce document n'a pas été régénéré, ou expliquer la situation avant de l'ouvrir.

---

## Prérequis navigateur

- Navigateur moderne recommandé : Chrome 120+ ou Firefox 120+ à jour.
- Désactiver les extensions de blocage (uBlock, Privacy Badger) pour le domaine
  `roadsen.vercel.app` pendant la démo — elles peuvent interférer avec les requêtes API.
- Résolution minimale : 1280 × 800 (démo conçue pour un affichage bureau).
- Connexion Internet requise : pas de mode hors-ligne en Phase 1 (calcul côté serveur).
- Le certificat TLS est valide sur les deux domaines (Vercel + Render) — aucune
  exception à accepter.

---

## Secrets — règle absolue

Ne jamais partager ni exposer dans une présentation ou un enregistrement :

- Les variables d'environnement (`.env`, secrets Render/Vercel).
- La clé HMAC de scellement des PV.
- Les identifiants d'autres organisations ou utilisateurs.

Le compte `demo@starfire.test` est dédié à la démo et ne contient aucune donnée de
production. Il n'y a pas de donnée réelle d'un bureau d'études tiers dans cet espace.
