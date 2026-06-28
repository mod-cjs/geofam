# Parcours utilisateur ROADSEN — inventaire & matrice d'état

> Référence des parcours (user journeys) + état réel de chacun. Sert de base à la matrice
> de tests e2e. Sources : INVENTAIRE-ecrans-etats.md (§D), ADR 0009-0012, décisions F-01→F-08.

**Phase** : P1 = Phase 1 livrable · FF = fast-follow · P2 = Phase 2.
**Front** : ✓ construit (mocké) · ~ partiel · ✗ absent.
**Back** : ✓ construit (passe 1, testé unitaire) · ~ partiel · ✗ absent.
**Câblé** : front ↔ backend réel effectif (✗ partout aujourd'hui = encore sur la couche mock ; swap à venir).

## Acteurs
- **Super-admin plateforme** (titulaire) — provisionne org + comptes + abonnements ; contrôle les droits.
- **Ingénieur de BE** (utilisateur tenant) — utilisateur principal.
- *(Revendeur STARFIRE = hors P1 ; admin d'org = FF.)*

---

## A. Provisionnement & administration — super-admin
| # | Parcours | Phase | Front | Back | Notes |
|---|---|---|---|---|---|
| A1 | Créer une **organisation** (tenant) | P1 backoffice → FF console | ✗ | ✓ | `provision_org` (#41/#42), owner forcé |
| A2 | Créer un **compte** (+ mot de passe temporaire) | P1 backoffice | ✗ | ✓ | `provision_user`, /admin |
| A3 | Configurer un **abonnement** (pack, validité, quota) | P1 backoffice | ✗ | ✓ | `provision_subscription` (ADR 0011), `POST /admin/orgs` |
| A4 | **Renouveler / étendre** un abonnement | FF | ✗ | ~ | à exposer |
| A5 | **Révoquer / suspendre** un abonnement | FF | ✗ | ✗ | |
| A6 | **Désactiver** un compte | FF | ✗ | ~ | `is_active` lu au refresh (M3) ; pas d'endpoint d'admin dédié |
| A7 | **Console d'admin** in-app | FF | ✗ | ✗ | |

## B. Authentification & session — ingénieur
| # | Parcours | Phase | Front | Back | Notes |
|---|---|---|---|---|---|
| B1 | **Connexion** | P1 | ✓ | ✓ | JWT claim `orgs` (ADR 0010) |
| B2 | **Premier login** → MDP temporaire | P1 | ~ | ~ | flux à finaliser (flag serveur) |
| B3 | **Refresh** transparent (TTL 5 min) | P1 | ✗ | ✓ | revalide `is_active` (M3) |
| B4 | **Session expirée** → re-login `returnTo` | P1 | ✓ | ✓ | |
| B5 | **Déconnexion** | P1 | ✓ | ~ | purge + invalidation à câbler |
| B6 | **Changer son mot de passe** | P1 | ✓ | ~ | |
| B7 | **Changer d'organisation** (switcher) | P1 | ✓ | ✓ | claims `orgs` ; isolation à prouver |

## C. Cœur métier — projets & calculs — ingénieur
| # | Parcours | Phase | Front | Back | Notes |
|---|---|---|---|---|---|
| C1 | **Lister ses projets** | P1 | ✓ | ✓ | scope `X-Org-Id` |
| C2 | **Créer un projet** (self-service) | P1 | ✓ | ✓ | owner = sub JWT (#42), F-03 |
| C3 | **Ouvrir un projet** (onglets) | P1 | ✓ | ✓ | défaut = Calculs (F-02) |
| C4 | **Renommer / éditer** (Informations) | P1 | ✓ | ~ | |
| C5 | **Vue d'ensemble** projet | P1 | ✓ | ~ | |
| C6 | **Lancer un calcul** (moteur → form → résultat) | P1 | ✓ | ✓ | moteurs réels = `integrateur-moteurs` |
| C7 | **Lire le verdict** CONFORME / NON CONFORME | P1 | ✓ | ✓ | verdict scellé (ADR 0012) |
| C8 | **Naviguer entre calculs** (master-detail) | P1 | ✓ | ✓ | |
| C9 | **Recalculer / dupliquer** | P1 | ✓ | ~ | |
| C10 | **Calcul en erreur** (params/convergence/réseau) | P1 | ✓ | ~ | états distingués |
| C11 | **Calcul long** (>3 s) feedback honnête | P1 | ✓ | n/a | |

## D. PV & livrables — ingénieur
| # | Parcours | Phase | Front | Back | Notes |
|---|---|---|---|---|---|
| D1 | **Émettre un PV scellé** (calcul « Calculé ») | P1 | ✓ | ✓ | scellement HMAC, idempotent |
| D2 | **Émettre un PV sur NON CONFORME** (durci) | P1 | ~ | ✓ | ADR 0012 ; marquage PDF + double confirmation à finir |
| D3 | **Lister les PV** d'un projet | P1 | ✓ | ✓ | |
| D4 | **Télécharger le PDF** scellé | P1 | ✓ | ✓ | |
| D5 | **Consulter un PV** (lecture seule) | P1 | ✓ | ✓ | |
| D6 | **Vérifier l'intégrité** (en ligne) | P2 | ✗ | ✗ | pierre angulaire Phase 2 |

## E. Abonnement & droits (gating) — transverse
| # | Parcours | Phase | Front | Back | Notes |
|---|---|---|---|---|---|
| E1 | **Consulter droits / quota** (`/me/entitlements`) | P1 | ~ | ✓ | affichage gating front = P2 partiel |
| E2 | **Moteur verrouillé** (hors pack) | P1 | ✓ | ✓ | 403 MODULE_NOT_IN_PACK |
| E3 | **Abonnement expiré** → lecture seule | P1 | ✓ | ✓ | 402 EXPIRED |
| E4 | **Quota épuisé** → blocage | P1 | ✓ | ✓ | 402 QUOTA, décompte atomique |
| E5 | **Demander une extension** (support) | FF | ✗ | ✗ | |

## F. Catalogue & ressources — ingénieur
| # | Parcours | Phase | Front | Back | Notes |
|---|---|---|---|---|---|
| F1 | **Bibliothèque de moteurs** (6 / 3 domaines) | P1 | ✓ | ~ | lecture seule, gated |
| F2 | **Fiche moteur** (détail) | FF | ✗ | ✗ | |

## G. Paramètres & aide
| # | Parcours | Phase | Front | Back | Notes |
|---|---|---|---|---|---|
| G1 | **Paramètres d'organisation** (nom, logo) — admin | P1 | ✓ | ~ | RBAC Admin/Membre (F-10) |
| G2 | **Mon compte** (profil) | P1 | ✓ | ~ | |
| G3 | **Aide** (raccourcis, support, version) | P1 | ✓ | n/a | |

## H. Transverses & système
| # | Parcours | Phase | Front | Back | Notes |
|---|---|---|---|---|---|
| H1 | **Cmd+K** (recherche / commandes) | P1 | ✓ | ✗ | ossature ; items réels à câbler |
| H2 | **Isolation** : ressource d'une autre org → 404 silencieux | P1 | ✓ | ✓ | **à prouver** (qa-test T-ISO) |
| H3 | **Accès refusé** (403 rôle / 404 tenant-safe) | P1 | ✓ | ✓ | |
| H4 | **Navigation** (collapse, drawer, ariane, back/forward) | P1 | ✓ | n/a | |
| H5 | **PWA hors-ligne / nouvelle version** | P1/FF | ~ | n/a | |
| H6 | **Erreur applicative** (error boundary) | P1 | ✓ | n/a | |

---

## Parcours phares (à prouver de bout en bout, e2e réel)
1. **Calcul → PV** (C6→C7→D1→D4) — le cœur produit.
2. **Changement d'org / isolation** (B7→H2) — zone critique, test négatif obligatoire.
3. **Provisionnement** (A1→A2→A3) — super-admin ouvre la porte.
4. **Gating abonnement** (E2/E3/E4) — blocage **serveur** (402/403), pas UI seule.

## Reste structurant
- **Swap mock → réel** : aucun parcours n'est « câblé » (front sur couche mock). Un seul fichier `client.ts` à basculer.
- **Portes adverses `qa-test`** (Postgres réel) : T-ISO-SUB, T-RACE, T-PROV, T-IMMUT, T-QUOTA-REASON, T-PV-IDEM, T3/T5 — transforment ✓-back « supposé » en « prouvé ».
- **Provisionnement P1 = backoffice** (pas d'UI) ; console = FF.
