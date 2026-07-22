# Inventaire workflows back-office SUPERADMIN (audit multi-agents, code reel)

": "Inventaire exhaustif des workflows du back-office SUPERADMIN (existant/partiel/manquant) + priorisation",
"agentCount": 9,
"logs": [],
"result": {
"count": 124,
"byStatus": {
"existant": 28,
"manquant": 63,
"partiel": 33
},
"synthesis": "# SynthÃ¨se â Back-office SUPERADMIN GEOFAM/ROADSEN : cartographie des workflows

## 1. Vue d'ensemble

**DÃ©compte (124 workflows recensÃ©s, doublons inter-lecteurs fusionnÃ©s) :**

| Statut                                                       | Nombre | Part  |
| ------------------------------------------------------------ | ------ | ----- |
| â Existant (bout en bout)                                    | 28     | ~23 % |
| â ï¸ Partiel (socle prÃ©sent, cÃ¢blage/UI/portÃ©e manquants) | 31     | ~25 % |
| â Manquant                                                   | 65     | ~52 % |

**Verdict de maturitÃ© : socle sÃ»r, exploitation incomplÃ¨te.**

Ce qui est fait est bien fait. Le **noyau sÃ©curitÃ©/identitÃ©** (RBAC deny-by-default, identitÃ© = `sub` JWT jamais le body â leÃ§on #42, durcissement JWT anti alg-confusion, rÃ©vocation temps rÃ©el par relecture DB) et les **mutations money du Lot 2** (top-up/renew/entitlements : atomiques, idempotentes, tracÃ©es avant/aprÃ¨s, immuables append-only) constituent une fondation robuste et testÃ©e. C'est la partie la plus durcie du produit.

En revanche, le back-office n'est **pas encore une console d'exploitation** : il manque tout l'Ã©tage Â« supervision Â» (aucun tableau de bord, aucune vue globale cross-org de l'audit, des abonnements ou des PV), plusieurs workflows d'ops de premier ordre sont absents (reset mot de passe, dÃ©sactivation globale d'un compte, transfert d'OWNER, rattacher un abo Ã  une org qui en est dÃ©pourvue), et l'**auditabilitÃ© est asymÃ©trique** (les mutations Lot 2 sont tracÃ©es, mais tout l'onboarding Lot 1 â crÃ©ation user/org, ajout/suspension de membre â ne laisse aucune trace).

**Deux dettes bloquantes avant prod**, indÃ©pendantes du confort : le **cookie de session SUPERADMIN non-httpOnly** (un XSS = compromission cross-tenant totale) et l'**absence de rÃ©vocation de session** (pas de `/auth/logout` backend, refresh valide ~7 j). Plus le **jalon CDP** (registre des traitements + droits des personnes + traÃ§age des lectures cross-tenant) explicitement dÃ» avant mise en production.

---

## 2. Tableau par domaine

LÃ©gende : â existant Â· â ï¸ partiel Â· â manquant Â· P = prioritÃ© (H/M/B)

### Cycle de vie Organisation

| Workflow                                                                                   | St.  | P   |
| ------------------------------------------------------------------------------------------ | ---- | --- |
| CrÃ©ation org (wizard OWNERâOrgâAbo, atomique, reprise aprÃ¨s Ã©chec)                      | â    | H   |
| Consultation dÃ©tail org                                                                   | â    | H   |
| Suspension / rÃ©activation (RLS, effet au prochain appel)                                  | â    | H   |
| Recherche org (ILIKE name/slug, jokers Ã©chappÃ©s)                                         | â    | H   |
| Journal d'audit du cycle de vie                                                            | â    | M   |
| Archivage (backend OK, aucun chemin UI vers ARCHIVED)                                      | â ï¸ | M   |
| Filtre par statut (filtrÃ© **client-side** sur page courante â faux Â« aucun rÃ©sultat Â») | â ï¸ | M   |
| Pagination (backend paginÃ©, **aucun contrÃ´le UI** â >50 orgs inatteignables)             | â ï¸ | H   |
| Ãdition identitÃ© (nom/slug **figÃ©s** aprÃ¨s crÃ©ation)                                   | â    | H   |
| Transfert de propriÃ©tÃ© (OWNER ni attribuable ni retirable)                               | â    | M   |
| Tri configurable (ORDER BY name figÃ©)                                                     | â    | B   |
| Export inventaire CSV                                                                      | â    | M   |
| Suppression/purge CDP                                                                      | â    | M   |
| Ãdition domaine (concept absent du modÃ¨le)                                                | â    | B   |

### Abonnements & money

| Workflow                                                                                                                                                | St.  | P   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --- |
| CrÃ©er abo Ã  la crÃ©ation d'org                                                                                                                        | â    | H   |
| Top-up / ajustement quota (atomique, idempotent, motif obligatoire)                                                                                     | â    | H   |
| Renouvellement (reset conso + fenÃªtre)                                                                                                                 | â    | H   |
| Changement pack/entitlements (**modal rÃ©initialise depuis une approximation packâmodules en dur â risque d'Ã©crasement** ; pas de rÃ©ajustement quota) | â ï¸ | H   |
| Gestion expiration (lecture/enforcement OK ; **pas d'alerte Â« expire bientÃ´t Â», pas de cron**)                                                       | â ï¸ | M   |
| Vue transverse abonnements (org-centrÃ©e, pas de console money dÃ©diÃ©e)                                                                                | â ï¸ | M   |
| TraÃ§abilitÃ© facturation (motif texte libre = seule trace comptable)                                                                                   | â ï¸ | H   |
| Journal audit global money (fonction supporte `p_org_id NULL`, **endpoint absent**)                                                                     | â ï¸ | M   |
| Rattacher un abo Ã  une org **existante** sans abo (org bloquÃ©e Ã  vie en 403)                                                                         | â    | H   |
| Baisse / rÃ©siliation d'abo                                                                                                                             | â    | M   |
| RBAC money SUPPORT/SUPERADMIN                                                                                                                           | â    | M   |
| Grille tarifaire packâquotaâprix (source serveur)                                                                                                       | â    | B   |
| Export comptable / rapprochement (P2 PayDunya)                                                                                                          | â    | B   |

### Membres & accÃ¨s

| Workflow                                                                                 | St.  | P   |
| ---------------------------------------------------------------------------------------- | ---- | --- |
| Lister membres (identitÃ© DEFINER + usage withTenant)                                    | â    | H   |
| Rechercher user pour l'attacher                                                          | â    | H   |
| Suspendre / rÃ©activer membre                                                            | â    | H   |
| Changer rÃ´le (double barriÃ¨re anti-escalade OWNER + anti-lockout, tracÃ©)              | â    | H   |
| Retrait soft (auditÃ©, idempotent)                                                       | â    | H   |
| Ajouter un membre existant (**endpoint OK, aucune UI** â workflow cÅur cassÃ© cÃ´tÃ© UX) | â ï¸ | H   |
| TraÃ§abilitÃ© ajout/suspension membre (Lot 1 **non tracÃ©** ; rÃ´le/retrait tracÃ©s)     | â ï¸ | H   |
| Transfert / dÃ©signation d'OWNER (aucune voie â org non rÃ©attribuable)                  | â    | H   |
| CrÃ©er compte + attacher inline (org existante)                                          | â    | M   |
| Vue appartenances cross-org d'un user (offboarding)                                      | â    | M   |
| Scopes fin par module/membre                                                             | â    | M   |
| Invitation par lien / self-service (non-rÃ©pudiation PV)                                 | â    | M   |
| RBAC SUPPORT lecture                                                                     | â    | M   |
| Retrait hard (effacement CDP)                                                            | â    | B   |
| Actions groupÃ©es                                                                        | â    | B   |
| Notification e-mail au membre                                                            | â    | B   |

### Utilisateurs & identitÃ©

| Workflow                                                                                             | St.  | P   |
| ---------------------------------------------------------------------------------------------------- | ---- | --- |
| Rechercher users (id/email/nom, jamais le hash)                                                      | â    | H   |
| Voir orgs d'un user (seulement le **compteur** `nb_orgs`, pas la liste ni les rÃ´les)                | â ï¸ | H   |
| CrÃ©er un user (backend OK ; **UI seulement inline dans le wizard d'org**)                           | â ï¸ | H   |
| Promouvoir/rÃ©trograder SUPERADMIN (CLI only ; **aucune rÃ©trogradation**)                           | â ï¸ | M   |
| Journal audit centrÃ© user (indexÃ© par org, actions identitÃ© non tracÃ©es)                         | â ï¸ | M   |
| **RÃ©initialiser le mot de passe** (aucun endpoint, aucun flux Â« oubliÃ© Â»)                        | â    | H   |
| **DÃ©sactiver/rÃ©activer le compte global** (`is_active` appliquÃ© au login mais aucun toggle admin) | â    | H   |
| DÃ©tail user (page dÃ©diÃ©e / fiche)                                                                 | â    | M   |
| Modifier profil (email/nom)                                                                          | â    | M   |
| Attribuer/retirer SUPPORT (rÃ´le cÃ¢blÃ© mais **inassignable = mort**)                               | â    | M   |
| Supprimer/anonymiser user (CDP)                                                                      | â    | B   |
| Voir/forcer dÃ©connexion des sessions                                                                | â    | B   |

### Audit, journal & conformitÃ©

| Workflow                                                                                 | St.  | P   |
| ---------------------------------------------------------------------------------------- | ---- | --- |
| Consulter journal audit d'une org                                                        | â    | H   |
| TraÃ§age auto des mutations money (6 actions, acteur=sub, motif, before/after)           | â    | H   |
| ImmuabilitÃ© append-only (triggers, RLS FORCE)                                           | â    | H   |
| Idempotence anti double-crÃ©dit (UNIQUE + ON CONFLICT)                                   | â    | H   |
| Capture avant/aprÃ¨s en payload JSONB                                                    | â    | M   |
| Vue audit **globale** cross-org (fonction prÃªte, **endpoint absent**)                   | â ï¸ | H   |
| Pagination journal (offset bornÃ© en base, **non cÃ¢blÃ© UI** â >50 inaccessible)        | â ï¸ | M   |
| DÃ©tail/diff d'une entrÃ©e (payload transmis, UI n'affiche que le motif)                 | â ï¸ | M   |
| Minimisation payloads (troncature cosmÃ©tique ; motif libre non contrÃ´lÃ©)              | â ï¸ | M   |
| **TraÃ§age onboarding Lot 1** (crÃ©er user/org, ajouter/suspendre membre = aucune trace) | â    | H   |
| **Registre CDP des traitements** (jalon prÃ©-prod)                                       | â    | H   |
| **CDP â droits des personnes** (accÃ¨s/rectif/effacement/portabilitÃ©)                   | â    | H   |
| Filtres & recherche audit (action/acteur/cible/dates)                                    | â    | M   |
| Export journal (CSV/JSON/PDF)                                                            | â    | M   |
| TraÃ§age des **lectures sensibles** (recherche users = oracle d'Ã©numÃ©ration)           | â    | M   |
| Politique de rÃ©tention/purge                                                            | â    | M   |
| Journal d'auth SUPERADMIN                                                                | â    | M   |
| IntÃ©gritÃ© forte (hash-chain, TSA, WORM)                                                | â    | B   |
| Alerting anomalies                                                                       | â    | B   |

### Tableau de bord & observabilitÃ©

| Workflow                                                                              | St.  | P   |
| ------------------------------------------------------------------------------------- | ---- | --- |
| **Page d'accueil /admin** (aujourd'hui simple `redirect('/admin/orgs')`)              | â    | H   |
| **KPIs globaux** (nb orgs par statut, users, PV, quota allouÃ©/consommÃ©)             | â    | H   |
| **Compteur PV global** cross-tenant                                                   | â    | H   |
| Alerte Â« abos expirant bientÃ´t Â» (on sait dire _dÃ©jÃ _ expirÃ©, pas _va_ expirer) | â ï¸ | H   |
| Alerte Â« quotas pleins Â» (barre par org, aucun remontÃ©e proactive)                 | â ï¸ | H   |
| Filtrer orgs suspendues (client-side, non fiable > 1 page)                            | â ï¸ | M   |
| Classement gros consommateurs (par org OK, pas de top plateforme)                     | â ï¸ | B   |
| SantÃ© systÃ¨me surfacÃ©e (health existe, jamais affichÃ©e, liveness statique)        | â ï¸ | M   |
| Flux d'activitÃ© admin rÃ©cent (dashboard)                                            | â    | M   |
| SantÃ© approfondie (readiness DB, version, latence)                                   | â    | M   |
| Tendances d'usage (sÃ©rie temporelle)                                                 | â    | M   |
| ObservabilitÃ© opÃ©rationnelle (4xx/5xx, latence â relÃ¨ve devops)                    | â    | B   |
| Export statistiques                                                                   | â    | B   |

### Supervision PV & livrables

| Workflow                                                                       | St.  | P   |
| ------------------------------------------------------------------------------ | ---- | --- |
| VÃ©rif sceau/intÃ©gritÃ© (primitive `verifySeal` prÃªte, rÃ©servÃ©e au tenant) | â ï¸ | H   |
| RÃ©gÃ©nÃ©ration PDF (dÃ©terministe, tenant-only)                               | â ï¸ | M   |
| Suivi livrables par org (ledger mois courant, pas d'historique)                | â ï¸ | M   |
| **Registre PV cross-tenant** (aucune route admin)                              | â    | H   |
| **Recherche PV par numÃ©ro** (global)                                          | â    | H   |
| **Consultation admin d'un PV** (litige/support)                                | â    | H   |
| **Audit d'intÃ©gritÃ© en masse** (dÃ©tection de sceaux cassÃ©s tous tenants)   | â    | H   |
| Distribution des verdicts (oversight qualitÃ©)                                 | â    | M   |
| RÃ©conciliation PV â ledger                                                    | â    | M   |
| Invalidation/rÃ©vocation d'un PV (void/superseded)                             | â    | M   |
| VÃ©rification publique par nÂ°+hash (P2)                                       | â    | M   |
| Oversight numÃ©rotation (gaps/numÃ©ros brÃ»lÃ©s)                               | â    | B   |
| Oversight cryptographique (key id, rotation)                                   | â    | B   |
| Export registre PV (CDP)                                                       | â    | B   |

### SÃ©curitÃ©, RBAC & sessions

| Workflow                                                                        | St.  | P   |
| ------------------------------------------------------------------------------- | ---- | --- |
| Garde RBAC `@Roles(SUPERADMIN)` serveur (deny-by-default)                       | â    | H   |
| Garde front shell /admin (redirect anti-oracle)                                 | â    | H   |
| Middleware Edge (prÃ©sence token)                                               | â    | M   |
| IdentitÃ© = sub JWT vÃ©rifiÃ©, jamais le body (#42)                             | â    | H   |
| Durcissement JWT (HS256 figÃ©, anti alg-confusion/none, typ)                    | â    | H   |
| RÃ©vocation temps rÃ©el par relecture DB                                        | â    | H   |
| Refresh revalide l'Ã©tat du compte                                              | â    | H   |
| Idempotence money obligatoire (topup/renew)                                     | â    | H   |
| **Cookie httpOnly** (token JS-readable â XSS = compromission cross-tenant)      | â ï¸ | H   |
| **Matrice SUPPORT/SUPERADMIN** (rÃ´le existe, aucun handler ne l'accorde)       | â ï¸ | H   |
| Anti-Ã©numÃ©ration (login OK ; recherche users **non journalisÃ©e**)            | â ï¸ | M   |
| Rate limiting (global 60/min, pas de politique login renforcÃ©e)                | â ï¸ | M   |
| Confirmation forte slug (friction UX, pas une rÃ©-auth)                         | â ï¸ | M   |
| Anti-CSRF (faible aujourd'hui ; requis si migration httpOnly)                   | â ï¸ | B   |
| Politique mot de passe (argon2id OK, pas de rotation)                           | â ï¸ | B   |
| **RÃ©vocation de session / logout serveur** (pas de `/auth/logout`, pas de jti) | â    | H   |
| **RÃ©-auth step-up** sur money/suspension                                       | â    | H   |
| Audit des accÃ¨s en lecture cross-tenant                                        | â    | M   |
| MFA/2FA comptes plateforme                                                      | â    | M   |
| Gestion des sessions actives (voir/rÃ©voquer)                                   | â    | M   |
| Restriction rÃ©seau (IP allowlist /admin)                                       | â    | B   |
| Alerte anomalie SUPERADMIN                                                      | â    | B   |

> **Doublons inter-domaines fusionnÃ©s** : _Transfert OWNER_ (Membres â¡ Org), _RBAC SUPPORT lecture_ (Membres â¡ Users â¡ SÃ©curitÃ© â mÃªme dette de cadrage Â§2.4), _Vue audit globale_ (Audit â¡ Dashboard Â« flux d'activitÃ© Â»), _Filtre statut org_ (Org â¡ Dashboard Â« orgs suspendues Â»), _effacement CDP_ (Org â¡ Membres â¡ Users). ComptÃ©s une fois dans le dÃ©compte.

---

## 3. Feuille de route priorisÃ©e

### Vague 1 â Ã faire (validÃ© titulaire)

| #   | Item                                                                                                                                                                                                                                                                                                                                                                         | Effort | Agents                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Corriger le dÃ©faut de route** â page d'accueil `/admin` renvoie aujourd'hui un simple redirect ; poser une vraie landing (remplacÃ©e par le dashboard #2). VÃ©rifier au passage l'absence de 404 sur `/app`/`/admin`.                                                                                                                                                     | **S**  | dev-frontend                                                                                                                                                |
| 2   | **Tableau de bord d'accueil** `/admin` : KPIs globaux (orgs actives/suspendues/archivÃ©es, users, PV Ã©mis, quota allouÃ©/consommÃ©) + alertes (abos expirant J-30/15/7, quotas â¥ 90 %) + flux d'activitÃ© rÃ©cent. NÃ©cessite une **DEFINER cross-tenant `admin_platform_stats`** (agrÃ©gats seulement, minimisation CDP) + endpoint `GET /admin/stats` + entrÃ©e sidebar. | **L**  | dev-backend (agrÃ©gats DEFINER), dev-frontend (page+widgets), ingenieur-securite (revue cross-tenant/RLS), qa-test (isolation des agrÃ©gats), qa-challenger |
| 3   | **Vue d'audit globale** cross-org : la fonction `admin_list_audit(p_org_id DEFAULT NULL)` **sait dÃ©jÃ ** faire le mode global â n'exposer qu'un `GET /admin/audit` + page/filtre (action/acteur/pÃ©riode). Amorce Ã  ~90 %.                                                                                                                                                 | **M**  | dev-backend (endpoint), dev-frontend (page+filtres), ingenieur-securite, qa-challenger                                                                      |
| 4   | **Console abonnements transverse** `/admin/subscriptions` : liste money-centrÃ©e filtrable/triable (expirÃ©s, expirant < 30 j, quota > 90 %, sans abo, par pack) + agrÃ©gats. Ajoute un paramÃ¨tre statut/tri Ã  `admin_list_orgs` **au SQL** (corrige au passage le filtre client-side et la pagination faussÃ©e).                                                          | **M**  | dev-backend (SQL filtres/tri), dev-frontend, qa-test                                                                                                        |
| 5   | **Backport audit onboarding** : tracer `createUser` / `createOrg` / `addMember` / `setMemberActive` dans `admin_audit_log` (dette actÃ©e cadrage Â§2.1). Les mutations money Lot 2 sont **dÃ©jÃ  tracÃ©es** â ici on rend le journal _exhaustif_ en amont.                                                                                                                   | **M**  | dev-backend (INSERT audit atomique dans les DEFINER 0004/0005/0011), qa-test (test prÃ©sence de trace), qa-challenger                                       |

> ChaÃ®ne Vague 1 : dev-backend/dev-frontend (build) â ingenieur-securite (isolation cross-tenant sur #2/#3 = zone sensible, donnÃ©es de BE tiers) â qa-test (tests d'isolation + non-rÃ©gression) â **qa-challenger (revue adverse rÃ©elle, DoD Â§6)** avant livraison. Item #2 est le plus lourd : dÃ©couper backend (DEFINER) / frontend (widgets) par propriÃ©tÃ© de fichiers.

### Vague 2 â ComplÃ©ments Ã  fort ROI

- **UI Â« Ajouter un membre Â»** (endpoint + recherche dÃ©jÃ  lÃ , il ne manque que le modal) â dÃ©bloque un workflow cÅur cassÃ© cÃ´tÃ© UX.
- **Reset mot de passe** + **dÃ©sactivation/rÃ©activation du compte global** (`is_active`) â ops de premier ordre, rÃ©utilisent argon2id/`auth_get_user_state`.
- **Rattacher un abo Ã  une org existante** (`POST /admin/orgs/:id/subscription`) â sort une org du blocage dÃ©finitif 403.
- **Transfert d'OWNER** (`transfer_ownership` DEFINER atomique : promeut B, rÃ©trograde A, anti-lockout, tracÃ©) â mutualisable entre domaines Org et Membres.
- **Ãdition identitÃ© org** (nom/slug) â attention effet de bord slug â numÃ©rotation PV `PV-RDS-{slug}-{YYYY}`.
- **Registre PV cross-tenant + recherche par numÃ©ro + consultation admin** (patron `admin_list_orgs`, rÃ©utilise `verifySeal`/`pdfForView`) â support/litige.
- **Matrice RBAC SUPPORT (lecture) / SUPERADMIN (Ã©criture)** par handler â le rÃ´le existe, il est aujourd'hui inassignable et sans effet.
- **Fiche user** (dÃ©tail + liste des orgs/rÃ´les + vue appartenances cross-org) â offboarding.
- **DÃ©tail/diff d'une entrÃ©e d'audit** + pagination rÃ©elle (audit & orgs) â le payload before/after est dÃ©jÃ  transmis, non rendu.
- **Grille packâentitlementsâquota cÃ´tÃ© serveur** â supprime la duplication frontâwizard et le risque d'Ã©crasement des entitlements.

### Vague 3 â Nice-to-have / durcissement prÃ©-prod / Phase 2

- **Bloquants sÃ©curitÃ© prÃ©-prod** (Ã  traiter avec devops/sÃ©cu, hors Â« confort Â») : cookie **httpOnly** + Route Handler proxy, **rÃ©vocation de session** (`/auth/logout` + table `refresh_tokens`/jti), **rÃ©-auth step-up** sur money/suspension, MFA/2FA plateforme.
- **Jalon CDP** (fiscal-juridique + ingenieur-securite, _avant prod_) : registre des traitements, droits des personnes (accÃ¨s/rectif/effacement â plutÃ´t **anonymisation** que purge, tension avec l'immuabilitÃ© de l'audit), traÃ§age des lectures sensibles, politique de rÃ©tention.
- Export CSV (inventaire, audit, PV, stats), tri configurable, actions groupÃ©es, notifications e-mail, tendances d'usage/sÃ©ries temporelles.
- Supervision PV avancÃ©e : audit d'intÃ©gritÃ© en masse (job dÃ©tectant les sceaux cassÃ©s), invalidation/void, rÃ©conciliation PVâledger, oversight numÃ©rotation, vÃ©rification publique en ligne, key id/rotation crypto (cohÃ©rent avec le threat model PV â Phase 2).
- ObservabilitÃ© technique (4xx/5xx, latence, readiness DB), restriction rÃ©seau /admin, alerting anomalies. Export comptable/PayDunya = Phase 2.

---

## 4. Angles morts (non listÃ©s par les lecteurs)

1. **Aucun test d'isolation sur les futures DEFINER cross-tenant d'agrÃ©gat.** Les KPIs globaux et le registre PV vont, par nature, **contourner la RLS** (asAppRole/bootstrap). C'est exactement la zone oÃ¹ une erreur = fuite cross-tenant. Il faut un golden-master d'isolation _dÃ©diÃ© aux agrÃ©gats_ (un tenant ne doit jamais voir apparaÃ®tre les chiffres d'un autre, mÃªme agrÃ©gÃ©s Ã  la maille org). Ã exiger dÃ¨s la Vague 1 #2/#3.

2. **CohÃ©rence transactionnelle orgâaboâmembre non supervisÃ©e.** Le wizard permet une org sans abo (fail-closed voulu), mais rien ne **remonte** l'inventaire des Ã©tats incohÃ©rents (orgs sans abo, orgs sans aucun OWNER actif, abos orphelins). Un back-office pro a un Ã©cran Â« anomalies de donnÃ©es Â» ; ici il faudrait le dÃ©duire.

3. **Recouvrement conceptuel Â« Suspendre Â» vs Â« Retirer Â» (membre)** et Â« Suspendre Â» vs Â« Archiver Â» (org) : mÃªmes effets techniques (`is_active=false` / non-ACTIVE), sÃ©mantiques distinctes non matÃ©rialisÃ©es. Risque d'ambiguÃ¯tÃ© d'exploitation Ã  clarifier cÃ´tÃ© UX **avant** d'ajouter d'autres actions.

4. **Pas de vue Â« qui a accÃ¨s Ã  quoi Â» cÃ´tÃ© SUPERADMIN plateforme.** On sait auditer les _mutations_, mais aucune vue ne rÃ©pond Ã  Â« quels comptes ont `platform_role` SUPERADMIN/SUPPORT aujourd'hui Â». Un back-office privilÃ©giÃ© devrait lister ses propres dÃ©tenteurs de privilÃ¨ge (et dÃ©tecter un SUPERADMIN de trop).

5. **Absence de scheduler/cron dans toute la plateforme.** ConfirmÃ© par le domaine Abonnements. Or plusieurs items (alertes d'expiration proactives, audit d'intÃ©gritÃ© PV en masse, rÃ©tention/purge CDP) **prÃ©supposent** un ordonnanceur. C'est une brique d'infra transverse Ã  cadrer avec devops-cloud, pas un workflow isolÃ© â sinon ces items resteront Â« au mieux Â» rÃ©actifs.

6. **Non-rÃ©pudiation des PV vs onboarding SUPERADMIN.** Le SUPERADMIN fixe le mot de passe initial â l'acteur d'un PV scellÃ© ne maÃ®trise pas son secret. L'invitation par lien (relÃ©guÃ©e P2) n'est pas un simple confort : elle conditionne la **valeur probante** des PV. Ã relier explicitement au durcissement du sceau, pas Ã  traiter isolÃ©ment.

7. **RÃ©versibilitÃ© / undo.** Aucune action destructive (suspension, changement de rÃ´le, top-up nÃ©gatif) n'a de parcours d'annulation guidÃ© au-delÃ  de la trace d'audit. Sur une console money, un Â« annuler la derniÃ¨re action Â» (compensation tracÃ©e) rÃ©duirait le risque d'erreur d'ops.

8. **i18n / fuseau horaire d'affichage.** Les dates d'audit/expiration sont en `now()` serveur ; aucun lecteur ne mentionne l'affichage en heure locale Dakar (UTC) ni la cohÃ©rence des seuils d'expiration (jour civil serveur vs client). DÃ©tail, mais source classique de Â« J-1 Â» erronÃ©s sur les relances commerciales.

Fichiers pivots pour la Vague 1 : `apps/api/src/admin/admin.controller.ts`, `apps/api/src/admin/admin-orgs.service.ts` / `admin-mutations.service.ts`, migrations `0012`/`0013` (fonctions DEFINER), `apps/web/src/app/admin/page.tsx` (redirect Ã  remplacer), `apps/web/src/components/admin/AdminSidebar.tsx` (NAV_ITEMS Ã  Ã©tendre), `apps/web/src/components/admin/AuditTab.tsx` (pagination/diff Ã  cÃ¢bler)."
},
"workflowProgress": [
{
"type": "workflow_phase",
"index": 1,
"title": "Inventaire"
},
{
"type": "workflow_phase",
"index": 2,
"title": "SynthÃ¨se"
},
{
"type": "workflow_agent",
"index": 1,
"label": "inv:Cycle de vie Organisation",
"phaseIndex": 1,
"phaseTitle": "Inventaire",
"agentId": "a37b001473a515640",
"model": "claude-opus-4-8[1m]",
"state": "done",
"startedAt": 1783277607487,
"queuedAt": 1783277607442,
"attempt": 1,
"lastToolName": "StructuredOutput",
"lastToolSummary": "Cycle de vie Organisation (back-office SUPERADMIN)",
"promptPreview": "Contexte : back-office SUPERADMIN d'une plateforme SaaS multi-tenant (GEOFAM/ROADSEN).
Code back = apps/api/src (NestJS/Prisma) â notamment admin-orgs.service.ts, admin-users.service.ts,
admin-mutations.service.ts et leurs controllers ; migrations prisma/migrations/0011..0013.
Code front = apps/web/src/app/admin/** et apps/web/src/components/admin/** (shell /admin, pages orgs/users, OrgDetailClienâ¦",
"lastProgressAt": 1783277780592,
"tokens": 105161,
"toolCalls": 18,
"durationMs": 173105,
"resultPreview": "{"domain":"Cycle de vie Organisation (back-office SUPERADMIN)","items":[{"workflow":"CrÃ©ation d'organisation (wizard 3 Ã©tapes : OWNER â Org â Abonnement)","status":"existant","evidence":"apps/web/src/app/admin/orgs/new/page.tsx (wizard) ; POST /admin/orgs (admin.controller.ts:195-220) â auth.provisionOrg + subscriptions.provision ; createOrgSchema (auth/dto.ts:57) ; provision_org/provision_subscriâ¦"
},
{
"type": "workflow_agent",
"index": 2,
"label": "inv:Abonnements & money",
"phaseIndex": 1,
"phaseTitle": "Inventaire",
"agentId": "a0c94ceee59608699",
"model": "claude-opus-4-8[1m]",
"state": "done",
"startedAt": 1783277607489,
"queuedAt": 1783277607443,
"attempt": 1,
"lastToolName": "StructuredOutput",
"lastToolSummary": "Abonnements & money (back-office SUPERADMIN GEOFAM/ROADSEN)",
"promptPreview": "Contexte : back-office SUPERADMIN d'une plateforme SaaS multi-tenant (GEOFAM/ROADSEN).
Code back = apps/api/src (NestJS/Prisma) â notamment admin-orgs.service.ts, admin-users.service.ts,
admin-mutations.service.ts et leurs controllers ; migrations prisma/migrations/0011..0013.
Code front = apps/web/src/app/admin/** et apps/web/src/components/admin/** (shell /admin, pages orgs/users, OrgDetailClienâ¦",
"lastProgressAt": 1783277733397,
"tokens": 89800,
"toolCalls": 14,
"durationMs": 125908,
"resultPreview": "{"domain":"Abonnements & money (back-office SUPERADMIN GEOFAM/ROADSEN)","items":[{"workflow":"CrÃ©er un abonnement Ã  la crÃ©ation d'org (wizard onboarding)","status":"existant","evidence":"POST /admin/orgs avec body.subscription â SubscriptionsService.provision â fonction DEFINER provision_subscription (migration 0013 Â§3bis, idempotente ON CONFLICT org_id DO NOTHING). admin.controller.ts L195-220 ; â¦"
},
{
"type": "workflow_agent",
"index": 3,
"label": "inv:Membres & accÃ¨s contrÃ´lÃ©s",
"phaseIndex": 1,
"phaseTitle": "Inventaire",
"agentId": "a5d90aeeafe5ffc04",
"model": "claude-opus-4-8[1m]",
"state": "done",
"startedAt": 1783277607491,
"queuedAt": 1783277607443,
"attempt": 1,
"lastToolName": "StructuredOutput",
"lastToolSummary": "Membres & accÃ¨s contrÃ´lÃ©s (back-office SUPERADMIN GEOFAM/ROâ¦",
"promptPreview": "Contexte : back-office SUPERADMIN d'une plateforme SaaS multi-tenant (GEOFAM/ROADSEN).
Code back = apps/api/src (NestJS/Prisma) â notamment admin-orgs.service.ts, admin-users.service.ts,
admin-mutations.service.ts et leurs controllers ; migrations prisma/migrations/0011..0013.
Code front = apps/web/src/app/admin/** et apps/web/src/components/admin/** (shell /admin, pages orgs/users, OrgDetailClienâ¦",
"lastProgressAt": 1783277831695,
"tokens": 72189,
"toolCalls": 19,
"durationMs": 224204,
"resultPreview": "{"domain":"Membres & accÃ¨s contrÃ´lÃ©s (back-office SUPERADMIN GEOFAM/ROADSEN)","items":[{"workflow":"Lister les membres d'une organisation (identitÃ© + rÃ´le + statut actif/suspendu + calculs consommÃ©s ce mois)","status":"existant","evidence":"GET /admin/orgs/:orgId/members -> apps/api/src/admin/admin.controller.ts:264 -> MembersService.listMembers (apps/api/src/admin/members.service.ts:130, list_orgâ¦"
},
{
"type": "workflow_agent",
"index": 4,
"label": "inv:Utilisateurs & identitÃ©",
"phaseIndex": 1,
"phaseTitle": "Inventaire",
"agentId": "af531ee1beffac754",
"model": "claude-opus-4-8[1m]",
"state": "done",
"startedAt": 1783277607492,
"queuedAt": 1783277607443,
"attempt": 1,
"lastToolName": "StructuredOutput",
"lastToolSummary": "Utilisateurs & identitÃ© (back-office SUPERADMIN)",
"promptPreview": "Contexte : back-office SUPERADMIN d'une plateforme SaaS multi-tenant (GEOFAM/ROADSEN).
Code back = apps/api/src (NestJS/Prisma) â notamment admin-orgs.service.ts, admin-users.service.ts,
admin-mutations.service.ts et leurs controllers ; migrations prisma/migrations/0011..0013.
Code front = apps/web/src/app/admin/** et apps/web/src/components/admin/** (shell /admin, pages orgs/users, OrgDetailClienâ¦",
"lastProgressAt": 1783277765176,
"tokens": 50062,
"toolCalls": 13,
"durationMs": 157684,
"resultPreview": "{"domain":"Utilisateurs & identitÃ© (back-office SUPERADMIN)","items":[{"workflow":"Rechercher des utilisateurs (email / nom)","status":"existant","evidence":"GET /admin/users (admin.controller.ts:164-170) -> AdminUsersService.searchUsers (admin-users.service.ts) via fonction DEFINER admin_search_users(q,limit) (migration 0012) ; front /admin/users (apps/web/src/app/admin/users/page.tsx) + apps/webâ¦"
},
{
"type": "workflow_agent",
"index": 5,
"label": "inv:Audit, journal & conformitÃ©",
"phaseIndex": 1,
"phaseTitle": "Inventaire",
"agentId": "ac3b09e3e391beb21",
"model": "claude-opus-4-8[1m]",
"state": "done",
"startedAt": 1783277607492,
"queuedAt": 1783277607443,
"attempt": 1,
"lastToolName": "StructuredOutput",
"lastToolSummary": "Audit, journal & conformitÃ©",
"promptPreview": "Contexte : back-office SUPERADMIN d'une plateforme SaaS multi-tenant (GEOFAM/ROADSEN).
Code back = apps/api/src (NestJS/Prisma) â notamment admin-orgs.service.ts, admin-users.service.ts,
admin-mutations.service.ts et leurs controllers ; migrations prisma/migrations/0011..0013.
Code front = apps/web/src/app/admin/** et apps/web/src/components/admin/** (shell /admin, pages orgs/users, OrgDetailClienâ¦",
"lastProgressAt": 1783277802622,
"tokens": 73627,
"toolCalls": 15,
"durationMs": 195129,
"resultPreview": "{"domain":"Audit, journal & conformitÃ©","items":[{"workflow":"Consulter le journal d'audit d'une organisation","status":"existant","evidence":"GET /admin/orgs/:orgId/audit (admin.controller.ts:410-416) -> AdminMutationsService.listAudit (admin-mutations.service.ts:188-209) -> fonction SQL admin_list_audit (0013 migration.sql:825-861) ; UI onglet AuditTab.tsx (colonnes Date/Action/Acteur/Cible/Motiâ¦"
},
{
"type": "workflow_agent",
"index": 6,
"label": "inv:Tableau de bord & observabilitÃ©",
"phaseIndex": 1,
"phaseTitle": "Inventaire",
"agentId": "a615882654ec04213",
"model": "claude-opus-4-8[1m]",
"state": "done",
"startedAt": 1783277607493,
"queuedAt": 1783277607443,
"attempt": 1,
"lastToolName": "StructuredOutput",
"lastToolSummary": "Tableau de bord & observabilitÃ© (back-office SUPERADMIN GEOâ¦",
"promptPreview": "Contexte : back-office SUPERADMIN d'une plateforme SaaS multi-tenant (GEOFAM/ROADSEN).
Code back = apps/api/src (NestJS/Prisma) â notamment admin-orgs.service.ts, admin-users.service.ts,
admin-mutations.service.ts et leurs controllers ; migrations prisma/migrations/0011..0013.
Code front = apps/web/src/app/admin/** et apps/web/src/components/admin/** (shell /admin, pages orgs/users, OrgDetailClienâ¦",
"lastProgressAt": 1783277746685,
"tokens": 51031,
"toolCalls": 15,
"durationMs": 139192,
"resultPreview": "{"domain":"Tableau de bord & observabilitÃ© (back-office SUPERADMIN GEOFAM/ROADSEN)","items":[{"workflow":"Page d'accueil /admin (tableau de bord)","status":"manquant","evidence":"apps/web/src/app/admin/page.tsx = simple redirect('/admin/orgs'), aucun contenu ; apps/web/src/components/admin/AdminSidebar.tsx n'a QUE 2 entrÃ©es (Organisations / Utilisateurs) ; docs/cadrage-backoffice.md ne prÃ©voit aucâ¦"
},
{
"type": "workflow_agent",
"index": 7,
"label": "inv:Supervision PV & livrables",
"phaseIndex": 1,
"phaseTitle": "Inventaire",
"agentId": "adfd7a3137b017622",
"model": "claude-opus-4-8[1m]",
"state": "done",
"startedAt": 1783277733398,
"queuedAt": 1783277607444,
"attempt": 1,
"lastToolName": "StructuredOutput",
"lastToolSummary": "Supervision PV & livrables (back-office SUPERADMIN)",
"promptPreview": "Contexte : back-office SUPERADMIN d'une plateforme SaaS multi-tenant (GEOFAM/ROADSEN).
Code back = apps/api/src (NestJS/Prisma) â notamment admin-orgs.service.ts, admin-users.service.ts,
admin-mutations.service.ts et leurs controllers ; migrations prisma/migrations/0011..0013.
Code front = apps/web/src/app/admin/** et apps/web/src/components/admin/** (shell /admin, pages orgs/users, OrgDetailClienâ¦",
"lastProgressAt": 1783277884165,
"tokens": 51287,
"toolCalls": 10,
"durationMs": 150767,
"resultPreview": "{"domain":"Supervision PV & livrables (back-office SUPERADMIN)","items":[{"workflow":"Registre des PV Ã©mis â liste cross-tenant (tous BE)","status":"manquant","evidence":"Aucune route admin. Toute la surface PV est tenant-scoped sous /projects/:projectId/pvs (apps/api/src/pv/pv.controller.ts:191 listPvs â PvService.listForProject, requireOrgId). AdminController (apps/api/src/admin/admin.controllerâ¦"
},
{
"type": "workflow_agent",
"index": 8,
"label": "inv:SÃ©curitÃ© & RBAC & sessions",
"phaseIndex": 1,
"phaseTitle": "Inventaire",
"agentId": "a4f39063463abe66a",
"model": "claude-opus-4-8[1m]",
"state": "done",
"startedAt": 1783277746686,
"queuedAt": 1783277607444,
"attempt": 1,
"lastToolName": "StructuredOutput",
"lastToolSummary": "SÃ©curitÃ©, RBAC & sessions â back-office SUPERADMIN (GEOFAM/â¦",
"promptPreview": "Contexte : back-office SUPERADMIN d'une plateforme SaaS multi-tenant (GEOFAM/ROADSEN).
Code back = apps/api/src (NestJS/Prisma) â notamment admin-orgs.service.ts, admin-users.service.ts,
admin-mutations.service.ts et leurs controllers ; migrations prisma/migrations/0011..0013.
Code front = apps/web/src/app/admin/** et apps/web/src/components/admin/** (shell /admin, pages orgs/users, OrgDetailClienâ¦",
"lastProgressAt": 1783277942503,
"tokens": 75365,
"toolCalls": 22,
"durationMs": 195817,
"resultPreview": "{"domain":"SÃ©curitÃ©, RBAC & sessions â back-office SUPERADMIN (GEOFAM/ROADSEN)","items":[{"workflow":"Garde serveur RBAC @Roles(SUPERADMIN) sur toutes les routes admin","status":"existant","evidence":"apps/api/src/auth/roles.guard.ts (deny-by-default, rÃ©solution paresseuse du platformRole via auth_get_platform_role) ; apps/api/src/admin/admin.controller.ts:94-96 (@Controller('admin') @NoTenant() @â¦"
},
{
"type": "workflow_agent",
"index": 9,
"label": "synthÃ¨se-inventaire",
"phaseIndex": 2,
"phaseTitle": "SynthÃ¨se",
"agentId": "a4bbfdce7cc8fa691",
"model": "claude-opus-4-8[1m]",
"state": "done",
"startedAt": 1783277942518,
"queuedAt": 1783277942517,
"attempt": 1,
"promptPreview": "Voici l'inventaire brut des workflows du back-office SUPERADMIN, agrÃ©gÃ© de 8 lecteurs par domaine (JSON) :

[
{
"workflow": "CrÃ©ation d'organisation (wizard 3 Ã©tapes : OWNER â Org â Abonnement)",
"status": "existant",
"evidence": "apps/web/src/app/admin/orgs/new/page.tsx (wizard) ; POST /admin/orgs (admin.controller.ts:195-220) â auth.provisionOrg + subscriptions.provision ; createOrâ¦",
"lastProgressAt": 1783278107659,
"tokens": 62343,
"toolCalls": 0,
"durationMs": 165140,
"resultPreview": "# SynthÃ¨se â Back-office SUPERADMIN GEOFAM/ROADSEN : cartographie des workflows

## 1. Vue d'ensemble

**DÃ©compte (124 workflows recensÃ©s, doublons inter-lecteurs fusionnÃ©s) :**

| Statut                                                       | Nombre | Part  |
| ------------------------------------------------------------ | ------ | ----- |
| â Existant (bout en bout)                                    | 28     | ~23 % |
| â ï¸ Partiel (socle prÃ©sent, cÃ¢blage/UI/portÃ©e manquants) | 31     | ~25 % |
| â Manquant                                                   | 65     | ~52 % |

\*\*Verdict de maturitÃ© : socle sÃ»r, â¦"
}
],
"totalTokens": 630865,
"totalToolCalls": 126
}
