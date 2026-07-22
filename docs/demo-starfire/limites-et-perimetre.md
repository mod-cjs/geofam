# Limites et périmètre — ROADSEN Phase 1 / Phase 2

_Document à usage interne et client. Ton d'ingénieur : prouvé = prouvé, à venir = à venir._

---

## Tableau Phase 1 / Phase 2

| Fonctionnalité                                                         | Phase 1                                                                                               | Phase 2                                                                                         |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Authentification JWT + session                                         | Livré et en ligne                                                                                     | —                                                                                               |
| Multi-tenant (organisations isolées)                                   | Livré — séparation fonctionnelle (RLS actif)                                                          | Isolation durcie : tests d'isolation exhaustifs, audit formel, threat model complet             |
| RBAC (rôles par organisation)                                          | Livré (OWNER + membres)                                                                               | RBAC intermédiaire : rôle revendeur (STARFIRE gère ses BE), droits fins                         |
| Moteur chaussées (Burmister/AGEROUTE 2015/LCPC)                        | Livré — calcul serveur opérationnel, résultats affichés                                               | —                                                                                               |
| Moteur radier/plaque (interaction sol-structure)                       | Intégré côté serveur — affichage résultats non activé                                                 | Affichage client-safe activé                                                                    |
| Moteur fondation superficielle (EC7/Ménard)                            | Intégré côté serveur — affichage résultats non activé                                                 | Affichage client-safe activé                                                                    |
| Moteur pressiomètre Ménard (pl\*/EM)                                   | Intégré côté serveur — affichage résultats non activé                                                 | Affichage client-safe activé                                                                    |
| Moteur fondation profonde / pieux (EC7)                                | Intégré côté serveur — affichage résultats non activé                                                 | Affichage client-safe activé                                                                    |
| Moteur essais labo et GTR (granulo, Atterberg, Proctor, CBR, œdomètre) | Intégré côté serveur — affichage résultats non activé                                                 | Affichage client-safe activé                                                                    |
| PV scellé (PDF + HMAC + horodatage + vérification en ligne)            | Livré — scellement de base opérationnel                                                               | Scellement renforcé (signature qualifiée / TSA, opposabilité juridique)                         |
| Entitlements / contrôle d'accès par pack                               | Livré — enforcement serveur (guard 402/403)                                                           | —                                                                                               |
| Facturation                                                            | Manuelle (provisionnement par l'administrateur plateforme)                                            | Automatisée — PayDunya (mobile money), back-office STARFIRE, KYC PayDunya à la charge du client |
| Déploiement et mise en ligne                                           | Livré (Vercel + Render)                                                                               | CI/CD complet, observabilité, RPO/RTO documentés, sauvegardes automatiques                      |
| Intégration continue (CI GitHub)                                       | Suspendue — cause administrative (facturation du compte) ; gate local actif                           | CI rétablie et porte de merge automatisée                                                       |
| Conformité données personnelles (CDP / loi 2008-12)                    | Mesures techniques fournies (cloisonnement, journalisation) — démarches CDP = responsabilité STARFIRE | Dossier de conformité complet, registre des traitements, base de transfert hors Sénégal         |
| Mode terrain hors-ligne                                                | Hors périmètre (calcul serveur requis par conception)                                                 | Hors périmètre                                                                                  |
| Inscription publique (auto-provisionnement)                            | Hors périmètre en Phase 1 — comptes créés manuellement par l'administrateur                           | Console d'administration in-app (backlog défini post-P1)                                        |
| Validation scientifique des moteurs                                    | Hors périmètre prestataire — fournie et validée par STARFIRE (split contractuel)                      | Idem                                                                                            |

---

## Limites à mentionner honnêtement

### 1. Affichage des résultats des moteurs fondations et labo

Les 5 moteurs autres que Chaussées (radier, fondation superficielle, pressiomètre, pieux,
labo/GTR) **effectuent leurs calculs côté serveur** et produisent des résultats. En revanche,
leur **affichage côté client n'est pas encore activé**. L'application affiche « résultat non
affichable » — c'est une décision délibérée, pas un bug.

Raison : la politique est **fail-closed** sur la confidentialité. Un résultat affiché sans
revue des sorties exposées risquerait de laisser filtrer des informations sur la méthode de
calcul (ex. nœuds de maillage pour le radier, indicateurs intermédiaires pour les pieux).
On préfère ne rien afficher plutôt que de prendre ce risque sans validation préalable.
L'activation se fait moteur par moteur, après que STARFIRE et le prestataire ont vérifié
ensemble que les sorties exposées ne compromettent pas la confidentialité.

**Ce qui est prouvé :** le calcul s'effectue et produit un résultat interne.  
**Ce qui est à venir :** la couche de présentation validée pour chaque moteur.

---

### 2. PV scellé — nature juridique exacte

Le sceau HMAC garantit **l'intégrité du document** : toute modification après scellement
invalide le sceau, détectable par vérification en ligne. C'est une garantie technique réelle.

Ce n'est **pas** une signature électronique qualifiée au sens de la loi sénégalaise
n° 2008-08 relative aux transactions électroniques. Les termes « certifié », « fait foi »
ou « opposable » **ne doivent pas être employés** pour désigner ce PV.

Vocabulaire juste : « scellé », « intégrité vérifiable en ligne », « document technique
traçable et horodaté ».

L'opposabilité renforcée (certificat qualifié / horodatage TSA) est prévue en Phase 2.

---

### 3. PV de démo — régénéré (résolu), reliquat à purger

Le premier PV `PV-RDS-demo-starfire-2026-000001` avait été scellé par une version
antérieure du pipeline (avant que le verdict ne soit inclus dans le sceau) : son
verdict interne indiquait « non applicable » alors que le calcul affiche
« NON CONFORME ». **Ce n'était pas un défaut du mécanisme de scellement**, qui dérive
et scelle correctement le verdict réel.

Un PV cohérent a été ré-émis : **`PV-RDS-demo-starfire-2026-000002`**, verdict
**NON CONFORME**, sceau valide, PDF téléchargeable — c'est celui à montrer en démo.

Reliquat : l'ancien `…-000001` (verdict périmé) subsiste dans la base de recette
(table immuable → suppression hors application, accès base requis). À purger avant la
démo pour ne laisser qu'un seul PV dans la liste. Tant qu'il n'est pas purgé : montrer
`…-000002` et ne pas ouvrir le PDF de `…-000001`.

---

### 4. Intégration continue (CI GitHub) suspendue

Les Actions GitHub du dépôt (`05-Plateforme/`) sont en échec systématique depuis
plusieurs semaines. La cause est un problème de facturation du compte GitHub (quota
Actions sur dépôt privé dépassé), **pas un défaut du code ou des tests**. Un gate de
qualité local (`scripts/review-gate.sh`) tient lieu de garde-fou en attendant la
régularisation.

Ce point ne remet pas en cause la qualité du code livré, mais il signifie que la porte
automatique de merge en CI n'est pas active. À régulariser avant la Phase 2.

---

### 5. Hors périmètre contractuel — points à ne pas confondre

Les éléments suivants ne font pas partie du devis DEV-RDS-001 et ne seront pas montrés
en démo :

- Validation scientifique des moteurs (méthodes, cas-tests, valeurs attendues) — fournie
  et validée par STARFIRE, pas par le prestataire.
- Mode hors-ligne ou saisie terrain (calcul serveur requis par architecture).
- Déclaration CDP et conformité données personnelles (responsabilité STARFIRE en tant
  que responsable de traitement).
- Hébergement, domaine, frais PayDunya (coûts récurrents à la charge du client).
- KYC PayDunya (démarche client, Phase 2).
- PV officiels au sens LNR-BTP (accréditation laboratoire) — hors périmètre explicite
  du devis.

---

## Référence contractuelle

Devis n° DEV-RDS-001 (révision, 17 juin 2026) — STARFIRE TECHNOLOGY SAS / Mouhammadou Oury Diallo.  
Phase 1 : 900 000 F CFA HT — Phase 2 : 800 000 F CFA HT — Total : 1 700 000 F CFA HT.  
Acompte 50 % (850 000 F CFA) déjà versé, Phase 1 en cours de livraison.

Split contractuel : science et moteurs = STARFIRE ; plateforme et intégration = prestataire.
